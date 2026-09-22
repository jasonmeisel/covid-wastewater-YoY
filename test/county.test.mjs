import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCountyCard, PROVENANCE } from '../js/county.js';

const metadata = { date_last_updated: '2026-09-18', week_end: '2026-09-12', source: 'https://pmc19.com/maps/data/current.json' };

test('an estimated county carries the distance note an observed county never gets', () => {
  const estimated = buildCountyCard({
    row: { data_status: 'Estimated', place_label: 'Tangipahoa Parish, LA', data_line: 'Estimated (from nearby counties; nearest observed county ≈614 miles away)', nearest_observed_miles: 614, prevalence_percent: 1.2, prevalence_one_in: 83 },
    metadata,
  });
  assert.equal(estimated.statusLabel, 'Estimated');
  assert.equal(estimated.isEstimated, true);
  assert.ok(estimated.statusNote.includes('614 miles away'), estimated.statusNote);
  assert.ok(estimated.statusNote.includes(PROVENANCE.ESTIMATED_NOTE));

  const observed = buildCountyCard({
    row: { data_status: 'Observed', place_label: 'Los Angeles County, CA', data_line: 'Observed (4 sites per county)', nearest_observed_miles: null, prevalence_percent: 3, prevalence_one_in: 33 },
    metadata,
  });
  assert.equal(observed.statusLabel, 'Observed');
  assert.equal(observed.isEstimated, false);
  assert.equal(observed.statusNote, 'Observed (4 sites per county)');
  assert.ok(!observed.statusNote.includes('miles away'));
});

test('estimated rows without a mileage still state that they are estimated', () => {
  const card = buildCountyCard({
    row: { data_status: 'Estimated', place_label: 'Nowhere, XX', data_line: 'Estimated (something)', nearest_observed_miles: null, prevalence_percent: 1, prevalence_one_in: 100 },
    metadata,
  });
  assert.equal(card.statusLabel, 'Estimated');
  assert.ok(card.statusNote.includes(PROVENANCE.ESTIMATED_NOTE));
  assert.ok(!card.statusNote.includes('miles away'));
});

test('the prevalence sentence is composed from numbers, capping when upstream caps', () => {
  const capped = buildCountyCard({
    row: { data_status: 'Estimated', place_label: 'X', prevalence_percent: 5, prevalence_one_in: 20, prevalence_percent_capped: true, data_line: 'Estimated (x)', nearest_observed_miles: 12 },
    metadata,
  });
  assert.ok(capped.prevalenceSentence.startsWith('An estimated >5.0% of residents (at least 1 in 20 people)'), capped.prevalenceSentence);
  assert.ok(capped.prevalenceSentence.endsWith('actively infectious with COVID-19.'));

  const uncapped = buildCountyCard({
    row: { data_status: 'Observed', place_label: 'Y', prevalence_percent: 3.04, prevalence_one_in: 33, prevalence_percent_capped: false, data_line: 'Observed (x)' },
    metadata,
  });
  assert.equal(uncapped.prevalenceSentence, 'An estimated ≈3.0% of residents (≈1 in 33 people) are actively infectious with COVID-19.');
});

test('rows without a usable estimate render no sentence rather than a scraped one', () => {
  const card = buildCountyCard({ row: { data_status: 'Observed', place_label: 'Z', data_line: 'Observed (x)' }, metadata });
  assert.equal(card.prevalenceSentence, null);
});

test('buildCountyCard returns null without a row', () => {
  assert.equal(buildCountyCard({ row: null }), null);
  assert.equal(buildCountyCard(), null);
});

test('multi-county plants annotate which county is shown', () => {
  const card = buildCountyCard({
    row: { data_status: 'Observed', place_label: 'Somewhere, CA', prevalence_percent: 1, prevalence_one_in: 100, data_line: 'Observed (x)' },
    metadata,
    countiesServed: ['a', 'b', 'c'],
    countyCount: 3,
    countyIndex: 1,
  });
  assert.ok(card.countyLabel.endsWith('(county 2 of 3 served)'), card.countyLabel);
  assert.ok(card.contextText.includes('(county 2 of 3 served)'));
  assert.ok(card.contextText.includes('Updated: Sep 18, 2026'));
  assert.ok(card.contextText.includes('Week ending: Sep 12, 2026'));
});
