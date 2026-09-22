#!/usr/bin/env bash
set -euo pipefail

DEFAULT_URL="https://pmc19.com/maps/data/current.json"
OUTPUT="data/pmc-counties.json"

if [[ "${1:-}" =~ ^https?:// ]]; then URL="$1"; else URL="$DEFAULT_URL"; fi

RAW="$(mktemp)"; SLIM="$(mktemp)"
trap 'rm -f "$RAW" "$SLIM"' EXIT

mkdir -p "$(dirname "$OUTPUT")"
curl -fsSL -A "COVID-Wastewater-YoY/1.0" "$URL" -o "$RAW"

jq -e '(.rows | type == "array") and (.rows | length > 3000)' "$RAW" >/dev/null \
  || { echo "pmc fetch: rows[] missing or implausibly small" >&2; exit 1; }
jq -e '.date_last_updated and .week_end' "$RAW" >/dev/null \
  || { echo "pmc fetch: missing date_last_updated/week_end" >&2; exit 1; }
if [[ -f "$OUTPUT" ]] && [[ "$(jq -r .week_end "$RAW")" < "$(jq -r .week_end "$OUTPUT")" ]]; then
  echo "pmc fetch: upstream week_end went backwards; refusing to overwrite" >&2; exit 1
fi

jq --arg src "$URL" '{
  source: $src, generated_at, date_last_updated, week_end,
  rows: [ .rows[] | {
    fips, county_name, state, place_label, data_status, data_line, value,
    prevalence_percent, prevalence_one_in, prevalence_percent_capped,
    nearest_observed_miles: ( [ (.data_line // "") | try (capture("≈(?<mi>[0-9]+) miles").mi | tonumber) catch null ] | .[0] )
  } ] }' "$RAW" > "$SLIM"

# A run that found the same rows must leave the file - and therefore the repo -
# untouched, even if upstream re-generated its payload with a fresh
# generated_at. Everything else is compared.
if [[ -f "$OUTPUT" ]] && [[ "$(jq -S 'del(.generated_at)' "$OUTPUT")" == "$(jq -S 'del(.generated_at)' "$SLIM")" ]]; then
  printf '%s is current; upstream data unchanged\n' "$OUTPUT"
  exit 0
fi

mv "$SLIM" "$OUTPUT"
printf 'Wrote %s (%s bytes, week_end %s)\n' "$OUTPUT" "$(wc -c < "$OUTPUT")" "$(jq -r .week_end "$OUTPUT")"
