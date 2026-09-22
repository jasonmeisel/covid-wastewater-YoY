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

  // Both the prose and its parts: the prose is the accessible sentence, the parts
  // drive the display numerals so neither has to be re-parsed from the other.
  let prevalenceSentence = null;
  let prevalencePercent = null;
  let prevalenceOneIn = null;
  let prevalenceCapped = false;
  const percent = Number(row.prevalence_percent);
  const oneIn = Number(row.prevalence_one_in);
  if (Number.isFinite(percent) && Number.isFinite(oneIn)) {
    prevalencePercent = formatNumber(percent, 1);
    prevalenceOneIn = oneIn;
    prevalenceCapped = Boolean(row.prevalence_percent_capped);
    prevalenceSentence = prevalenceCapped
      ? `An estimated >${prevalencePercent}% of residents (at least 1 in ${oneIn} people) are actively infectious with COVID-19.`
      : `An estimated ≈${prevalencePercent}% of residents (≈1 in ${oneIn} people) are actively infectious with COVID-19.`;
  }

  const updatedDate = formatShortDate(metadata && metadata.date_last_updated);
  const weekEnding = metadata && metadata.week_end ? formatShortDate(metadata.week_end) : null;

  return {
    countyLabel,
    statusLabel,
    statusNote,
    prevalenceSentence,
    prevalencePercent,
    prevalenceOneIn,
    prevalenceCapped,
    // Shipped separately so the renderer lays them out as a meta row, rather than
    // unravelling one pipe-joined string back into its parts.
    updatedDate,
    weekEnding,
    sourceUrl: (metadata && metadata.source) || 'https://pmc19.com',
    isEstimated,
  };
}

// Renders the county card in an explicit error state rather than silently hiding it.
export function showCountyDataError(message) {
  state.countyDataError = message;
  const summary = document.getElementById('countyCovidSummary');
  if (!summary) return;
  summary.innerHTML = `
    <h2 class="uppercase-label text-slate-400">PMC19 county estimate</h2>
    <p class="mt-1.5 text-sm leading-relaxed text-rose-300">PMC19 county data unavailable — ${escapeHtml(message)}</p>
  `;
  summary.classList.remove('hidden');
}

function renderCountyCard(card, zip) {
  const summary = document.getElementById('countyCovidSummary');
  if (!summary) return;

  const chipClass = card.isEstimated
    ? 'bg-amber-500/20 text-amber-300'
    : 'bg-emerald-500/20 text-emerald-300';

  // PMC19 ships exactly one quantitative figure, so it gets the display numeral.
  // Explicit "≈"/">" so the glyph matches the prose rather than implying precision.
  const stats = card.prevalencePercent === null
    ? ''
    : `
      <dl class="mt-4 flex flex-wrap items-stretch gap-x-8 gap-y-4">
        <div class="min-w-0">
          <dt class="uppercase-label text-slate-500">Infectious now</dt>
          <dd class="mt-1.5 metric-value text-rose-300 tabular-nums">${card.prevalenceCapped ? '&gt;' : '≈'}${card.prevalencePercent}<span class="text-lg font-bold">%</span></dd>
        </div>
        <div class="min-w-0">
          <dt class="uppercase-label text-slate-500">Residents</dt>
          <dd class="mt-1.5 metric-value text-slate-100 tabular-nums">1<span class="text-lg font-bold text-slate-500"> in </span>${card.prevalenceOneIn}</dd>
        </div>
      </dl>
      <p class="mt-3 text-[11px] leading-relaxed text-slate-500 max-w-2xl">${escapeHtml(card.prevalenceSentence)}</p>
    `;

  const metaParts = [];
  if (zip) metaParts.push(`ZIP ${escapeHtml(zip)}`);
  metaParts.push(`Updated ${escapeHtml(card.updatedDate)}`);
  if (card.weekEnding) metaParts.push(`Week ending ${escapeHtml(card.weekEnding)}`);

  summary.innerHTML = `
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 class="uppercase-label text-slate-400">PMC19 county estimate</h2>
        <span class="px-1.5 py-0.5 rounded-sm uppercase-label ${chipClass}">${escapeHtml(card.statusLabel)}</span>
      </div>
      <a href="${escapeHtml(card.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="text-[11px] font-semibold text-teal-400 hover:text-teal-300 hover:underline">PMC19.com <span aria-hidden="true">↗</span></a>
    </div>
    <p class="mt-1.5 text-sm font-semibold text-slate-100">${escapeHtml(card.countyLabel)}</p>
    ${stats}
    <div class="mt-4 pt-3 border-t border-slate-800/90 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-500">
      ${metaParts.map(part => `<span>${part}</span>`).join('<span aria-hidden="true" class="text-slate-700">·</span>')}
      <span class="text-slate-400 basis-full md:basis-auto md:before:content-['·'] md:before:mr-2.5 md:before:text-slate-700">${escapeHtml(card.statusNote)}</span>
    </div>
  `;
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
    summary.innerHTML = `
      <h2 class="uppercase-label text-slate-400">PMC19 county estimate</h2>
      <p class="mt-1.5 text-sm leading-relaxed text-slate-400">No PMC19 estimate for the counties served by this plant.</p>
    `;
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
