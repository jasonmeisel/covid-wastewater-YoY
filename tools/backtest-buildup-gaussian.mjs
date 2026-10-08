#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';
import { buildSeries, identifyWaves, preWaveBaselineRange, quantile } from '../js/stats.js';
import { backtestGaussianWaveEnd, fitGaussian } from './gaussian-wave-backtest.mjs';
import { smoothTimelineLikeChart } from './train-wave-model.mjs';

const DAY = 86400000;
const dayNumber = date => Math.floor(Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`) / DAY);
const formatDay = day => new Date(Math.ceil(day) * DAY).toISOString().slice(0, 10);

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

function localTroughBeforePeak(smooth, peak) {
  const candidates = smooth.filter(point => point.day >= peak.day - 84 && point.day <= peak.day - 15);
  return candidates.reduce((lowest, point) => !lowest || point.y < lowest.y ? point : lowest, null);
}

/** Fit only the observed rising half; project the Gaussian decline to baseline P90. */
export function buildupGaussianPrediction(points, cutoffDate, baselineMedian, baselineP90, targetPeakDate = null) {
  const cutoffDay = dayNumber(cutoffDate);
  if (!Number.isFinite(cutoffDay) || !(baselineP90 > baselineMedian)) return null;
  const prefix = (points || []).filter(point => dayNumber(point.originalDate) <= cutoffDay);
  const smooth = smoothTimelineLikeChart(prefix, 30);
  if (smooth.length < 31) return null;
  const targetPeakDay = targetPeakDate ? dayNumber(targetPeakDate) : null;
  const peakCandidates = [];
  for (let index = 1; index < smooth.length - 1; index++) {
    const point = smooth[index];
    if (point.day > smooth.at(-1).day - 15 || point.day > cutoffDay - 15) continue;
    if (point.y >= smooth[index - 1].y && point.y > smooth[index + 1].y &&
        (targetPeakDay === null || Math.abs(point.day - targetPeakDay) <= 45)) {
      peakCandidates.push({ index, point });
    }
  }
  if (!peakCandidates.length) return null;
  const selectedPeak = targetPeakDay === null
    ? peakCandidates.at(-1)
    : peakCandidates.reduce((best, candidate) => candidate.point.y > best.point.y ? candidate : best);
  const peak = selectedPeak.point;
  const trough = localTroughBeforePeak(smooth, peak);
  if (!trough || peak.y / trough.y < 1.7) return null;
  const risingHalf = smooth.filter(point => point.day >= trough.day && point.day <= peak.day)
    .map(point => ({ day: point.day, y: point.y }));
  if (risingHalf.length < 5) return null;
  const fit = fitGaussian(risingHalf, baselineMedian);
  const thresholdDelta = baselineP90 - baselineMedian;
  if (!fit || !(fit.amplitude > thresholdDelta)) return null;
  const crossingDay = fit.mean + fit.sigma * Math.sqrt(2 * Math.log(fit.amplitude / thresholdDelta));
  if (!(crossingDay > cutoffDay) || crossingDay - cutoffDay > 365) return null;
  return {
    forecastDate: formatDay(crossingDay),
    localTroughDate: formatDay(trough.day),
    localPeakDate: formatDay(peak.day),
    fittedMeanDate: formatDay(fit.mean),
    fittedSigmaDays: fit.sigma,
    fittedAmplitude: fit.amplitude,
    fitPoints: risingHalf.length,
    cutoffDate: formatDay(cutoffDay),
  };
}

function baselineP90ForCompletedWave(points, waves, index) {
  const previous = waves[index - 1];
  const current = waves[index];
  if (!previous?.endDate || !current?.startDate) return null;
  const values = points.filter(point => point.originalDate >= previous.endDate && point.originalDate < current.startDate)
    .map(point => Number(point.y)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return null;
  return { median: quantile(values, 0.5), p90: quantile(values, 0.9) };
}

function observedP90Crossing(smooth, peak, p90, nextWaveStart) {
  const nextStartDay = nextWaveStart ? dayNumber(nextWaveStart) : Infinity;
  for (let index = peak.index + 1; index < smooth.length; index++) {
    if (smooth[index].day >= nextStartDay) break;
    if (smooth[index].y <= p90) return formatDay(smooth[index].day);
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

function earliestPerWave(rows) {
  const first = new Map();
  for (const row of rows) {
    const previous = first.get(row.waveId);
    if (!previous || row.cutoffDate < previous.cutoffDate) first.set(row.waveId, row);
  }
  return [...first.values()];
}

function sameWaveCutoffPairs(testRows, comparatorRows) {
  const map = new Map(comparatorRows.map(row => [`${row.waveId}:${row.cutoffDate}`, row]));
  return testRows.flatMap(row => {
    const comparator = map.get(`${row.waveId}:${row.cutoffDate}`);
    return comparator ? [{ test: row, comparator }] : [];
  });
}

export async function backtestBuildupGaussian(cacheDir = '.cache/facility-samples') {
  const files = (await readdir(cacheDir)).filter(file => file.endsWith('.json')).sort();
  const buildupRows = [];
  const rawGaussianRows = [];
  for (const file of files) {
    const record = JSON.parse(await readFile(`${cacheDir}/${file}`, 'utf8'));
    const facilityId = record.uid || file.replace(/\.json$/, '');
    const { byYear } = buildSeries(record.samples.map(sample => ({ ...sample, _facilityUid: facilityId })));
    const points = Object.values(byYear).flat()
      .map(point => ({ ...point, _facilityUid: facilityId, originalDate: String(point.originalDate).slice(0, 10) }))
      .sort((a, b) => a.originalDate.localeCompare(b.originalDate));
    const raw = backtestGaussianWaveEnd(points, { smoothingDays: 1, transform: 'raw' }).forecasts;
    const waves = identifyWaves(points);
    const chartSignal = smoothTimelineLikeChart(points, 30);
    const actualEnds = new Map();

    for (let waveIndex = 1; waveIndex < waves.length; waveIndex++) {
      const wave = waves[waveIndex];
      if (!wave.endDate || wave.ongoing || !wave.endConfirmed) continue;
      const baseline = baselineP90ForCompletedWave(points, waves, waveIndex);
      if (!baseline || !(baseline.p90 > baseline.median)) continue;
      const fullPeak = localPeakInWindow(chartSignal, wave.peakDate);
      if (!fullPeak || !(fullPeak.point.y > baseline.p90)) continue;
      const actualEndDate = observedP90Crossing(chartSignal, fullPeak, baseline.p90, waves[waveIndex + 1]?.startDate);
      if (!actualEndDate) continue;
      const waveId = `${facilityId}:${wave.peakDate}`;
      actualEnds.set(waveId, actualEndDate);
      const actualEndDay = dayNumber(actualEndDate);

      for (const point of points) {
        const cutoffDay = dayNumber(point.originalDate);
        if (cutoffDay < fullPeak.point.day + 15 || cutoffDay >= actualEndDay) continue;
        const prefix = points.filter(candidate => candidate.originalDate <= point.originalDate);
        const prefixWaves = identifyWaves(prefix);
        const activeWave = prefixWaves.find(candidate => candidate.ongoing && candidate.peakDate === wave.peakDate);
        const baselineAtCutoff = activeWave ? preWaveBaselineRange(prefix, prefixWaves) : null;
        if (!baselineAtCutoff) continue;
        const prediction = buildupGaussianPrediction(prefix, point.originalDate,
          baselineAtCutoff.median, baselineAtCutoff.p90, wave.peakDate);
        if (!prediction) continue;
        buildupRows.push({
          facilityId,
          waveId,
          cutoffDate: point.originalDate,
          actualEndDate,
          forecastDate: prediction.forecastDate,
          localTroughDate: prediction.localTroughDate,
          localPeakDate: prediction.localPeakDate,
          fittedMeanDate: prediction.fittedMeanDate,
          fitPoints: prediction.fitPoints,
          errorDays: dayNumber(prediction.forecastDate) - actualEndDay,
        });
        break;
      }
    }

    rawGaussianRows.push(...raw.flatMap(row => {
      const actualEndDate = actualEnds.get(row.waveId);
      return actualEndDate && row.cutoffDate < actualEndDate
        ? [{ ...row, actualEndDate, errorDays: dayNumber(row.forecastDate) - dayNumber(actualEndDate) }]
        : [];
    }));
  }

  const buildupFirst = earliestPerWave(buildupRows);
  const rawFirst = earliestPerWave(rawGaussianRows);
  const exactPairs = sameWaveCutoffPairs(buildupFirst, rawGaussianRows);
  return {
    facilities: files.length,
    method: '30-day weighted-average signal; Gaussian fitted only from local trough to confirmed local peak; extrapolated symmetric decline crosses previous quiet-period baseline P90',
    buildupOnlyGaussian: summarize(buildupFirst),
    rawUnsmoothedGaussian: summarize(rawFirst),
    exactSameWaveAndCutoff: {
      buildupOnlyGaussian: summarize(exactPairs.map(pair => pair.test)),
      rawUnsmoothedGaussian: summarize(exactPairs.map(pair => pair.comparator)),
      pairedForecasts: exactPairs.length,
    },
    examples: buildupFirst.slice(0, 10),
  };
}

async function main() {
  process.stdout.write(`${JSON.stringify(await backtestBuildupGaussian(), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
