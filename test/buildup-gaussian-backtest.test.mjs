import test from 'node:test';
import assert from 'node:assert/strict';
import { buildupGaussianPrediction } from '../tools/backtest-buildup-gaussian.mjs';

const DAY = 86400000;
const dateAt = day => new Date(Date.parse('2023-01-01T00:00:00Z') + day * DAY).toISOString().slice(0, 10);
const gaussianWave = lastDay => Array.from({ length: lastDay + 1 }, (_, day) => ({
  originalDate: dateAt(day),
  y: 10 + 100 * Math.exp(-0.5 * ((day - 150) / 35) ** 2),
}));

test('buildup-only Gaussian predicts the baseline-P90 crossing from a synthetic rise', () => {
  const prediction = buildupGaussianPrediction(gaussianWave(190), dateAt(180), 10, 20, dateAt(150));
  assert.ok(prediction);
  assert.ok(prediction.fitPoints >= 5);
  const crossing = Date.parse(`${prediction.forecastDate}T00:00:00Z`);
  assert.ok(crossing > Date.parse(`${dateAt(180)}T00:00:00Z`));
  assert.ok(Math.abs(crossing / DAY - (Date.parse('2023-01-01T00:00:00Z') / DAY + 225)) < 12,
    `expected Gaussian decline crossing near day 225, got ${prediction.forecastDate}`);
});

test('buildup-only fit waits for peak confirmation and ignores future readings', () => {
  const points = gaussianWave(180);
  assert.equal(buildupGaussianPrediction(points, dateAt(160), 10, 20, dateAt(150)), null);
  const forecast = buildupGaussianPrediction(points, dateAt(180), 10, 20, dateAt(150));
  const extended = [...points, ...Array.from({ length: 70 }, (_, index) => ({
    originalDate: dateAt(index + 181), y: 500,
  }))];
  assert.deepEqual(buildupGaussianPrediction(extended, dateAt(180), 10, 20, dateAt(150)), forecast);
});
