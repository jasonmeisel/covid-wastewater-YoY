#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';
import { buildSeries } from '../js/stats.js';
import { backtestGaussianWaveEnd } from './gaussian-wave-backtest.mjs';

function summarize(rows) {
  const errors = rows.map(row => Math.abs(row.errorDays)).sort((a, b) => a - b);
  return {
    forecasts: rows.length,
    facilities: new Set(rows.map(row => row.facilityId)).size,
    waves: new Set(rows.map(row => row.waveId)).size,
    meanAbsoluteErrorDays: errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null,
    medianAbsoluteErrorDays: errors.length ? errors[Math.floor((errors.length - 1) / 2)] : null,
    within14DaysPercent: errors.length ? 100 * errors.filter(value => value <= 14).length / errors.length : null,
  };
}

function firstForecastPerWave(rows) {
  const first = new Map();
  for (const row of rows) {
    const current = first.get(row.waveId);
    if (!current || row.cutoffDate < current.cutoffDate) first.set(row.waveId, row);
  }
  return [...first.values()];
}

function pairedAtSameCutoff(rawRows, percentileRows) {
  const percentileByKey = new Map(percentileRows.map(row => [`${row.waveId}:${row.cutoffDate}`, row]));
  return rawRows.flatMap(raw => {
    const percentile = percentileByKey.get(`${raw.waveId}:${raw.cutoffDate}`);
    return percentile ? [{ rawErrorDays: raw.errorDays, percentileErrorDays: percentile.errorDays }] : [];
  });
}

export async function backtestPercentileGaussian(cacheDir = '.cache/facility-samples') {
  const files = (await readdir(cacheDir)).filter(file => file.endsWith('.json')).sort();
  const rawForecasts = [];
  const percentileForecasts = [];
  for (const file of files) {
    const record = JSON.parse(await readFile(`${cacheDir}/${file}`, 'utf8'));
    const facilityId = record.uid || file.replace(/\.json$/, '');
    const { byYear } = buildSeries(record.samples.map(sample => ({ ...sample, _facilityUid: facilityId })));
    const points = Object.values(byYear).flat()
      .map(point => ({ ...point, _facilityUid: facilityId }))
      .sort((a, b) => a.originalDate.localeCompare(b.originalDate));
    rawForecasts.push(...backtestGaussianWaveEnd(points, { smoothingDays: 1, transform: 'raw' }).forecasts);
    percentileForecasts.push(...backtestGaussianWaveEnd(points, { smoothingDays: 1, transform: 'percentile' }).forecasts);
  }

  const paired = pairedAtSameCutoff(rawForecasts, percentileForecasts);
  return {
    facilityFiles: files.length,
    methodComparison: {
      rawGaussian: summarize(rawForecasts),
      prefixPercentileGaussian: summarize(percentileForecasts),
    },
    oneEarliestForecastPerWave: {
      rawGaussian: summarize(firstForecastPerWave(rawForecasts)),
      prefixPercentileGaussian: summarize(firstForecastPerWave(percentileForecasts)),
    },
    pairedSameWaveAndCutoff: {
      forecasts: paired.length,
      rawGaussianMaeDays: paired.length ? paired.reduce((sum, row) => sum + Math.abs(row.rawErrorDays), 0) / paired.length : null,
      percentileGaussianMaeDays: paired.length ? paired.reduce((sum, row) => sum + Math.abs(row.percentileErrorDays), 0) / paired.length : null,
      percentileBetterPercent: paired.length ? 100 * paired.filter(row => Math.abs(row.percentileErrorDays) < Math.abs(row.rawErrorDays)).length / paired.length : null,
      tiedPercent: paired.length ? 100 * paired.filter(row => Math.abs(row.percentileErrorDays) === Math.abs(row.rawErrorDays)).length / paired.length : null,
    },
  };
}

async function main() {
  process.stdout.write(`${JSON.stringify(await backtestPercentileGaussian(), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
