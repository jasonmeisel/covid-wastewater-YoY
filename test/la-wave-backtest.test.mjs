import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildSeries } from '../js/stats.js';
import { backtestWaveEnd } from '../tools/backtest-wave-end.mjs';

const uid = 'b9c02d34';
const cachePath = new URL('../.cache/la-wave-backtest.json', import.meta.url);
const enabled = process.env.RUN_LA_WAVE_BACKTEST === '1' && process.env.GITHUB_ACTIONS !== 'true';

test('default LA plant wave-end forecast backtest (opt-in; excluded from GitHub Actions)', {
  skip: !enabled && (process.env.GITHUB_ACTIONS === 'true'
    ? 'intentionally not run in GitHub Actions'
    : 'set RUN_LA_WAVE_BACKTEST=1 to download/cache data and run'),
}, async t => {
  let samples;
  try {
    samples = JSON.parse(await readFile(cachePath, 'utf8')).samples;
    t.diagnostic(`Using cached ${uid} sample data from ${cachePath.pathname}`);
  } catch {
    const url = `https://storage.googleapis.com/wastewater-dev-data/json/${uid}.json`;
    const response = await fetch(url);
    assert.equal(response.ok, true, `failed fetching ${url}: HTTP ${response.status}`);
    const payload = await response.json();
    assert.ok(Array.isArray(payload.samples), 'feed response must contain samples');
    samples = payload.samples;
    await mkdir(new URL('../.cache/', import.meta.url), { recursive: true });
    await writeFile(cachePath, JSON.stringify({ uid, fetchedAt: new Date().toISOString(), samples }, null, 2));
    t.diagnostic(`Fetched and cached ${samples.length} samples at ${cachePath.pathname}`);
  }

  const { byYear } = buildSeries(samples.map(sample => ({ ...sample, _facilityUid: uid })));
  const points = Object.values(byYear).flat().sort((a, b) => a.originalDate.localeCompare(b.originalDate));
  const result = backtestWaveEnd(points);
  t.diagnostic(`LA wave-end backtest: ${JSON.stringify({
    completedWaves: result.completedWaves,
    forecastCount: result.forecastCount,
    intervalCoverage: result.intervalCoverage,
    meanAbsoluteIntervalMissDays: result.meanAbsoluteIntervalMissDays,
    medianAbsoluteIntervalMissDays: result.medianAbsoluteIntervalMissDays,
  })}`);
  assert.ok(points.length > 0, 'default LA plant feed should yield usable points');
});
