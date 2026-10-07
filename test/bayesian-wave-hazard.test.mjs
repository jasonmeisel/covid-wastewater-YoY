import test from 'node:test';
import assert from 'node:assert/strict';
import { fitBayesianHazard, predictBayesianHazard } from '../tools/bayesian-wave-hazard.mjs';

test('Bayesian discrete hazard fits time-varying risk rows and returns a predictive date range', () => {
  const rows = [];
  for (let wave = 0; wave < 30; wave++) {
    for (let week = 0; week < 5; week++) {
      rows.push({
        facilityUid: `facility-${wave % 12}`,
        wavePeakDate: `2024-${String(Math.floor(wave / 3) + 1).padStart(2, '0')}-01`,
        eventNextWeek: week === 4 ? 1 : 0,
        x: {
          elapsedDays: 14 + week * 7,
          logAboveThreshold: 1.5 - week * 0.25,
          logBelowPeak: -0.2 - week * 0.1,
          logSlope: -0.01 - week * 0.001,
          slopeR2: 0.6,
        },
      });
    }
  }
  const model = fitBayesianHazard(rows);
  assert.ok(model);
  assert.equal(model.trainingEvents, 30);
  const estimate = predictBayesianHazard(model, rows[8].x, { draws: 200, maxWeeks: 30 });
  assert.ok(estimate.lowerDays <= estimate.medianDays && estimate.medianDays <= estimate.upperDays);
  assert.ok(estimate.upperDays - estimate.lowerDays > 0);
  assert.deepEqual(estimate, predictBayesianHazard(model, rows[8].x, { draws: 200, maxWeeks: 30 }));
});

test('Bayesian hazard refuses an underpowered dataset', () => {
  assert.equal(fitBayesianHazard([]), null);
});
