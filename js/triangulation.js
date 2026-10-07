// Geographic selection and interpolation helpers for the experimental ZIP graph.
export function barycentricWeights(point, a, b, c) {
  const denominator = (b.lat - c.lat) * (a.lng - c.lng) + (c.lng - b.lng) * (a.lat - c.lat);
  if (Math.abs(denominator) < 1e-10) return null;
  const wa = ((b.lat - c.lat) * (point.lng - c.lng) + (c.lng - b.lng) * (point.lat - c.lat)) / denominator;
  const wb = ((c.lat - a.lat) * (point.lng - c.lng) + (a.lng - c.lng) * (point.lat - c.lat)) / denominator;
  const wc = 1 - wa - wb;
  const epsilon = 1e-9;
  return [wa, wb, wc].every(weight => weight >= -epsilon && weight <= 1 + epsilon)
    ? [wa, wb, wc].map(weight => Math.max(0, weight)) : null;
}

export function findEnclosingPlantTriangle(plants, point, getCoordinates, distance) {
  const candidates = plants.map(plant => {
    const coordinates = getCoordinates(plant);
    return coordinates ? { plant, coordinates, distance: distance(point.lat, point.lng, coordinates.lat, coordinates.lng) } : null;
  }).filter(Boolean).sort((a, b) => a.distance - b.distance);
  if (candidates.length < 3) return null;
  const firstTwo = candidates.slice(0, 2);
  for (const candidate of candidates.slice(2)) {
    const weights = barycentricWeights(point, firstTwo[0].coordinates, firstTwo[1].coordinates, candidate.coordinates);
    if (weights) return { plants: [firstTwo[0].plant, firstTwo[1].plant, candidate.plant], weights };
  }
  return null;
}

// Linear interpolation within a facility's sampled date range, with no extrapolation.
export function interpolateAtDay(series, day) {
  if (!series.length || day < series[0].x || day > series.at(-1).x) return null;
  let rightIndex = series.findIndex(point => point.x >= day);
  if (rightIndex < 0) return null;
  const right = series[rightIndex];
  if (right.x === day || rightIndex === 0) return right.y;
  const left = series[rightIndex - 1];
  return left.y + (right.y - left.y) * ((day - left.x) / (right.x - left.x));
}
