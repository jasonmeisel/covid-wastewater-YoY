import test from 'node:test';
import assert from 'node:assert/strict';
import { fitGaussian } from '../tools/gaussian-wave-backtest.mjs';

test('Gaussian curve fit recovers the peak and spread of a baseline-offset wave', () => {
  const points = Array.from({ length: 41 }, (_, index) => {
    const day = index * 3;
    return { day, y: 12 + 100 * Math.exp(-0.5 * ((day - 60) / 24) ** 2) };
  });
  const fit = fitGaussian(points, 12);
  assert.ok(fit);
  assert.ok(Math.abs(fit.mean - 60) < 2, `expected mean near 60, got ${fit.mean}`);
  assert.ok(Math.abs(fit.sigma - 24) < 2, `expected sigma near 24, got ${fit.sigma}`);
  assert.ok(Math.abs(fit.amplitude - 100) < 2, `expected amplitude near 100, got ${fit.amplitude}`);
});

test('Gaussian fit rejects insufficient data', () => {
  assert.equal(fitGaussian([{ day: 0, y: 1 }, { day: 1, y: 2 }]), null);
});
