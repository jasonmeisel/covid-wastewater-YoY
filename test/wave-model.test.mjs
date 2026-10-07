import test from 'node:test';
import assert from 'node:assert/strict';
import { fitRidge, predictRidge, predictWaveAnalogs, predictCalibratedWaveAnalogs, selectTopActivePlants, smoothTimelineLikeChart } from '../tools/train-wave-model.mjs';

test('top-active plant selection applies the 3-month activity rule and ranks by population', () => {
  const plants = [
    { uid: 'small', sewershed_pop: 100 },
    { uid: 'large', sewershed_pop: 1000 },
    { uid: 'stale', sewershed_pop: 9000 },
  ];
  const activity = {
    small: { covid: { lastSampleDate: '2025-02-01' } },
    large: { covid: { lastSampleDate: '2025-02-01' } },
    stale: { covid: { lastSampleDate: '2024-01-01' } },
  };
  assert.deepEqual(selectTopActivePlants(plants, activity, { now: new Date('2025-03-01T00:00:00Z') }).map(p => p.uid), ['large', 'small']);
});

test('14-day smoothing matches timeline chart behavior and uses only the supplied prefix', () => {
  const points = Array.from({ length: 25 }, (_, i) => ({
    originalDate: new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10),
    y: i === 16 ? 100 : 10,
  }));
  const prefix = points.slice(0, 20);
  const smoothPrefix = smoothTimelineLikeChart(prefix, 14);
  assert.equal(smoothPrefix.at(-1).originalDate, prefix.at(-1).originalDate);
  assert.equal(smoothPrefix.at(-1).y, prefix.at(-1).y, 'chart preserves the latest reading');
  assert.ok(smoothPrefix.every(point => point.originalDate <= prefix.at(-1).originalDate), 'no future samples appear');
  assert.ok(smoothPrefix.find(point => point.originalDate === '2024-01-17').y < 100, 'the spike is smoothed');
});

test('wave analog prediction takes one nearest snapshot per wave and returns median quantiles', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({
    facilityUid: `facility-${i}`,
    wavePeakDate: `2024-01-0${i + 1}`,
    x: { elapsedDays: i, logAboveThreshold: i, logBelowPeak: -i, logSlope: -0.01 * i, slopeR2: i / 10 },
    remainingDays: 10 + i * 5,
  }));
  // Duplicate a wave with an inferior feature match; it must not count twice.
  rows.push({ ...rows[0], x: { ...rows[0].x, elapsedDays: 100 }, remainingDays: 999 });
  const prediction = predictWaveAnalogs(rows, rows[0].x, 7);
  assert.equal(prediction.neighbors, 7);
  assert.equal(prediction.medianDays, 25);
  assert.ok(prediction.lowerDays <= prediction.medianDays);
  assert.ok(prediction.upperDays >= prediction.medianDays);
});

test('wave analog intervals calibrate using held-out whole waves', () => {
  const rows = Array.from({ length: 12 }, (_, wave) => Array.from({ length: 2 }, (_, cutoff) => ({
    facilityUid: `facility-${wave}`,
    wavePeakDate: new Date(Date.UTC(2024, wave, 1)).toISOString().slice(0, 10),
    endDate: new Date(Date.UTC(2024, wave + 1, 1)).toISOString().slice(0, 10),
    x: { elapsedDays: 15 + cutoff * 7, logAboveThreshold: 1 + wave / 10, logBelowPeak: -wave / 20, logSlope: -0.01 - wave / 1000, slopeR2: 0.5 + wave / 100 },
    remainingDays: 20 + wave + cutoff * 3,
  }))).flat();
  const prediction = predictCalibratedWaveAnalogs(rows, rows[0].x, { k: 7, coverage: 0.8 });
  assert.ok(prediction);
  assert.ok(prediction.calibrationWaves >= 3);
  assert.ok(prediction.adjustmentDays >= 0);
  assert.ok(prediction.lowerDays <= prediction.medianDays);
  assert.ok(prediction.upperDays >= prediction.medianDays);
});

test('ridge model learns a simple relationship and returns a bounded prediction', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    facilityUid: `plant-${i % 3}`,
    wavePeakDate: `2024-01-0${Math.floor(i / 3) + 1}`,
    x: { elapsedDays: i, logAboveThreshold: i / 10, logBelowPeak: -i / 20, logSlope: -0.01 * i, slopeR2: 0.5 },
    remainingDays: 30 - i,
  }));
  const model = fitRidge(rows, 0.01);
  assert.ok(model);
  const estimate = predictRidge(model, rows[5].x);
  assert.ok(estimate >= 0 && estimate <= 180);
  assert.ok(Math.abs(estimate - 25) < 5, `expected plausible estimate, got ${estimate}`);
});
