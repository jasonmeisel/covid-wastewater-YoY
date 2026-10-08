import test from 'node:test';
import assert from 'node:assert/strict';
import { fitGaussian, fitSkewNormal, inclusivePercentileOfSorted } from '../tools/gaussian-wave-backtest.mjs';

test('inclusive percentile transform matches graph tie handling', () => {
  assert.equal(inclusivePercentileOfSorted(2, [1, 2, 2, 4]), 75);
  assert.equal(inclusivePercentileOfSorted(1, [1, 2, 2, 4]), 25);
  assert.equal(inclusivePercentileOfSorted(3, []), null);
});

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

test('skew-normal fit returns a finite asymmetric curve candidate', () => {
  const points = Array.from({ length: 31 }, (_, index) => {
    const day = index * 3;
    const z = (day - 45) / 22;
    const cdfApprox = value => 1 / (1 + Math.exp(-1.7 * value));
    return { day, y: 10 + 100 * Math.exp(-0.5 * z * z) * 2 * cdfApprox(3 * z) };
  });
  const fit = fitSkewNormal(points, 10);
  assert.ok(fit);
  assert.ok(Number.isFinite(fit.location));
  assert.ok(fit.scale > 0);
  assert.ok(fit.amplitude > 0);
});

test('Gaussian fit rejects insufficient data', () => {
  assert.equal(fitGaussian([{ day: 0, y: 1 }, { day: 1, y: 2 }]), null);
});
