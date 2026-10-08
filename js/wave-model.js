// Runtime inference for the static pooled ridge model. Features intentionally
// mirror tools/train-wave-model.mjs: one facility, chronological 14-day chart
// smoothing, a prefix-only active-wave detector, and a fixed issue rule.
import { dailyAggregate, identifyWaves, movingAverage, preWaveBaselineRange } from './stats.js';
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

const gaussianShape = (x, mean, sigma) => Math.exp(-0.5 * ((x - mean) / sigma) ** 2);

// Least-squares fit of y = baseline + amplitude * Gaussian(day; mean, sigma).
export function fitGaussianWave(points, baseline = 0) {
  if (!Array.isArray(points) || points.length < 5) return null;
  const origin = points[0].day;
  const rows = points.map(point => ({ x: point.day - origin, y: Number(point.y) - baseline }));
  if (rows.some(row => !(row.y > 0))) return null;
  const maxX = rows.at(-1).x;
  if (!(maxX > 0)) return null;
  const maxY = Math.max(...rows.map(row => row.y));
  const minY = Math.min(...rows.map(row => row.y));
  const evaluate = (mean, sigma) => {
    if (!(sigma > 0)) return null;
    let xy = 0;
    let xx = 0;
    for (const row of rows) {
      const shape = gaussianShape(row.x, mean, sigma);
      xy += row.y * shape;
      xx += shape * shape;
    }
    if (!(xx > 0)) return null;
    const amplitude = xy / xx;
    let loss = 0;
    for (const row of rows) loss += (row.y - amplitude * gaussianShape(row.x, mean, sigma)) ** 2;
    return { mean: mean + origin, sigma, amplitude, loss };
  };
  let best = null;
  const meanHigh = maxX + Math.max(180, maxX);
  const sigmaHigh = Math.max(30, maxX * 4);
  for (let i = 0; i <= 60; i++) {
    const mean = (meanHigh * i) / 60;
    for (let j = 0; j <= 50; j++) {
      const sigma = 2 * (sigmaHigh / 2) ** (j / 50);
      const candidate = evaluate(mean, sigma);
      if (candidate && (!best || candidate.loss < best.loss)) best = candidate;
    }
  }
  if (!best || !(maxY > minY)) return null;
  let meanStep = meanHigh / 60;
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

// Site inference uses daily-averaged observations without the 30-day smoothing
// tested in the backtest. The baseline needs a preceding completed wave.
export function predictGaussianWaveEnd(points, waves = identifyWaves(points)) {
  const active = waves.at(-1);
  if (!active?.ongoing || !active.startDate || !active.peakDate) return null;
  const baseline = preWaveBaselineRange(points, waves);
  if (!baseline || !(baseline.p90 > baseline.median)) return null;
  const signal = smoothTimelineSignal(points, 1)
    .filter(point => point.day >= dayNumber(active.startDate));
  if (signal.length < 5 || signal.at(-1).day - dayNumber(active.peakDate) < 14) return null;
  const fit = fitGaussianWave(signal, baseline.median);
  const thresholdDelta = baseline.p90 - baseline.median;
  if (!fit || !(fit.amplitude > thresholdDelta)) return null;
  const crossing = fit.mean + fit.sigma * Math.sqrt(2 * Math.log(fit.amplitude / thresholdDelta));
  const latestDay = signal.at(-1).day;
  if (!(crossing > latestDay) || crossing - latestDay > 365) return null;
  const endDate = formatDay(Math.ceil(crossing));
  return {
    activeWave: active,
    endDate,
    earliestDate: endDate,
    latestDate: endDate,
    remainingDays: Math.ceil(crossing) - latestDay,
    threshold: baseline.p90,
    cutoffDate: signal.at(-1).originalDate,
    method: 'Gaussian fit to daily observations; prior-baseline P90 crossing',
  };
}
