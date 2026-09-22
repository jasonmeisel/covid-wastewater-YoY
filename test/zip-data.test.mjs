import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGeoNamesTsv } from '../tools/build-zip-data.mjs';

// GeoNames US.txt columns: [1] zip, [4] state, [5] county, [9] lat, [10] lng.
const row = (zip, state, county, lat, lng) =>
  ['US', zip, 'place', 'admin', state, county, 'code', 'admin3', 'code3', lat, lng, '1'].join('\t');

const FIXTURE = [
  row('99553', 'AK', 'Aleutians East', '54.143', '-165.7854'),
  row('99553', 'AK', 'Aleutians East', '0', '0'), // duplicate: dropped, first occurrence wins
  row('94110', 'CA', 'City and County of San Francisco', '37.7509', '-122.4153'),
  row('00000', 'XX', 'Nowhere', 'not-a-number', '-1'), // no usable coordinates
].join('\n');

test('parseGeoNamesTsv keeps first occurrences and skips unusable rows', () => {
  const { map, duplicates, total } = parseGeoNamesTsv(FIXTURE);

  assert.equal(total, 4);
  assert.equal(map.size, 2);
  assert.equal(duplicates, 1);
  assert.deepEqual(map.get('99553'), [54.143, -165.7854, 'AK', 'Aleutians East']);
  assert.deepEqual(map.get('94110'), [37.7509, -122.4153, 'CA', 'City and County of San Francisco']);
  assert.equal(map.has('00000'), false, 'rows without finite coordinates are dropped');
});

test('parseGeoNamesTsv tolerates blank lines and short rows', () => {
  const { map, duplicates } = parseGeoNamesTsv(`\n${row('94110', 'CA', 'San Francisco', '37.7509', '-122.4153')}\n\nnot\tenough\n`);
  assert.equal(map.size, 1);
  assert.equal(duplicates, 0);
});

test('the committed lookup file matches the shape the build tool emits', () => {
  const json = JSON.parse(readFileSync(new URL('../data/zip-lookup.json', import.meta.url), 'utf8'));
  assert.equal(json.source, 'zipcodes-us@1.1.3 / GeoNames US.txt');
  assert.match(json.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Object.keys(json.zips).length > 40000, 'expected the full US ZIP set');
  assert.deepEqual(json.zips['99553'], [54.143, -165.7854, 'AK', 'Aleutians East']);
});
