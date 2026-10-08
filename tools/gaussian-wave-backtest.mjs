#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { identifyWaves, preWaveBaselineRange } from '../js/stats.js';
import { smoothTimelineLikeChart } from './train-wave-model.mjs';

const DAY = 86400000;
const dayNumber = date => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);
const formatDay = day => new Date(day * DAY).toISOString().slice(0, 10);
const gaussian = (x, mean, sigma) => Math.exp(-0.5 * ((x - mean) / sigma) ** 2);

// Fit y = baseline + amplitude * exp(-(day - mean)^2 / (2 sigma^2)) by least squares.
// For each mean/sigma pair the optimal amplitude has a closed-form solution.
export function fitGaussian(points, baseline = 0) {
  if (!Array.isArray(points) || points.length < 5) return null;
  const origin = points[0].day;
  const rows = points.map(point => ({ x: point.day - origin, y: Number(point.y) }));
  if (rows.some(row => !(row.y > 0))) return null;
  const span = rows.at(-1).x;
  if (!(span > 0)) return null;
  const adjusted = rows.map(row => ({ ...row, y: row.y - baseline }));
  if (adjusted.some(row => !(row.y > 0))) return null;
  const maxY = Math.max(...adjusted.map(row => row.y));
  const minY = Math.min(...adjusted.map(row => row.y));
  const maxX = rows.at(-1).x;
  const evaluate = (mean, sigma) => {
    if (!(sigma > 0)) return null;
    let xy = 0;
    let xx = 0;
    for (const row of adjusted) {
      const shape = gaussian(row.x, mean, sigma);
      xy += row.y * shape;
      xx += shape * shape;
    }
    if (!(xx > 0)) return null;
    const amplitude = xy / xx;
    let loss = 0;
    for (const row of adjusted) loss += (row.y - amplitude * gaussian(row.x, mean, sigma)) ** 2;
    return { mean: mean + origin, sigma, amplitude, loss };
  };
  let best = null;
  const meanLow = 0;
  const meanHigh = maxX + Math.max(180, span);
  const sigmaLow = 2;
  const sigmaHigh = Math.max(30, span * 4);
  for (let i = 0; i <= 60; i++) {
    const mean = meanLow + (meanHigh - meanLow) * i / 60;
    for (let j = 0; j <= 50; j++) {
      const sigma = sigmaLow * (sigmaHigh / sigmaLow) ** (j / 50);
      const candidate = evaluate(mean, sigma);
      if (candidate && (!best || candidate.loss < best.loss)) best = candidate;
    }
  }
  if (!best || !(maxY > minY)) return null;

  // Refine the grid winner locally, progressively reducing the search step.
  let meanStep = (meanHigh - meanLow) / 60;
  let sigmaStep = Math.max(1, best.sigma * 0.2);
  for (let iteration = 0; iteration < 8; iteration++) {
    let local = best;
    for (let i = -4; i <= 4; i++) {
      for (let j = -4; j <= 4; j++) {
        const candidate = evaluate(best.mean - origin + i * meanStep, Math.max(1, best.sigma + j * sigmaStep));
        if (candidate && candidate.loss < local.loss) local = candidate;
      }
    }
    best = local;
    meanStep /= 2;
    sigmaStep /= 2;
  }
  return best;
}

function predictFromPrefix(prefix, active, baselineMedian, threshold, smoothingDays, logTransform) {
  const startDay = dayNumber(active.startDate);
  const observed = smoothTimelineLikeChart(prefix, smoothingDays)
    .filter(point => point.day >= startDay && point.y > 0);
  if (observed.length < 5 || !(threshold > 0)) return null;
  const daily = logTransform
    ? observed.map(point => ({ ...point, y: Math.log(point.y) }))
    : observed;
  const fitBaseline = logTransform ? Math.log(baselineMedian) : baselineMedian;
  const fitThreshold = logTransform ? Math.log(threshold) : threshold;
  const fit = fitGaussian(daily, fitBaseline);
  if (!fit || !(fitThreshold > fitBaseline) || !(fit.amplitude > fitThreshold - fitBaseline)) return null;
  const ratio = fit.amplitude / (fitThreshold - fitBaseline);
  const crossingDay = fit.mean + fit.sigma * Math.sqrt(2 * Math.log(ratio));
  const latestDay = daily.at(-1).day;
  if (!(crossingDay > latestDay) || crossingDay - latestDay > 365) return null;
  return { date: formatDay(Math.ceil(crossingDay)), mean: fit.mean, sigma: fit.sigma, amplitude: fit.amplitude };
}

/** Walk-forward evaluation for Gaussian fits against each completed wave. */
export function backtestGaussianWaveEnd(points, { smoothingDays = 30, logTransform = false } = {}) {
  const ordered = (points || [])
    .filter(point => /^\d{4}-\d{2}-\d{2}$/.test(String(point.originalDate)) && Number(point.y) > 0)
    .map(point => ({ ...point, originalDate: String(point.originalDate).slice(0, 10) }))
    .sort((a, b) => a.originalDate.localeCompare(b.originalDate));
  const waves = identifyWaves(ordered).filter(wave => wave.endDate && !wave.ongoing && wave.endConfirmed);
  const forecasts = [];
  for (const truth of waves) {
    const peakDay = dayNumber(truth.peakDate);
    const endDay = dayNumber(truth.endDate);
    for (let i = 0; i < ordered.length; i++) {
      const cutoffDate = ordered[i].originalDate;
      const cutoffDay = dayNumber(cutoffDate);
      if (cutoffDay < peakDay + 14 || cutoffDay >= endDay) continue;
      const prefix = ordered.slice(0, i + 1);
      const detected = identifyWaves(prefix);
      const active = detected.find(wave => wave.ongoing && wave.peakDate === truth.peakDate);
      if (!active?.startDate) continue;
      const baseline = preWaveBaselineRange(prefix, detected);
      if (!baseline || !(baseline.p90 > 0)) continue;
      if (!(baseline.p90 > baseline.median)) continue;
      const prediction = predictFromPrefix(prefix, active, baseline.median, baseline.p90, smoothingDays, logTransform);
      if (!prediction) continue;
      const forecastDay = dayNumber(prediction.date);
      forecasts.push({
        peakDate: truth.peakDate,
        cutoffDate,
        actualEndDate: truth.endDate,
        baselineThreshold: baseline.p90,
        forecastDate: prediction.date,
        fittedPeakDate: formatDay(Math.round(prediction.mean)),
        fittedSigmaDays: prediction.sigma,
        leadDays: endDay - cutoffDay,
        errorDays: forecastDay - endDay,
        absoluteErrorDays: Math.abs(forecastDay - endDay),
      });
    }
  }
  const errors = forecasts.map(row => row.absoluteErrorDays).sort((a, b) => a - b);
  return {
    strategy: `${smoothingDays > 1 ? `${smoothingDays}-day triangular weighted average` : 'unsmoothed daily values'} + ${logTransform ? 'log-scale ' : ''}Gaussian curve over prior baseline median; crossing prior baseline P90`,
    completedWaves: waves.length,
    forecastCount: forecasts.length,
    meanAbsoluteErrorDays: errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null,
    medianAbsoluteErrorDays: errors.length ? errors[Math.floor((errors.length - 1) / 2)] : null,
    within14DaysPercent: errors.length ? 100 * errors.filter(value => value <= 14).length / errors.length : null,
    forecasts,
  };
}

async function main() {
  const filename = process.argv[2];
  if (!filename || filename === '--help') {
    console.log(`Usage: node tools/gaussian-wave-backtest.mjs <points.json>\nJSON must contain an array of { originalDate, y } points, or an object with a points array.`);
    process.exitCode = filename ? 0 : 2;
    return;
  }
  const parsed = JSON.parse(await readFile(filename, 'utf8'));
  const points = Array.isArray(parsed) ? parsed : parsed.points;
  if (!Array.isArray(points)) throw new Error('Input JSON must be an array or contain a points array.');
  console.log(JSON.stringify(backtestGaussianWaveEnd(points), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
