import test from 'node:test';
import assert from 'node:assert/strict';
import { symmetricExtremaEstimate } from '../tools/backtest-symmetric-extrema.mjs';

const DAY = 86400000;
const dateAt = day => new Date(Date.parse('2023-01-01T00:00:00Z') + day * DAY).toISOString().slice(0, 10);
const gaussianWave = lastDay => Array.from({ length: lastDay + 1 }, (_, day) => ({
  originalDate: dateAt(day),
  y: 10 + 100 * Math.exp(-0.5 * ((day - 150) / 35) ** 2),
}));

test('symmetric extrema projection uses a confirmed smoothed peak and preceding trough', () => {
  const points = gaussianWave(190);
  const forecast = symmetricExtremaEstimate(points, dateAt(180), dateAt(150), 20);
  assert.ok(forecast);
  assert.ok(Math.abs(Date.parse(`${forecast.localPeakDate}T00:00:00Z`) - Date.parse(`${dateAt(150)}T00:00:00Z`)) / DAY <= 2);
  assert.ok(forecast.riseDays > 0);
  const crossingFraction = (forecast.localPeakValue - 20) / (forecast.localPeakValue - forecast.localTroughValue);
  const expectedCrossing = Math.ceil(Date.parse(`${forecast.localPeakDate}T00:00:00Z`) / DAY + forecast.riseDays * crossingFraction);
  assert.equal(forecast.forecastDate, new Date(expectedCrossing * DAY).toISOString().slice(0, 10));
  assert.ok(forecast.forecastDate < forecast.predictedLocalMinimumDate);
});

test('symmetric extrema projection waits for centered smoothing confirmation and ignores future values', () => {
  const points = gaussianWave(180);
  assert.equal(symmetricExtremaEstimate(points, dateAt(160), dateAt(150), 20), null);
  const before = symmetricExtremaEstimate(points, dateAt(180), dateAt(150), 20);
  const extendedWithFutureSpike = [...points, ...Array.from({ length: 70 }, (_, index) => ({
    originalDate: dateAt(index + 181), y: 500,
  }))];
  assert.deepEqual(symmetricExtremaEstimate(extendedWithFutureSpike, dateAt(180), dateAt(150), 20), before);
});
