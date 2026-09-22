// Source: index.html // [587-604] // [606-609] // [611-636] // [694-732] // [734-751] // [753-756] // [758-766] // [768-786] // [788-797] // [2188-2203] // [2216-2261]

import { state, setSeries } from './state.js';
import { updateCountyCovidSummary, resolveZipToCountyFips, showCountyDataError } from './county.js';
import { buildSeries } from './stats.js';
import { updateChart, updateCustomLegendUI } from './chart.js';
import { applyTableFiltering } from './table.js';
import { updatePlantMetadataUI, renderPlantSearchResults, updateYearlyStatsSummaryPanel, renderSummaryMetricsRow, renderSampleAccounting, showStatusBanner } from './ui.js';

    function reportPlantCatalogError() {
      const container = document.getElementById('plantSearchResults');
      if (container) {
        container.innerHTML = '<div class="p-4 text-xs text-amber-400 text-center">Plant catalog unavailable — search disabled</div>';
        container.classList.remove('hidden');
      }
    }

    // Fetch plant database catalog
    export async function loadPlantsCatalog() {
      const catalogUrl = "https://storage.googleapis.com/wastewater-dev-data/json/plants.json";
      try {
        const response = await fetch(catalogUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${catalogUrl}`);

        const data = await response.json();
        if (!data || !Array.isArray(data.plants) || data.plants.length === 0) {
          throw new Error(`unexpected schema for ${catalogUrl} (no plants array)`);
        }

        state.plantsCatalog = data.plants;
        updatePlantMetadataUI();
        updateCountyCovidSummary();
        await loadPlantActivityStatus();
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        showStatusBanner(message, 'error');
        reportPlantCatalogError();
      }
    }

    export function isPlantInactive(plant) {
      if (!plant || !plant.uid) return false;
      return state.inactivePlantUids.has(String(plant.uid));
    }

    let zipLookupPromise = null;

    // Fetches (once) and memoises the bundled ZIP -> [lat, lng, state, county] table.
    export function loadZipLookup() {
      if (!zipLookupPromise) {
        zipLookupPromise = (async () => {
          const url = './data/zip-lookup.json';
          let response;
          try {
            response = await fetch(url);
          } catch (err) {
            throw new Error(err && err.message ? err.message : `network error for ${url}`);
          }
          if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);

          const json = await response.json();
          if (!json || typeof json.zips !== 'object' || json.zips === null) {
            throw new Error('zip lookup schema invalid');
          }
          return new Map(Object.entries(json.zips));
        })();
        // Allow a later call to retry after a transient failure.
        zipLookupPromise.catch(() => { zipLookupPromise = null; });
      }
      return zipLookupPromise;
    }

    // Fetches the slimmed PMC19 county dataset. Throws with the exact reason on failure.
    export async function loadCountyData() {
      const url = './data/pmc-counties.json';

      let response;
      try {
        response = await fetch(url);
      } catch (err) {
        throw new Error(err && err.message ? err.message : `network error for ${url}`);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);

      const json = await response.json();
      if (!json || !Array.isArray(json.rows)) throw new Error('county dataset schema invalid');

      return {
        metadata: {
          date_last_updated: json.date_last_updated,
          week_end: json.week_end,
          source: json.source,
        },
        byFips: new Map(json.rows.map(row => [String(row.fips).padStart(5, '0'), row])),
      };
    }

    export async function loadCountyCovidData() {
      try {
        const { metadata, byFips } = await loadCountyData();
        state.countyDataError = null;
        state.countyCovidMetadata = metadata;
        state.countyCovidDataByFips = byFips;
        updateCountyCovidSummary();

        const searchInput = document.getElementById('plantSearchInput');
        if (state.selectedPmcZip) {
          resolveZipToCountyFips(state.selectedPmcZip);
        } else if (searchInput && isZipCodeQuery(searchInput.value)) {
          resolveZipToCountyFips(searchInput.value);
        }
      } catch (err) {
        showCountyDataError(err && err.message ? err.message : String(err));
      }
    }

    export async function loadPlantActivityStatus() {
      const activityUrl = "https://data.wastewaterscan.org/data/categories/plants.json";
      try {
        const response = await fetch(activityUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - 3);
        state.inactivePlantUids = new Set();

        if (data && typeof data === 'object') {
          Object.entries(data).forEach(([uid, samples]) => {
            if (!samples || typeof samples !== 'object') return;

            const dates = Object.values(samples)
              .filter(entry => entry && typeof entry === 'object' && entry.lastSampleDate)
              .map(entry => new Date(entry.lastSampleDate))
              .filter(date => !Number.isNaN(date.getTime()));

            if (dates.length === 0) return;

            const latestDate = new Date(Math.max(...dates.map(date => date.getTime())));
            if (latestDate < cutoffDate) {
              state.inactivePlantUids.add(String(uid));
            }
          });
        }

        const searchInput = document.getElementById('plantSearchInput');
        if (searchInput) {
          renderPlantSearchResults(searchInput.value || '');
        }
      } catch (err) {
        showStatusBanner(err && err.message ? err.message : String(err), 'error');
      }
    }

    // Fuzzy matching logic across multiple fields
    export function fuzzyMatchPlant(plant, query) {
      if (!query || !query.trim()) return true;
      const tokens = query.toLowerCase().trim().split(/\s+/);
      
      const searchableStr = [
        plant.name,
        plant.site_name,
        plant.place_name,
        plant.city,
        plant.state,
        plant.zipcode,
        plant.country,
        plant.uid
      ].filter(Boolean).join(' ').toLowerCase();

      return tokens.every(token => searchableStr.includes(token));
    }

    // ZIP-code distance sorting helpers
    export function isZipCodeQuery(query) {
      return /^\d{5}(-\d{4})?$/.test(query.trim());
    }

    export function getPlantCoordinates(plant) {
      if (plant.point && Array.isArray(plant.point.coordinates) && plant.point.coordinates.length >= 2) {
        return { lng: plant.point.coordinates[0], lat: plant.point.coordinates[1] };
      }
      if (plant.longitude !== undefined && plant.latitude !== undefined) {
        return { lng: Number(plant.longitude), lat: Number(plant.latitude) };
      }
      return null;
    }

    export async function getReferenceCoordsFromZip(zip) {
      const normalizedZip = zip.trim().slice(0, 5);

      // Try the plant catalog first for exact facility coordinates
      const referencePlant = state.plantsCatalog.find(p => p.zipcode && p.zipcode.trim().slice(0, 5) === normalizedZip);
      if (referencePlant) {
        return getPlantCoordinates(referencePlant);
      }

      // Fall back to the bundled ZIP dataset for any US ZIP
      const entry = (await loadZipLookup()).get(normalizedZip);
      return entry ? { lat: entry[0], lng: entry[1] } : null;
    }

    export function haversineDistance(lat1, lon1, lat2, lon2) {
      const R = 3958.8; // Earth radius in miles
      const toRad = deg => deg * (Math.PI / 180);
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    // Main data process pipeline orchestrator
    export function processAndDisplayData() {
      const loader = document.getElementById('chartLoader');
      if (loader) loader.classList.remove('hidden');
      
      const { byYear, years, skipped } = buildSeries(state.rawSamples);
      setSeries(byYear, years, skipped);
      updateChart();
      updateCustomLegendUI();
      updateYearlyStatsSummaryPanel();
      renderSummaryMetricsRow();
      renderSampleAccounting();
      applyTableFiltering();

      if (loader) loader.classList.add('hidden');
    }

    // Primary Async Loader fetching from GCS Target URL
    // Fetches the raw sample arrays for the given plant UIDs, in parallel.
    // Throws with the exact reason when any request fails or yields nothing.
    export async function loadPlantSamples(uids) {
      const results = await Promise.all(uids.map(async uid => {
        const url = `https://storage.googleapis.com/wastewater-dev-data/json/${uid}.json`;

        let response;
        try {
          response = await fetch(url);
        } catch (err) {
          throw new Error(err && err.message ? err.message : `network error for ${url}`);
        }
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);

        const json = await response.json();
        if (!json || !Array.isArray(json.samples)) {
          throw new Error(`unexpected schema for ${url} (no samples array)`);
        }
        return json.samples;
      }));

      const samples = results.flat();
      if (samples.length === 0) throw new Error('no samples loaded');
      return samples;
    }

    // Loads the selected plants and drives the loader panel with the real reason on failure.
    export async function loadAndRenderPlantSamples(uids = state.selectedPlantUids) {
      const loader = document.getElementById('chartLoader');
      const spinner = document.getElementById('loaderSpinner');
      const errorPanel = document.getElementById('loaderErrorPanel');
      const errorMessage = document.getElementById('loaderErrorMessage');
      const chartContainer = document.getElementById('chartContainer');

      if (chartContainer) chartContainer.setAttribute('aria-busy', 'true');
      if (loader) loader.classList.remove('hidden');
      if (spinner) spinner.classList.remove('hidden');
      if (errorPanel) errorPanel.classList.add('hidden');

      try {
        state.rawSamples = await loadPlantSamples(uids);
        const banner = document.getElementById('statusBanner');
        if (banner) banner.classList.add('hidden');
        processAndDisplayData();
        if (chartContainer) chartContainer.setAttribute('aria-busy', 'false');
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        if (spinner) spinner.classList.add('hidden');
        if (errorMessage) errorMessage.innerText = message;
        if (errorPanel) errorPanel.classList.remove('hidden');
        if (chartContainer) chartContainer.setAttribute('aria-busy', 'false');
        showStatusBanner(message, 'error');
      }
    }
