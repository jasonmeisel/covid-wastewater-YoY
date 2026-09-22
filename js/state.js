// Central mutable application state and URL synchronisation.
import { isZipCodeQuery } from './data.js';

// Default option values — defaults are omitted from the URL until modified
export const DEFAULTS = {
  plant: "b9c02d34",
  smoothing: 3,
  scale: 'linear',
};

let sortedSamplesCache = null;

export const state = {
  // Plant selection
  currentPlantUid: "b9c02d34", // Default plant UID
  plantsCatalog: [], // Full list of plants loaded from plants.json
  currentPlantMetadata: null,
  selectedPlantUids: ["b9c02d34"],

  // PMC19 county data
  countyCovidDataByFips: new Map(),
  countyCovidMetadata: null,
  selectedZipCountyFips: null,
  selectedPmcZip: null,
  countyDataError: null,

  // Sample dataset
  rawSamples: [],
  series: {}, // Grouped by year: { '2023': [ { x: 120, y: 15.5, originalDate: '2023-04-30', actualYear: 2023 } ], ... }
  skipped: { total: 0, missingDate: 0, missingValue: 0, nonPositive: 0, unparseableDate: 0 },
  years: [],
  visibleYears: {}, // { '2023': true, '2024': true, ... }
  smoothingWindow: 3, // Standard 3-point moving average
  yScaleType: 'linear', // 'linear' or 'logarithmic'
  inactivePlantUids: new Set(),

  // UI table state
  tablePage: 1,
  tableLimit: 10,
  tableSortAsc: false,
  tableSearchQuery: '',
  filteredTableSamples: [],

  // Chart.js instance
  chartInstance: null,
};

// Replaces the derived dataset and invalidates the shared chronological view.
export function setSeries(byYear, years, skipped) {
  state.series = byYear;
  state.years = years;
  state.skipped = skipped;
  sortedSamplesCache = null;

  // Default to having all years checked/visible
  years.forEach(yr => {
    if (state.visibleYears[yr] === undefined) state.visibleYears[yr] = true;
  });
}

// Every plotted point, ascending by sample date. Memoised until setSeries runs.
export function sortedSamples() {
  if (!sortedSamplesCache) {
    sortedSamplesCache = Object.values(state.series)
      .flat()
      .sort((a, b) => String(a.originalDate).localeCompare(String(b.originalDate)));
  }
  return sortedSamplesCache;
}

// --- URL state synchronization ---
// Syncs current option values into the URL query params.
// Only non-default values are appended; defaults are removed from the URL.
export function syncStateToUrl() {
  const params = new URLSearchParams();

  const selectedPlants = state.selectedPlantUids.join(',');
  if (selectedPlants !== DEFAULTS.plant) params.set('plant', selectedPlants);
  if (state.selectedPmcZip) params.set('pmcZip', state.selectedPmcZip);
  if (state.smoothingWindow !== DEFAULTS.smoothing) params.set('smoothing', String(state.smoothingWindow));
  if (state.yScaleType !== DEFAULTS.scale) params.set('scale', state.yScaleType);

  // Years: only include hidden years (default = all visible)
  const hiddenYears = state.years.filter(yr => !state.visibleYears[yr]).map(String);
  if (hiddenYears.length > 0) params.set('hide', hiddenYears.join(','));

  const query = params.toString();
  const newUrl = `${window.location.pathname}${query ? '?' + query : ''}${window.location.hash}`;
  window.history.replaceState(null, '', newUrl);
}

// Reads option values from the URL query params (called once at startup)
export function applyStateFromUrl() {
  const params = new URLSearchParams(window.location.search);

  const plantParam = params.get('plant');
  if (plantParam) {
    state.selectedPlantUids = plantParam.split(',').filter(Boolean);
    state.currentPlantUid = state.selectedPlantUids[0] || DEFAULTS.plant;
  }

  const pmcZipParam = params.get('pmcZip');
  if (pmcZipParam && isZipCodeQuery(pmcZipParam)) {
    state.selectedPmcZip = pmcZipParam.slice(0, 5);
  }

  const smoothingParam = parseInt(params.get('smoothing'), 10);
  if ([1, 3, 7, 14].includes(smoothingParam)) state.smoothingWindow = smoothingParam;

  const scaleParam = params.get('scale');
  if (scaleParam === 'linear' || scaleParam === 'logarithmic' || scaleParam === 'percentile') state.yScaleType = scaleParam;

  // Hidden years from URL
  const hideParam = params.get('hide');
  if (hideParam) {
    hideParam.split(',').forEach(yrStr => {
      const yr = parseInt(yrStr, 10);
      if (!isNaN(yr)) state.visibleYears[yr] = false;
    });
  }
}

// Reflect current state values into the option select elements
export function syncControlsFromState() {
  const scaleSel = document.getElementById('scaleTypeSelector');
  if (scaleSel) scaleSel.value = state.yScaleType;
  const smoothSel = document.getElementById('smoothingSelector');
  if (smoothSel) smoothSel.value = String(state.smoothingWindow);
}
