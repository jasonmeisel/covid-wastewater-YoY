#!/usr/bin/env node
// Experiments for pooled, interpretable wave-end regression. No model artifact is
// used by the app: this script evaluates a leakage-conscious baseline first.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildSeries, dailyAggregate, identifyWaves, movingAverage, quantile } from '../js/stats.js';
import { durationOutcome, fitBayesianWeibullSurvival, predictBayesianWeibullRemaining } from './bayesian-wave-survival.mjs';
import { fitBayesianHazard, predictBayesianHazard } from './bayesian-wave-hazard.mjs';

const DAY = 86400000;
const dayNumber = date => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').slice(0, 10));
const FEATURES = ['elapsedDays', 'logAboveThreshold', 'logBelowPeak', 'logSlope', 'slopeR2'];

function linearFit(values) {
  if (values.length < 3) return { slope: 0, r2: 0 };
  const xs = values.map((point, i) => Number.isFinite(point.day) ? point.day - values[0].day : i * 7);
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

// Match the chart's continuous-timeline path: absolute-day x, daily aggregation,
// triangular smoothing, and exact latest-observation preservation.
export function smoothTimelineLikeChart(points, windowDays = 14) {
  const dated = (points || []).filter(point => validDate(point.originalDate) && Number(point.y) > 0)
    .map(point => ({ ...point, originalDate: String(point.originalDate).slice(0, 10), x: dayNumber(point.originalDate) }))
    .sort((a, b) => a.x - b.x);
  const daily = dailyAggregate(dated);
  return movingAverage(daily, windowDays, true).map(point => {
    const date = new Date(Number(point.x) * DAY).toISOString().slice(0, 10);
    return { ...point, x: Number(point.x), day: Number(point.x), originalDate: date };
  });
}

// Complete Monday-Sunday averages from the chart's 14-day-smoothed signal.
function completedWeeklyMeans(points) {
  const smoothed = smoothTimelineLikeChart(points, 14);
  if (smoothed.length < 7) return [];
  const byWeek = new Map();
  for (const point of smoothed) {
    const week = point.day - ((point.day + 3) % 7);
    const values = byWeek.get(week) || [];
    values.push(point.y);
    byWeek.set(week, values);
  }
  const lastDay = smoothed.at(-1).day;
  return [...byWeek.entries()].filter(([start, values]) => start >= smoothed[0].day && start + 6 <= lastDay && values.length === 7)
    .sort((a, b) => a[0] - b[0]).map(([start, values]) => ({
      day: start + 3, y: values.reduce((sum, value) => sum + value, 0) / values.length,
    }));
}

function completedWeeklyDeclines(points) {
  const weeks = completedWeeklyMeans(points).map(point => point.y);
  let declines = 0;
  for (let i = weeks.length - 1; i > 0 && weeks[i] < weeks[i - 1]; i--) declines++;
  return declines;
}

export function waveTrainingRows(facilityUid, points, { smoothingDays = 0, includeCensored = false, weeklySlope = false } = {}) {
  const series = (points || []).filter(point => validDate(point.originalDate) && Number(point.y) > 0)
    .slice().sort((a, b) => String(a.originalDate).localeCompare(String(b.originalDate)));
  const fullSignal = smoothingDays ? smoothTimelineLikeChart(series, smoothingDays) : series;
  const preSmoothed = Boolean(smoothingDays);
  const lastObservedDate = String(series.at(-1)?.originalDate || '').slice(0, 10);
  const waves = identifyWaves(fullSignal, { preSmoothed }).filter(wave => includeCensored || (wave.endDate && !wave.ongoing && wave.endConfirmed));
  const rows = [];
  for (const truth of waves) {
    const observedEndDate = truth.endDate || lastObservedDate;
    const peakDay = dayNumber(truth.peakDate);
    const endDay = dayNumber(observedEndDate);
    if (!Number.isFinite(endDay) || endDay <= peakDay) continue;
    for (let index = 0; index < series.length; index++) {
      const cutoffDate = String(series[index].originalDate).slice(0, 10);
      const cutoff = dayNumber(cutoffDate);
      if (cutoff < peakDay + 14 || cutoff >= endDay) continue;
      // Derive the features from the estimator's prefix-only wave state. Using
      // the full-series peak or threshold here would leak future observations.
      const rawPrefix = series.slice(0, index + 1);
      const prefix = smoothingDays ? smoothTimelineLikeChart(rawPrefix, smoothingDays) : rawPrefix;
      const detected = identifyWaves(prefix, { preSmoothed });
      const active = detected.find(wave => wave.ongoing && !wave.endDate && wave.peakDate === truth.peakDate);
      if (!active || !(active.endThreshold > 0) || !(active.peak > 0)) continue;
      const recent = prefix.filter(point => (Number.isFinite(point.day) ? point.day : dayNumber(String(point.originalDate).slice(0, 10))) >= cutoff - 42)
        .map(point => ({ day: Number.isFinite(point.day) ? point.day : dayNumber(String(point.originalDate).slice(0, 10)), y: Number(point.y) }));
      if (!recent.length) continue;
      const fit = weeklySlope
        ? linearFit(completedWeeklyMeans(rawPrefix).slice(-4))
        : linearFit(recent.slice(-7));
      rows.push({
        facilityUid: String(facilityUid), wavePeakDate: truth.peakDate,
        cutoffDate, endDate: observedEndDate, event: Boolean(truth.endConfirmed),
        x: {
          elapsedDays: cutoff - dayNumber(active.peakDate),
          logAboveThreshold: Math.log(Math.max(0.01, recent.at(-1).y / active.endThreshold)),
          logBelowPeak: Math.log(Math.max(0.01, recent.at(-1).y / active.peak)),
          logSlope: fit.slope,
          slopeR2: fit.r2,
        },
        remainingDays: endDay - cutoff,
        declineWeeks: completedWeeklyDeclines(rawPrefix),
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

// A transparent analog/nearest-wave model: select one closest observed snapshot
// per completed training wave, then summarize remaining durations with quantiles.
export function predictWaveAnalogs(rows, features, k = 7) {
  if (!rows.length) return null;
  const means = FEATURES.map(feature => rows.reduce((sum, row) => sum + row.x[feature], 0) / rows.length);
  const scales = FEATURES.map((feature, i) => Math.sqrt(rows.reduce((sum, row) => sum + (row.x[feature] - means[i]) ** 2, 0) / rows.length) || 1);
  const closestByWave = new Map();
  for (const row of rows) {
    const distance = FEATURES.reduce((sum, feature, i) => sum + ((row.x[feature] - features[feature]) / scales[i]) ** 2, 0);
    const id = `${row.facilityUid}/${row.wavePeakDate}`;
    if (!closestByWave.has(id) || distance < closestByWave.get(id).distance) {
      closestByWave.set(id, { distance, remainingDays: row.remainingDays });
    }
  }
  const neighbors = [...closestByWave.values()].sort((a, b) => a.distance - b.distance).slice(0, k);
  if (neighbors.length < k) return null;
  const durations = neighbors.map(row => row.remainingDays).sort((a, b) => a - b);
  return {
    neighbors: neighbors.length,
    medianDays: quantile(durations, 0.5),
    lowerDays: quantile(durations, 0.1),
    upperDays: quantile(durations, 0.9),
  };
}

// Split earlier completed waves into analog-fit and calibration folds. Calibration
// uses each held-out wave's worst interval miss, so repeated snapshots do not count
// as independent calibration observations.
export function predictCalibratedWaveAnalogs(trainingRows, features, { k = 7, coverage = 0.8 } = {}) {
  const waves = new Map();
  for (const row of trainingRows) {
    const id = `${row.facilityUid}/${row.wavePeakDate}`;
    const group = waves.get(id) || { id, endDate: row.endDate, rows: [] };
    group.rows.push(row);
    waves.set(id, group);
  }
  const ordered = [...waves.values()].sort((a, b) => a.endDate.localeCompare(b.endDate) || a.id.localeCompare(b.id));
  const calibrationWaves = ordered.filter((_, index) => index % 4 === 0);
  const fitWaves = ordered.filter((_, index) => index % 4 !== 0);
  const fitRows = fitWaves.flatMap(wave => wave.rows);
  if (fitWaves.length < k || calibrationWaves.length < 3) return null;
  const analog = predictWaveAnalogs(fitRows, features, k);
  if (!analog) return null;

  const scores = [];
  for (const wave of calibrationWaves) {
    const waveScores = wave.rows.map(row => {
      const interval = predictWaveAnalogs(fitRows, row.x, k);
      if (!interval) return null;
      return Math.max(0, interval.lowerDays - row.remainingDays, row.remainingDays - interval.upperDays);
    }).filter(Number.isFinite);
    if (waveScores.length) scores.push(Math.max(...waveScores));
  }
  if (scores.length < 3) return null;
  scores.sort((a, b) => a - b);
  const rank = Math.min(scores.length, Math.ceil((scores.length + 1) * coverage));
  const adjustmentDays = scores[rank - 1];
  return {
    ...analog,
    lowerDays: Math.max(0, analog.lowerDays - adjustmentDays),
    upperDays: analog.upperDays + adjustmentDays,
    adjustmentDays,
    calibrationWaves: scores.length,
    fitWaves: fitWaves.length,
  };
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
    const analog = predictWaveAnalogs(training, target.x, 7);
    const calibratedAnalog = predictCalibratedWaveAnalogs(training, target.x, { k: 7, coverage: 0.8 });
    const trendDays = target.x.logSlope < -0.005 && target.x.logAboveThreshold > 0
      ? Math.min(180, -target.x.logAboveThreshold / target.x.logSlope) : null;
    const historicalWaves = new Map();
    for (const row of training) {
      const key = `${row.facilityUid}/${row.wavePeakDate}`;
      if (!historicalWaves.has(key)) historicalWaves.set(key, dayNumber(row.endDate) - dayNumber(row.wavePeakDate));
    }
    const historicalRemaining = [...historicalWaves.values()]
      .map(duration => duration - target.x.elapsedDays).filter(duration => duration > 0).sort((a, b) => a - b);
    const historicalDurationDays = historicalRemaining.length >= 3
      ? historicalRemaining[Math.floor((historicalRemaining.length - 1) / 2)] : null;
    predictions.push({
      ...target, predictedDays: prediction,
      absoluteErrorDays: Math.abs(prediction - target.remainingDays),
      recentTrendDays: trendDays,
      historicalDurationDays,
      analogMedianDays: analog?.medianDays ?? null,
      analogLowerDays: analog?.lowerDays ?? null,
      analogUpperDays: analog?.upperDays ?? null,
      calibratedAnalogMedianDays: calibratedAnalog?.medianDays ?? null,
      calibratedAnalogLowerDays: calibratedAnalog?.lowerDays ?? null,
      calibratedAnalogUpperDays: calibratedAnalog?.upperDays ?? null,
      calibratedAnalogAdjustmentDays: calibratedAnalog?.adjustmentDays ?? null,
      analogCalibrationWaves: calibratedAnalog?.calibrationWaves ?? null,
      trainingWaves: historicalWaves.size,
    });
  }
  const errors = predictions.map(row => row.absoluteErrorDays).sort((a, b) => a - b);
  const errorsFor = selector => predictions.filter(row => Number.isFinite(selector(row)))
    .map(row => Math.abs(selector(row) - row.remainingDays)).sort((a, b) => a - b);
  const pairedPredictions = predictions.filter(row => Number.isFinite(row.currentBaselineDays));
  const pairedModelErrors = pairedPredictions.map(row => row.absoluteErrorDays).sort((a, b) => a - b);
  const baselineErrors = errorsFor(row => row.currentBaselineDays);
  const trendErrors = errorsFor(row => row.recentTrendDays);
  const historicalErrors = errorsFor(row => row.historicalDurationDays);
  const analogErrors = errorsFor(row => row.analogMedianDays);
  const calibratedAnalogErrors = errorsFor(row => row.calibratedAnalogMedianDays);
  const analogIntervals = predictions.filter(row => Number.isFinite(row.analogLowerDays) && Number.isFinite(row.analogUpperDays));
  const calibratedIntervals = predictions.filter(row => Number.isFinite(row.calibratedAnalogLowerDays) && Number.isFinite(row.calibratedAnalogUpperDays));
  const intervalSummary = (intervals, lowerKey = 'analogLowerDays', upperKey = 'analogUpperDays') => {
    const widths = intervals.map(row => row[upperKey] - row[lowerKey]);
    const waves = new Map();
    for (const row of intervals) {
      const key = `${row.facilityUid}/${row.wavePeakDate}`;
      const wave = waves.get(key) || { covered: true };
      if (row.remainingDays < row[lowerKey] || row.remainingDays > row[upperKey]) wave.covered = false;
      waves.set(key, wave);
    }
    const waveValues = [...waves.values()];
    return {
      count: intervals.length,
      snapshotCoveragePercent: intervals.length ? 100 * intervals.filter(row => row.remainingDays >= row[lowerKey] && row.remainingDays <= row[upperKey]).length / intervals.length : null,
      meanWidthDays: widths.length ? widths.reduce((sum, width) => sum + width, 0) / widths.length : null,
      medianWidthDays: widths.length ? [...widths].sort((a, b) => a - b)[Math.floor(widths.length / 2)] : null,
      waveCount: waveValues.length,
      wholeWaveCoveragePercent: waveValues.length ? 100 * waveValues.filter(wave => wave.covered).length / waveValues.length : null,
    };
  };
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
  const allMethods = [
    ['ridge', 'predictedDays'],
    ['currentEstimator', 'currentBaselineDays'],
    ['recentTrend', 'recentTrendDays'],
    ['historicalDuration', 'historicalDurationDays'],
    ['waveAnalogs', 'analogMedianDays'],
    ['calibratedWaveAnalogs', 'calibratedAnalogMedianDays'],
  ];
  const commonRows = predictions.filter(row => allMethods.every(([, key]) => Number.isFinite(row[key])));
  const matchedMethodSummary = key => {
    const methodErrors = commonRows.map(row => Math.abs(row[key] - row.remainingDays));
    const waveGroups = new Map();
    for (const row of commonRows) {
      const id = `${row.facilityUid}/${row.wavePeakDate}`;
      const values = waveGroups.get(id) || [];
      values.push(Math.abs(row[key] - row.remainingDays));
      waveGroups.set(id, values);
    }
    const waveMeans = [...waveGroups.values()].map(values => values.reduce((sum, value) => sum + value, 0) / values.length);
    return {
      snapshots: methodErrors.length,
      meanAbsoluteErrorDays: methodErrors.length ? methodErrors.reduce((sum, value) => sum + value, 0) / methodErrors.length : null,
      medianAbsoluteErrorDays: methodErrors.length ? [...methodErrors].sort((a, b) => a - b)[Math.floor(methodErrors.length / 2)] : null,
      within14DaysPercent: methodErrors.length ? 100 * methodErrors.filter(error => error <= 14).length / methodErrors.length : null,
      waves: waveMeans.length,
      meanWaveAbsoluteErrorDays: waveMeans.length ? waveMeans.reduce((sum, value) => sum + value, 0) / waveMeans.length : null,
    };
  };
  const leadTimeBands = [
    { label: '0-13 days', min: 0, max: 14 },
    { label: '14-27 days', min: 14, max: 28 },
    { label: '28-55 days', min: 28, max: 56 },
    { label: '56+ days', min: 56, max: Infinity },
  ].map(band => {
    const subset = predictions.filter(row => row.remainingDays >= band.min && row.remainingDays < band.max);
    const summarizeErrors = errors => ({
      count: errors.length,
      meanAbsoluteErrorDays: errors.length ? errors.reduce((sum, error) => sum + error, 0) / errors.length : null,
      medianAbsoluteErrorDays: errors.length ? [...errors].sort((a, b) => a - b)[Math.floor(errors.length / 2)] : null,
      within7DaysPercent: errors.length ? 100 * errors.filter(error => error <= 7).length / errors.length : null,
      within14DaysPercent: errors.length ? 100 * errors.filter(error => error <= 14).length / errors.length : null,
    });
    const waveMetrics = (items, errorOf) => {
      const groups = new Map();
      for (const row of items) {
        const error = errorOf(row);
        if (!Number.isFinite(error)) continue;
        const key = `${row.facilityUid}/${row.wavePeakDate}`;
        const values = groups.get(key) || [];
        values.push(error);
        groups.set(key, values);
      }
      const waveErrors = [...groups.values()].map(values => values.reduce((sum, value) => sum + value, 0) / values.length);
      return {
        waveCount: waveErrors.length,
        meanWaveAbsoluteErrorDays: waveErrors.length ? waveErrors.reduce((sum, value) => sum + value, 0) / waveErrors.length : null,
        wavesWithin14DaysPercent: waveErrors.length ? 100 * waveErrors.filter(value => value <= 14).length / waveErrors.length : null,
      };
    };
    const eligible = rows.filter(row => row.remainingDays >= band.min && row.remainingDays < band.max).length;
    const methodStats = selector => {
      const candidates = subset.filter(row => Number.isFinite(selector(row)));
      const methodErrors = candidates.map(row => Math.abs(selector(row) - row.remainingDays));
      return {
        ...summarizeErrors(methodErrors),
        availabilityPercent: eligible ? 100 * candidates.length / eligible : null,
        ...waveMetrics(candidates, row => Math.abs(selector(row) - row.remainingDays)),
      };
    };
    return {
      ...band,
      eligibleSnapshots: eligible,
      model: methodStats(row => row.predictedDays),
      currentEstimator: methodStats(row => row.currentBaselineDays),
      recentTrend: methodStats(row => row.recentTrendDays),
      historicalDuration: methodStats(row => row.historicalDurationDays),
      waveAnalogs: methodStats(row => row.analogMedianDays),
      calibratedWaveAnalogs: methodStats(row => row.calibratedAnalogMedianDays),
      waveAnalogInterval: intervalSummary(subset.filter(row => Number.isFinite(row.analogLowerDays) && Number.isFinite(row.analogUpperDays))),
      calibratedWaveAnalogInterval: intervalSummary(
        subset.filter(row => Number.isFinite(row.calibratedAnalogLowerDays) && Number.isFinite(row.calibratedAnalogUpperDays)),
        'calibratedAnalogLowerDays', 'calibratedAnalogUpperDays'),
      matchedCutoffs: (() => {
        const matched = subset.filter(row => allMethods.every(([, key]) => Number.isFinite(row[key])));
        const statsFor = key => {
          const methodErrors = matched.map(row => Math.abs(row[key] - row.remainingDays));
          const waveGroups = new Map();
          for (const row of matched) {
            const id = `${row.facilityUid}/${row.wavePeakDate}`;
            const values = waveGroups.get(id) || [];
            values.push(Math.abs(row[key] - row.remainingDays));
            waveGroups.set(id, values);
          }
          const waveMeans = [...waveGroups.values()].map(values => values.reduce((sum, value) => sum + value, 0) / values.length);
          return {
            snapshots: methodErrors.length,
            meanAbsoluteErrorDays: methodErrors.length ? methodErrors.reduce((sum, value) => sum + value, 0) / methodErrors.length : null,
            meanWaveAbsoluteErrorDays: waveMeans.length ? waveMeans.reduce((sum, value) => sum + value, 0) / waveMeans.length : null,
          };
        };
        return Object.fromEntries(allMethods.map(([name, key]) => [name, statsFor(key)]));
      })(),
    };
  });
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
    waveAnalogsCount: analogErrors.length,
    waveAnalogsMeanAbsoluteErrorDays: analogErrors.length ? analogErrors.reduce((sum, n) => sum + n, 0) / analogErrors.length : null,
    waveAnalogsMedianAbsoluteErrorDays: analogErrors.length ? analogErrors[Math.floor(analogErrors.length / 2)] : null,
    waveAnalogsWithin14DaysPercent: analogErrors.length ? 100 * analogErrors.filter(error => error <= 14).length / analogErrors.length : null,
    waveAnalogIntervals: intervalSummary(analogIntervals),
    calibratedWaveAnalogs: {
      count: calibratedAnalogErrors.length,
      meanAbsoluteErrorDays: calibratedAnalogErrors.length ? calibratedAnalogErrors.reduce((sum, value) => sum + value, 0) / calibratedAnalogErrors.length : null,
      medianAbsoluteErrorDays: calibratedAnalogErrors.length ? calibratedAnalogErrors[Math.floor(calibratedAnalogErrors.length / 2)] : null,
      within14DaysPercent: calibratedAnalogErrors.length ? 100 * calibratedAnalogErrors.filter(error => error <= 14).length / calibratedAnalogErrors.length : null,
    },
    calibratedWaveAnalogIntervals: intervalSummary(calibratedIntervals, 'calibratedAnalogLowerDays', 'calibratedAnalogUpperDays'),
    leadTimeBands,
    commonCutoffCount: commonRows.length,
    matchedMethods: Object.fromEntries(allMethods.map(([name, key]) => [name, matchedMethodSummary(key)])),
  };
}

// Confirmed endings are events; inferred closures and current waves are right-censored
// at their closure or last observed date, respectively.
export function waveSurvivalOutcomes(facilityUid, points) {
  const series = (points || []).filter(point => validDate(point.originalDate) && Number(point.y) > 0)
    .slice().sort((a, b) => String(a.originalDate).localeCompare(String(b.originalDate)));
  if (!series.length) return [];
  const lastObservedDate = String(series.at(-1).originalDate).slice(0, 10);
  return identifyWaves(series).map(wave => durationOutcome(facilityUid, wave, lastObservedDate)).filter(Boolean);
}

export function buildWaveHazardRows(snapshotRows) {
  const waves = new Map();
  for (const row of snapshotRows || []) {
    const key = `${row.facilityUid}/${row.wavePeakDate}`;
    const values = waves.get(key) || [];
    values.push(row);
    waves.set(key, values);
  }
  const result = [];
  for (const values of waves.values()) {
    values.sort((a, b) => a.cutoffDate.localeCompare(b.cutoffDate));
    const byWeek = new Map();
    const peak = dayNumber(values[0].wavePeakDate);
    for (const row of values) {
      const cutoff = dayNumber(row.cutoffDate);
      const week = Math.floor((cutoff - peak - 14) / 7);
      if (week < 0) continue;
      const prior = byWeek.get(week);
      if (!prior || row.cutoffDate > prior.cutoffDate) byWeek.set(week, row);
    }
    for (const row of byWeek.values()) {
      const remainingDays = dayNumber(row.endDate) - dayNumber(row.cutoffDate);
      if (!(remainingDays > 0)) continue;
      // Censoring inside the next week means the binary hazard outcome is unknown.
      if (!row.event && remainingDays < 7) continue;
      const eventNextWeek = row.event && remainingDays <= 7 ? 1 : 0;
      result.push({
        facilityUid: row.facilityUid, wavePeakDate: row.wavePeakDate,
        cutoffDate: row.cutoffDate,
        outcomeDate: eventNextWeek ? row.endDate : new Date((dayNumber(row.cutoffDate) + 7) * DAY).toISOString().slice(0, 10),
        eventNextWeek, censoredWave: !row.event, x: row.x,
      });
    }
  }
  return result.sort((a, b) => a.cutoffDate.localeCompare(b.cutoffDate));
}

function errorSummary(values) {
  const errors = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    count: errors.length,
    meanAbsoluteErrorDays: errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null,
    medianAbsoluteErrorDays: errors.length ? errors[Math.floor(errors.length / 2)] : null,
    within14DaysPercent: errors.length ? 100 * errors.filter(value => value <= 14).length / errors.length : null,
  };
}

// The fixed issuance rule is >=14 days post-peak plus three consecutive declines
// in complete calendar-week means of the chart's 14-day-smoothed signal.
export function evaluateBayesianWaveHazard(snapshotRows, hazardRows, regressionRows) {
  const grouped = new Map();
  for (const row of snapshotRows || []) {
    if (!row.event) continue;
    const key = `${row.facilityUid}/${row.wavePeakDate}`;
    const values = grouped.get(key) || [];
    values.push(row);
    grouped.set(key, values);
  }
  const targets = [...grouped.values()].map(values => values.filter(row => row.x.elapsedDays >= 14 && row.declineWeeks >= 3)
    .sort((a, b) => a.cutoffDate.localeCompare(b.cutoffDate))[0]).filter(Boolean);
  const predictions = [];
  for (const target of targets) {
    const cutoff = target.cutoffDate;
    const trainingRisk = hazardRows.filter(row => row.facilityUid !== target.facilityUid && row.outcomeDate < cutoff);
    const model = fitBayesianHazard(trainingRisk);
    if (!model) continue;
    const distribution = predictBayesianHazard(model, target.x, { seed: dayNumber(cutoff) + dayNumber(target.wavePeakDate) });
    if (!distribution) continue;
    const training = regressionRows.filter(row => row.facilityUid !== target.facilityUid && row.endDate < cutoff);
    const ridge = predictRidge(fitRidge(training), target.x);
    const historical = new Map();
    for (const row of training) historical.set(`${row.facilityUid}/${row.wavePeakDate}`, dayNumber(row.endDate) - dayNumber(row.wavePeakDate));
    const priorRemaining = [...historical.values()].map(duration => duration - target.x.elapsedDays).filter(value => value > 0).sort((a, b) => a - b);
    const historicalDays = priorRemaining.length >= 3 ? priorRemaining[Math.floor((priorRemaining.length - 1) / 2)] : null;
    predictions.push({
      ...target,
      ...distribution,
      ridgeDays: ridge,
      historicalDays,
      remainingDays: dayNumber(target.endDate) - dayNumber(target.cutoffDate),
      currentBaselineDays: target.currentBaselineDays,
      trainingCensoredWaves: new Set(trainingRisk.filter(row => row.censoredWave)
        .map(row => `${row.facilityUid}/${row.wavePeakDate}`)).size,
    });
  }
  const intervals = predictions.filter(row => Number.isFinite(row.lowerDays) && Number.isFinite(row.upperDays));
  const widths = intervals.map(row => row.upperDays - row.lowerDays);
  return {
    issuanceRule: '>=14 days post-peak and 3 consecutive complete weekly declines in the chart 14-day-smoothed signal',
    eligibleCompletedWaves: grouped.size,
    issuedForecasts: predictions.length,
    availabilityPercent: grouped.size ? 100 * predictions.length / grouped.size : null,
    waves: predictions.length,
    bayesianHazard: errorSummary(predictions.map(row => Math.abs(row.medianDays - row.remainingDays))),
    ridge: errorSummary(predictions.map(row => Number.isFinite(row.ridgeDays) ? Math.abs(row.ridgeDays - row.remainingDays) : null)),
    historicalDuration: errorSummary(predictions.map(row => Number.isFinite(row.historicalDays) ? Math.abs(row.historicalDays - row.remainingDays) : null)),
    currentEstimator: errorSummary(predictions.map(row => Number.isFinite(row.currentBaselineDays) ? Math.abs(row.currentBaselineDays - row.remainingDays) : null)),
    intervalCoveragePercent: intervals.length ? 100 * intervals.filter(row => row.remainingDays >= row.lowerDays && row.remainingDays <= row.upperDays).length / intervals.length : null,
    meanIntervalWidthDays: widths.length ? widths.reduce((sum, value) => sum + value, 0) / widths.length : null,
    medianTrainingWaves: predictions.length ? [...predictions.map(row => row.trainingWaves)].sort((a, b) => a - b)[Math.floor(predictions.length / 2)] : null,
    medianTrainingEvents: predictions.length ? [...predictions.map(row => row.trainingEvents)].sort((a, b) => a - b)[Math.floor(predictions.length / 2)] : null,
    predictions,
  };
}

export function evaluateBayesianSurvival(rows, outcomes) {
  const predictions = [];
  const modelCache = new Map();
  for (const target of rows) {
    const cutoff = target.cutoffDate;
    const key = `${target.facilityUid}/${cutoff}`;
    let model = modelCache.get(key);
    if (model === undefined) {
      const eligible = outcomes.filter(row => row.facilityUid !== target.facilityUid && row.observationDate < cutoff);
      model = fitBayesianWeibullSurvival(eligible);
      modelCache.set(key, model || null);
    }
    if (!model) continue;
    const prediction = predictBayesianWeibullRemaining(model, target.x.elapsedDays);
    if (!prediction) continue;
    predictions.push({
      ...target,
      survivalMedianDays: prediction.medianDays,
      survivalLowerDays: prediction.lowerDays,
      survivalUpperDays: prediction.upperDays,
      survivalTrainingWaves: prediction.trainingWaves,
      survivalTrainingEvents: prediction.trainingEvents,
      survivalTrainingCensored: prediction.trainingCensored,
      survivalAbsoluteErrorDays: Math.abs(prediction.medianDays - target.remainingDays),
    });
  }
  const errors = predictions.map(row => row.survivalAbsoluteErrorDays).sort((a, b) => a - b);
  const waveErrors = new Map();
  for (const row of predictions) {
    const id = `${row.facilityUid}/${row.wavePeakDate}`;
    const values = waveErrors.get(id) || [];
    values.push(row.survivalAbsoluteErrorDays);
    waveErrors.set(id, values);
  }
  const meanWaveErrors = [...waveErrors.values()].map(values => values.reduce((sum, value) => sum + value, 0) / values.length);
  const covered = predictions.filter(row => row.remainingDays >= row.survivalLowerDays && row.remainingDays <= row.survivalUpperDays);
  const widths = predictions.map(row => row.survivalUpperDays - row.survivalLowerDays);
  return {
    predictions,
    snapshots: predictions.length,
    waves: waveErrors.size,
    meanAbsoluteErrorDays: errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null,
    medianAbsoluteErrorDays: errors.length ? errors[Math.floor(errors.length / 2)] : null,
    meanWaveAbsoluteErrorDays: meanWaveErrors.length ? meanWaveErrors.reduce((sum, value) => sum + value, 0) / meanWaveErrors.length : null,
    within14DaysPercent: errors.length ? 100 * errors.filter(value => value <= 14).length / errors.length : null,
    intervalCoveragePercent: predictions.length ? 100 * covered.length / predictions.length : null,
    meanIntervalWidthDays: widths.length ? widths.reduce((sum, value) => sum + value, 0) / widths.length : null,
    medianTrainingEvents: predictions.length ? [...predictions.map(row => row.survivalTrainingEvents)].sort((a, b) => a - b)[Math.floor(predictions.length / 2)] : null,
    medianTrainingCensored: predictions.length ? [...predictions.map(row => row.survivalTrainingCensored)].sort((a, b) => a - b)[Math.floor(predictions.length / 2)] : null,
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
  const auditVariant = smoothingDays => facilities.map(facility => {
    const signal = smoothingDays ? smoothTimelineLikeChart(facility.points, smoothingDays) : facility.points;
    return {
      uid: facility.uid,
      waves: identifyWaves(signal, { preSmoothed: Boolean(smoothingDays) }).map(wave => ({
        peakDate: wave.peakDate, endDate: wave.endDate,
        endConfirmed: wave.endConfirmed, ongoing: wave.ongoing,
      })),
    };
  });
  const countLabels = audit => audit.flatMap(facility => facility.waves).reduce((counts, wave) => {
    if (wave.ongoing) counts.ongoing++;
    else if (wave.endConfirmed) counts.thresholdConfirmed++;
    else counts.inferredNextWave++;
    return counts;
  }, { thresholdConfirmed: 0, inferredNextWave: 0, ongoing: 0 });
  const labelAudit = auditVariant(0);
  const smoothedLabelAudit = auditVariant(14);
  const labelCounts = countLabels(labelAudit);
  const smoothedLabelCounts = countLabels(smoothedLabelAudit);
  const rows = facilities.flatMap(facility => waveTrainingRows(facility.uid, facility.points));
  const smoothedRows = facilities.flatMap(facility => waveTrainingRows(facility.uid, facility.points, { smoothingDays: 14 }));
  const survivalOutcomes = facilities.flatMap(facility => waveSurvivalOutcomes(facility.uid, facility.points));
  const survivalResult = evaluateBayesianSurvival(rows, survivalOutcomes);
  const { predictions: survivalPredictions, ...survivalSummary } = survivalResult;
  const hazardSnapshots = facilities.flatMap(facility => waveTrainingRows(facility.uid, facility.points, { smoothingDays: 14, includeCensored: true, weeklySlope: true }));
  const hazardRows = buildWaveHazardRows(hazardSnapshots);
  const hazardResult = evaluateBayesianWaveHazard(hazardSnapshots, hazardRows, smoothedRows);
  const { predictions: hazardPredictions, ...hazardSummary } = hazardResult;
  await writeFile(`${cacheDir}/wave-training-rows.json`, JSON.stringify({
    generatedAt: new Date().toISOString(),
    facilityCount: facilities.filter(item => !item.error).length,
    labelCounts,
    labelAudit,
    smoothed14LabelCounts: smoothedLabelCounts,
    smoothed14LabelAudit: smoothedLabelAudit,
    plants: facilities.map(({ uid, sampleCount, error }) => ({ uid, sampleCount, error })),
    rows,
    smoothed14Rows: smoothedRows,
    survivalOutcomes,
    bayesianSurvivalSummary: survivalSummary,
    bayesianSurvivalPredictions: survivalPredictions,
    hazardSnapshotRows: hazardSnapshots,
    bayesianHazardRows: hazardRows,
    bayesianHazardSummary: hazardSummary,
    bayesianHazardPredictions: hazardPredictions,
  }, null, 2));
  const result = evaluatePooledModel(rows);
  const smoothedResult = evaluatePooledModel(smoothedRows);
  const { predictions, ...summary } = result;
  const { predictions: smoothedPredictions, ...smoothedSummary } = smoothedResult;
  const rowKey = row => `${row.facilityUid}/${row.wavePeakDate}/${row.endDate}/${row.cutoffDate}`;
  const smoothedByKey = new Map(smoothedPredictions.map(row => [rowKey(row), row]));
  const sameLabelAndCutoff = predictions.flatMap(raw => {
    const smoothed = smoothedByKey.get(rowKey(raw));
    return smoothed ? [{ raw, smoothed }] : [];
  });
  const pairedSmoothingMetrics = errorFor => {
    const errors = sameLabelAndCutoff.map(({ raw, smoothed }) => [errorFor(raw), errorFor(smoothed)])
      .filter(pair => pair.every(Number.isFinite));
    return {
      count: errors.length,
      rawMeanAbsoluteErrorDays: errors.length ? errors.reduce((sum, pair) => sum + pair[0], 0) / errors.length : null,
      smoothedMeanAbsoluteErrorDays: errors.length ? errors.reduce((sum, pair) => sum + pair[1], 0) / errors.length : null,
    };
  };
  console.log(JSON.stringify({
    selectedFacilities: plants.map(plant => ({ uid: plant.uid, name: plant.name, population: plant.sewershed_pop })),
    successfulFeeds: facilities.filter(item => !item.error).length,
    failedFeeds: facilities.filter(item => item.error).map(item => ({ uid: item.uid, error: item.error })),
    rawVariant: {
      rowCount: rows.length, labelCounts,
      completedWaves: new Set(rows.map(row => `${row.facilityUid}/${row.wavePeakDate}`)).size,
      ...summary,
    },
    chart14DayVariant: {
      rowCount: smoothedRows.length, labelCounts: smoothedLabelCounts,
      completedWaves: new Set(smoothedRows.map(row => `${row.facilityUid}/${row.wavePeakDate}`)).size,
      ...smoothedSummary,
    },
    sameWaveCutoffComparison: {
      sharedForecasts: sameLabelAndCutoff.length,
      ridge: pairedSmoothingMetrics(row => row.absoluteErrorDays),
      historicalDuration: pairedSmoothingMetrics(row => Number.isFinite(row.historicalDurationDays)
        ? Math.abs(row.historicalDurationDays - row.remainingDays) : null),
      waveAnalogs: pairedSmoothingMetrics(row => Number.isFinite(row.analogMedianDays)
        ? Math.abs(row.analogMedianDays - row.remainingDays) : null),
    },
    bayesianWeibullSurvival: survivalSummary,
    bayesianDiscreteHazard: hazardSummary,
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
