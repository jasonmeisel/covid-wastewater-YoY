// Shared, DOM-free helpers: timezone-stable date formatting, escaping, number formatting.

// Parses the leading 'YYYY-MM-DD' of a date string into integer parts.
// Returns null for anything else, so callers can degrade instead of throwing.
export function parseDateParts(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

// Formats a date string in UTC so the rendered calendar day never shifts with the
// viewer's timezone. Returns '' for unparseable input.
export function formatDate(dateStr, options = {}) {
  const parts = parseDateParts(dateStr);
  if (!parts) return '';
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
    .toLocaleDateString(undefined, { timeZone: 'UTC', ...options });
}

export function formatShortDate(dateStr) {
  return formatDate(dateStr, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatLongDate(dateStr) {
  return formatDate(dateStr, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatMonthDay(dateStr) {
  return formatDate(dateStr, { month: 'short', day: 'numeric' });
}

export function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
  return Number(value).toFixed(digits);
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}
