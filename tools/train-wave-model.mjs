#!/usr/bin/env node
// Experiments for pooled, interpretable wave-end regression. No model artifact is
// used by the app: this script evaluates a leakage-conscious baseline first.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildSeries, identifyWaves } from '../js/stats.js';

const DAY = 86400000;
const dayNumber = date => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10));
const FEATURES = ['elapsedDays', 'logAboveThreshold', 'logBelowPeak', 'logSlope', 'slopeR2'];

function linearFit(values) {
  if (values.length < 3) return { slope: 0, r2: 0 };
  const xs = values.map((_, i) => i * 7);
  const ys = values.map(point => Math.log(point.y));
  const xm = xs.reduce((a, b) => a + b, 0) / xs.length;
  const ym = ys.reduce((a, b) => a + b, 0) / ys.length;
  const denom = xs.reduce((sum, x) => sum + (x - xm) ** 2, 0);
  const slope = xs.reduce((sum, x, i) => sum + (x - xm) * (ys[i] - ym), 0) / denom;
  const intercept = ym - slope * xm;
  const total = ys.reduce((sum, y) => sum + (y - ym) ** 2, 0);
  const residual = ys.reduce((sum, y, i) => sum + (y - (intercept + slope * xs[i])) ** 2, 0);
  return { slope, r2: total ? Math.max(0, 1 - residual / total) : 0 };
}

// Feature rows use only measurements available on or before the forecast cutoff.
export function waveTrainingRows(facilityUid, points) {
  const series = (points || []).filter(point => validDate(point.originalDate) && Number(point.y) > 0)
    .slice().sort((a, b) => String(a.originalDate).localeCompare(String(b.originalDate)));
  const completed = identifyWaves(series).filter(wave => wave.endDate && !wave.ongoing);
  const rows = [];
  for (const truth of completed) {
    const peakDay = dayNumber(truth.peakDate);
    const endDay = dayNumber(truth.endDate);
    for (let index = 0; index < series.length; index++) {
      const cutoffDate = String(series[index].originalDate).slice(0, 10);
      const cutoff = dayNumber(cutoffDate);
      if (cutoff < peakDay + 14 || cutoff >= endDay) continue;
      // Derive the features from the estimator's prefix-only wave state. Using
      // the full-series peak or threshold here would leak future observations.
      const prefix = series.slice(0, index + 1);
      const detected = identifyWaves(prefix);
      const active = detected.find(wave => wave.ongoing && !wave.endDate && wave.peakDate === truth.peakDate);
      if (!active || !(active.endThreshold > 0) || !(active.peak > 0)) continue;
      const recent = prefix.filter(point => dayNumber(String(point.originalDate).slice(0, 10)) >= cutoff - 42)
        .map(point => ({ day: dayNumber(String(point.originalDate).slice(0, 10)), y: Number(point.y) }));
      if (!recent.length) continue;
      const fit = linearFit(recent.slice(-7));
      rows.push({
        facilityUid: String(facilityUid), wavePeakDate: truth.peakDate,
        cutoffDate, endDate: truth.endDate,
        x: {
          elapsedDays: cutoff - dayNumber(active.peakDate),
          logAboveThreshold: Math.log(Math.max(0.01, recent.at(-1).y / active.endThreshold)),
          logBelowPeak: Math.log(Math.max(0.01, recent.at(-1).y / active.peak)),
          logSlope: fit.slope,
          slopeR2: fit.r2,
        },
        remainingDays: endDay - cutoff,
        currentBaselineDays: active.forecast
          ? (dayNumber(active.forecast.earliestDate) + dayNumber(active.forecast.latestDate)) / 2 - cutoff
          : null,
      });
    }
  }
  return rows;
}

function solve(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-12) continue;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const scale = a[col][col];
    for (let j = col; j <= n; j++) a[col][j] /= scale;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map(row => row[n]);
}

// Standardized ridge regression, fitted with one equal total weight per wave so
// high-frequency facilities or long waves cannot dominate just by sample count.
export function fitRidge(rows, lambda = 1) {
  if (rows.length < FEATURES.length + 2) return null;
  const counts = new Map();
  for (const row of rows) {
    const key = `${row.facilityUid}/${row.wavePeakDate}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const weights = rows.map(row => 1 / counts.get(`${row.facilityUid}/${row.wavePeakDate}`));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const means = FEATURES.map((_, index) => rows.reduce((sum, row, i) => sum + weights[i] * row.x[FEATURES[index]], 0) / totalWeight);
  const scales = FEATURES.map((_, index) => Math.sqrt(rows.reduce((sum, row, i) => sum + weights[i] * (row.x[FEATURES[index]] - means[index]) ** 2, 0) / totalWeight) || 1);
  const targetMean = rows.reduce((sum, row, i) => sum + weights[i] * row.remainingDays, 0) / totalWeight;
  const dimensions = FEATURES.length + 1;
  const matrix = Array.from({ length: dimensions }, () => Array(dimensions).fill(0));
  const vector = Array(dimensions).fill(0);
  rows.forEach((row, i) => {
    const x = [1, ...FEATURES.map((feature, j) => (row.x[feature] - means[j]) / scales[j])];
    const y = row.remainingDays - targetMean;
    for (let r = 0; r < dimensions; r++) {
      vector[r] += weights[i] * x[r] * y;
      for (let c = 0; c < dimensions; c++) matrix[r][c] += weights[i] * x[r] * x[c];
    }
  });
  for (let i = 1; i < dimensions; i++) matrix[i][i] += lambda;
  return { means, scales, targetMean, coefficients: solve(matrix, vector) };
}

export function predictRidge(model, features) {
  if (!model) return null;
  const z = FEATURES.map((feature, i) => (features[feature] - model.means[i]) / model.scales[i]);
  const prediction = model.targetMean + model.coefficients[0] + z.reduce((sum, value, i) => sum + value * model.coefficients[i + 1], 0);
  return Math.max(0, Math.min(180, prediction));
}

// Compare rolling model predictions against the current estimator. At each target
// cutoff, only completed training waves ending before that date are eligible; the
// target facility is excluded to test transfer to unseen facilities.
export function evaluatePooledModel(rows, lambda = 1) {
  const predictions = [];
  for (const target of rows) {
    const cutoff = dayNumber(target.cutoffDate);
    const training = rows.filter(row => row.facilityUid !== target.facilityUid && dayNumber(row.endDate) < cutoff);
    const model = fitRidge(training, lambda);
    const prediction = predictRidge(model, target.x);
    if (prediction === null) continue;
    predictions.push({ ...target, predictedDays: prediction, absoluteErrorDays: Math.abs(prediction - target.remainingDays), trainingWaves: new Set(training.map(row => `${row.facilityUid}/${row.wavePeakDate}`)).size });
  }
  const errors = predictions.map(row => row.absoluteErrorDays).sort((a, b) => a - b);
  const pairedPredictions = predictions.filter(row => Number.isFinite(row.currentBaselineDays));
  const pairedModelErrors = pairedPredictions.map(row => row.absoluteErrorDays).sort((a, b) => a - b);
  const baselineErrors = pairedPredictions
    .map(row => Math.abs(row.currentBaselineDays - row.remainingDays)).sort((a, b) => a - b);
  const meanByWave = selector => {
    const groups = new Map();
    for (const row of predictions) {
      const value = selector(row);
      if (!Number.isFinite(value)) continue;
      const key = `${row.facilityUid}/${row.wavePeakDate}`;
      const group = groups.get(key) || { sum: 0, count: 0 };
      group.sum += value;
      group.count++;
      groups.set(key, group);
    }
    const values = [...groups.values()].map(group => group.sum / group.count);
    return {
      count: values.length,
      mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    };
  };
  return {
    predictions,
    predictionCount: predictions.length,
    medianAbsoluteErrorDays: errors.length ? errors[Math.floor(errors.length / 2)] : null,
    meanAbsoluteErrorDays: errors.length ? errors.reduce((sum, n) => sum + n, 0) / errors.length : null,
    pairedPredictionCount: pairedPredictions.length,
    pairedModelMedianAbsoluteErrorDays: pairedModelErrors.length ? pairedModelErrors[Math.floor(pairedModelErrors.length / 2)] : null,
    pairedModelMeanAbsoluteErrorDays: pairedModelErrors.length ? pairedModelErrors.reduce((sum, n) => sum + n, 0) / pairedModelErrors.length : null,
    currentBaselineCount: baselineErrors.length,
    currentBaselineMedianAbsoluteErrorDays: baselineErrors.length ? baselineErrors[Math.floor(baselineErrors.length / 2)] : null,
    currentBaselineMeanAbsoluteErrorDays: baselineErrors.length ? baselineErrors.reduce((sum, n) => sum + n, 0) / baselineErrors.length : null,
    waveErrorSummary: meanByWave(row => row.absoluteErrorDays),
    currentBaselineWaveErrorSummary: meanByWave(row => Number.isFinite(row.currentBaselineDays)
      ? Math.abs(row.currentBaselineDays - row.remainingDays) : null),
  };
}

export function selectTopActivePlants(plants, activity, { now = new Date(), limit = 16 } = {}) {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - 3);
  return (plants || []).filter(plant => {
    const feeds = activity && activity[plant.uid];
    if (!feeds || typeof feeds !== 'object') return false;
    return Object.values(feeds).some(feed => {
      const date = feed && feed.lastSampleDate ? new Date(feed.lastSampleDate) : null;
      return date && Number.isFinite(date.getTime()) && date >= cutoff;
    });
  }).sort((a, b) => Number(b.sewershed_pop || 0) - Number(a.sewershed_pop || 0) || a.uid.localeCompare(b.uid)).slice(0, limit);
}

async function main() {
  const cacheDir = '.cache';
  const [catalog, activityResponse] = await Promise.all([
    readFile('data/plants.json', 'utf8').then(JSON.parse),
    fetch('https://data.wastewaterscan.org/data/categories/plants.json'),
  ]);
  if (!activityResponse.ok) throw new Error(`Activity feed HTTP ${activityResponse.status}`);
  const activity = await activityResponse.json();
  const plants = selectTopActivePlants(catalog.plants, activity);
  const refresh = process.argv.includes('--refresh');
  if (refresh) {
    const { rm } = await import('node:fs/promises');
    await Promise.all(plants.map(plant => rm(`${cacheDir}/facility-samples/${plant.uid}.json`, { force: true })));
  }
  const facilities = await fetchFacilitySamples(plants);
  const rows = facilities.flatMap(facility => waveTrainingRows(facility.uid, facility.points));
  await writeFile(`${cacheDir}/wave-training-rows.json`, JSON.stringify({
    generatedAt: new Date().toISOString(),
    facilityCount: facilities.filter(item => !item.error).length,
    plants: facilities.map(({ uid, sampleCount, error }) => ({ uid, sampleCount, error })),
    rows,
  }, null, 2));
  const result = evaluatePooledModel(rows);
  const { predictions, ...summary } = result;
  console.log(JSON.stringify({
    selectedFacilities: plants.map(plant => ({ uid: plant.uid, name: plant.name, population: plant.sewershed_pop })),
    successfulFeeds: facilities.filter(item => !item.error).length,
    failedFeeds: facilities.filter(item => item.error).map(item => ({ uid: item.uid, error: item.error })),
    rowCount: rows.length,
    completedWaves: new Set(rows.map(row => `${row.facilityUid}/${row.wavePeakDate}`)).size,
    ...summary,
  }, null, 2));
}

export async function fetchFacilitySamples(plants, { cacheDir = '.cache/facility-samples', concurrency = 8 } = {}) {
  await mkdir(cacheDir, { recursive: true });
  const result = [];
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < plants.length) {
      const plant = plants[cursor++];
      const filename = `${cacheDir}/${plant.uid}.json`;
      try {
        let payload;
        try { payload = JSON.parse(await readFile(filename, 'utf8')); }
        catch {
          const response = await fetch(`https://storage.googleapis.com/wastewater-dev-data/json/${plant.uid}.json`);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          payload = await response.json();
          if (!Array.isArray(payload.samples)) throw new Error('missing samples array');
          await writeFile(filename, JSON.stringify(payload));
        }
        const built = buildSeries(payload.samples.map(sample => ({ ...sample, _facilityUid: plant.uid })));
        const points = Object.values(built.byYear).flat().sort((a, b) => a.originalDate.localeCompare(b.originalDate));
        result.push({ uid: plant.uid, points, sampleCount: points.length });
      } catch (error) {
        result.push({ uid: plant.uid, error: error.message, points: [] });
      }
    }
  });
  await Promise.all(workers);
  return result.sort((a, b) => a.uid.localeCompare(b.uid));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
