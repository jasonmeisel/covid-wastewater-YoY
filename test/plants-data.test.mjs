import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Guards the committed artifact fetch-plants.sh writes. The app reads these
// fields directly, so a wrong jq filter or a schema change upstream must fail
// here rather than quietly degrade search, distance sorting or the county card.
const payload = JSON.parse(readFileSync(new URL('../data/plants.json', import.meta.url), 'utf8'));
const plants = payload.plants;
const HEAVY_FIELDS = ['polygon', 'liquids', 'flow_rate', 'allow_download', 'is_wwscan', 'id', 'uuid'];

test('the plant catalog carries provenance and a plausible plant list', () => {
  assert.equal(payload.source, 'https://storage.googleapis.com/wastewater-dev-data/json/plants.json');
  assert.match(payload.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Array.isArray(plants));
  assert.ok(plants.length > 100, `expected the full plant list, got ${plants.length}`);
});

test('every plant is identifiable and carries the fields the UI reads', () => {
  const uids = new Set();
  for (const plant of plants) {
    assert.equal(typeof plant.uid, 'string');
    assert.ok(plant.uid.length > 0);
    assert.ok(!uids.has(plant.uid), `duplicate uid ${plant.uid}`);
    uids.add(plant.uid);

    assert.equal(typeof plant.name, 'string');
    assert.ok(plant.name.length > 0);

    for (const field of ['site_name', 'place_name', 'city', 'state', 'zipcode', 'country']) {
      assert.ok(field in plant, `${plant.uid} is missing ${field}`);
    }
    assert.ok('sewershed_pop' in plant);
    assert.ok('counties_served' in plant);
    assert.ok('point' in plant);
  }
});

test('coordinates and county FIPS survive the slim so maps and cards still work', () => {
  const withCoords = plants.filter(p => Array.isArray(p.point?.coordinates) && p.point.coordinates.length >= 2
    && p.point.coordinates.every(Number.isFinite));
  assert.ok(withCoords.length >= plants.length - 1, `expected nearly every plant to keep coordinates, got ${withCoords.length}`);

  const served = plants.flatMap(p => p.counties_served ?? []);
  assert.ok(served.length > 100, 'expected counties_served to survive');
  for (const fips of served) assert.match(String(fips), /^\d{5}$/);

  const multiCounty = plants.filter(p => (p.counties_served ?? []).length > 1);
  assert.ok(multiCounty.length > 0, 'expected some plants to serve more than one county');
});

test('the fields that made the feed 11.6 MB are gone', () => {
  for (const plant of plants) {
    for (const field of HEAVY_FIELDS) {
      assert.ok(!(field in plant), `${plant.uid} still carries ${field}`);
    }
  }
});
