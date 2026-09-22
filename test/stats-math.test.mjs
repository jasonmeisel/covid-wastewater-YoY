import test from 'node:test';
import assert from 'node:assert/strict';
import { quantile, inclusivePercentile, movingAverage, summarize, buildSeries, dailyAggregate } from '../js/stats.js';

// Means of ratios land on values like 1.9999999999999998e-4, so compare with slack.
const closeTo = (actual, expected, eps = 1e-12) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} to be within ${eps} of ${expected}`);

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

test('dailyAggregate averages the plants that reported on the same day', () => {
  const series = [
    { x: 10, y: 100, rawRatio: 1e-4, originalDate: '2024-01-10', actualYear: 2024 },
    { x: 10, y: 300, rawRatio: 3e-4, originalDate: '2024-01-10', actualYear: 2024 },
    { x: 12, y: 50, rawRatio: 0.5e-4, originalDate: '2024-01-12', actualYear: 2024 },
  ];

  const daily = dailyAggregate(series);
  assert.equal(daily.length, 2, 'three samples over two dates collapse to two points');
  assert.deepEqual(daily.map(p => p.originalDate), ['2024-01-10', '2024-01-12']);

  const first = daily[0];
  closeTo(first.y, 200, 1e-9); // mean across plants
  closeTo(first.rawRatio, 2e-4);
  closeTo(first.y, first.rawRatio * 1e6, 1e-6); // the y = rawRatio * 1e6 invariant survives
  assert.equal(first.x, 10);
  assert.equal(first.actualYear, 2024);

  // A date with a single reporter is passed through by reference.
  assert.equal(daily[1], series[2]);
});

test('dailyAggregate leaves one-sample-per-day series untouched', () => {
  const series = [
    { x: 1, y: 10, rawRatio: 1e-5, originalDate: '2024-01-01', actualYear: 2024 },
    { x: 2, y: 20, rawRatio: 2e-5, originalDate: '2024-01-02', actualYear: 2024 },
  ];
  assert.equal(dailyAggregate(series), series, 'single-plant output must be identical by reference');
  assert.deepEqual(dailyAggregate([]), []);
  assert.deepEqual(dailyAggregate([{ x: 1, y: 1, rawRatio: 1e-6, originalDate: '2024-01-01' }]).length, 1);
});

test('dailyAggregate keeps Feb 29 and Mar 1 apart despite sharing day index 60', () => {
  const series = [
    { x: 60, y: 10, rawRatio: 1e-5, originalDate: '2024-02-29', actualYear: 2024 },
    { x: 60, y: 30, rawRatio: 3e-5, originalDate: '2024-03-01', actualYear: 2024 },
  ];
  const daily = dailyAggregate(series);
  assert.equal(daily.length, 2, 'distinct dates must not merge just because x collides');
  assert.deepEqual(daily.map(p => p.originalDate), ['2024-02-29', '2024-03-01']);
  assert.deepEqual(daily.map(p => p.y), [10, 30]);
});

test('dailyAggregate then movingAverage gives one smoothed value per day', () => {
  // Three plants reporting on two consecutive days.
  const series = [
    { x: 1, y: 10, rawRatio: 1e-5, originalDate: '2024-01-01', actualYear: 2024 },
    { x: 1, y: 20, rawRatio: 2e-5, originalDate: '2024-01-01', actualYear: 2024 },
    { x: 1, y: 30, rawRatio: 3e-5, originalDate: '2024-01-01', actualYear: 2024 },
    { x: 2, y: 40, rawRatio: 4e-5, originalDate: '2024-01-02', actualYear: 2024 },
  ];

  const daily = dailyAggregate(series);
  assert.deepEqual(daily.map(p => p.y), [20, 40]);

  // window 3 => offset 1; both days see each other, so both smooth to (20+40)/2
  const smoothed = movingAverage(daily, 3, false);
  assert.deepEqual(smoothed.map(p => p.y), [30, 30], 'window spans days, not samples');
  assert.equal(new Set(smoothed.map(p => p.originalDate)).size, smoothed.length, 'no duplicate dates');
});
