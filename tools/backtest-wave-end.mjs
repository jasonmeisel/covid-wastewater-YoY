#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { identifyWaves } from '../js/stats.js';

const DAY_MS = 86400000;
const day = date => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

/**
 * Evaluate historical end-date ranges using only observations available at each
 * cutoff. Input points are { originalDate: 'YYYY-MM-DD', y: positive number }.
 */
export function backtestWaveEnd(points) {
  const ordered = (points || [])
    .filter(point => /^\d{4}-\d{2}-\d{2}$/.test(String(point.originalDate)) && Number(point.y) > 0)
    .slice().sort((a, b) => String(a.originalDate).localeCompare(String(b.originalDate)));
  const waves = identifyWaves(ordered).filter(wave => wave.endDate && !wave.ongoing && wave.endConfirmed);
  const forecasts = [];

  for (const truth of waves) {
    const peakDay = day(truth.peakDate);
    const endDay = day(truth.endDate);
    for (let cutoff = 0; cutoff < ordered.length; cutoff++) {
      const cutoffDate = String(ordered[cutoff].originalDate).slice(0, 10);
      const cutoffDay = day(cutoffDate);
      if (cutoffDay < peakDay + 14 || cutoffDay >= endDay) continue;
      const prefix = ordered.slice(0, cutoff + 1);
      const estimated = identifyWaves(prefix).find(wave => wave.ongoing && wave.peakDate === truth.peakDate);
      const forecast = estimated?.forecast;
      if (!forecast) continue;
      forecasts.push({
        peakDate: truth.peakDate,
        cutoffDate,
        actualEndDate: truth.endDate,
        earliestDate: forecast.earliestDate,
        latestDate: forecast.latestDate,
        method: forecast.method,
        leadDays: endDay - cutoffDay,
        errorDays: day(forecast.earliestDate) > endDay
          ? day(forecast.earliestDate) - endDay
          : day(forecast.latestDate) < endDay ? day(forecast.latestDate) - endDay : 0,
        covered: day(forecast.earliestDate) <= endDay && endDay <= day(forecast.latestDate),
      });
    }
  }

  const errors = forecasts.map(result => Math.abs(result.errorDays)).sort((a, b) => a - b);
  const mean = errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null;
  const median = errors.length ? errors[Math.floor((errors.length - 1) / 2)] : null;
  return {
    completedWaves: waves.length,
    forecastCount: forecasts.length,
    intervalCoverage: forecasts.length ? forecasts.filter(result => result.covered).length / forecasts.length : null,
    meanAbsoluteIntervalMissDays: mean,
    medianAbsoluteIntervalMissDays: median,
    forecasts,
  };
}

async function main() {
  const filename = process.argv[2];
  if (!filename || filename === '--help') {
    console.log('Usage: node tools/backtest-wave-end.mjs <points.json>\nJSON must contain an array of { originalDate, y } points, or an object with a points array.');
    process.exitCode = filename ? 0 : 2;
    return;
  }
  const parsed = JSON.parse(await readFile(filename, 'utf8'));
  const points = Array.isArray(parsed) ? parsed : parsed.points;
  if (!Array.isArray(points)) throw new Error('Input JSON must be an array or contain a points array.');
  console.log(JSON.stringify(backtestWaveEnd(points), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
