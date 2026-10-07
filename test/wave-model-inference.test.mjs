import test from 'node:test';
import assert from 'node:assert/strict';
import { trainedWaveFeatures, predictTrainedWaveEnd } from '../js/wave-model.js';
import { waveTrainingRows } from '../tools/train-wave-model.mjs';

function completedWaveSeries() {
  const values = [];
  for (let day = 0; day < 330; day++) {
    let y = 10;
    if (day >= 100 && day < 130) y = 10 + (day - 100) * (140 / 30);
    else if (day >= 130 && day < 205) y = 150 - (day - 130) * (140 / 75);
    values.push({
      originalDate: new Date(Date.UTC(2024, 0, 1 + day)).toISOString().slice(0, 10),
      y,
    });
  }
  return values;
}

test('site ridge features match the backtest at an eligible historical cutoff', () => {
  const points = completedWaveSeries();
  const rows = waveTrainingRows('synthetic', points, { smoothingDays: 14 });
  const target = rows.find(row => row.x.elapsedDays >= 14 && row.declineWeeks < 3);
  assert.ok(target, 'synthetic wave should have a valid 14-day post-peak cutoff before three full-week declines');
  const prefix = points.filter(point => point.originalDate <= target.cutoffDate);
  const inference = trainedWaveFeatures(prefix);
  assert.ok(inference);
  assert.equal(inference.cutoffDate, target.cutoffDate);
  assert.equal(inference.activeWave.peakDate, target.wavePeakDate);
  assert.equal(inference.declineWeeks, target.declineWeeks);
  for (const feature of Object.keys(target.x)) {
    assert.ok(Math.abs(inference.x[feature] - target.x[feature]) < 1e-10,
      `${feature}: site ${inference.x[feature]} vs training ${target.x[feature]}`);
  }
  const forecast = predictTrainedWaveEnd(prefix);
  assert.ok(forecast);
  assert.ok(Number.isFinite(forecast.remainingDays));
  assert.equal(forecast.earliestDate, forecast.latestDate, 'the point model must not imply an unvalidated interval');
});
