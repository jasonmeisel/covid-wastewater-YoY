import test from 'node:test';
import assert from 'node:assert/strict';
import { durationOutcome, fitBayesianWeibullSurvival, predictBayesianWeibullRemaining } from '../tools/bayesian-wave-survival.mjs';

test('duration outcomes distinguish confirmed events from right censoring', () => {
  const confirmed = durationOutcome('a', { peakDate: '2024-01-01', endDate: '2024-02-01', endConfirmed: true }, '2024-03-01');
  const inferred = durationOutcome('b', { peakDate: '2024-01-01', endDate: '2024-02-01', endConfirmed: false }, '2024-03-01');
  const ongoing = durationOutcome('c', { peakDate: '2024-01-01', endDate: null, endConfirmed: false }, '2024-02-15');
  assert.equal(confirmed.durationDays, 31);
  assert.equal(confirmed.event, true);
  assert.equal(inferred.event, false);
  assert.equal(ongoing.durationDays, 45);
  assert.equal(ongoing.observationDate, '2024-02-15');
});

test('Bayesian Weibull posterior predicts remaining time conditional on survival to cutoff', () => {
  const outcomes = [
    ...[35, 45, 50, 60, 70, 80, 90, 100, 110, 120].map((durationDays, index) => ({
      durationDays, event: true, facilityUid: `f${index}`,
    })),
    ...[55, 75, 95, 115].map((durationDays, index) => ({
      durationDays, event: false, facilityUid: `c${index}`,
    })),
  ];
  const model = fitBayesianWeibullSurvival(outcomes);
  assert.ok(model);
  assert.equal(model.eventCount, 10);
  assert.equal(model.censoredCount, 4);
  const early = predictBayesianWeibullRemaining(model, 0);
  const late = predictBayesianWeibullRemaining(model, 60);
  assert.ok(early.lowerDays <= early.medianDays && early.medianDays <= early.upperDays);
  assert.ok(late.lowerDays <= late.medianDays && late.medianDays <= late.upperDays);
  assert.ok(late.medianDays < early.medianDays, 'remaining duration should account for time already survived');
  assert.equal(late.trainingCensored, 4);
});
