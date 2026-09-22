// PMC19 county card: a pure model (buildCountyCard) plus its renderer.
import { formatShortDate, formatNumber, escapeHtml } from './util.js';
import { state } from './state.js';
import { loadZipLookup } from './data.js';

export const PROVENANCE = {
  OBSERVED_LABEL: 'Observed',
  ESTIMATED_LABEL: 'Estimated',
  ESTIMATED_NOTE: 'Estimated from nearby counties — no local wastewater surveillance.',
  ESTIMATED_DISTANCE: miles => `nearest observed county ≈${miles} miles away`,
};

// Builds the county card model. `null` when there is no row to describe.
// Every displayed sentence is composed from shipped numbers, never scraped from upstream markup.
export function buildCountyCard({ row, metadata, zip, countiesServed = [], countyCount = 1, countyIndex = 0 } = {}) {
  if (!row) return null;

  const isEstimated = row.data_status !== 'Observed';
  const statusLabel = isEstimated ? PROVENANCE.ESTIMATED_LABEL : PROVENANCE.OBSERVED_LABEL;

  let statusNote;
  if (isEstimated) {
    const parts = [PROVENANCE.ESTIMATED_NOTE];
    if (typeof row.nearest_observed_miles === 'number' && Number.isFinite(row.nearest_observed_miles)) {
      parts.push(PROVENANCE.ESTIMATED_DISTANCE(row.nearest_observed_miles));
    }
    statusNote = parts.join(' · ');
  } else {
    statusNote = String(row.data_line || '').trim();
  }

  let countyLabel = String(row.place_label || row.county_name || 'Unknown');
  if (countyCount > 1) {
    countyLabel += ` (county ${countyIndex + 1} of ${countyCount} served)`;
  }

  let prevalenceSentence = null;
  const percent = Number(row.prevalence_percent);
  const oneIn = Number(row.prevalence_one_in);
  if (Number.isFinite(percent) && Number.isFinite(oneIn)) {
    prevalenceSentence = row.prevalence_percent_capped
      ? `An estimated >${formatNumber(percent, 1)}% of residents (at least 1 in ${oneIn} people) are actively infectious with COVID-19.`
      : `An estimated ≈${formatNumber(percent, 1)}% of residents (≈1 in ${oneIn} people) are actively infectious with COVID-19.`;
  }

  const updatedDate = formatShortDate(metadata && metadata.date_last_updated);
  const weekEnding = metadata && metadata.week_end ? formatShortDate(metadata.week_end) : null;
  const contextText = `County: ${countyLabel} | Updated: ${updatedDate}${weekEnding ? ` | Week ending: ${weekEnding}` : ''}`;

  return {
    countyLabel,
    statusLabel,
    statusNote,
    prevalenceSentence,
    contextText,
    sourceUrl: (metadata && metadata.source) || 'https://pmc19.com',
    isEstimated,
  };
}

// Renders the county card in an explicit error state rather than silently hiding it.
export function showCountyDataError(message) {
  state.countyDataError = message;
  const summary = document.getElementById('countyCovidSummary');
  if (!summary) return;
  summary.innerHTML = `<div class="text-[10px] font-bold uppercase tracking-wider text-slate-300">PMC19.com Data</div><div class="text-[10px] text-rose-300">PMC19.com county data unavailable — ${escapeHtml(message)}</div>`;
  summary.classList.remove('hidden');
}

function renderCountyCard(card, zip) {
  const summary = document.getElementById('countyCovidSummary');
  if (!summary) return;

  const zipLabel = zip ? `ZIP: ${escapeHtml(zip)}` : '';
  const chipClass = card.isEstimated
    ? 'bg-amber-500/20 text-amber-300'
    : 'bg-emerald-500/20 text-emerald-300';
  const estimate = card.prevalenceSentence
    ? `<a href="${escapeHtml(card.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="text-slate-200 hover:text-teal-300 underline decoration-teal-400/70 underline-offset-2">${escapeHtml(card.prevalenceSentence)}</a>`
    : 'No PMC19 estimate for the counties served by this plant.';

  summary.innerHTML = `<div class="flex flex-nowrap items-center justify-between gap-3"><div class="min-w-0"><div class="flex items-center gap-2 whitespace-nowrap"><div class="text-[10px] font-bold uppercase tracking-wider text-slate-300">PMC19.com Data</div><a href="${escapeHtml(card.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-teal-400 hover:text-teal-300 hover:underline">View source <span aria-hidden="true">↗</span></a><span class="text-[10px] font-mono text-slate-400">${zipLabel}</span></div><div class="text-[10px] text-slate-500">${escapeHtml(card.contextText)}</div><div class="flex items-center gap-2 mt-1"><span class="text-[10px] px-1.5 py-0.5 rounded-full ${chipClass}">${escapeHtml(card.statusLabel)}</span><span class="text-[10px] text-slate-400">${escapeHtml(card.statusNote)}</span></div></div></div><div class="text-center">${estimate}</div>`;
  summary.classList.remove('hidden');
}

export function updateCountyCovidSummary() {
  const summary = document.getElementById('countyCovidSummary');
  if (!summary) return;

  if (state.countyDataError) {
    showCountyDataError(state.countyDataError);
    return;
  }

  // Not loaded yet: leave the card out of the layout entirely.
  if (state.countyCovidDataByFips.size === 0) {
    summary.classList.add('hidden');
    return;
  }

  const servedFips = (state.currentPlantMetadata?.counties_served || [])
    .map(fips => String(fips).padStart(5, '0'))
    .filter(fips => state.countyCovidDataByFips.has(fips));

  const zipFips = state.selectedZipCountyFips ? String(state.selectedZipCountyFips).padStart(5, '0') : null;
  let countyFips = null;
  let countyIndex = 0;
  if (zipFips && state.countyCovidDataByFips.has(zipFips)) {
    countyFips = zipFips;
    countyIndex = Math.max(0, servedFips.indexOf(zipFips));
  } else if (servedFips.length > 0) {
    countyFips = servedFips[0];
  }

  const card = buildCountyCard({
    row: countyFips ? state.countyCovidDataByFips.get(countyFips) : null,
    metadata: state.countyCovidMetadata,
    zip: state.selectedPmcZip,
    countiesServed: servedFips,
    countyCount: Math.max(1, servedFips.length),
    countyIndex,
  });

  if (!card) {
    summary.innerHTML = `<div class="text-[10px] font-bold uppercase tracking-wider text-slate-300">PMC19.com Data</div><div class="text-[10px] text-slate-400">No PMC19 estimate for the counties served by this plant.</div>`;
    summary.classList.remove('hidden');
    return;
  }

  renderCountyCard(card, state.selectedPmcZip);
}

// GeoNames and PMC19 spell regions differently ("City and County of San Francisco"
// vs "San Francisco County"), so both sides are reduced to a bare place name.
const normalizeCounty = value => String(value)
  .toLowerCase()
  .replace(/^city and county of\s+/, '')
  .replace(/\s+(county|parish|borough|census area|municipality)$/, '')
  .trim();

export async function resolveZipToCountyFips(zip) {
  const normalizedZip = zip.trim().slice(0, 5);
  state.selectedPmcZip = normalizedZip;

  let entry = null;
  try {
    entry = (await loadZipLookup()).get(normalizedZip);
  } catch (err) {
    state.selectedZipCountyFips = null;
    updateCountyCovidSummary();
    return;
  }

  const stateCode = entry && entry[2];
  const targetCounty = entry ? normalizeCounty(entry[3]) : null;
  const countyData = targetCounty
    ? [...state.countyCovidDataByFips.values()].find(county =>
        county.state === stateCode && normalizeCounty(county.county_name) === targetCounty)
    : null;

  state.selectedZipCountyFips = countyData?.fips || null;
  updateCountyCovidSummary();
}
