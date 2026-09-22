# COVID Wastewater YoY

Interactive year-over-year wastewater analytics for SARS-CoV-2 levels normalized by PMMoV.

## Repository layout

Served statically with no build step (GitHub Pages publishes the repo root).

| Path | Purpose |
|---|---|
| `index.html` | Markup only; controls carry `data-action` attributes |
| `css/app.css` | Styles moved out of the old inline `<style>` block |
| `js/main.js` | Entry point: URL state, event delegation, initial loads |
| `js/state.js` | Mutable state, `setSeries()`, `sortedSamples()`, URL sync |
| `js/util.js` | DOM-free date/number/escaping helpers |
| `js/stats.js` | DOM-free parsing, day-of-year bucketing, smoothing, percentiles |
| `js/county.js` | PMC19 county card model (`buildCountyCard`) and renderer |
| `js/{data,chart,table,ui}.js` | Fetching, Chart.js, the table, and DOM rendering |
| `tools/build-zip-data.mjs` | Regenerates `data/zip-lookup.json` from GeoNames `US.txt` |
| `fetch-pmc.sh` | Slims the PMC19 feed into `data/pmc-counties.json` |
| `fetch-plants.sh` | Slims the GCS plant catalog into `data/plants.json` |

The two `fetch-*.sh` scripts run daily from `.github/workflows/update-data.yml`.
Both upstream feeds are much larger than the app needs (11.6 MB of plant
polygons, 12.6 MB of PMC19 hover markup), so only the fields the UI renders
or matches on are committed and served.

## Development

```bash
python3 -m http.server 8765      # module scripts and fetch() need HTTP, not file://
node --test test/*.test.mjs      # unit tests (node:test only, no dependencies)
./fetch-pmc.sh                   # refresh data/pmc-counties.json from pmc19.com
./fetch-plants.sh                # refresh data/plants.json from the GCS catalog
```

Sample dates are parsed and bucketed in UTC arithmetic, so the rendered
calendar day does not depend on the viewer's timezone. Percentiles are
computed over every loaded sample of the current plant selection.

When more than one plant is selected the chart collapses each date's samples
to a single daily mean before smoothing, so a plotted point is a day rather
than one plant's reading and the smoothing window counts days. The Data Table
Explorer and the CSV export still list every individual sample.

## Data Attribution and License

This is an independent site using data from [WastewaterSCAN / SCAN](https://data.wastewaterscan.org/about/#18) and county-level COVID estimates from the [Pandemic Mitigation Collaborative](https://pmc19.com/).

The original site code and documentation are available under the [MIT License](LICENSE). The MIT License applies only to this repository's original software and documentation; it does not license PMC19, WastewaterSCAN / SCAN, or any other third-party data or content. Those materials remain subject to their respective terms below.

### WastewaterSCAN / SCAN

WastewaterSCAN / SCAN data is licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). When used in any format, the required attribution is:

> These data were collected as part of the WastewaterSCAN / SCAN project, a partnership between Stanford University, Emory University, and Verily funded philanthropically through a gift to Stanford University.

The required publication citation is:

> A. B. Boehm, M. K. Wolfe, A. L. Bidwell, A. Zulli, B. J. White, B. Shelden, D. Duong. *Pathogen nucleic acids data in wastewater solids from 147 treatment plants in the United States: 2024-2025*. Data in Brief, 2026. [Paper](https://www.sciencedirect.com/science/article/pii/S2352340926000569).

The source data is experimental, provided as-is without warranty, and is not intended to diagnose or treat disease. Research or other use of the WastewaterSCAN / SCAN database should be directed to [wwscan_stanford_emory@lists.stanford.edu](mailto:wwscan_stanford_emory@lists.stanford.edu) or [Alexandria Boehm](mailto:aboehm@stanford.edu). Users should check the [WastewaterSCAN license page](https://data.wastewaterscan.org/about/#18) for updated attribution requirements.

WastewaterSCAN provides the wastewater treatment plant data. PMC19 provides the county-level COVID estimates shown in the PMC19 data widget.

### PMC19 Reuse Guidance

According to [PMC19's permission-to-reuse guidance](https://pmc19.com/), graphics and text from `pmc19.com/data` and Dr. Hoerger's social media accounts may be reused, modified, and improved without permission unless otherwise noted. PMC encourages broad sharing and feedback, including reuse by good-faith communicators promoting COVID caution.

PMC discourages monetizing data from its website on ethical grounds and because misuse of underlying public data, which may be provided strictly for non-profit academic purposes, could create legal liability. PMC may withdraw reuse privileges from actors who repeatedly misrepresent the work through minimizing or fear-mongering misinformation after being warned. Reusers should preserve accurate context and consult PMC19 directly for current terms.
