#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';
import { buildSeries } from '../js/stats.js';
import { backtestGaussianWaveEnd } from './gaussian-wave-backtest.mjs';
import { GAUSSIAN_INTERVAL_BUCKETS, calibrateGaussianIntervals, gaussianPredictionInterval } from '../js/wave-intervals.js';

const DAY = 86400000;
const dayNumber = date => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);
const ageBucket = days => GAUSSIAN_INTERVAL_BUCKETS.find(bucket => days >= bucket.min && days <= bucket.max)?.id || 'pooled';

export function oneForecastPerWaveAgeBucket(forecasts) {
  const selected = new Map();
  for (const forecast of forecasts || []) {
    const key = `${forecast.waveId}:${ageBucket(forecast.daysSincePeak)}`;
    const previous = selected.get(key);
    if (!previous || forecast.cutoffDate < previous.cutoffDate) selected.set(key, forecast);
  }
  return [...selected.values()].sort((a, b) => a.facilityId.localeCompare(b.facilityId) ||
    a.peakDate.localeCompare(b.peakDate) || a.daysSincePeak - b.daysSincePeak);
}

export async function collectCalibrationRows(cacheDir = '.cache/facility-samples') {
  const files = (await readdir(cacheDir)).filter(file => file.endsWith('.json')).sort();
  const forecasts = [];
  for (const file of files) {
    const record = JSON.parse(await readFile(`${cacheDir}/${file}`, 'utf8'));
    const facilityId = record.uid || file.replace(/\.json$/, '');
    const { byYear } = buildSeries(record.samples.map(sample => ({ ...sample, _facilityUid: facilityId })));
    const points = Object.values(byYear).flat()
      .map(point => ({ ...point, _facilityUid: facilityId }))
      .sort((a, b) => a.originalDate.localeCompare(b.originalDate));
    forecasts.push(...backtestGaussianWaveEnd(points, { smoothingDays: 1 }).forecasts);
  }
  return { facilityCount: files.length, forecasts: oneForecastPerWaveAgeBucket(forecasts) };
}

function summarizeRows(rows, calibrateForTarget) {
  const result = {};
  const summaries = ['all', ...GAUSSIAN_INTERVAL_BUCKETS.map(bucket => bucket.id)];
  for (const method of ['absolute', 'asymmetric']) {
    const buckets = {};
    for (const bucketId of summaries) {
      const subset = bucketId === 'all' ? rows : rows.filter(row => ageBucket(row.daysSincePeak) === bucketId);
      let covered = 0;
      let widthTotal = 0;
      let intervalCount = 0;
      for (const row of subset) {
        const calibration = calibrateForTarget(row);
        const interval = gaussianPredictionInterval(row.forecastDate, row.daysSincePeak, calibration, method);
        if (!interval) continue;
        intervalCount++;
        widthTotal += interval.widthDays;
        const actualDay = dayNumber(row.actualEndDate);
        if (actualDay >= dayNumber(interval.earliestDate) && actualDay <= dayNumber(interval.latestDate)) covered++;
      }
      buckets[bucketId] = {
        targets: subset.length,
        intervals: intervalCount,
        empiricalCoveragePercent: intervalCount ? 100 * covered / intervalCount : null,
        meanWidthDays: intervalCount ? widthTotal / intervalCount : null,
      };
    }
    result[method] = buckets;
  }
  return result;
}

export function firstForecastPerWave(rows) {
  const firstByWave = new Map();
  for (const row of rows) {
    const current = firstByWave.get(row.waveId);
    if (!current || row.cutoffDate < current.cutoffDate) firstByWave.set(row.waveId, row);
  }
  return [...firstByWave.values()];
}

export function evaluateLeaveOneFacilityOut(rows, { coverage = 0.9, lowerTailShare = 0.5 } = {}) {
  const calibrateWithoutFacility = target => calibrateGaussianIntervals(
    rows.filter(row => row.facilityId !== target.facilityId), { coverage, lowerTailShare },
  );
  return {
    oneForecastPerWave: summarizeRows(firstForecastPerWave(rows), calibrateWithoutFacility),
    byForecastAge: summarizeRows(rows, calibrateWithoutFacility),
  };
}

function scoreAllocationLeaveOneFacilityOut(rows, lowerTailShare, coverage) {
  let covered = 0;
  let widthTotal = 0;
  let intervals = 0;
  for (const facilityId of new Set(rows.map(row => row.facilityId))) {
    const training = rows.filter(row => row.facilityId !== facilityId);
    const calibration = calibrateGaussianIntervals(training, { coverage, lowerTailShare });
    for (const row of rows.filter(candidate => candidate.facilityId === facilityId)) {
      const interval = gaussianPredictionInterval(row.forecastDate, row.daysSincePeak, calibration, 'asymmetric');
      if (!interval) continue;
      intervals++;
      widthTotal += interval.widthDays;
      const actualDay = dayNumber(row.actualEndDate);
      if (actualDay >= dayNumber(interval.earliestDate) && actualDay <= dayNumber(interval.latestDate)) covered++;
    }
  }
  return {
    intervals,
    empiricalCoverage: intervals ? covered / intervals : 0,
    meanWidthDays: intervals ? widthTotal / intervals : Infinity,
  };
}

export function tuneGaussianIntervalsLeaveOneFacilityOut(rows, {
  coverage = 0.75,
  lowerTailShares = Array.from({ length: 17 }, (_, index) => (index + 2) / 20),
} = {}) {
  const testRows = firstForecastPerWave(rows);
  const selectedShares = [];
  let covered = 0;
  let widthTotal = 0;
  let intervals = 0;
  let innerPasses = 0;
  for (const facilityId of new Set(testRows.map(row => row.facilityId))) {
    const outerTraining = testRows.filter(row => row.facilityId !== facilityId);
    const outerTargets = testRows.filter(row => row.facilityId === facilityId);
    const candidates = lowerTailShares.map(share => ({
      share,
      score: scoreAllocationLeaveOneFacilityOut(outerTraining, share, coverage),
    }));
    const passing = candidates.filter(candidate => candidate.score.intervals > 0 && candidate.score.empiricalCoverage >= coverage);
    const pool = passing.length ? passing : candidates;
    if (passing.length) innerPasses++;
    pool.sort((a, b) => passing.length
      ? a.score.meanWidthDays - b.score.meanWidthDays
      : b.score.empiricalCoverage - a.score.empiricalCoverage || a.score.meanWidthDays - b.score.meanWidthDays);
    const chosen = pool[0];
    selectedShares.push({ facilityId, lowerTailShare: chosen.share, innerCoverage: chosen.score.empiricalCoverage,
      innerMeanWidthDays: chosen.score.meanWidthDays, innerMetTarget: passing.length > 0 });
    const calibration = calibrateGaussianIntervals(outerTraining, { coverage, lowerTailShare: chosen.share });
    for (const row of outerTargets) {
      const interval = gaussianPredictionInterval(row.forecastDate, row.daysSincePeak, calibration, 'asymmetric');
      if (!interval) continue;
      intervals++;
      widthTotal += interval.widthDays;
      const actualDay = dayNumber(row.actualEndDate);
      if (actualDay >= dayNumber(interval.earliestDate) && actualDay <= dayNumber(interval.latestDate)) covered++;
    }
  }
  return {
    targetCoverage: coverage,
    targetWaves: testRows.length,
    intervals,
    empiricalCoveragePercent: intervals ? 100 * covered / intervals : null,
    meanWidthDays: intervals ? widthTotal / intervals : null,
    innerFacilityFoldsMeetingTarget: innerPasses,
    facilityFolds: selectedShares.length,
    selectedShares,
  };
}

export async function runGaussianIntervalTuning(cacheDir = '.cache/facility-samples', { coverage = 0.75 } = {}) {
  const { facilityCount, forecasts } = await collectCalibrationRows(cacheDir);
  const onePerWave = firstForecastPerWave(forecasts);
  return {
    facilityCount,
    eligibleForecastsByWaveAge: forecasts.length,
    uniqueWaves: onePerWave.length,
    targetCoverage: coverage,
    symmetricConformal: evaluateLeaveOneFacilityOut(onePerWave, { coverage }),
    nestedOptimizedAsymmetric: tuneGaussianIntervalsLeaveOneFacilityOut(onePerWave, { coverage }),
  };
}

export async function runGaussianIntervalBacktest(cacheDir = '.cache/facility-samples', { coverage = 0.9 } = {}) {
  const { facilityCount, forecasts } = await collectCalibrationRows(cacheDir);
  const fullCalibration = calibrateGaussianIntervals(forecasts, { coverage });
  return {
    facilityCount,
    allForecastRows: forecasts.length,
    uniqueWaves: new Set(forecasts.map(row => row.waveId)).size,
    calibration: fullCalibration,
    leaveOneFacilityOut: evaluateLeaveOneFacilityOut(forecasts, { coverage }),
  };
}

async function main() {
  const result = process.argv.includes('--tune75')
    ? await runGaussianIntervalTuning('.cache/facility-samples', { coverage: 0.75 })
    : await runGaussianIntervalBacktest();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
