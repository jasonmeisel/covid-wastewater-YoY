// Run in a western timezone so a local-time regression cannot hide.
process.env.TZ = 'America/Los_Angeles';

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDateParts, formatDate, formatShortDate, formatLongDate, formatMonthDay, formatNumber, escapeHtml } from '../js/util.js';

test('parseDateParts accepts leading ISO dates and rejects everything else', () => {
  assert.deepEqual(parseDateParts('2024-01-01'), { year: 2024, month: 1, day: 1 });
  assert.deepEqual(parseDateParts('2024-12-31T00:00:00Z'), { year: 2024, month: 12, day: 31 });
  assert.deepEqual(parseDateParts('  2026-09-16 '), { year: 2026, month: 9, day: 16 });

  assert.equal(parseDateParts('2024-13-01'), null); // month out of range
  assert.equal(parseDateParts('2024-00-10'), null);
  assert.equal(parseDateParts('2024-02-00'), null);
  assert.equal(parseDateParts('01/02/2024'), null);
  assert.equal(parseDateParts('not a date'), null);
  assert.equal(parseDateParts(''), null);
  assert.equal(parseDateParts(null), null);
  assert.equal(parseDateParts(20240101), null);
});

test('formatLongDate renders the calendar day regardless of timezone', () => {
  const formatted = formatLongDate('2024-01-01');
  assert.match(formatted, /Mon/);
  assert.match(formatted, /Jan 1, 2024/);
  assert.ok(!formatted.includes('2023'), 'must not slip back into the previous year');
});

test('formatShortDate and formatMonthDay use the same UTC-stable day', () => {
  assert.match(formatShortDate('2026-09-16'), /Sep 16, 2026/);
  assert.equal(formatMonthDay('2026-09-16'), formatMonthDay('2026-09-16'));
  assert.match(formatMonthDay('2026-09-16'), /Sep 16/);
  assert.ok(!formatMonthDay('2026-09-16').includes('15'));
});

test('formatDate returns an empty string for unparseable input instead of throwing', () => {
  assert.equal(formatDate('nope'), '');
  assert.equal(formatLongDate(''), '');
  assert.equal(formatShortDate(null), '');
});

test('escapeHtml neutralises markup and quotes', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml(`"'&`), '&quot;&#39;&amp;');
  assert.equal(escapeHtml("O'Brien & Sons"), 'O&#39;Brien &amp; Sons');
  assert.equal(escapeHtml(42), '42');
});

test('formatNumber degrades to N/A for missing values', () => {
  assert.equal(formatNumber(null), 'N/A');
  assert.equal(formatNumber(undefined), 'N/A');
  assert.equal(formatNumber(NaN), 'N/A');
  assert.equal(formatNumber(5, 1), '5.0');
  assert.equal(formatNumber('5.25', 2), '5.25');
});
