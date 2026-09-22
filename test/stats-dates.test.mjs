import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const ZONES = ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];
const STATS_URL = new URL('../js/stats.js', import.meta.url).href;

const SCRIPT = `
import { buildSeries } from '${STATS_URL}';
const s = [{collection_date:'2024-01-01',targets:{'N Gene':{gc_g_dry_weight_trimmed5_pmmov:1e-4}}},
           {collection_date:'2023-12-31',targets:{'N Gene':{gc_g_dry_weight_trimmed5_pmmov:2e-4}}},
           {collection_date:'2024-02-29',targets:{'N Gene':{gc_g_dry_weight_trimmed5_pmmov:3e-4}}},
           {collection_date:'2024-03-01',targets:{'N Gene':{gc_g_dry_weight_trimmed5_pmmov:4e-4}}},
           {collection_date:'2024-12-31',targets:{'N Gene':{gc_g_dry_weight_trimmed5_pmmov:5e-4}}}];
process.stdout.write(JSON.stringify(buildSeries(s)));`;

const run = tz => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', SCRIPT], {
  env: { ...process.env, TZ: tz },
}).toString());

test('buildSeries buckets dates identically in every timezone', () => {
  const expected = { years: [2024, 2023], x2024: [1, 60, 60, 365], x2023: [365] };

  for (const tz of ZONES) {
    const { byYear, years, skipped } = run(tz);

    assert.deepEqual(years, expected.years, `years differ in ${tz}`);
    assert.deepEqual(byYear[2024].map(p => p.x), expected.x2024, `2024 day-of-year indices differ in ${tz}`);
    assert.deepEqual(byYear[2023].map(p => p.x), expected.x2023, `2023 day-of-year indices differ in ${tz}`);

    // Jan 1 must stay in its own year, never fall back to the previous one at x=365.
    assert.deepEqual(byYear[2024][0].originalDate, '2024-01-01');
    assert.equal(byYear[2024][0].actualYear, 2024);

    for (const [year, series] of Object.entries(byYear)) {
      for (const point of series) {
        assert.equal(point.actualYear, Number(year), `actualYear mismatch in ${tz}`);
      }
    }

    assert.deepEqual(skipped, { total: 0, missingDate: 0, missingValue: 0, nonPositive: 0, unparseableDate: 0 });
  }
});

test('leap Feb 29 and Mar 1 share day index 60 while Dec 31 stays at 365', () => {
  const { byYear } = run('UTC');
  const feb29 = byYear[2024].find(p => p.originalDate === '2024-02-29');
  const mar1 = byYear[2024].find(p => p.originalDate === '2024-03-01');
  const dec31 = byYear[2024].find(p => p.originalDate === '2024-12-31');

  assert.equal(feb29.x, 60);
  assert.equal(mar1.x, 60);
  assert.equal(dec31.x, 365);
  // Equal x values are ordered by date.
  assert.deepEqual(byYear[2024].filter(p => p.x === 60).map(p => p.originalDate), ['2024-02-29', '2024-03-01']);
});
