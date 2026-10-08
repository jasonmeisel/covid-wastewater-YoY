const DAY_MS = 86400000;

export const GAUSSIAN_INTERVAL_COVERAGE = 0.9;
export const GAUSSIAN_INTERVAL_BUCKETS = Object.freeze([
  { id: '14-21', min: 14, max: 21 },
  { id: '22-35', min: 22, max: 35 },
  { id: '36-49', min: 36, max: 49 },
  { id: '50+', min: 50, max: Infinity },
]);

const bucketFor = days => GAUSSIAN_INTERVAL_BUCKETS.find(bucket =>
  days >= bucket.min && days <= bucket.max)?.id || 'pooled';

function absoluteErrorQuantile(errors, coverage) {
  const sorted = errors.map(Math.abs).sort((a, b) => a - b);
  if (!sorted.length || !(coverage > 0 && coverage < 1)) return null;
  // Split-conformal finite-sample rank. Returning null when the rank exceeds n
  // is preferable to silently claiming coverage the available sample cannot support.
  const rank = Math.ceil((sorted.length + 1) * coverage);
  return rank <= sorted.length ? sorted[rank - 1] : null;
}

function signedErrorBounds(errors, coverage, lowerTailShare = 0.5) {
  const sorted = [...errors].sort((a, b) => a - b);
  if (!sorted.length || !(coverage > 0 && coverage < 1) || !(lowerTailShare > 0 && lowerTailShare < 1)) return null;
  const tail = 1 - coverage;
  const lowerRank = Math.floor((sorted.length + 1) * tail * lowerTailShare);
  const upperRank = Math.ceil((sorted.length + 1) * (1 - tail * (1 - lowerTailShare)));
  if (lowerRank < 1 || upperRank > sorted.length) return null;
  return { lowerErrorDays: sorted[lowerRank - 1], upperErrorDays: sorted[upperRank - 1] };
}

/**
 * Estimate absolute-error radii for 90% prediction intervals. Inputs should be
 * one walk-forward forecast per wave and age bucket; callers doing validation
 * must keep every row from a held-out facility/wave out of calibration.
 */
export function calibrateGaussianIntervals(rows, {
  coverage = GAUSSIAN_INTERVAL_COVERAGE,
  minimumBucketSize = 12,
  lowerTailShare = 0.5,
} = {}) {
  const valid = (rows || []).filter(row => Number.isFinite(Number(row.errorDays)) &&
    Number.isFinite(Number(row.daysSincePeak)) && Number(row.daysSincePeak) >= 14);
  const selectOnePerWave = candidates => {
    const byWave = new Map();
    candidates.forEach((row, index) => {
      const key = row.waveId || `${row.facilityId || 'unknown'}:${row.peakDate || row.cutoffDate || index}`;
      const current = byWave.get(key);
      if (!current || Number(row.daysSincePeak) < Number(current.daysSincePeak)) byWave.set(key, row);
    });
    return [...byWave.values()];
  };
  // Pool each historical wave once (at its earliest eligible forecast age),
  // so multiple phase snapshots do not dominate the conformal calibration.
  const pooledRows = selectOnePerWave(valid);
  const errors = pooledRows.map(row => Number(row.errorDays));
  const pooledRadius = absoluteErrorQuantile(errors, coverage);
  const pooledSignedBounds = signedErrorBounds(errors, coverage, lowerTailShare);
  const bucketResults = {};
  for (const bucket of GAUSSIAN_INTERVAL_BUCKETS) {
    const bucketRows = selectOnePerWave(valid.filter(row => bucketFor(Number(row.daysSincePeak)) === bucket.id));
    const bucketErrors = bucketRows.map(row => Number(row.errorDays));
    const bucketRadius = bucketRows.length >= minimumBucketSize
      ? absoluteErrorQuantile(bucketErrors, coverage)
      : null;
    const bucketSignedBounds = bucketRows.length >= minimumBucketSize
      ? signedErrorBounds(bucketErrors, coverage, lowerTailShare)
      : null;
    bucketResults[bucket.id] = {
      radiusDays: bucketRadius ?? pooledRadius,
      signedErrorBounds: bucketSignedBounds ?? pooledSignedBounds,
      sampleCount: bucketRows.length,
      source: bucketRadius === null ? 'pooled' : 'age-bucket',
      signedSource: bucketSignedBounds === null ? 'pooled' : 'age-bucket',
    };
  }
  return {
    coverage,
    sampleCount: pooledRows.length,
    rowCount: valid.length,
    pooledRadiusDays: pooledRadius,
    pooledSignedErrorBounds: pooledSignedBounds,
    buckets: bucketResults,
  };
}

export function gaussianIntervalRadius(calibration, daysSincePeak) {
  if (!calibration || !Number.isFinite(Number(daysSincePeak))) return null;
  const bucketId = bucketFor(Number(daysSincePeak));
  const radius = bucketId === 'pooled'
    ? calibration.pooledRadiusDays
    : calibration.buckets?.[bucketId]?.radiusDays;
  return Number.isFinite(radius) && radius >= 0 ? radius : null;
}

export function makeGaussianPredictionInterval(endDate, radiusDays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(endDate)) || !Number.isFinite(radiusDays) || radiusDays < 0) return null;
  const center = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(center)) return null;
  return {
    earliestDate: new Date(center - Math.ceil(radiusDays) * DAY_MS).toISOString().slice(0, 10),
    latestDate: new Date(center + Math.ceil(radiusDays) * DAY_MS).toISOString().slice(0, 10),
    radiusDays: Math.ceil(radiusDays),
  };
}

export function gaussianPredictionInterval(endDate, daysSincePeak, calibration, method = 'absolute') {
  if (!calibration || !/^\d{4}-\d{2}-\d{2}$/.test(String(endDate))) return null;
  const center = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(center)) return null;
  const days = Number(daysSincePeak);
  if (method === 'asymmetric') {
    const bucketId = bucketFor(days);
    const bounds = bucketId === 'pooled'
      ? calibration.pooledSignedErrorBounds
      : calibration.buckets?.[bucketId]?.signedErrorBounds;
    if (!bounds || !Number.isFinite(bounds.lowerErrorDays) || !Number.isFinite(bounds.upperErrorDays)) return null;
    const low = center - bounds.upperErrorDays * DAY_MS;
    const high = center - bounds.lowerErrorDays * DAY_MS;
    if (low > high) return null;
    return {
      earliestDate: new Date(low).toISOString().slice(0, 10),
      latestDate: new Date(high).toISOString().slice(0, 10),
      widthDays: (high - low) / DAY_MS,
      coverage: calibration.coverage,
      method,
    };
  }
  const radius = gaussianIntervalRadius(calibration, days);
  const interval = makeGaussianPredictionInterval(endDate, radius);
  return interval ? { ...interval, widthDays: 2 * interval.radiusDays, coverage: calibration.coverage, method } : null;
}
