// Source: index.html // [587-604] // [606-609] // [611-636] // [694-732] // [734-751] // [753-756] // [758-766] // [768-786] // [788-797] // [2188-2203] // [2216-2261]

import { state } from './state.js';
import { updateCountyCovidSummary, resolveZipToCountyFips } from './county.js';
import { buildSeries } from './stats.js';
import { initYoYChart, updateCustomLegendUI } from './chart.js';
import { applyTableFiltering } from './table.js';
import { updatePlantMetadataUI, renderPlantSearchResults, updateYearlyStatsSummaryPanel, renderSummaryMetricsRow, showStatusBanner } from './ui.js';

    // Fetch plant database catalog
    export async function loadPlantsCatalog() {
      const catalogUrl = "https://storage.googleapis.com/wastewater-dev-data/json/plants.json";
      try {
        const response = await fetch(catalogUrl);
        if (response.ok) {
          const data = await response.json();
          if (data && data.plants) {
            state.plantsCatalog = data.plants;
            updatePlantMetadataUI();
            updateCountyCovidSummary();
            await loadPlantActivityStatus();
          }
        }
      } catch (err) {
        console.warn("Could not fetch plants catalog directly due to CORS or network rules.", err);
      }
    }

    export function isPlantInactive(plant) {
      if (!plant || !plant.uid) return false;
      return state.inactivePlantUids.has(String(plant.uid));
    }

    export async function loadCountyCovidData() {
      const url = './pmc-current.json';

      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.warn('Could not load PMC19 county COVID data.');
          return;
        }

        const data = await response.json();
        state.countyCovidMetadata = data;
        state.countyCovidDataByFips = new Map(
          (data.rows || []).map(county => [String(county.fips).padStart(5, '0'), county])
        );
        updateCountyCovidSummary();
        const searchInput = document.getElementById('plantSearchInput');
        if (state.selectedPmcZip) {
          resolveZipToCountyFips(state.selectedPmcZip);
        } else if (searchInput && isZipCodeQuery(searchInput.value)) {
          resolveZipToCountyFips(searchInput.value);
        }
      } catch (err) {
        console.warn('Could not load PMC19 county COVID data.', err);
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
        console.warn("Could not determine inactive plants from Wastewater Scan status feed.", err);
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

    export function getReferenceCoordsFromZip(zip) {
      const normalizedZip = zip.trim().slice(0, 5);

      // Try the plant catalog first for exact facility coordinates
      const referencePlant = state.plantsCatalog.find(p => p.zipcode && p.zipcode.trim().slice(0, 5) === normalizedZip);
      if (referencePlant) {
        return getPlantCoordinates(referencePlant);
      }

      // Fall back to the zipcodes-us library for any US ZIP
      if (typeof window !== 'undefined' && window.zipcodes && typeof window.zipcodes.find === 'function') {
        const z = window.zipcodes.find(normalizedZip);
        if (z && z.isValid && z.latitude !== undefined && z.longitude !== undefined) {
          return { lat: Number(z.latitude), lng: Number(z.longitude) };
        }
      }

      return null;
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
      
      setTimeout(() => {
        const { byYear, years, skipped } = buildSeries(state.rawSamples);
        state.processedData = byYear;
        state.yearsList = years;
        state.skipped = skipped;
        years.forEach(yr => {
          if (state.visibleYears[yr] === undefined) state.visibleYears[yr] = true;
        });
        initYoYChart();
        updateCustomLegendUI();
        updateYearlyStatsSummaryPanel();
        renderSummaryMetricsRow();
        applyTableFiltering();
        
        if (loader) loader.classList.add('hidden');
      }, 300);
    }

    // Primary Async Loader fetching from GCS Target URL
    export async function loadRawData(forceShowSimBanner = false, overrideUrl = null) {
      const targetUrls = overrideUrl
        ? [overrideUrl]
        : state.selectedPlantUids.map(uid => `https://storage.googleapis.com/wastewater-dev-data/json/${uid}.json`);
      const loader = document.getElementById('chartLoader');
      const spinner = document.getElementById('loaderSpinner');
      const errorPanel = document.getElementById('loaderErrorPanel');
      
      if (loader) loader.classList.remove('hidden');
      if (spinner) spinner.classList.remove('hidden');
      if (errorPanel) errorPanel.classList.add('hidden');

      try {
        const datasets = await Promise.all(targetUrls.map(async targetUrl => {
          const response = await fetch(targetUrl);
          if (!response.ok) {
            throw new Error(`HTTP network response failed: ${response.status}`);
          }
          const data = await response.json();
          if (!data || !Array.isArray(data.samples)) {
            throw new Error("Invalid schema structure found within target JSON database.");
          }
          return data.samples;
        }));

        if (datasets.length > 0) {
          state.rawSamples = datasets.flat();
          processAndDisplayData();
          const banner = document.getElementById('statusBanner');
          if (banner) banner.classList.add('hidden');
        } else {
          throw new Error("Invalid schema structure found within target JSON database.");
        }
      } catch (err) {
        console.warn("Direct live GCS data fetch restricted by sandbox environment or network. Details:", err);
        
        // Show non-falsified error panel, asking the user to load original data manually
        if (spinner) spinner.classList.add('hidden');
        if (errorPanel) errorPanel.classList.remove('hidden');
        
        if (forceShowSimBanner) {
          showStatusBanner("CORS fetch blocked. Please drag-and-drop the downloaded JSON.", "warning");
        }
      }
    }
