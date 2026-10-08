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

const normalCdf = value => {
  const z = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-z * z);
  return 0.5 * (1 + (value < 0 ? -erf : erf));
};
const skewShape = (z, alpha) => Math.exp(-0.5 * z * z) * 2 * normalCdf(alpha * z);

// Fit a baseline-offset skew-normal curve; amplitude is solved exactly for
// each location / scale / skew candidate, then the least-squares loss is minimized.
export function fitSkewNormal(points, baseline = 0) {
  if (!Array.isArray(points) || points.length < 5) return null;
  const origin = points[0].day;
  const rows = points.map(point => ({ x: point.day - origin, y: Number(point.y) - baseline }));
  if (rows.some(row => !(row.y > 0))) return null;
  const gaussian = fitGaussian(points, baseline);
  if (!gaussian) return null;
  const center = gaussian.mean - origin;
  const radius = Math.max(35, gaussian.sigma * 1.5);
  const scales = [0.5, 0.7, 0.85, 1, 1.2, 1.5, 2].map(factor => gaussian.sigma * factor);
  const shapes = [-8, -4, -2, -1, 0, 1, 2, 4, 8];
  const evaluate = (location, scale, alpha) => {
    if (!(scale > 0)) return null;
    let xy = 0;
    let xx = 0;
    for (const row of rows) {
      const shape = skewShape((row.x - location) / scale, alpha);
      xy += row.y * shape;
      xx += shape * shape;
    }
    if (!(xx > 0)) return null;
    const amplitude = xy / xx;
    let loss = 0;
    for (const row of rows) loss += (row.y - amplitude * skewShape((row.x - location) / scale, alpha)) ** 2;
    return { location: location + origin, scale, alpha, amplitude, loss };
  };
  let best = null;
  for (let i = 0; i <= 40; i++) {
    const location = center - radius + 2 * radius * i / 40;
    for (const scale of scales) for (const alpha of shapes) {
      const candidate = evaluate(location, scale, alpha);
      if (candidate && (!best || candidate.loss < best.loss)) best = candidate;
    }
  }
  if (!best) return null;
  let locationStep = radius / 10;
  for (let iteration = 0; iteration < 5; iteration++) {
    let local = best;
    for (let i = -4; i <= 4; i++) {
      for (const scaleFactor of [0.85, 0.93, 1, 1.07, 1.15]) {
        for (const alpha of shapes) {
          const candidate = evaluate(best.location - origin + i * locationStep, best.scale * scaleFactor, alpha);
          if (candidate && candidate.loss < local.loss) local = candidate;
        }
      }
    }
    best = local;
    locationStep /= 2;
  }
  return best;
}

function predictFromPrefix(prefix, active, baselineMedian, threshold, smoothingDays, transform, curveType = 'gaussian', fitFromPeak = false) {
  const startDay = dayNumber(fitFromPeak ? active.peakDate : active.startDate);
  const observed = smoothTimelineLikeChart(prefix, smoothingDays)
    .filter(point => point.day >= startDay && point.y > 0);
  if (observed.length < 5 || !(threshold > 0)) return null;
  const transformValue = value => transform === 'log' ? Math.log(value)
    : transform === 'exp100' ? Math.exp(value / 100) : value;
  const daily = transform === 'raw' ? observed
    : observed.map(point => ({ ...point, y: transformValue(point.y) }));
  const fitBaseline = transformValue(baselineMedian);
  const fitThreshold = transformValue(threshold);
  if (curveType === 'average-whole-postpeak') {
    if (!(fitThreshold > fitBaseline)) return null;
    const peakDay = dayNumber(active.peakDate);
    const postPeak = daily.filter(point => point.day >= peakDay);
    const wholeFit = fitGaussian(daily, fitBaseline);
    const declineFit = fitGaussian(postPeak, fitBaseline);
    if (!wholeFit || !declineFit) return null;
    const evaluate = (fit, day) => fitBaseline + fit.amplitude *
      Math.exp(-0.5 * ((day - fit.mean) / fit.sigma) ** 2);
    const averageAt = day => (evaluate(wholeFit, day) + evaluate(declineFit, day)) / 2;
    const latestDay = daily.at(-1).day;
    if (!(averageAt(latestDay) > fitThreshold)) return null;
    let crossingDay = NaN;
    for (let day = latestDay + 1; day <= latestDay + 365; day++) {
      if (averageAt(day) <= fitThreshold) { crossingDay = day; break; }
    }
    if (!Number.isFinite(crossingDay)) return null;
    return {
      date: formatDay(crossingDay),
      mean: (wholeFit.mean + declineFit.mean) / 2,
      sigma: (wholeFit.sigma + declineFit.sigma) / 2,
      amplitude: (wholeFit.amplitude + declineFit.amplitude) / 2,
    };
  }
  const fit = curveType === 'skew-normal'
    ? fitSkewNormal(daily, fitBaseline)
    : fitGaussian(daily, fitBaseline);
  if (!fit || !(fitThreshold > fitBaseline) || !(fit.amplitude > fitThreshold - fitBaseline)) return null;
  let crossingDay;
  if (curveType === 'skew-normal') {
    const latestDay = daily.at(-1).day;
    let peakDay = fit.location - 5 * fit.scale;
    let peakValue = -Infinity;
    for (let day = Math.floor(fit.location - 5 * fit.scale); day <= Math.ceil(fit.location + 5 * fit.scale); day++) {
      const value = skewShape((day - fit.location) / fit.scale, fit.alpha);
      if (value > peakValue) { peakValue = value; peakDay = day; }
    }
    crossingDay = NaN;
    for (let day = Math.max(latestDay + 1, peakDay + 1); day <= latestDay + 365; day++) {
      if (fitBaseline + fit.amplitude * skewShape((day - fit.location) / fit.scale, fit.alpha) <= fitThreshold) {
        crossingDay = day;
        break;
      }
    }
  } else {
    const ratio = fit.amplitude / (fitThreshold - fitBaseline);
    crossingDay = fit.mean + fit.sigma * Math.sqrt(2 * Math.log(ratio));
  }
  const latestDay = daily.at(-1).day;
  if (!(crossingDay > latestDay) || crossingDay - latestDay > 365) return null;
  return {
    date: formatDay(Math.ceil(crossingDay)),
    mean: fit.mean ?? fit.location,
    sigma: fit.sigma ?? fit.scale,
    amplitude: fit.amplitude,
  };
}

/** Walk-forward evaluation for Gaussian fits against each completed wave. */
export function backtestGaussianWaveEnd(points, { smoothingDays = 30, transform = 'raw', curveType = 'gaussian', fitFromPeak = false } = {}) {
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
      const prediction = predictFromPrefix(prefix, active, baseline.median, baseline.p90, smoothingDays, transform, curveType, fitFromPeak);
      if (!prediction) continue;
      const forecastDay = dayNumber(prediction.date);
      const facilityId = ordered[0]?._facilityUid || ordered[0]?.facilityUid || ordered[0]?.uid || 'unknown-facility';
      forecasts.push({
        facilityId,
        waveId: `${facilityId}:${truth.peakDate}`,
        daysSincePeak: cutoffDay - peakDay,
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
    strategy: `${smoothingDays > 1 ? `${smoothingDays}-day triangular weighted average` : 'unsmoothed daily values'} + ${transform === 'raw' ? '' : `${transform === 'exp100' ? 'exp(y/100)' : 'log(y)'}-scale `}${curveType === 'average-whole-postpeak' ? 'average whole-wave/post-peak Gaussian curve' : `${fitFromPeak ? 'post-peak ' : ''}${curveType} curve`} over prior baseline median; crossing prior baseline P90`,
    completedWaves: waves.length,
    forecastCount: forecasts.length,
    meanAbsoluteErrorDays: errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null,
    medianAbsoluteErrorDays: errors.length ? errors[Math.floor((errors.length - 1) / 2)] : null,
    within14DaysPercent: errors.length ? 100 * errors.filter(value => value <= 14).length / errors.length : null,
    forecasts,
  };
}

export function backtestSkewNormalWaveEnd(points, { smoothingDays = 1 } = {}) {
  return backtestGaussianWaveEnd(points, { smoothingDays, curveType: 'skew-normal' });
}

export function backtestAveragedGaussianWaveEnd(points, { smoothingDays = 1 } = {}) {
  return backtestGaussianWaveEnd(points, { smoothingDays, curveType: 'average-whole-postpeak' });
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
