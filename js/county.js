// Source: index.html // [638-670] // [672-692]

import { state } from './state.js';

    export function updateCountyCovidSummary() {
      const summary = document.getElementById('countyCovidSummary');
      const countyFips = state.selectedZipCountyFips || state.currentPlantMetadata?.counties_served?.[0];
      if (!summary || !countyFips || state.countyCovidDataByFips.size === 0) {
        if (summary) summary.classList.add('hidden');
        return;
      }

      const countyData = state.countyCovidDataByFips.get(String(countyFips).padStart(5, '0'));
      if (!countyData || !countyData.hover || !state.countyCovidMetadata?.date_last_updated) {
        summary.classList.add('hidden');
        return;
      }

      const hoverHtml = String(countyData.hover || '');
      const estimateMatch = hoverHtml.match(/An estimated .*?are actively infectious with SARS-CoV-2\./i);
      const estimateText = estimateMatch ? estimateMatch[0].replace(/^An estimated\s+/i, '').replace(/SARS-CoV-2\./i, 'COVID').replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';

      if (!estimateText) {
        summary.classList.add('hidden');
        return;
      }

      const countyLabel = countyData.place_label || `${countyData.county_name || 'Unknown'} County${countyData.state ? `, ${countyData.state}` : ''}`;
      const updatedDate = new Date(`${state.countyCovidMetadata.date_last_updated}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      const weekEnding = state.countyCovidMetadata.week_end
        ? new Date(`${state.countyCovidMetadata.week_end}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        : null;
      const contextText = `County: ${countyLabel} | Updated: ${updatedDate}${weekEnding ? ` | Week ending: ${weekEnding}` : ''}`;
      const zipLabel = state.selectedPmcZip ? `ZIP: ${state.selectedPmcZip}` : '';
      summary.innerHTML = `<div class="flex flex-nowrap items-center justify-between gap-3"><div class="min-w-0"><div class="flex items-center gap-2 whitespace-nowrap"><div class="text-[10px] font-bold uppercase tracking-wider text-slate-300">PMC19.com Data</div><a href="https://pmc19.com" target="_blank" rel="noopener noreferrer" class="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-teal-400 hover:text-teal-300 hover:underline">View source <span aria-hidden="true">↗</span></a><span class="text-[10px] font-mono text-slate-400">${zipLabel}</span></div><div class="text-[10px] text-slate-500">${contextText}</div></div></div><div class="text-center"><a href="https://pmc19.com" target="_blank" rel="noopener noreferrer" class="text-slate-200 hover:text-teal-300 underline decoration-teal-400/70 underline-offset-2">${estimateText}</a></div>`;
      summary.classList.remove('hidden');
    }

    export function resolveZipToCountyFips(zip) {
      const normalizedZip = zip.trim().slice(0, 5);
      state.selectedPmcZip = normalizedZip;
      const zipcodes = window.zipcodes;
      const zipInfo = zipcodes?.find?.(normalizedZip);

      if (!zipInfo?.isValid || !zipInfo.county || !zipInfo.stateCode) {
        state.selectedZipCountyFips = null;
        updateCountyCovidSummary();
        return;
      }

      const normalizeCounty = value => String(value).toLowerCase().replace(/\s+county$/i, '').trim();
      const targetCounty = normalizeCounty(zipInfo.county);
      const countyData = [...state.countyCovidDataByFips.values()].find(county =>
        county.state === zipInfo.stateCode && normalizeCounty(county.county_name) === targetCounty
      );

      state.selectedZipCountyFips = countyData?.fips || null;
      updateCountyCovidSummary();
    }
