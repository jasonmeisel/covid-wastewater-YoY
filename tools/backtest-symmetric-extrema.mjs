#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';
import { buildSeries, identifyWaves, quantile } from '../js/stats.js';
import { backtestGaussianWaveEnd } from './gaussian-wave-backtest.mjs';
import { smoothTimelineLikeChart } from './train-wave-model.mjs';

const DAY = 86400000;
const dayNumber = date => Math.floor(Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`) / DAY);
const formatDay = day => new Date(day * DAY).toISOString().slice(0, 10);

/**
 * Estimate a wave end from a chart-smoothed trough-to-peak duration. The centered
 * 30-day smoother only supplies peaks at least 15 days behind the issue date, so
 * every value used to confirm the peak is available at forecast time.
 */
export function symmetricExtremaEstimate(points, cutoffDate, targetPeakDate = null, baselineP90 = null) {
  const cutoffDay = dayNumber(cutoffDate);
  if (!Number.isFinite(cutoffDay)) return null;
  const prefix = (points || []).filter(point => dayNumber(point.originalDate) <= cutoffDay);
  const smooth = smoothTimelineLikeChart(prefix, 30);
  if (smooth.length < 31) return null;
  const lastSmoothedDay = smooth.at(-1).day;
  const confirmedThrough = lastSmoothedDay - 15;
  const targetPeakDay = targetPeakDate ? dayNumber(targetPeakDate) : null;
  const peakCandidates = [];
  for (let index = 1; index < smooth.length - 1; index++) {
    const point = smooth[index];
    if (point.day > confirmedThrough || point.day > cutoffDay - 15) continue;
    if (point.y >= smooth[index - 1].y && point.y > smooth[index + 1].y) {
      if (targetPeakDay !== null && Math.abs(point.day - targetPeakDay) > 45) continue;
      peakCandidates.push({ index, point });
    }
  }
  if (!peakCandidates.length) return null;
  const peakCandidate = targetPeakDay === null
    ? peakCandidates.at(-1)
    : peakCandidates.reduce((best, candidate) => candidate.point.y > best.point.y ? candidate : best);
  const peak = peakCandidate.point;

  // Use the lowest point in the preceding 12-week window, matching the local
  // scale used by the wave detector while allowing the smoothed trough to shift.
  const troughCandidates = smooth.filter(point => point.day >= peak.day - 84 && point.day <= peak.day - 15);
  if (!troughCandidates.length) return null;
  const trough = troughCandidates.reduce((lowest, point) => point.y < lowest.y ? point : lowest);
  if (!(trough.y > 0) || peak.y / trough.y < 1.7) return null;
  const riseDays = peak.day - trough.day;
  if (!(riseDays > 0)) return null;
  if (!(Number.isFinite(baselineP90) && baselineP90 > trough.y && baselineP90 < peak.y)) return null;
  const crossingFraction = (peak.y - baselineP90) / (peak.y - trough.y);
  const predictedEndDay = peak.day + riseDays * crossingFraction;
  if (predictedEndDay <= cutoffDay) return null;
  return {
    forecastDate: formatDay(Math.ceil(predictedEndDay)),
    localTroughDate: formatDay(trough.day),
    localTroughValue: trough.y,
    localPeakDate: formatDay(peak.day),
    localPeakValue: peak.y,
    riseDays,
    prominenceRatio: peak.y / trough.y,
    baselineP90,
    predictedLocalMinimumDate: formatDay(peak.day + riseDays),
    cutoffDate: formatDay(cutoffDay),
  };
}

function localPeakInWindow(smooth, targetPeakDate) {
  const targetDay = dayNumber(targetPeakDate);
  const candidates = [];
  for (let index = 1; index < smooth.length - 1; index++) {
    const point = smooth[index];
    if (Math.abs(point.day - targetDay) > 45) continue;
    if (point.y >= smooth[index - 1].y && point.y > smooth[index + 1].y) candidates.push({ index, point });
  }
  return candidates.reduce((best, candidate) => !best || candidate.point.y > best.point.y ? candidate : best, null);
}

function preWaveBaselineP90(points, waves, waveIndex) {
  const previousWave = waves[waveIndex - 1];
  const wave = waves[waveIndex];
  if (!previousWave?.endDate || !wave?.startDate) return null;
  const values = points.filter(point => point.originalDate >= previousWave.endDate && point.originalDate < wave.startDate)
    .map(point => Number(point.y)).filter(Number.isFinite).sort((a, b) => a - b);
  return values.length ? quantile(values, 0.9) : null;
}

function observedBaselineCrossing(smooth, peak, baselineP90, nextWaveStartDate) {
  const nextWaveDay = nextWaveStartDate ? dayNumber(nextWaveStartDate) : Infinity;
  for (let index = peak.index + 1; index < smooth.length; index++) {
    const point = smooth[index];
    if (point.day >= nextWaveDay) break;
    if (point.y <= baselineP90) return formatDay(point.day);
  }
  return null;
}

function summarize(rows) {
  const errors = rows.map(row => Math.abs(row.errorDays)).sort((a, b) => a - b);
  return {
    forecasts: rows.length,
    facilities: new Set(rows.map(row => row.facilityId)).size,
    waves: new Set(rows.map(row => row.waveId)).size,
    meanAbsoluteErrorDays: errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null,
    medianAbsoluteErrorDays: errors.length ? errors[Math.floor((errors.length - 1) / 2)] : null,
    within14DaysPercent: errors.length ? 100 * errors.filter(value => value <= 14).length / errors.length : null,
  };
}

function earliestByWave(rows) {
  const first = new Map();
  for (const row of rows) {
    const previous = first.get(row.waveId);
    if (!previous || row.cutoffDate < previous.cutoffDate) first.set(row.waveId, row);
  }
  return [...first.values()];
}

function matchedRawAtOrAfter(rawRows, symmetricRows) {
  const byWave = new Map();
  for (const row of rawRows) {
    const group = byWave.get(row.waveId) || [];
    group.push(row);
    byWave.set(row.waveId, group);
  }
  const matched = [];
  for (const symmetric of symmetricRows) {
    const candidate = (byWave.get(symmetric.waveId) || [])
      .filter(row => row.cutoffDate >= symmetric.cutoffDate)
      .sort((a, b) => a.cutoffDate.localeCompare(b.cutoffDate))[0];
    if (candidate) matched.push(candidate);
  }
  return matched;
}

function exactCutoffPairs(rawRows, symmetricRows) {
  const rawByKey = new Map(rawRows.map(row => [`${row.waveId}:${row.cutoffDate}`, row]));
  return symmetricRows.flatMap(symmetric => {
    const raw = rawByKey.get(`${symmetric.waveId}:${symmetric.cutoffDate}`);
    return raw ? [{ symmetric, raw }] : [];
  });
}

export async function backtestSymmetricExtrema(cacheDir = '.cache/facility-samples') {
  const files = (await readdir(cacheDir)).filter(file => file.endsWith('.json')).sort();
  const symmetryRows = [];
  const rawRows = [];
  for (const file of files) {
    const record = JSON.parse(await readFile(`${cacheDir}/${file}`, 'utf8'));
    const facilityId = record.uid || file.replace(/\.json$/, '');
    const { byYear } = buildSeries(record.samples.map(sample => ({ ...sample, _facilityUid: facilityId })));
    const points = Object.values(byYear).flat()
      .map(point => ({ ...point, _facilityUid: facilityId }))
      .sort((a, b) => a.originalDate.localeCompare(b.originalDate));
    const raw = backtestGaussianWaveEnd(points, { smoothingDays: 1, transform: 'raw' }).forecasts;
    const ordered = points.filter(point => Number(point.y) > 0)
      .map(point => ({ ...point, originalDate: String(point.originalDate).slice(0, 10) }))
      .sort((a, b) => a.originalDate.localeCompare(b.originalDate));
    const allWaves = identifyWaves(ordered);
    const chartSignal = smoothTimelineLikeChart(ordered, 30);
    const targetEnds = new Map();
    for (let waveIndex = 1; waveIndex < allWaves.length; waveIndex++) {
      const wave = allWaves[waveIndex];
      if (!wave.endDate || wave.ongoing || !wave.endConfirmed) continue;
      const baselineP90 = preWaveBaselineP90(ordered, allWaves, waveIndex);
      if (!Number.isFinite(baselineP90)) continue;
      const localPeak = localPeakInWindow(chartSignal, wave.peakDate);
      if (!localPeak || !(localPeak.point.y > baselineP90)) continue;
      const actualEndDate = observedBaselineCrossing(chartSignal, localPeak, baselineP90, allWaves[waveIndex + 1]?.startDate);
      if (!actualEndDate) continue;
      const waveId = `${facilityId}:${wave.peakDate}`;
      targetEnds.set(waveId, actualEndDate);

      const actualEndDay = dayNumber(actualEndDate);
      for (const point of ordered) {
        const cutoffDay = dayNumber(point.originalDate);
        if (cutoffDay < localPeak.point.day + 15 || cutoffDay >= actualEndDay) continue;
        const prefix = ordered.filter(candidate => candidate.originalDate <= point.originalDate);
        const prediction = symmetricExtremaEstimate(prefix, point.originalDate, wave.peakDate, baselineP90);
        if (!prediction) continue;
        symmetryRows.push({
          facilityId,
          waveId,
          cutoffDate: point.originalDate,
          actualEndDate,
          forecastDate: prediction.forecastDate,
          localTroughDate: prediction.localTroughDate,
          localPeakDate: prediction.localPeakDate,
          predictedLocalMinimumDate: prediction.predictedLocalMinimumDate,
          baselineP90,
          riseDays: prediction.riseDays,
          errorDays: dayNumber(prediction.forecastDate) - actualEndDay,
        });
        break;
      }
    }
    rawRows.push(...raw.flatMap(row => {
      const actualEndDate = targetEnds.get(row.waveId);
      return actualEndDate && row.cutoffDate < actualEndDate
        ? [{ ...row, actualEndDate, errorDays: dayNumber(row.forecastDate) - dayNumber(actualEndDate) }]
        : [];
    }));
  }

  const symmetryFirst = earliestByWave(symmetryRows);
  const rawFirst = earliestByWave(rawRows);
  const rawAtSymmetryIssue = matchedRawAtOrAfter(rawRows, symmetryFirst);
  const rawComparableIds = new Set(rawAtSymmetryIssue.map(row => row.waveId));
  const symmetryOnRawComparableWaves = symmetryFirst.filter(row => rawComparableIds.has(row.waveId));
  const exactPairs = exactCutoffPairs(rawRows, symmetryFirst);
  return {
    facilities: files.length,
    endpointRule: 'first decline-side crossing of the actual 30-day weighted-average signal below the prior quiet-period raw-value P90; the forecast line connects the 30-day-smoothed local peak to a projected local minimum one trough-to-peak duration later',
    issueRule: 'first observed cutoff at least 15 days after the detected 30-day-smoothed local peak, with a confirmed centered-window lookahead; trough is the minimum in the preceding 12 weeks; require peak/trough >= 1.7 and the baseline P90 to lie between trough and peak',
    symmetricTroughPeakForecast: summarize(symmetryFirst),
    rawGaussianEarliestAvailable: summarize(rawFirst),
    rawGaussianAtOrAfterSymmetryIssue: summarize(rawAtSymmetryIssue),
    symmetryOnSameWavesAsRawAtOrAfter: summarize(symmetryOnRawComparableWaves),
    exactSameWaveAndCutoffComparison: {
      symmetric: summarize(exactPairs.map(pair => pair.symmetric)),
      rawGaussian: summarize(exactPairs.map(pair => pair.raw)),
      pairedForecasts: exactPairs.length,
    },
    pairedAvailability: {
      symmetricWaves: symmetryFirst.length,
      rawGaussianWavesAtSymmetricIssue: rawAtSymmetryIssue.length,
      exactSameCutoffForecasts: exactPairs.length,
      symmetricExamples: symmetryFirst.slice(0, 10),
    },
  };
}

async function main() {
  process.stdout.write(`${JSON.stringify(await backtestSymmetricExtrema(), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
