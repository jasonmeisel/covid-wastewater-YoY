// Source: index.html // [799-805] // [807-825] // [827-833] // [835-936] // [938-978] // [980-1029] // [1031-1038] // [1797-1852] // [1886-1944] // [2077-2084] // [2086-2113] // [2115-2121] // [2123-2158] // [2160-2179] // [2181-2186] // [2205-2214]

import { formatShortDate, formatMonthDay, parseDateParts, escapeHtml } from './util.js';
import { state, syncStateToUrl, sortedSamples } from './state.js';
import { resolveZipToCountyFips, updateCountyCovidSummary } from './county.js';
import { pickYearColor, getLatestSampleValue, summarize, inclusivePercentile } from './stats.js';
import { fuzzyMatchPlant, isZipCodeQuery, getPlantCoordinates, getReferenceCoordsFromZip, haversineDistance, isPlantInactive, loadAndRenderPlantSamples } from './data.js';
import { resetChartZoom, toggleAllYears, updateYScale, updateSmoothing } from './chart.js';
import { downloadCSV, sortTableByDate, changePage, handleSearch } from './table.js';

    export function showPlantDropdown() {
      const resultsContainer = document.getElementById('plantSearchResults');
      if (resultsContainer) {
        renderPlantSearchResults(document.getElementById('plantSearchInput').value);
        resultsContainer.classList.remove('hidden');
      }
    }

    export function handlePlantQueryChange(val) {
      const clearBtn = document.getElementById('clearPlantSearchBtn');
      if (clearBtn) {
        clearBtn.classList.toggle('hidden', !val);
      }
      if (isZipCodeQuery(val)) {
        resolveZipToCountyFips(val);
      } else {
        state.selectedZipCountyFips = null;
        state.selectedPmcZip = null;
        syncStateToUrl();
        updateCountyCovidSummary();
      }
      renderPlantSearchResults(val);
      const resultsContainer = document.getElementById('plantSearchResults');
      if (resultsContainer) {
        resultsContainer.classList.remove('hidden');
      }
    }

    export function clearPlantSearch() {
      const input = document.getElementById('plantSearchInput');
      if (input) {
        input.value = '';
        handlePlantQueryChange('');
      }
    }

    export async function renderPlantSearchResults(query) {
      const container = document.getElementById('plantSearchResults');
      if (!container) return;

      const trimmedQuery = query.trim();
      const isZip = isZipCodeQuery(trimmedQuery);
      let matches = [];
      let distanceMap = new Map();

      if (isZip) {
        // Resolve coordinates before touching the DOM so overlapping renders cannot interleave.
        let referenceCoords = null;
        try {
          referenceCoords = await getReferenceCoordsFromZip(trimmedQuery);
        } catch (err) {
          showStatusBanner(err && err.message ? err.message : String(err), 'error');
        }
        container.innerHTML = '';
        matches = [...state.plantsCatalog];

        if (referenceCoords) {
          matches.forEach(plant => {
            const coords = getPlantCoordinates(plant);
            if (coords) {
              const dist = haversineDistance(referenceCoords.lat, referenceCoords.lng, coords.lat, coords.lng);
              distanceMap.set(plant, dist);
            }
          });

          matches.sort((a, b) => {
            const da = distanceMap.get(a);
            const db = distanceMap.get(b);
            if (da === undefined && db === undefined) {
              return (Number(b.sewershed_pop) || 0) - (Number(a.sewershed_pop) || 0);
            }
            if (da === undefined) return 1;
            if (db === undefined) return -1;
            return da - db;
          });

          const header = document.createElement('div');
          header.className = "p-2 text-[11px] text-slate-400 bg-slate-800/50 border-b border-slate-800 text-center";
          header.innerText = `Sorting by distance from ZIP ${trimmedQuery.slice(0, 5)}`;
          container.appendChild(header);
        } else {
          matches.sort((a, b) => {
            const aPop = Number(a.sewershed_pop) || 0;
            const bPop = Number(b.sewershed_pop) || 0;
            return bPop - aPop;
          });

          const header = document.createElement('div');
          header.className = "p-2 text-[11px] text-amber-400 bg-amber-500/10 border-b border-slate-800 text-center";
          header.innerText = `ZIP ${trimmedQuery.slice(0, 5)} not in catalog; showing all plants`;
          container.appendChild(header);
        }
      } else {
        container.innerHTML = '';
        matches = state.plantsCatalog
          .filter(p => fuzzyMatchPlant(p, query))
          .sort((a, b) => {
            const aPop = Number(a.sewershed_pop) || 0;
            const bPop = Number(b.sewershed_pop) || 0;
            return bPop - aPop;
          });
      }

      if (matches.length === 0) {
        container.innerHTML = `<div class="p-4 text-xs text-slate-500 text-center">No matching treatment plants found.</div>`;
        return;
      }

      matches.slice(0, 30).forEach(plant => {
        const item = document.createElement('div');
        const isSelected = state.selectedPlantUids.includes(plant.uid);
        const isInactive = isPlantInactive(plant);
        const distance = distanceMap.get(plant);
        const distanceStr = distance !== undefined
          ? `${distance < 10 ? distance.toFixed(1) : Math.round(distance)} mi`
          : '';

        item.className = `p-3 text-xs cursor-pointer hover:bg-slate-800 transition flex items-center justify-between ${
          isSelected ? 'bg-teal-500/10 border-l-4 border-teal-400' : ''
        } ${isInactive ? 'bg-amber-500/5 border-l-4 border-amber-500/60' : ''}`;

        const popFormatted = plant.sewershed_pop ? Number(plant.sewershed_pop).toLocaleString() : 'N/A';
        const locationStr = [plant.city, plant.state].filter(Boolean).join(', ');
        const statusBadge = isInactive
          ? '<span class="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded">Inactive</span>'
          : (isSelected ? '<span class="text-[10px] bg-teal-500/20 text-teal-300 px-1.5 py-0.2 rounded">Active</span>' : '');

        item.innerHTML = `
          <div class="flex flex-col gap-0.5">
            <div class="font-bold text-slate-100 flex items-center gap-1.5">
              <span>${escapeHtml(plant.name || plant.site_name || 'Facility')}</span>
              ${statusBadge}
            </div>
            <div class="text-[11px] text-slate-400">${escapeHtml(plant.site_name || '')} ${locationStr ? '• ' + escapeHtml(locationStr) : ''}</div>
          </div>
          <div class="text-right shrink-0 ml-2 flex flex-col items-end gap-0.5">
            <span class="text-[10px] font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">Pop: ${popFormatted}</span>
            ${distanceStr ? `<span class="text-[10px] font-mono text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded">${distanceStr}</span>` : ''}
          </div>
        `;

        item.onclick = event => selectPlant(plant, event.shiftKey);
        container.appendChild(item);
      });
    }

    export function selectPlant(plant, addToSelection = false) {
      const searchInput = document.getElementById('plantSearchInput');
      const selectedQuery = searchInput?.value || '';
      if (isZipCodeQuery(selectedQuery)) {
        resolveZipToCountyFips(selectedQuery);
      } else {
        state.selectedZipCountyFips = null;
        state.selectedPmcZip = null;
      }

      if (addToSelection) {
        state.selectedPlantUids = state.selectedPlantUids.includes(plant.uid)
          ? state.selectedPlantUids.filter(uid => uid !== plant.uid)
          : [...state.selectedPlantUids, plant.uid];

        if (state.selectedPlantUids.length === 0) {
          state.selectedPlantUids = [plant.uid];
        }
      } else {
        state.selectedPlantUids = [plant.uid];
      }
      state.currentPlantUid = state.selectedPlantUids.includes(plant.uid)
        ? plant.uid
        : state.selectedPlantUids[0];
      state.currentPlantMetadata = state.plantsCatalog.find(candidate => candidate.uid === state.currentPlantUid) || plant;
      
      // Update inputs & hide dropdown
      if (searchInput) searchInput.value = '';
      const clearBtn = document.getElementById('clearPlantSearchBtn');
      if (clearBtn) clearBtn.classList.add('hidden');

      const resultsContainer = document.getElementById('plantSearchResults');
      if (resultsContainer) resultsContainer.classList.add('hidden');

      updatePlantMetadataUI();
      updateCountyCovidSummary();
      syncStateToUrl();
      
      // Load all selected plant JSON files into a single analysis dataset.
      loadAndRenderPlantSamples();
    }

    export function updatePlantMetadataUI() {
      if (state.plantsCatalog.length > 0 && !state.currentPlantMetadata) {
        state.currentPlantMetadata = state.plantsCatalog.find(p => p.uid === state.currentPlantUid) || null;
      }

      const titleDisplay = document.getElementById('plantTitleDisplay');
      const popBadge = document.getElementById('plantPopBadge');

      const selectedPlants = state.plantsCatalog.filter(plant => state.selectedPlantUids.includes(plant.uid));
      if (selectedPlants.length > 1) {
        const names = selectedPlants
          .map(plant => plant.name || plant.site_name || plant.uid)
          .join(' + ');
        const population = selectedPlants.reduce((sum, plant) => sum + (Number(plant.sewershed_pop) || 0), 0);

        if (titleDisplay) {
          titleDisplay.innerHTML = `<span class="shrink-0">Combined: ${escapeHtml(names)}</span>`;
        }
        if (popBadge) {
          popBadge.innerText = `Pop: ${population.toLocaleString()}`;
        }
        return;
      }

      if (state.currentPlantMetadata) {
        const name = state.currentPlantMetadata.name || state.currentPlantMetadata.site_name || state.currentPlantUid;
        const place = state.currentPlantMetadata.place_name || [state.currentPlantMetadata.city, state.currentPlantMetadata.state].filter(Boolean).join(', ');
        
        if (titleDisplay) {
          titleDisplay.innerHTML = `<span class="shrink-0">${escapeHtml(name)}</span> <span class="min-w-0 truncate text-xs font-normal text-slate-400 font-mono">(${escapeHtml(place)})</span>`;
        }
        if (popBadge) {
          popBadge.innerText = `Pop: ${state.currentPlantMetadata.sewershed_pop ? Number(state.currentPlantMetadata.sewershed_pop).toLocaleString() : 'N/A'}`;
        }
      } else {
        if (titleDisplay) {
          titleDisplay.innerHTML = `<span>Plant UID: ${escapeHtml(state.currentPlantUid)}</span>`;
        }
        if (popBadge) {
          popBadge.innerText = `Pop: --`;
        }
      }
    }


    // Render Year Summary Details Panel
    export function updateYearlyStatsSummaryPanel() {
      const container = document.getElementById('yearlyStatsSummary');
      if (!container) return;
      container.innerHTML = '';

      if (state.years.length === 0) {
        container.innerHTML = `<div class="text-xs text-slate-500 py-4 text-center">No statistical profile available. Please load database JSON.</div>`;
        return;
      }

      const currentValue = getLatestSampleValue();

      state.years.forEach(yr => {
        const series = state.series[yr] || [];
        if (series.length === 0) return;

        const { mean, peak } = summarize(series);
        const yearValues = series.map(item => item.y).sort((a, b) => a - b);
        const currentPercentile = currentValue === null
          ? null
          : inclusivePercentile(currentValue, yearValues);

        const colorConf = pickYearColor(yr);

        const card = document.createElement('div');
        card.className = "p-3 rounded-lg bg-slate-900/40 border border-slate-800 hover:border-slate-700 transition flex items-center justify-between";
        card.innerHTML = `
          <div class="flex items-center gap-3">
            <span class="w-1 h-10 rounded ${colorConf.bg}"></span>
            <div>
              <h4 class="font-bold text-slate-200 text-sm">${yr} Baseline</h4>
              <p class="text-[10px] text-slate-500">Peak recorded on: ${formatMonthDay(peak.date)}</p>
            </div>
          </div>
          <div class="text-right">
            <div class="text-xs font-bold text-slate-300">Mean: <span class="text-teal-400 font-mono">${mean.toFixed(1)}</span></div>
            <div class="text-[10px] text-slate-500">Peak: <span class="text-indigo-400 font-mono font-bold">${peak.value.toFixed(1)}</span></div>
          </div>
          <div class="text-right">
            <div class="text-[10px] text-slate-500">Percentile of latest sample</div>
            <div class="text-xs font-bold text-slate-300"><span class="text-pink-400 font-mono">${currentPercentile === null ? 'N/A' : `${currentPercentile.toFixed(1)}%`}</span></div>
          </div>
        `;
        container.appendChild(card);
      });
    }

    // Honest accounting for samples that could not be plotted.
    export function renderSampleAccounting() {
      const target = document.getElementById('sampleAccounting');
      if (!target) return;

      const total = state.rawSamples.length;
      const plotted = sortedSamples().length;
      const skipped = state.skipped || {};

      let text = `Plotted ${plotted} of ${total} samples`;
      if (skipped.total > 0) {
        text += ` — ${skipped.missingValue} without an N-gene/PMMoV value, ${skipped.nonPositive} non-positive, ${skipped.unparseableDate} unparseable date`;
      }
      target.innerText = text;
    }

    // Render Metrics Row Values dynamically based on calculated states
    export function renderSummaryMetricsRow() {
      if (state.rawSamples.length === 0) return;

      // Extract raw points chronologically (shared, memoised view)
      const allPointsSorted = sortedSamples();

      if (allPointsSorted.length === 0) return;

      // Current/Latest Sample Statistics
      const latestItem = allPointsSorted[allPointsSorted.length - 1];
      const previousItem = allPointsSorted.length > 1 ? allPointsSorted[allPointsSorted.length - 2] : null;
      
      document.getElementById('metricLatestVal').innerText = latestItem.y.toFixed(2);
      document.getElementById('metricLatestDate').innerText = formatShortDate(latestItem.originalDate);

      const changeElem = document.getElementById('metricLatestChange');
      if (previousItem) {
        const deltaPct = ((latestItem.y - previousItem.y) / previousItem.y) * 100;
        const sign = deltaPct >= 0 ? '+' : '';
        changeElem.innerText = `${sign}${deltaPct.toFixed(1)}% vs ${formatShortDate(previousItem.originalDate)}`;
        changeElem.className = `text-[8px] font-semibold ${deltaPct >= 0 ? 'text-rose-400' : 'text-emerald-400'}`;
      } else {
        changeElem.innerText = '';
      }

      // Peak and overall-mean statistics
      const overall = summarize(allPointsSorted);
      document.getElementById('metricPeakVal').innerText = overall.peak.value.toFixed(2);
      document.getElementById('metricPeakDate').innerText = formatShortDate(overall.peak.date);
      document.getElementById('metricPeakYear').innerText = parseDateParts(overall.peak.date)?.year ?? 'N/A';
      document.getElementById('metricMeanVal').innerText = overall.mean.toFixed(2);
      document.getElementById('metricMeanDesc').innerText = `Across ${overall.count} samples`;

      // Dataset Span statistics
      const firstYear = parseDateParts(allPointsSorted[0].originalDate)?.year ?? null;
      const lastYear = parseDateParts(allPointsSorted[allPointsSorted.length - 1].originalDate)?.year ?? null;
      const totalYears = firstYear !== null && lastYear !== null ? lastYear - firstYear + 1 : 0;

      document.getElementById('metricSpanYears').innerText = `${totalYears} Years`;
      document.getElementById('metricSamplesCount').innerText = `${allPointsSorted.length} samples from ${firstYear} - ${lastYear}`;
    }

    // Export chart layout into clean PNG image
    export function downloadChart() {
      if (!state.chartInstance) return;
      const link = document.createElement('a');
      link.download = `wastewater_yoy_comparison_${new Date().toISOString().split('T')[0]}.png`;
      link.href = state.chartInstance.toBase64Image();
      link.click();
    }

    // Helper banner alert manager
    export function showStatusBanner(text, type = "info") {
      const banner = document.getElementById('statusBanner');
      const bannerText = document.getElementById('statusBannerText');
      if (!banner || !bannerText) return;
      
      bannerText.innerText = text;
      banner.classList.remove('hidden', 'bg-indigo-600', 'bg-emerald-600', 'bg-rose-600', 'bg-amber-600');
      
      if (type === "success") {
        banner.classList.add('bg-emerald-600');
      } else if (type === "error") {
        banner.classList.add('bg-rose-600');
      } else if (type === "warning") {
        banner.classList.add('bg-amber-600');
      } else {
        banner.classList.add('bg-indigo-600');
      }
      banner.classList.remove('hidden');
    }

    // Toggle collapsible panel content visibility
    export function togglePanel(contentId, iconId) {
      const content = document.getElementById(contentId);
      const icon = document.getElementById(iconId);
      if (!content || !icon) return;

      const isCollapsed = content.classList.contains('hidden');
      content.classList.toggle('hidden');
      icon.innerText = isCollapsed ? '−' : '+';
    }

    // Delegated event bindings: markup carries data-action, this is the single wiring point.
    const CLICK_ACTIONS = {
      'retry-load': () => loadAndRenderPlantSamples(),
      'plant-clear': () => clearPlantSearch(),
      'chart-reset': () => resetChartZoom(),
      'years-all': el => toggleAllYears(el.dataset.visible === 'true'),
      'toggle-panel': el => togglePanel(el.dataset.target, el.dataset.icon),
      'download-csv': () => downloadCSV(),
      'download-chart': () => downloadChart(),
      'table-sort': () => sortTableByDate(),
      'table-page': el => changePage(Number(el.dataset.delta)),
    };

    const INPUT_ACTIONS = {
      'plant-query': el => handlePlantQueryChange(el.value),
      'table-search': el => handleSearch(el.value),
    };

    const CHANGE_ACTIONS = {
      'scale': el => updateYScale(el.value),
      'smoothing': el => updateSmoothing(el.value),
    };

    export function bindActions() {
      document.addEventListener('click', (e) => {
        // Close the plant search dropdown on any click outside its container.
        const container = document.getElementById('plantSearchContainer');
        const dropdown = document.getElementById('plantSearchResults');
        if (container && dropdown && !container.contains(e.target)) {
          dropdown.classList.add('hidden');
        }
        const el = e.target.closest('[data-action]');
        if (el) CLICK_ACTIONS[el.dataset.action]?.(el);
      });

      document.addEventListener('input', (e) => {
        const el = e.target.closest('[data-action]');
        if (el && INPUT_ACTIONS[el.dataset.action]) INPUT_ACTIONS[el.dataset.action](el);
      });

      document.addEventListener('change', (e) => {
        const el = e.target.closest('[data-action]');
        if (el && CHANGE_ACTIONS[el.dataset.action]) CHANGE_ACTIONS[el.dataset.action](el);
      });

      document.addEventListener('focusin', (e) => {
        if (e.target.closest('[data-action="plant-query"]')) showPlantDropdown();
      });
    }
