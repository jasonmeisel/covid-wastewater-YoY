// Runtime inference for the static pooled ridge model. Features intentionally
// mirror tools/train-wave-model.mjs: one facility, chronological 14-day chart
// smoothing, a prefix-only active-wave detector, and a fixed issue rule.
import { dailyAggregate, identifyWaves, movingAverage } from './stats.js';
import { WAVE_END_RIDGE_MODEL } from './wave-model-weights.js';

const DAY = 86400000;
const dayNumber = date => Math.floor(Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`) / DAY);
const formatDay = day => new Date(day * DAY).toISOString().slice(0, 10);

export function smoothTimelineSignal(points, windowDays = 14) {
  const dated = (points || []).filter(point => /^\d{4}-\d{2}-\d{2}$/.test(String(point.originalDate || '').slice(0, 10)) && Number(point.y) > 0)
    .map(point => ({ ...point, originalDate: String(point.originalDate).slice(0, 10), x: dayNumber(point.originalDate) }))
    .sort((a, b) => a.x - b.x);
  const daily = dailyAggregate(dated);
  return movingAverage(daily, windowDays, true).map(point => ({
    ...point,
    x: Number(point.x),
    day: Number(point.x),
    originalDate: formatDay(Number(point.x)),
  }));
}

function completeWeeklyMeans(points) {
  const byWeek = new Map();
  for (const point of points) {
    const week = point.day - ((point.day + 3) % 7);
    const values = byWeek.get(week) || [];
    values.push(point.y);
    byWeek.set(week, values);
  }
  const firstDay = points[0]?.day;
  const lastDay = points.at(-1)?.day;
  return [...byWeek.entries()]
    .filter(([start, values]) => start >= firstDay && start + 6 <= lastDay && values.length === 7)
    .sort((a, b) => a[0] - b[0])
    .map(([, values]) => values.reduce((sum, value) => sum + value, 0) / values.length);
}

function consecutiveWeeklyDeclines(points) {
  const means = completeWeeklyMeans(points);
  let count = 0;
  for (let i = means.length - 1; i > 0 && means[i] < means[i - 1]; i--) count++;
  return count;
}

function linearLogFit(points) {
  if (points.length < 3) return { slope: 0, r2: 0 };
  const xs = points.map(point => point.day - points[0].day);
  const ys = points.map(point => Math.log(point.y));
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const denominator = xs.reduce((sum, value) => sum + (value - xMean) ** 2, 0);
  if (!denominator) return { slope: 0, r2: 0 };
  const slope = xs.reduce((sum, value, i) => sum + (value - xMean) * (ys[i] - yMean), 0) / denominator;
  const intercept = yMean - slope * xMean;
  const total = ys.reduce((sum, value) => sum + (value - yMean) ** 2, 0);
  const residual = ys.reduce((sum, value, i) => sum + (value - (intercept + slope * xs[i])) ** 2, 0);
  return { slope, r2: total ? Math.max(0, 1 - residual / total) : 0 };
}

export function trainedWaveFeatures(points) {
  const signal = smoothTimelineSignal(points, WAVE_END_RIDGE_MODEL.smoothingDays);
  if (!signal.length) return null;
  const waves = identifyWaves(signal, { preSmoothed: true });
  const active = waves.find(wave => wave.ongoing && !wave.endDate);
  if (!active) return null;
  const latest = signal.at(-1);
  const elapsedDays = latest.day - dayNumber(active.peakDate);
  const declineWeeks = consecutiveWeeklyDeclines(signal);
  if (elapsedDays < 14 || !(active.endThreshold > 0) || !(active.peak > 0)) return null;
  const recent = signal.filter(point => point.day >= latest.day - 42);
  if (!recent.length) return null;
  const fit = linearLogFit(recent.slice(-7));
  return {
    x: {
      elapsedDays,
      logAboveThreshold: Math.log(Math.max(0.01, latest.y / active.endThreshold)),
      logBelowPeak: Math.log(Math.max(0.01, latest.y / active.peak)),
      logSlope: fit.slope,
      slopeR2: fit.r2,
    },
    activeWave: active,
    cutoffDate: latest.originalDate,
    declineWeeks,
  };
}

export function predictTrainedWaveEnd(points) {
  const features = trainedWaveFeatures(points);
  if (!features) return null;
  const model = WAVE_END_RIDGE_MODEL;
  const z = model.features.map((feature, i) => (features.x[feature] - model.means[i]) / model.scales[i]);
  const prediction = model.targetMean + model.coefficients[0]
    + z.reduce((sum, value, i) => sum + value * model.coefficients[i + 1], 0);
  const remainingDays = Math.max(0, Math.min(180, prediction));
  const endDate = formatDay(dayNumber(features.cutoffDate) + Math.round(remainingDays));
  return {
    ...features,
    remainingDays,
    endDate,
    earliestDate: endDate,
    latestDate: endDate,
    method: 'pooled ridge model',
  };
}
