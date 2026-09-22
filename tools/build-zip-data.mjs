// Builds data/zip-lookup.json from the GeoNames US.txt shipped in the
// zipcodes-us npm tarball. Run once; the output is committed.
//
//   curl -sL https://registry.npmjs.org/zipcodes-us/-/zipcodes-us-1.1.3.tgz -o /tmp/zip.tgz
//   tar xzOf /tmp/zip.tgz package/data/US.txt > /tmp/US.txt
//   node tools/build-zip-data.mjs /tmp/US.txt data/zip-lookup.json
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// GeoNames US.txt columns: [1] zip, [4] state code, [5] county, [9] lat, [10] lng.
// First occurrence wins; rows without finite coordinates are dropped.
export function parseGeoNamesTsv(text) {
  const map = new Map();
  let duplicates = 0;
  let total = 0;

  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    const columns = line.split('\t');
    if (columns.length < 11) continue;

    total++;
    const zip = columns[1];
    const stateCode = columns[4];
    const county = columns[5];
    const lat = Number(columns[9]);
    const lng = Number(columns[10]);

    if (!zip || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (map.has(zip)) {
      duplicates++;
      continue;
    }
    map.set(zip, [lat, lng, stateCode, county]);
  }

  return { map, duplicates, total };
}

function main([inputPath, outputPath]) {
  if (!inputPath || !outputPath) {
    console.error('usage: node tools/build-zip-data.mjs <US.txt> <out.json>');
    process.exit(1);
  }

  const { map, duplicates, total } = parseGeoNamesTsv(readFileSync(inputPath, 'utf8'));
  const payload = {
    source: 'zipcodes-us@1.1.3 / GeoNames US.txt',
    generated_at: new Date().toISOString(),
    zips: Object.fromEntries(map),
  };
  writeFileSync(outputPath, JSON.stringify(payload));
  console.log(`Wrote ${outputPath}: ${map.size} zips (${duplicates} duplicate rows skipped of ${total})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
