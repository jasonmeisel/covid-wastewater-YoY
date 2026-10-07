// Bayesian discrete-time wave-end hazard model. A Laplace approximation to the
// regularized logistic posterior is used for reproducible posterior prediction.
const FEATURES = ['elapsedDays', 'logAboveThreshold', 'logBelowPeak', 'logSlope', 'slopeR2'];
const logistic = value => value >= 0 ? 1 / (1 + Math.exp(-Math.min(value, 40))) : Math.exp(Math.max(value, -40)) / (1 + Math.exp(Math.max(value, -40)));

function solve(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
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

function inverse(matrix) {
  const n = matrix.length;
  const columns = Array.from({ length: n }, (_, i) => solve(matrix, Array.from({ length: n }, (__, j) => i === j ? 1 : 0)));
  if (columns.some(column => !column)) return null;
  return Array.from({ length: n }, (_, row) => columns.map(column => column[row]));
}

function cholesky(matrix) {
  const n = matrix.length;
  const lower = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k++) sum -= lower[i][k] * lower[j][k];
      if (i === j) {
        if (sum <= 1e-12) return null;
        lower[i][j] = Math.sqrt(sum);
      } else lower[i][j] = sum / lower[j][j];
    }
  }
  return lower;
}

export function fitBayesianHazard(rows, { priorSd = 1.5, interceptPriorSd = 2.5 } = {}) {
  const usable = (rows || []).filter(row => row.x && Number.isFinite(row.eventNextWeek));
  const waveIds = new Set(usable.map(row => `${row.facilityUid}/${row.wavePeakDate}`));
  const eventCount = usable.filter(row => row.eventNextWeek === 1).length;
  if (usable.length < 40 || eventCount < 6 || waveIds.size < 10) return null;

  const means = FEATURES.map(key => usable.reduce((sum, row) => sum + row.x[key], 0) / usable.length);
  const scales = FEATURES.map((key, i) => Math.sqrt(usable.reduce((sum, row) => sum + (row.x[key] - means[i]) ** 2, 0) / usable.length) || 1);
  const design = usable.map(row => [1, ...FEATURES.map((key, i) => (row.x[key] - means[i]) / scales[i])]);
  const target = usable.map(row => row.eventNextWeek);
  const dimensions = FEATURES.length + 1;
  const precision = [1 / interceptPriorSd ** 2, ...FEATURES.map(() => 1 / priorSd ** 2)];
  let beta = Array(dimensions).fill(0);
  beta[0] = Math.log((eventCount + 0.5) / (usable.length - eventCount + 0.5));
  let hessian;
  for (let iteration = 0; iteration < 80; iteration++) {
    const gradient = beta.map((value, j) => -precision[j] * value);
    hessian = Array.from({ length: dimensions }, () => Array(dimensions).fill(0));
    for (let j = 0; j < dimensions; j++) hessian[j][j] = precision[j];
    for (let i = 0; i < usable.length; i++) {
      const eta = design[i].reduce((sum, value, j) => sum + value * beta[j], 0);
      const probability = logistic(eta);
      const variance = probability * (1 - probability);
      for (let r = 0; r < dimensions; r++) {
        gradient[r] += design[i][r] * (target[i] - probability);
        for (let c = 0; c < dimensions; c++) hessian[r][c] += variance * design[i][r] * design[i][c];
      }
    }
    const step = solve(hessian, gradient);
    if (!step) return null;
    const maxStep = Math.max(...step.map(Math.abs));
    beta = beta.map((value, i) => value + step[i]);
    if (maxStep < 1e-7) break;
  }
  const covariance = inverse(hessian);
  const lower = covariance && cholesky(covariance);
  if (!lower) return null;
  return { beta, covariance, lower, means, scales, featureNames: FEATURES, trainingRows: usable.length, trainingWaves: waveIds.size, trainingEvents: eventCount };
}

function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function standardNormals(random, count) {
  const values = [];
  while (values.length < count) {
    const u1 = Math.max(random(), Number.EPSILON);
    const u2 = random();
    const radius = Math.sqrt(-2 * Math.log(u1));
    values.push(radius * Math.cos(2 * Math.PI * u2));
    if (values.length < count) values.push(radius * Math.sin(2 * Math.PI * u2));
  }
  return values;
}

function featureVector(x, model) {
  return [1, ...FEATURES.map((key, i) => (x[key] - model.means[i]) / model.scales[i])];
}

// Posterior predictive end-time quantiles, assuming the observed log decline
// continues over the forecast horizon. The uncertainty includes both hazard
// outcome variation and approximate coefficient-posterior uncertainty.
export function predictBayesianHazard(model, currentX, { draws = 500, maxWeeks = 52, seed = 20250301 } = {}) {
  if (!model || !currentX) return null;
  const random = seededRandom(seed);
  const remainingDays = [];
  for (let draw = 0; draw < draws; draw++) {
    const z = standardNormals(random, model.beta.length);
    const beta = model.beta.map((mean, i) => mean + model.lower[i].reduce((sum, value, j) => sum + value * z[j], 0));
    const u = random();
    let survival = 1;
    let eventWeek = null;
    for (let week = 0; week < maxWeeks; week++) {
      const elapsedDays = currentX.elapsedDays + week * 7;
      const projectedLogDecline = currentX.logSlope * week * 7;
      const x = {
        ...currentX,
        elapsedDays,
        logAboveThreshold: Math.max(-8, Math.min(8, currentX.logAboveThreshold + projectedLogDecline)),
        logBelowPeak: Math.max(-8, Math.min(8, currentX.logBelowPeak + projectedLogDecline)),
      };
      const eta = featureVector(x, model).reduce((sum, value, i) => sum + value * beta[i], 0);
      const hazard = logistic(eta);
      survival *= 1 - hazard;
      if (u <= 1 - survival) {
        eventWeek = week;
        break;
      }
    }
    remainingDays.push(eventWeek === null ? maxWeeks * 7 : Math.max(1, (eventWeek + 1) * 7));
  }
  remainingDays.sort((a, b) => a - b);
  const at = probability => remainingDays[Math.min(remainingDays.length - 1, Math.floor(probability * remainingDays.length))];
  return {
    medianDays: at(0.5), lowerDays: at(0.1), upperDays: at(0.9),
    draws, maxWeeks, trainingRows: model.trainingRows, trainingWaves: model.trainingWaves,
    trainingEvents: model.trainingEvents,
  };
}
