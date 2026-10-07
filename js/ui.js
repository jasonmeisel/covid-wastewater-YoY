// Source: index.html // [799-805] // [807-825] // [827-833] // [835-936] // [938-978] // [980-1029] // [1031-1038] // [1797-1852] // [1886-1944] // [2077-2084] // [2086-2113] // [2115-2121] // [2123-2158] // [2160-2179] // [2181-2186] // [2205-2214]

import { formatShortDate, formatMonthDay, parseDateParts, escapeHtml } from './util.js';
import { state, syncStateToUrl, sortedSamples } from './state.js';
import { resolveZipToCountyFips, updateCountyCovidSummary } from './county.js';
import { pickYearColor, getLatestSampleValue, summarize, inclusivePercentile, sortedSeriesValues, getPercentileEmoji, identifyWaves } from './stats.js';
import { predictTrainedWaveEnd } from './wave-model.js';
import { fuzzyMatchPlant, isZipCodeQuery, getPlantCoordinates, getReferenceCoordsFromZip, haversineDistance, isPlantInactive, loadAndRenderPlantSamples } from './data.js';
import { resetChartZoom, toggleAllYears, toggleYearVisibility, updateYScale, updateSmoothing, updateChart, updateChartMode } from './chart.js';
import { downloadCSV, sortTableByDate, changePage, handleSearch } from './table.js';

    let multiFacilityMode = false;

    function toggleMultiFacilityMode() {
      multiFacilityMode = !multiFacilityMode;
      const button = document.getElementById('multiFacilityToggle');
      const label = document.getElementById('multiFacilityModeLabel');
      if (button) button.setAttribute('aria-pressed', String(multiFacilityMode));
      if (label) label.textContent = multiFacilityMode ? 'On' : 'Off';
    }

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

      if (multiFacilityMode) {
        const hint = document.createElement('div');
        hint.className = 'sticky top-0 z-10 p-2 text-[11px] text-teal-200 bg-slate-800 border-b border-slate-700';
        hint.textContent = 'Tap facilities to add or remove them from the combined selection.';
        container.appendChild(hint);
      }

      matches.slice(0, 30).forEach(plant => {
        const item = document.createElement('div');
        const isSelected = state.selectedPlantUids.includes(plant.uid);
        const isInactive = isPlantInactive(plant);
        const distance = distanceMap.get(plant);
        const distanceStr = distance !== undefined
          ? `${distance < 10 ? distance.toFixed(1) : Math.round(distance)} mi`
          : '';

        item.className = `px-3 py-2.5 text-xs cursor-pointer hover:bg-slate-800 transition flex items-center justify-between ${
          isSelected ? 'bg-teal-500/10 border-l-2 border-teal-400' : ''
        } ${isInactive ? 'bg-amber-500/5 border-l-2 border-amber-500/60' : ''}`;

        const popFormatted = plant.sewershed_pop ? Number(plant.sewershed_pop).toLocaleString() : 'N/A';
        const locationStr = [plant.city, plant.state].filter(Boolean).join(', ');
        const statusBadge = isInactive
          ? '<span class="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-sm">Inactive</span>'
          : (isSelected ? '<span class="text-[10px] bg-teal-500/20 text-teal-300 px-1.5 py-0.5 rounded-sm">Active</span>' : '');

        item.innerHTML = `
          <div class="flex flex-col gap-0.5">
            <div class="font-bold text-slate-100 flex items-center gap-1.5">
              <span>${escapeHtml(plant.name || plant.site_name || 'Facility')}</span>
              ${statusBadge}
            </div>
            <div class="text-[11px] text-slate-400">${escapeHtml(plant.site_name || '')} ${locationStr ? '• ' + escapeHtml(locationStr) : ''}</div>
          </div>
          <div class="text-right shrink-0 ml-2 flex flex-col items-end gap-0.5">
            <span class="text-[10px] font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded-sm">Pop: ${popFormatted}</span>
            ${distanceStr ? `<span class="text-[10px] font-mono text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded-sm">${distanceStr}</span>` : ''}
          </div>
        `;

        item.onclick = event => selectPlant(plant, event.shiftKey || multiFacilityMode);
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
      
      // Keep search results open on touch devices so multiple stations can be toggled in sequence.
      const keepResultsOpen = multiFacilityMode;
      if (!keepResultsOpen) {
        if (searchInput) searchInput.value = '';
        const clearBtn = document.getElementById('clearPlantSearchBtn');
        if (clearBtn) clearBtn.classList.add('hidden');

        const resultsContainer = document.getElementById('plantSearchResults');
        if (resultsContainer) resultsContainer.classList.add('hidden');
      } else if (searchInput) {
        renderPlantSearchResults(searchInput.value);
      }

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
        card.className = "px-3 py-2.5 flex items-center justify-between gap-3 border-l-2 border-slate-800 bg-slate-900/40";
        card.innerHTML = `
          <div class="flex items-center gap-3 min-w-0">
            <span class="w-1 h-9 rounded-full ${colorConf.bg} shrink-0"></span>
            <div class="min-w-0">
              <h4 class="font-bold text-slate-200 text-sm">${yr} Baseline</h4>
              <p class="text-[11px] text-slate-500">Peak recorded on: ${formatMonthDay(peak.date)}</p>
            </div>
          </div>
          <div class="text-right shrink-0">
            <div class="text-xs font-bold text-slate-300">Mean: <span class="text-teal-400 font-mono">${mean.toFixed(1)}</span></div>
            <div class="text-[11px] text-slate-500">Peak: <span class="text-indigo-400 font-mono font-bold">${peak.value.toFixed(1)}</span></div>
          </div>
          <div class="text-right shrink-0">
            <div class="text-[11px] text-slate-500">Percentile of latest</div>
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

      // "Used" not "plotted": with several plants a sample is folded into its day's
      // point before the chart draws it, so sample count and point count differ.
      let text = `Used ${plotted} of ${total} samples`;
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
        changeElem.className = `metric-delta ${deltaPct >= 0 ? 'text-rose-400' : 'text-emerald-400'}`;
      } else {
        changeElem.innerText = '';
      }

      // Peak statistics
      const overall = summarize(allPointsSorted);
      document.getElementById('metricPeakVal').innerText = overall.peak.value.toFixed(2);
      document.getElementById('metricPeakDate').innerText = formatShortDate(overall.peak.date);
      document.getElementById('metricPeakYear').innerText = parseDateParts(overall.peak.date)?.year ?? 'N/A';

      // Current percentile: where the latest reading sits among the loaded samples.
      // Same source as the chart's percentile row, so the two can never disagree.
      const currentValue = latestItem.y;
      const currentPercentile = inclusivePercentile(currentValue, sortedSeriesValues());
      document.getElementById('metricPercentileVal').innerText = currentPercentile === null
        ? 'N/A'
        : `${currentPercentile.toFixed(1)}%`;
      document.getElementById('metricPercentileDesc').innerText =
        `of ${allPointsSorted.length} samples in this selection`;
      document.getElementById('metricPercentileEmoji').innerText = getPercentileEmoji(currentPercentile);

      renderWastewaterWavesCard(allPointsSorted);
    }

    function renderWaveHighlightOptions(selector) {
      if (state.chartMode === 'timeline') {
        selector.innerHTML = `<option value="">No highlight</option><option value="all" ${state.highlightAllWaves ? 'selected' : ''}>Highlight waves</option>`;
        return;
      }
      selector.innerHTML = '<option value="">Highlight wave…</option>' + state.detectedWaves.map((wave, index) =>
        `<option value="${index}" ${wave.startDate === state.highlightedWaveStartDate ? 'selected' : ''}>Wave ${index + 1}: ${formatShortDate(wave.startDate)} – ${wave.endDate ? formatShortDate(wave.endDate) : 'current'}</option>`
      ).join('');
    }

    function setHighlightedWave(value) {
      state.highlightAllWaves = state.chartMode === 'timeline' && value === 'all';
      const index = value === '' || value === 'all' ? -1 : Number(value);
      state.highlightedWave = Number.isInteger(index) && index >= 0 ? state.detectedWaves[index] || null : null;
      state.highlightedWaveStartDate = state.highlightedWave?.startDate || null;
      syncStateToUrl();
      updateChart();
    }

    function setChartMode(value) {
      if (value === 'timeline') {
        state.highlightedWave = null;
        state.highlightedWaveStartDate = null;
      } else {
        state.highlightAllWaves = false;
      }
      updateChartMode(value);
      const selector = document.getElementById('waveHighlightSelector');
      if (selector) renderWaveHighlightOptions(selector);
    }

    function renderWaveMetric(points, waves) {
      const title = document.getElementById('metricWaveTitle');
      const elapsed = document.getElementById('metricWaveElapsed');
      const phase = document.getElementById('metricWavePhase');
      const remaining = document.getElementById('metricWaveRemaining');
      const progress = document.getElementById('metricWaveProgress');
      const baselineRatio = document.getElementById('metricWaveBaselineRatio');
      remaining?.classList.remove('hidden');
      progress?.classList.remove('hidden');
      phase?.classList.remove('hidden');
      const activeWave = waves.at(-1)?.ongoing ? waves.at(-1) : null;
      const wave = activeWave || waves.at(-1);
      if (title) title.textContent = activeWave ? 'Current Wave' : 'Previous Wave';

      if (!wave) {
        if (elapsed) elapsed.textContent = '—';
        if (phase) phase.textContent = '';
        if (remaining) remaining.textContent = 'Estimated end unavailable';
        if (progress) progress.textContent = '—% through wave';
        if (baselineRatio) {
          baselineRatio.textContent = 'Latest baseline ratio: —';
          baselineRatio.classList.remove('text-rose-400', 'font-bold');
          baselineRatio.classList.add('text-slate-400');
        }
        return;
      }

      const latestDate = points.reduce((latest, point) =>
        String(point.originalDate).slice(0, 10) > latest ? String(point.originalDate).slice(0, 10) : latest, '');
      const waveEndDate = wave.endDate || latestDate;
      const startDay = Date.parse(`${wave.startDate}T00:00:00Z`);
      const latestDay = Date.parse(`${latestDate}T00:00:00Z`);
      const endDay = Date.parse(`${waveEndDate}T00:00:00Z`);
      if (activeWave) {
        const daysInto = Math.max(1, Math.floor((latestDay - startDay) / 86400000) + 1);
        if (elapsed) elapsed.textContent = `${daysInto} days in`;
        if (phase) {
          phase.textContent = '';
          phase.classList.add('hidden');
        }
      } else {
        const daysSince = Math.max(0, Math.floor((latestDay - endDay) / 86400000));
        if (elapsed) elapsed.textContent = `${daysSince} days since`;
        if (phase) {
          phase.textContent = `wave ended ${formatShortDate(waveEndDate)}`;
          phase.classList.remove('hidden');
        }
      }

      if (remaining) {
        if (!activeWave) {
          remaining.textContent = '';
          remaining.classList.add('hidden');
          if (progress) {
            progress.textContent = '';
            progress.classList.add('hidden');
          }
        } else if (wave.forecast) {
          const forecastMidpoint = (Date.parse(`${wave.forecast.earliestDate}T00:00:00Z`) +
            Date.parse(`${wave.forecast.latestDate}T00:00:00Z`)) / 2;
          const daysRemaining = Math.max(0, Math.round((forecastMidpoint - latestDay) / 86400000));
          const daysElapsed = Math.max(0, Math.floor((latestDay - startDay) / 86400000) + 1);
          const percentThrough = Math.round(100 * daysElapsed / (daysElapsed + daysRemaining));
          remaining.textContent = `~${daysRemaining} days to estimated end`;
          if (progress) progress.textContent = `~${percentThrough}% through wave`;
        } else {
          remaining.textContent = 'Estimate unavailable';
          if (progress) progress.textContent = '—% through wave';
        }
      }

      const waveIndex = waves.indexOf(wave);
      const precedingWave = waves.slice(0, waveIndex).reverse().find(candidate => candidate.endDate);
      const baselineStart = precedingWave?.endDate || '';
      const baselineValues = points.filter(point => {
        const date = String(point.originalDate || '').slice(0, 10);
        return date < wave.startDate && (!baselineStart || date >= baselineStart);
      }).map(point => Number(point.y)).filter(Number.isFinite).sort((a, b) => a - b);
      const middle = Math.floor(baselineValues.length / 2);
      const median = baselineValues.length
        ? baselineValues.length % 2 ? baselineValues[middle] : (baselineValues[middle - 1] + baselineValues[middle]) / 2
        : null;
      const latestPoint = [...points].reverse().find(point => String(point.originalDate).slice(0, 10) === latestDate);
      const ratio = median > 0 && latestPoint ? latestPoint.y / median : null;
      if (baselineRatio) {
        baselineRatio.textContent = ratio === null
          ? 'Latest is —× baseline'
          : `Latest is ${ratio.toFixed(1)}× baseline`;
        const elevated = ratio > 2;
        baselineRatio.classList.toggle('text-rose-400', elevated);
        baselineRatio.classList.toggle('font-bold', elevated);
        baselineRatio.classList.toggle('text-slate-400', !elevated);
      }
    }

    function renderWastewaterWavesCard(points) {
      const card = document.getElementById('wastewaterWavesCard');
      const content = document.getElementById('wastewaterWavesContent');
      const facility = document.getElementById('wastewaterWavesFacility');
      const forecastMessage = document.getElementById('wastewaterWaveForecast');
      if (!card || !content) return;
      card.classList.remove('hidden');
      if (forecastMessage) forecastMessage.classList.add('hidden');

      const waveSelector = document.getElementById('waveHighlightSelector');
      if (state.selectedPlantUids.length !== 1) {
        renderWaveMetric(points, []);
        state.detectedWaves = [];
        state.highlightedWave = null;
        state.highlightedWaveStartDate = null;
        if (forecastMessage) forecastMessage.textContent = '';
        if (waveSelector) renderWaveHighlightOptions(waveSelector);
        content.innerHTML = '<p class="text-xs text-slate-400">Wave summaries are shown for one facility at a time. Select a single facility to view its history.</p>';
        if (facility) facility.textContent = 'Multiple facilities selected';
        return;
      }

      const modelForecast = predictTrainedWaveEnd(points);
      const waves = identifyWaves(points).map(wave => ({
        ...wave,
        forecast: null,
        highlightEndDate: wave.endDate || points[points.length - 1]?.originalDate,
      }));
      const currentDetectedWave = waves.at(-1);
      if (modelForecast && currentDetectedWave?.ongoing) {
        currentDetectedWave.forecast = {
          earliestDate: modelForecast.earliestDate,
          latestDate: modelForecast.latestDate,
          remainingDays: modelForecast.remainingDays,
          method: modelForecast.method,
          modelPeakDate: modelForecast.activeWave.peakDate,
          cutoffDate: modelForecast.cutoffDate,
        };
      }
      state.detectedWaves = waves;
      renderWaveMetric(points, waves);
      const currentWave = waves[waves.length - 1];
      const currentWaveForecast = currentWave?.forecast;
      if (forecastMessage && currentWaveForecast) {
        forecastMessage.textContent = `The pooled ridge model estimates that the current wave will cross its end threshold around ${formatShortDate(currentWaveForecast.earliestDate)} (about ${Math.round(currentWaveForecast.remainingDays)} days after the latest sample). This estimate is shown from 14 days post-peak, before sustained decline is established, so it can be uncertain. No calibrated prediction interval is available.`;
        forecastMessage.classList.remove('hidden');
      } else if (forecastMessage && currentWave?.ongoing) {
        forecastMessage.textContent = 'A wave is still active, but the trained estimate is withheld until at least 14 days have passed since the detected peak.';
        forecastMessage.classList.remove('hidden');
      }
      state.highlightedWave = waves.find(wave => wave.startDate === state.highlightedWaveStartDate) || null;
      state.highlightedWaveStartDate = state.highlightedWave?.startDate || null;
      if (waveSelector) renderWaveHighlightOptions(waveSelector);
      const metadata = state.plantsCatalog.find(plant => plant.uid === state.selectedPlantUids[0]);
      if (facility) facility.textContent = metadata
        ? `${metadata.name || metadata.site_name} · ${points[0]?.originalDate?.slice(0, 4) || ''}–${points[points.length - 1]?.originalDate?.slice(0, 4) || ''}`
        : 'Selected facility';

      if (!waves.length) {
        content.innerHTML = '<p class="text-xs text-slate-400">Not enough distinct wastewater data to identify waves yet.</p>';
        return;
      }

      content.innerHTML = `
        <div class="overflow-x-auto">
          <table class="w-full min-w-[620px] text-left text-xs">
            <thead class="text-[10px] uppercase tracking-wide text-slate-500">
              <tr><th class="py-2 pr-3">Wave</th><th class="py-2 pr-3">Start – end</th><th class="py-2 pr-3">Length (days)</th><th class="py-2 pr-3">High</th><th class="py-2 pr-3">Baseline</th><th class="py-2">Peak date</th></tr>
            </thead>
            <tbody class="divide-y divide-slate-800">
              ${waves.map((wave, index) => {
                const endDate = wave.endDate || points.reduce((latest, point) =>
                  String(point.originalDate) > latest ? String(point.originalDate) : latest, '');
                const lengthDays = Math.floor((Date.parse(`${endDate.slice(0, 10)}T00:00:00Z`) -
                  Date.parse(`${wave.startDate}T00:00:00Z`)) / 86400000) + 1;
                return `
                <tr class="text-slate-300">
                  <th scope="row" class="py-2 pr-3 font-semibold text-slate-200">${index + 1}${wave.ongoing ? ' · current' : ''}</th>
                  <td class="py-2 pr-3 whitespace-nowrap">${formatShortDate(wave.startDate)} – ${wave.endDate ? formatShortDate(wave.endDate) : 'Ongoing'}</td>
                  <td class="py-2 pr-3 font-mono whitespace-nowrap">${lengthDays}${wave.ongoing ? '+' : ''}</td>
                  <td class="py-2 pr-3 font-mono text-rose-300">${wave.peak.toFixed(1)}</td>
                  <td class="py-2 pr-3 font-mono text-teal-300">${wave.baseline.toFixed(1)}</td>
                  <td class="py-2 whitespace-nowrap">${formatShortDate(wave.peakDate)}</td>
                </tr>
              `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
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
      // The glyph stays put; the chevron rotates so the control reads as a disclosure.
      icon.classList.toggle('rotate-180', isCollapsed);
    }

    // Delegated event bindings: markup carries data-action, this is the single wiring point.
    const CLICK_ACTIONS = {
      'retry-load': () => loadAndRenderPlantSamples(),
      'plant-clear': () => clearPlantSearch(),
      'toggle-multi-facility': () => toggleMultiFacilityMode(),
      'chart-reset': () => resetChartZoom(),
      'years-all': el => toggleAllYears(el.dataset.visible === 'true'),
      'toggle-panel': el => togglePanel(el.dataset.target, el.dataset.icon),
      'download-csv': () => downloadCSV(),
      'download-chart': () => downloadChart(),
      'table-sort': () => sortTableByDate(),
      'table-page': el => changePage(Number(el.dataset.delta)),
      'toggle-year': el => toggleYearVisibility(Number(el.dataset.year)),
    };

    const INPUT_ACTIONS = {
      'plant-query': el => handlePlantQueryChange(el.value),
      'table-search': el => handleSearch(el.value),
    };

    const CHANGE_ACTIONS = {
      'scale': el => updateYScale(el.value),
      'smoothing': el => updateSmoothing(el.value),
      'chart-mode': el => setChartMode(el.value),
      'wave-highlight': el => setHighlightedWave(el.value),
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

      // Enter/Space activate custom controls (the legend switches). Native controls are
      // skipped: the browser already turns those keys into a click event.
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const el = e.target.closest('[data-action]');
        if (!el) return;
        if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(el.tagName)) return;
        const action = CLICK_ACTIONS[el.dataset.action];
        if (!action) return;
        e.preventDefault();
        action(el);
      });
    }
