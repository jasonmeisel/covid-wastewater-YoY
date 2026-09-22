// Source: index.html // [799-805] // [807-825] // [827-833] // [835-936] // [938-978] // [980-1029] // [1031-1038] // [1797-1852] // [1886-1944] // [2077-2084] // [2086-2113] // [2115-2121] // [2123-2158] // [2160-2179] // [2181-2186] // [2205-2214]

import { state, syncStateToUrl } from './state.js';
import { resolveZipToCountyFips, updateCountyCovidSummary } from './county.js';
import { YEAR_COLOR_PALETTE, getLatestSampleValue } from './stats.js';
import { fuzzyMatchPlant, isZipCodeQuery, getPlantCoordinates, getReferenceCoordsFromZip, haversineDistance, isPlantInactive, loadRawData, processAndDisplayData } from './data.js';
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

    export function renderPlantSearchResults(query) {
      const container = document.getElementById('plantSearchResults');
      if (!container) return;
      container.innerHTML = '';

      const trimmedQuery = query.trim();
      const isZip = isZipCodeQuery(trimmedQuery);
      let matches = [];
      let distanceMap = new Map();

      if (isZip) {
        const referenceCoords = getReferenceCoordsFromZip(trimmedQuery);
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
              <span>${plant.name || plant.site_name || 'Facility'}</span>
              ${statusBadge}
            </div>
            <div class="text-[11px] text-slate-400">${plant.site_name || ''} ${locationStr ? '• ' + locationStr : ''}</div>
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
      loadRawData(true);
    }

    export function updatePlantMetadataUI() {
      if (state.plantsCatalog.length > 0 && !state.currentPlantMetadata) {
        state.currentPlantMetadata = state.plantsCatalog.find(p => p.uid === state.currentPlantUid) || null;
      }

      const titleDisplay = document.getElementById('plantTitleDisplay');
      const popBadge = document.getElementById('plantPopBadge');
      const downloadLink = document.getElementById('directDownloadLink');
      const gcsInput = document.getElementById('gcsUrlInput');

      const plantUrl = `https://storage.googleapis.com/wastewater-dev-data/json/${state.currentPlantUid}.json`;

      if (gcsInput) gcsInput.value = plantUrl;
      if (downloadLink) downloadLink.href = plantUrl;

      const selectedPlants = state.plantsCatalog.filter(plant => state.selectedPlantUids.includes(plant.uid));
      if (selectedPlants.length > 1) {
        const names = selectedPlants
          .map(plant => plant.name || plant.site_name || plant.uid)
          .join(' + ');
        const population = selectedPlants.reduce((sum, plant) => sum + (Number(plant.sewershed_pop) || 0), 0);

        if (titleDisplay) {
          titleDisplay.innerHTML = `<span class="shrink-0">Combined: ${names}</span>`;
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
          titleDisplay.innerHTML = `<span class="shrink-0">${name}</span> <span class="min-w-0 truncate text-xs font-normal text-slate-400 font-mono">(${place})</span>`;
        }
        if (popBadge) {
          popBadge.innerText = `Pop: ${state.currentPlantMetadata.sewershed_pop ? Number(state.currentPlantMetadata.sewershed_pop).toLocaleString() : 'N/A'}`;
        }
      } else {
        if (titleDisplay) {
          titleDisplay.innerHTML = `<span>Plant UID: ${state.currentPlantUid}</span>`;
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

      if (state.yearsList.length === 0) {
        container.innerHTML = `<div class="text-xs text-slate-500 py-4 text-center">No statistical profile available. Please load database JSON.</div>`;
        return;
      }

      const currentValue = getLatestSampleValue();

      state.yearsList.forEach(yr => {
        const series = state.processedData[yr] || [];
        if (series.length === 0) return;

        const mean = series.reduce((sum, item) => sum + item.y, 0) / series.length;
        const currentPercentile = currentValue === null
          ? null
          : (series.filter(item => item.y <= currentValue).length / series.length) * 100;
        
        // Find maximum peak
        let peakVal = 0;
        let peakDate = 'N/A';
        series.forEach(item => {
          if (item.y > peakVal) {
            peakVal = item.y;
            peakDate = item.originalDate;
          }
        });

        const colorConf = YEAR_COLOR_PALETTE[yr] || YEAR_COLOR_PALETTE.default;

        const card = document.createElement('div');
        card.className = "p-3 rounded-lg bg-slate-900/40 border border-slate-800 hover:border-slate-700 transition flex items-center justify-between";
        card.innerHTML = `
          <div class="flex items-center gap-3">
            <span class="w-1 h-10 rounded ${colorConf.bg}"></span>
            <div>
              <h4 class="font-bold text-slate-200 text-sm">${yr} Baseline</h4>
              <p class="text-[10px] text-slate-500">Peak recorded on: ${new Date(peakDate).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</p>
            </div>
          </div>
          <div class="text-right">
            <div class="text-xs font-bold text-slate-300">Mean: <span class="text-teal-400 font-mono">${mean.toFixed(1)}</span></div>
            <div class="text-[10px] text-slate-500">Peak: <span class="text-indigo-400 font-mono font-bold">${peakVal.toFixed(1)}</span></div>
          </div>
          <div class="text-right">
            <div class="text-[10px] text-slate-500">Percentile of latest sample</div>
            <div class="text-xs font-bold text-slate-300"><span class="text-pink-400 font-mono">${currentPercentile === null ? 'N/A' : `${currentPercentile.toFixed(1)}%`}</span></div>
          </div>
        `;
        container.appendChild(card);
      });
    }

    // Render Metrics Row Values dynamically based on calculated states
    export function renderSummaryMetricsRow() {
      if (state.rawSamples.length === 0) return;

      // Extract raw points chronologically
      const allPointsSorted = [];
      Object.keys(state.processedData).forEach(yr => {
        state.processedData[yr].forEach(pt => {
          allPointsSorted.push(pt);
        });
      });
      allPointsSorted.sort((a, b) => new Date(a.originalDate) - new Date(b.originalDate));

      if (allPointsSorted.length === 0) return;

      // Current/Latest Sample Statistics
      const latestItem = allPointsSorted[allPointsSorted.length - 1];
      const previousItem = allPointsSorted.length > 1 ? allPointsSorted[allPointsSorted.length - 2] : null;
      
      document.getElementById('metricLatestVal').innerText = latestItem.y.toFixed(2);
      document.getElementById('metricLatestDate').innerText = new Date(latestItem.originalDate).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});

      const changeElem = document.getElementById('metricLatestChange');
      if (previousItem) {
        const deltaPct = ((latestItem.y - previousItem.y) / previousItem.y) * 100;
        const sign = deltaPct >= 0 ? '+' : '';
        changeElem.innerText = `${sign}${deltaPct.toFixed(1)}%`;
        changeElem.className = `text-xs font-semibold ${deltaPct >= 0 ? 'text-rose-400' : 'text-emerald-400'}`;
      } else {
        changeElem.innerText = '';
      }

      // Peak Sample statistics
      let globalPeakVal = 0;
      let globalPeakDate = '';
      allPointsSorted.forEach(pt => {
        if (pt.y > globalPeakVal) {
          globalPeakVal = pt.y;
          globalPeakDate = pt.originalDate;
        }
      });
      document.getElementById('metricPeakVal').innerText = globalPeakVal.toFixed(2);
      document.getElementById('metricPeakDate').innerText = new Date(globalPeakDate).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
      document.getElementById('metricPeakYear').innerText = new Date(globalPeakDate).getFullYear();

      // Overall Mean statistics
      const totalSum = allPointsSorted.reduce((sum, pt) => sum + pt.y, 0);
      const overallMean = totalSum / allPointsSorted.length;
      document.getElementById('metricMeanVal').innerText = overallMean.toFixed(2);
      document.getElementById('metricMeanDesc').innerText = `Across ${allPointsSorted.length} samples`;

      // Dataset Span statistics
      const firstDate = new Date(allPointsSorted[0].originalDate);
      const lastDate = new Date(allPointsSorted[allPointsSorted.length - 1].originalDate);
      const totalYears = lastDate.getFullYear() - firstDate.getFullYear() + 1;
      
      document.getElementById('metricSpanYears').innerText = `${totalYears} Years`;
      document.getElementById('metricSamplesCount').innerText = `${allPointsSorted.length} samples from ${firstDate.getFullYear()} - ${lastDate.getFullYear()}`;
    }

    // Export chart layout into clean PNG image
    export function downloadChart() {
      if (!state.chartInstance) return;
      const link = document.createElement('a');
      link.download = `wastewater_yoy_comparison_${new Date().toISOString().split('T')[0]}.png`;
      link.href = state.chartInstance.toBase64Image();
      link.click();
    }

    // Theme Switcher support for light / dark dashboards
    export function toggleTheme() {
      const html = document.documentElement;
      const isDark = html.classList.contains('dark');
      const sunIcon = document.getElementById('themeSun');
      const moonIcon = document.getElementById('themeMoon');

      if (isDark) {
        html.classList.remove('dark');
        html.classList.add('light');
        document.body.classList.remove('bg-slate-900', 'text-slate-100');
        document.body.classList.add('bg-slate-50', 'text-slate-800');
        sunIcon.classList.remove('hidden');
        moonIcon.classList.add('hidden');
      } else {
        html.classList.remove('light');
        html.classList.add('dark');
        document.body.classList.remove('bg-slate-50', 'text-slate-800');
        document.body.classList.add('bg-slate-900', 'text-slate-100');
        sunIcon.classList.add('hidden');
        moonIcon.classList.remove('hidden');
      }

      // Re-initialize graph to adapt colors and borders to new theme
      if (state.chartInstance) {
        initYoYChart();
      }
    }

    // Open Config Modal view
    export function toggleSetupModal() {
      const modal = document.getElementById('setupModal');
      if (modal) {
        modal.classList.toggle('hidden');
      }
    }

    // Handle Drag-and-drop file operations
    export function handleFileDrop(e) {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        parseUploadedJsonFile(files[0]);
      }
    }

    export function handleFileSelect(e) {
      const files = e.target.files;
      if (files.length > 0) {
        parseUploadedJsonFile(files[0]);
      }
    }

    // Parse manual JSON uploads containing original samples structure
    export function parseUploadedJsonFile(file) {
      const reader = new FileReader();
      reader.onload = function(evt) {
        try {
          const uploadedObj = JSON.parse(evt.target.result);
          if (uploadedObj && uploadedObj.samples) {
            state.rawSamples = uploadedObj.samples;
            processAndDisplayData(); 
            toggleSetupModal();
            showStatusBanner("Loaded authentic JSON file successfully.", "success");
          } else {
            alert("Uploaded JSON does not contain the required 'samples' list layout.");
          }
        } catch (err) {
          alert("Error parsing file structure as standard JSON.");
        }
      };
      reader.readAsText(file);
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

    // Apply specific URL targets & attempt fetch connection
    export function applyUrlAndFetch() {
      const inputVal = document.getElementById('gcsUrlInput').value.trim();
      loadRawData(true, inputVal);
      toggleSetupModal();
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
      'toggle-setup-modal': () => toggleSetupModal(),
      'plant-clear': () => clearPlantSearch(),
      'chart-reset': () => resetChartZoom(),
      'years-all': el => toggleAllYears(el.dataset.visible === 'true'),
      'toggle-panel': el => togglePanel(el.dataset.target, el.dataset.icon),
      'download-csv': () => downloadCSV(),
      'download-chart': () => downloadChart(),
      'table-sort': () => sortTableByDate(),
      'table-page': el => changePage(Number(el.dataset.delta)),
      'apply-url': () => applyUrlAndFetch(),
    };

    const INPUT_ACTIONS = {
      'plant-query': el => handlePlantQueryChange(el.value),
      'table-search': el => handleSearch(el.value),
    };

    const CHANGE_ACTIONS = {
      'scale': el => updateYScale(el.value),
      'smoothing': el => updateSmoothing(el.value),
      'file-select': el => handleFileSelect({ target: el }),
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

      document.addEventListener('dragover', (e) => {
        if (e.target.closest('[data-action="drop-zone"]')) e.preventDefault();
      });

      document.addEventListener('drop', (e) => {
        if (e.target.closest('[data-action="drop-zone"]')) handleFileDrop(e);
      });
    }
