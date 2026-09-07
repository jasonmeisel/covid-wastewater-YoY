#!/usr/bin/env bash
set -euo pipefail

DEFAULT_URL="https://pmc19.com/maps/data/current.json"
DEFAULT_OUTPUT="pmc-current.json"

if [[ "${1:-}" =~ ^https?:// ]]; then
  URL="$1"
  OUTPUT="${2:-$DEFAULT_OUTPUT}"
else
  URL="$DEFAULT_URL"
  OUTPUT="${1:-$DEFAULT_OUTPUT}"
fi

if command -v curl >/dev/null 2>&1; then
  curl -fsSL -A "COVID-Wastewater-YoY/1.0" "$URL" -o "$OUTPUT"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$OUTPUT" --user-agent="COVID-Wastewater-YoY/1.0" "$URL"
else
  echo "Error: neither curl nor wget is installed in this environment." >&2
  exit 1
fi

echo "Saved PMC19 data to $OUTPUT"
