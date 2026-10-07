import test from 'node:test';
import assert from 'node:assert/strict';
import { fitRidge, predictRidge, selectTopActivePlants } from '../tools/train-wave-model.mjs';

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
