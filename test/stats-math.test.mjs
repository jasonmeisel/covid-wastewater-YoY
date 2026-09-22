import test from 'node:test';
import assert from 'node:assert/strict';
import { quantile, inclusivePercentile, movingAverage, summarize, buildSeries } from '../js/stats.js';

test('quantile interpolates linearly', () => {
  const values = [1, 2, 3, 4];
  assert.equal(quantile(values, 0.25), 1.75);
  assert.equal(quantile(values, 0.5), 2.5);
  assert.equal(quantile(values, 0.75), 3.25);
  assert.equal(quantile([], 0.5), null);
});

test('inclusivePercentile reports the share of values at or below the reading', () => {
  assert.equal(inclusivePercentile(1, [1, 1, 2, 3]), 50);
  assert.equal(inclusivePercentile(3, [1, 1, 2, 3]), 100);
  assert.equal(inclusivePercentile(0, [1, 1, 2, 3]), 0);
  assert.equal(inclusivePercentile(2, [1, 1, 2, 3]), 75);
  assert.equal(inclusivePercentile(5, []), null);
});

test('movingAverage smooths interior points and can preserve the last sample', () => {
  const short = [{ y: 1 }, { y: 2 }, { y: 3 }];
  const windowed = movingAverage(short, 7);
  assert.equal(windowed.length, 3);
  // A window wider than the series averages every available neighbour.
  assert.deepEqual(windowed.map(p => p.y), [2, 2, 2]);

  assert.equal(movingAverage(short, 1), short, 'window 1 is a no-op');
  assert.equal(movingAverage(short, 3, false).length, 3);

  const ramp = Array.from({ length: 10 }, (_, i) => ({ y: i, originalDate: `2024-01-${String(i + 1).padStart(2, '0')}` }));
  const smoothed = movingAverage(ramp, 7, true);
  assert.deepEqual(smoothed[9], ramp[9], 'last point is preserved verbatim');
  const expectedInterior = [2, 3, 4, 5, 6, 7, 8].reduce((a, b) => a + b, 0) / 7;
  assert.equal(smoothed[5].y, expectedInterior);
  // Edge points average only the neighbours that exist, so they move even on a linear ramp.
  assert.equal(smoothed[0].y, (0 + 1 + 2 + 3) / 4);
  assert.notEqual(smoothed[0].y, ramp[0].y);
});

test('summarize reduces a series to count, mean, peak and latest', () => {
  const series = [
    { y: 10, originalDate: '2024-03-01' },
    { y: 30, originalDate: '2024-01-05' },
    { y: 20, originalDate: '2024-02-02' },
  ];
  const stats = summarize(series);
  assert.equal(stats.count, 3);
  assert.equal(stats.mean, 20);
  assert.deepEqual(stats.peak, { value: 30, date: '2024-01-05' });
  assert.deepEqual(stats.latest, { y: 10, originalDate: '2024-03-01' });
  assert.deepEqual(summarize([]), { count: 0, mean: null, peak: { value: null, date: null }, latest: null });
});

test('buildSeries accounts for every sample it cannot plot', () => {
  const samples = [
    { targets: { 'N Gene': { gc_g_dry_weight_trimmed5_pmmov: 2e-4 } } }, // no date field at all
    { collection_date: '2024-05-01', targets: { 'N Gene': { gc_g_dry_weight_trimmed5_pmmov: null } } },
    { collection_date: '2024-05-02', targets: { 'N Gene': { gc_g_dry_weight_trimmed5_pmmov: 0 } } },
    { collection_date: '2024-13-01', targets: { 'N Gene': { gc_g_dry_weight_trimmed5_pmmov: 3e-4 } } },
    { collection_date: '2024-05-03', targets: { 'N Gene': { gc_g_dry_weight_trimmed5_pmmov: 4e-4 } } },
  ];

  const { byYear, years, skipped } = buildSeries(samples);
  assert.deepEqual(skipped, { total: 4, missingDate: 1, missingValue: 1, nonPositive: 1, unparseableDate: 1 });
  assert.deepEqual(years, [2024]);
  assert.equal(byYear[2024].length, 1);
  assert.equal(byYear[2024][0].rawRatio, 4e-4);
  assert.equal(byYear[2024][0].y, 400);
});

test('buildSeries falls back to the first target carrying a finite ratio', () => {
  const { byYear } = buildSeries([
    { collection_date: '2024-06-01', targets: { Other: { gc_g_dry_weight_trimmed5_pmmov: 0.5 } } },
  ]);
  assert.equal(byYear[2024][0].rawRatio, 0.5);
});
