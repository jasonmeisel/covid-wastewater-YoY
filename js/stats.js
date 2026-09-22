// Sample-series maths: parsing, day-of-year bucketing, smoothing, quantiles.
// DOM-free (apart from reading the shared state object) so `node --test` can import it.
import { state } from './state.js';
import { parseDateParts } from './util.js';

// Color definitions for individual years (Tailwind `bg-*` classes are consumed by the legend cards).
// Unknown years fall through to an ordered 6-entry cycle so consecutive years stay distinguishable.
const YEAR_COLORS = {
  2022: { stroke: 'rgba(56, 189, 248, 1)', fill: 'rgba(56, 189, 248, 0.05)', bg: 'bg-sky-400' },
  2023: { stroke: 'rgba(59, 130, 246, 1)', fill: 'rgba(59, 130, 246, 0.05)', bg: 'bg-blue-500' },
  2024: { stroke: 'rgba(168, 85, 247, 1)', fill: 'rgba(168, 85, 247, 0.05)', bg: 'bg-purple-500' },
  2025: { stroke: 'rgba(236, 72, 153, 1)', fill: 'rgba(236, 72, 153, 0.05)', bg: 'bg-pink-500' },
  2026: { stroke: 'rgba(244, 63, 94, 1)', fill: 'rgba(244, 63, 94, 0.05)', bg: 'bg-rose-500' },
  2027: { stroke: 'rgba(20, 184, 166, 1)', fill: 'rgba(20, 184, 166, 0.05)', bg: 'bg-teal-500' },
  2028: { stroke: 'rgba(245, 158, 11, 1)', fill: 'rgba(245, 158, 11, 0.05)', bg: 'bg-amber-500' }
};

const FALLBACK_YEAR_COLORS = [
  { stroke: 'rgba(148, 163, 184, 1)', fill: 'rgba(148, 163, 184, 0.05)', bg: 'bg-slate-400' },
  { stroke: 'rgba(34, 211, 238, 1)', fill: 'rgba(34, 211, 238, 0.05)', bg: 'bg-cyan-400' },
  { stroke: 'rgba(132, 204, 22, 1)', fill: 'rgba(132, 204, 22, 0.05)', bg: 'bg-lime-400' },
  { stroke: 'rgba(249, 115, 22, 1)', fill: 'rgba(249, 115, 22, 0.05)', bg: 'bg-orange-500' },
  { stroke: 'rgba(139, 92, 246, 1)', fill: 'rgba(139, 92, 246, 0.05)', bg: 'bg-violet-500' },
  { stroke: 'rgba(244, 114, 182, 1)', fill: 'rgba(244, 114, 182, 0.05)', bg: 'bg-fuchsia-400' }
];

export function pickYearColor(year) {
  const value = Number(year);
  if (YEAR_COLORS[value]) return YEAR_COLORS[value];
  const offset = ((value - 2029) % FALLBACK_YEAR_COLORS.length + FALLBACK_YEAR_COLORS.length) % FALLBACK_YEAR_COLORS.length;
  return FALLBACK_YEAR_COLORS[offset];
}

// Cumulative days before each month on a non-leap calendar (Jan 1 → index 1).
const CUMULATIVE_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const isLeapYear = year => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

// Continuous 1–365 day index computed with integer arithmetic only (no Date, no timezone).
// Leap years are flattened from Mar 1 so Feb 29 and Mar 1 both land on 60 and calendar
// dates overlay across years.
export function dayOfYearIndex({ year, month, day }) {
  const realDay = CUMULATIVE_DAYS[month - 1] + day + (isLeapYear(year) && month > 2 ? 1 : 0);
  return isLeapYear(year) && realDay > 60 ? realDay - 1 : realDay;
}

export { parseDateParts };

// Dynamic key discovery for robustness across diverse wastewater GCS schemas
export function findSampleDate(s) {
  if (s.date) return s.date;
  if (s.collection_date) return s.collection_date;
  if (s.sample_date) return s.sample_date;

  const potentialKey = Object.keys(s).find(k => k.toLowerCase().includes('date') || k.toLowerCase().includes('time'));
  return potentialKey ? s[potentialKey] : null;
}

// N Gene / PMMoV ratio, falling back to the first target that carries a finite value.
export function extractPmMov(sample) {
  const targets = sample && sample.targets;
  if (!targets || typeof targets !== 'object') return null;

  const preferred = targets['N Gene'] && targets['N Gene'].gc_g_dry_weight_trimmed5_pmmov;
  if (preferred !== undefined && preferred !== null && Number.isFinite(Number(preferred))) {
    return Number(preferred);
  }

  for (const target of Object.values(targets)) {
    const value = target && target.gc_g_dry_weight_trimmed5_pmmov;
    if (value !== undefined && value !== null && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

// Groups samples into per-year series aligned on the 1–365 day-of-year axis.
// Every rejected sample is counted in `skipped` so the UI can report the loss honestly.
export function buildSeries(samples, { scaleFactor = 1e6 } = {}) {
  const byYear = {};
  const skipped = { total: 0, missingDate: 0, missingValue: 0, nonPositive: 0, unparseableDate: 0 };

  (samples || []).forEach(sample => {
    const rawDate = findSampleDate(sample);
    if (!rawDate) {
      skipped.total++; skipped.missingDate++;
      return;
    }
    const parts = parseDateParts(rawDate);
    if (!parts) {
      skipped.total++; skipped.unparseableDate++;
      return;
    }
    const ratio = extractPmMov(sample);
    if (ratio === null) {
      skipped.total++; skipped.missingValue++;
      return;
    }
    const scaled = ratio * scaleFactor;
    if (!(scaled > 0)) {
      skipped.total++; skipped.nonPositive++;
      return;
    }

    if (!byYear[parts.year]) byYear[parts.year] = [];
    byYear[parts.year].push({
      x: dayOfYearIndex(parts), // aligned X coordinate (1-365)
      y: scaled, // scaled target ratio value (N Gene / PMMoV * 1,000,000)
      originalDate: rawDate,
      actualYear: parts.year,
      rawRatio: ratio
    });
  });

  // Sort each year by day of year; leap Feb 29 / Mar 1 collide on x and are ordered by date.
  Object.values(byYear).forEach(series => {
    series.sort((a, b) => a.x - b.x || String(a.originalDate).localeCompare(String(b.originalDate)));
  });

  const years = Object.keys(byYear).map(Number).sort((a, b) => b - a); // descending sort
  return { byYear, years, skipped };
}

// Collapses a year's samples onto one point per calendar date, averaging the plants
// that reported that day. Without this a multi-plant selection leaves several points
// sharing an x, and the index-based moving window then averages a mix of same-day
// siblings and other days — so the same date renders as several different values.
// One point per date keeps the plotted line daily, as the chart claims, and makes the
// smoothing window count reporting days rather than samples.
export function dailyAggregate(series) {
  if (series.length < 2) return series;

  const byDate = new Map();
  for (const point of series) {
    const entry = byDate.get(point.originalDate);
    if (entry) {
      entry.sum += point.y;
      entry.ratioSum += point.rawRatio;
      entry.count += 1;
    } else {
      byDate.set(point.originalDate, { sum: point.y, ratioSum: point.rawRatio, count: 1, point });
    }
  }

  // Already one sample per day (a single plant): keep the original points untouched.
  if (byDate.size === series.length) return series;

  // Insertion order is preserved, and the input was sorted by date.
  return [...byDate.values()].map(entry => (entry.count === 1
    ? entry.point
    : { ...entry.point, y: entry.sum / entry.count, rawRatio: entry.ratioSum / entry.count }));
}

// Dynamic moving average smoothing window logic
export function movingAverage(dataSeries, windowSize, preserveLastPoint = false) {
  if (windowSize <= 1 || dataSeries.length <= 1) return dataSeries;

  return dataSeries.map((currentPoint, currentIdx, list) => {
    // Keep only the current year's endpoint tied to the latest observed sample.
    if (preserveLastPoint && currentIdx === list.length - 1) return currentPoint;

    let sum = 0;
    let count = 0;
    const offset = Math.floor(windowSize / 2);

    for (let i = currentIdx - offset; i <= currentIdx + offset; i++) {
      if (i >= 0 && i < list.length) {
        sum += list[i].y;
        count++;
      }
    }

    return {
      ...currentPoint,
      y: sum / count // smoothed Y coordinate
    };
  });
}

// Single reduction over a series: count, arithmetic mean, peak and latest point.
export function summarize(points) {
  if (!points || points.length === 0) {
    return { count: 0, mean: null, peak: { value: null, date: null }, latest: null };
  }

  let sum = 0;
  let peak = points[0];
  let latest = points[0];
  points.forEach(point => {
    sum += point.y;
    if (point.y > peak.y) peak = point;
    if (String(point.originalDate) > String(latest.originalDate)) latest = point;
  });

  return { count: points.length, mean: sum / points.length, peak: { value: peak.y, date: peak.originalDate }, latest };
}

// Linear-interpolation quantile over an ascending list.
export function quantile(sortedList, ratio) {
  if (!sortedList.length) return null;
  const position = (sortedList.length - 1) * ratio;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sortedList[lowerIndex];
  const lowerValue = sortedList[lowerIndex];
  const upperValue = sortedList[upperIndex];
  const weight = position - lowerIndex;
  return lowerValue + (upperValue - lowerValue) * weight;
}

// Ascending list of every loaded sample value. Deliberately ignores `visibleYears`:
// percentiles describe the whole selection, not what happens to be toggled on.
export function sortedSeriesValues() {
  const values = [];
  Object.values(state.series).forEach(series => series.forEach(pt => values.push(pt.y)));
  return values.sort((a, b) => a - b);
}

// Inclusive percentile rank (share of values <= value) via binary search.
export function inclusivePercentile(value, sortedValues) {
  let lower = 0;
  let upper = sortedValues.length;

  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (sortedValues[middle] <= value) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }

  return sortedValues.length ? (lower / sortedValues.length) * 100 : null;
}

export function getLatestSamplePoint() {
  let latestPoint = null;
  Object.values(state.series).forEach(series => {
    series.forEach(point => {
      if (!latestPoint || String(point.originalDate) > String(latestPoint.originalDate)) {
        latestPoint = point;
      }
    });
  });
  return latestPoint;
}

export function getLatestSampleValue() {
  return getLatestSamplePoint()?.y ?? null;
}

// The one percentile implementation. Callers pass the full sorted value list and the
// current reading explicitly — there is no module-level percentile singleton.
export function percentileStats(sortedValues, currentValue = getLatestSampleValue()) {
  if (!sortedValues.length) {
    return { count: 0, q1: null, median: null, q3: null, p5: null, p1: null, currentPercentile: null, currentValue: null };
  }

  return {
    count: sortedValues.length,
    q1: quantile(sortedValues, 0.25),
    median: quantile(sortedValues, 0.5),
    q3: quantile(sortedValues, 0.75),
    p5: quantile(sortedValues, 0.05),
    p1: quantile(sortedValues, 0.01),
    currentPercentile: currentValue === null ? null : inclusivePercentile(currentValue, sortedValues),
    currentValue
  };
}

export function getPercentileEmoji(percentile) {
  if (percentile === null || percentile === undefined || Number.isNaN(percentile)) return '—';
  if (percentile <= 1) return '👌';
  if (percentile <= 5) return '🙂';
  if (percentile <= 10) return '🟢';
  if (percentile <= 25) return '🟨';
  if (percentile <= 50) return '😣';
  if (percentile <= 75) return '⚠️';
  return '🚨';
}
