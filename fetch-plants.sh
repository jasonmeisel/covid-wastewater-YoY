#!/usr/bin/env bash
set -euo pipefail

DEFAULT_URL="https://storage.googleapis.com/wastewater-dev-data/json/plants.json"
OUTPUT="data/plants.json"

if [[ "${1:-}" =~ ^https?:// ]]; then URL="$1"; else URL="$DEFAULT_URL"; fi

RAW="$(mktemp)"; SLIM="$(mktemp)"
trap 'rm -f "$RAW" "$SLIM"' EXIT

mkdir -p "$(dirname "$OUTPUT")"
curl -fsSL -A "COVID-Wastewater-YoY/1.0" "$URL" -o "$RAW"

# The upstream file also carries polygon, liquids, flow_rate, allow_download,
# is_wwscan, id and uuid; nothing in the app reads them and they are 99% of the
# 11.6 MB. Only the fields the UI renders or matches on are kept.
jq -e '(.plants | type == "array") and (.plants | length > 100)' "$RAW" >/dev/null \
  || { echo "plants fetch: plants[] missing or implausibly small" >&2; exit 1; }
jq -e 'all(.plants[]; (.uid // "") | length > 0) and (([.plants[].uid] | unique | length) == (.plants | length))' "$RAW" >/dev/null \
  || { echo "plants fetch: plants[] has missing or duplicate uids" >&2; exit 1; }

# counties_served arrives as strings, nine of them space-padded (" 13047"),
# which the renderer's padStart(5,'0') does not undo; normalise here so the
# county card cannot silently drop a served county.
jq --arg src "$URL" '{
  source: $src, generated_at: (now | todate),
  plants: [ .plants[] | {
    uid, name, site_name, place_name, city, state, zipcode, country,
    sewershed_pop, point,
    counties_served: ((.counties_served // []) | map(tostring | gsub("^\\s+|\\s+$"; "")))
  } ] }' "$RAW" > "$SLIM"

# generated_at is the only field the script invents, so it must not be the only
# reason the file changes: a run that found the same catalog has to leave the
# file - and therefore the repo - untouched. Everything else is compared.
if [[ -f "$OUTPUT" ]] && [[ "$(jq -S 'del(.generated_at)' "$OUTPUT")" == "$(jq -S 'del(.generated_at)' "$SLIM")" ]]; then
  printf '%s is current; upstream catalog unchanged\n' "$OUTPUT"
  exit 0
fi

mv "$SLIM" "$OUTPUT"
printf 'Wrote %s (%s bytes, %s plants)\n' "$OUTPUT" "$(wc -c < "$OUTPUT")" "$(jq -r '.plants | length' "$OUTPUT")"
