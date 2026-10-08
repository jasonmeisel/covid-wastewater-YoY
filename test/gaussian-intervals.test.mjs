import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calibrateGaussianIntervals,
  gaussianIntervalRadius,
  gaussianPredictionInterval,
  makeGaussianPredictionInterval,
} from '../js/wave-intervals.js';
import { oneForecastPerWaveAgeBucket } from '../tools/backtest-gaussian-intervals.mjs';

const row = (errorDays, daysSincePeak = 16, facilityId = 'facility-a', waveId = `${facilityId}:wave-${errorDays}`) => ({
  errorDays, daysSincePeak, facilityId, waveId,
});

test('conformal radius uses a finite-sample corrected absolute-error order statistic', () => {
  const calibration = calibrateGaussianIntervals(Array.from({ length: 12 }, (_, index) => row(index + 1)));
  assert.equal(calibration.pooledRadiusDays, 12);
  assert.equal(calibration.buckets['14-21'].radiusDays, 12);
  assert.equal(calibration.buckets['14-21'].source, 'age-bucket');
});

test('sparse age buckets fall back to pooled calibration and insufficient pool is unavailable', () => {
  const calibration = calibrateGaussianIntervals([
    ...Array.from({ length: 12 }, (_, index) => row(index + 1, 16, `f${index}`, `f${index}:w`)),
    ...Array.from({ length: 5 }, (_, index) => row(index + 1, 38, `g${index}`, `g${index}:w`)),
  ]);
  assert.equal(calibration.buckets['36-49'].source, 'pooled');
  assert.equal(calibration.buckets['36-49'].radiusDays, calibration.pooledRadiusDays);
  assert.equal(gaussianIntervalRadius(calibrateGaussianIntervals(Array.from({ length: 8 }, (_, i) => row(i + 1))), 16), null);
});

test('prediction intervals expand symmetrically around the point estimate', () => {
  assert.deepEqual(makeGaussianPredictionInterval('2025-01-20', 14), {
    earliestDate: '2025-01-06', latestDate: '2025-02-03', radiusDays: 14,
  });
  const calibration = calibrateGaussianIntervals(Array.from({ length: 12 }, (_, i) => row(i + 1)));
  assert.deepEqual(gaussianPredictionInterval('2025-01-20', 16, calibration), {
    earliestDate: '2025-01-08', latestDate: '2025-02-01', radiusDays: 12, widthDays: 24, coverage: 0.9, method: 'absolute',
  });
});

test('asymmetric residual intervals shift away from a signed forecast bias', () => {
  const calibration = calibrateGaussianIntervals(Array.from({ length: 20 }, (_, index) => row(index + 1)));
  const interval = gaussianPredictionInterval('2025-01-20', 16, calibration, 'asymmetric');
  assert.ok(interval);
  assert.equal(interval.earliestDate, '2024-12-31');
  assert.equal(interval.latestDate, '2025-01-19');
  assert.equal(interval.widthDays, 19);
});

test('tail allocation moves asymmetric bounds while preserving their nominal total coverage', () => {
  const rows = Array.from({ length: 20 }, (_, index) => row(index - 10, 16, `f${index}`, `w${index}`));
  const calibration = calibrateGaussianIntervals(rows, { coverage: 0.75, lowerTailShare: 0.25 });
  assert.deepEqual(calibration.buckets['14-21'].signedErrorBounds, {
    lowerErrorDays: -10,
    upperErrorDays: 7,
  });
});

test('calibration sample selector keeps earliest cutoff once per wave and age bucket', () => {
  const forecasts = [
    { waveId: 'f:w1', facilityId: 'f', peakDate: '2025-01-01', daysSincePeak: 16, cutoffDate: '2025-01-18' },
    { waveId: 'f:w1', facilityId: 'f', peakDate: '2025-01-01', daysSincePeak: 19, cutoffDate: '2025-01-21' },
    { waveId: 'f:w1', facilityId: 'f', peakDate: '2025-01-01', daysSincePeak: 24, cutoffDate: '2025-01-26' },
  ];
  const selected = oneForecastPerWaveAgeBucket(forecasts);
  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map(forecast => forecast.cutoffDate), ['2025-01-18', '2025-01-26']);
});
