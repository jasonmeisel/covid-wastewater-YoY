import test from 'node:test';
import assert from 'node:assert/strict';
import { backtestWaveEnd } from '../tools/backtest-wave-end.mjs';

test('backtest returns a stable empty summary when there are no completed waves', () => {
  assert.deepEqual(backtestWaveEnd([]), {
    completedWaves: 0,
    forecastCount: 0,
    intervalCoverage: null,
    meanAbsoluteIntervalMissDays: null,
    medianAbsoluteIntervalMissDays: null,
    forecasts: [],
  });
});

test('backtest ignores invalid dated or non-positive observations', () => {
  const result = backtestWaveEnd([
    { originalDate: 'not-a-date', y: 12 },
    { originalDate: '2024-01-01', y: 0 },
  ]);
  assert.equal(result.completedWaves, 0);
  assert.equal(result.forecastCount, 0);
});
