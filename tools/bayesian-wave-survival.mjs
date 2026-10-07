// Bayesian Weibull survival model for time from wave peak to confirmed threshold
// crossing. Right-censored waves contribute survival likelihood, not fabricated
// end dates. The small deterministic grid avoids adding a runtime dependency.
const SHAPES = Array.from({ length: 41 }, (_, i) => 0.5 + i * 0.1);
const SCALES = Array.from({ length: 55 }, (_, i) => 7 * (365 / 7) ** (i / 54));
const DAY_MS = 86400000;
const day = date => Math.floor(Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`) / DAY_MS);
const logSumExp = values => {
  const max = Math.max(...values);
  return max + Math.log(values.reduce((sum, value) => sum + Math.exp(value - max), 0));
};

function logSurvival(duration, shape, scale) {
  return -((Math.max(0, duration) / scale) ** shape);
}

export function fitBayesianWeibullSurvival(outcomes) {
  const usable = (outcomes || []).filter(row => Number.isFinite(row.durationDays) && row.durationDays > 0);
  const events = usable.filter(row => row.event).length;
  if (events < 4 || usable.length < 8) return null;

  const grid = [];
  for (const shape of SHAPES) {
    for (const scale of SCALES) {
      let logWeight = -Math.log(shape); // log-uniform priors; the scale grid is uniform in log(scale)
      for (const row of usable) {
        const time = row.durationDays;
        if (row.event) {
          logWeight += Math.log(shape / scale) + (shape - 1) * Math.log(time / scale)
            + logSurvival(time, shape, scale);
        } else {
          logWeight += logSurvival(time, shape, scale);
        }
      }
      grid.push({ shape, scale, logWeight });
    }
  }
  const normalizer = logSumExp(grid.map(row => row.logWeight));
  const posterior = grid.map(row => ({ ...row, weight: Math.exp(row.logWeight - normalizer) }));
  return { posterior, outcomeCount: usable.length, eventCount: events, censoredCount: usable.length - events };
}

// Posterior predictive remaining-time distribution, conditional on the wave
// having survived at least elapsedDays. Survival to the forecast origin updates
// the parameter posterior before integrating future duration uncertainty.
export function predictBayesianWeibullRemaining(model, elapsedDays, { coverage = 0.8, maxDays = 730 } = {}) {
  if (!model || !Number.isFinite(elapsedDays) || elapsedDays < 0) return null;
  const logWeights = model.posterior.map(row => row.logWeight + logSurvival(elapsedDays, row.shape, row.scale));
  const normalizer = logSumExp(logWeights);
  const conditional = model.posterior.map((row, i) => ({
    ...row,
    weight: Math.exp(logWeights[i] - normalizer),
    survivalAtOrigin: Math.exp(logSurvival(elapsedDays, row.shape, row.scale)),
  }));
  const cdf = remaining => 1 - conditional.reduce((sum, row) => {
    const futureSurvival = Math.exp(logSurvival(elapsedDays + remaining, row.shape, row.scale));
    return sum + row.weight * futureSurvival / row.survivalAtOrigin;
  }, 0);
  const quantile = probability => {
    let low = 0;
    let high = maxDays;
    if (cdf(high) < probability) return maxDays;
    for (let i = 0; i < 36; i++) {
      const mid = (low + high) / 2;
      if (cdf(mid) < probability) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
  };
  const tail = (1 - coverage) / 2;
  return {
    medianDays: quantile(0.5),
    lowerDays: quantile(tail),
    upperDays: quantile(1 - tail),
    coverage,
    elapsedDays,
    trainingWaves: model.outcomeCount,
    trainingEvents: model.eventCount,
    trainingCensored: model.censoredCount,
  };
}

export function durationOutcome(facilityUid, wave, lastObservedDate) {
  if (!wave || !wave.peakDate) return null;
  const peak = day(wave.peakDate);
  const observationDate = wave.endDate || lastObservedDate;
  const observed = day(observationDate);
  if (!Number.isFinite(peak) || !Number.isFinite(observed) || observed <= peak) return null;
  return {
    facilityUid: String(facilityUid),
    wavePeakDate: wave.peakDate,
    observationDate: new Date(observed * DAY_MS).toISOString().slice(0, 10),
    durationDays: observed - peak,
    event: Boolean(wave.endConfirmed),
  };
}
