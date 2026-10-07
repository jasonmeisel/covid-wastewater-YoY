import test from 'node:test';
import assert from 'node:assert/strict';
import { barycentricWeights, findEnclosingPlantTriangle, interpolateAtDay } from '../js/triangulation.js';
import { buildSeries } from '../js/stats.js';

const distance = (lat1, lng1, lat2, lng2) => Math.hypot(lat2 - lat1, lng2 - lng1);
const coordinates = plant => plant.point;

test('barycentric weights reconstruct an interior point and reject exterior points', () => {
  const a = { lat: 0, lng: 0 }, b = { lat: 0, lng: 2 }, c = { lat: 2, lng: 0 };
  const weights = barycentricWeights({ lat: 0.5, lng: 0.5 }, a, b, c);
  assert.ok(Math.abs(weights[0] - 0.5) < 1e-12);
  assert.ok(Math.abs(weights[1] - 0.25) < 1e-12);
  assert.ok(Math.abs(weights[2] - 0.25) < 1e-12);
  assert.equal(barycentricWeights({ lat: 3, lng: 3 }, a, b, c), null);
});

test('triangle search fixes the nearest two and finds the closest enclosing third', () => {
  const plants = [
    { uid: 'a', point: { lat: 0, lng: -1 } },
    { uid: 'b', point: { lat: 0, lng: 1 } },
    { uid: 'outside', point: { lat: 0.1, lng: 0 } },
    { uid: 'c', point: { lat: 1, lng: 0 } },
  ];
  const result = findEnclosingPlantTriangle(plants, { lat: 0, lng: 0 }, coordinates, distance);
  assert.deepEqual(result.plants.map(plant => plant.uid), ['outside', 'a', 'b']);
  assert.ok(Math.abs(result.weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12);
});

test('interpolation stays within observed coverage and weighted build requires all three facilities', () => {
  assert.equal(interpolateAtDay([{ x: 1, y: 10 }, { x: 3, y: 30 }], 2), 20);
  assert.equal(interpolateAtDay([{ x: 1, y: 10 }, { x: 3, y: 30 }], 0), null);
  const samples = [
    ['a', 1, 10], ['a', 3, 30], ['b', 2, 20], ['b', 3, 30], ['c', 1, 30], ['c', 3, 10],
  ].map(([uid, day, ratio]) => ({
    _facilityUid: uid,
    date: `2024-${day === 1 ? '01-01' : day === 2 ? '01-02' : '01-03'}`,
    targets: { 'N Gene': { gc_g_dry_weight_trimmed5_pmmov: ratio } },
  }));
  const { byYear } = buildSeries(samples, { scaleFactor: 1, facilityWeights: { a: 0.5, b: 0.25, c: 0.25 } });
  assert.deepEqual(byYear[2024].map(point => point.y), [20, 25]);
  assert.deepEqual(byYear[2024].map(point => point.originalDate), ['2024-01-02', '2024-01-03']);
});
