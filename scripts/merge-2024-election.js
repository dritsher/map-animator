#!/usr/bin/env node
/**
 * merge-2024-election.js
 *
 * Downloads 2024 US presidential election results by county and merges them
 * into server/data/region-data.json, adding:
 *   - counties: election_2024_rep, election_2024_dem, election_2024_winner
 *   - states:   election_2024_rep_pct, election_2024_winner
 *
 * Data source: MIT Election Data + Science Lab
 *   https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/VOQCHQ
 *
 * Usage:
 *   node scripts/merge-2024-election.js [--csv path/to/local.csv]
 *
 * If --csv is provided, skips the download and reads from the local file.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REGION_DATA_PATH = path.join(__dirname, '../server/data/region-data.json');

// 2024 county presidential results (CSV, via tonmcg/US_County_Level_Election_Results_08-24)
// Columns: state_name, county_fips, county_name, votes_gop, votes_dem, total_votes, ...
const DOWNLOAD_URL =
  'https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/master/2024_US_County_Level_Presidential_Results.csv';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function download(url) {
  return new Promise((resolve, reject) => {
    let data = '';
    const req = https.get(url, { headers: { 'User-Agent': 'merge-2024-election/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Download timed out')); });
  });
}

function parseTsv(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split('\t').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const cols = line.split('\t').map(c => c.trim().replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ''; });
    return row;
  });
}

function parseCsv(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ''; });
    return row;
  });
}

function padFips(fips) {
  // Ensure 5-digit county FIPS (some sources omit leading zeros)
  return String(fips).padStart(5, '0');
}

function stateFipsFromCounty(fips5) {
  return fips5.slice(0, 2);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const csvArg = process.argv.indexOf('--csv');
  let rawText;

  if (csvArg !== -1 && process.argv[csvArg + 1]) {
    const csvPath = process.argv[csvArg + 1];
    console.log(`Reading local file: ${csvPath}`);
    rawText = fs.readFileSync(csvPath, 'utf8');
  } else {
    console.log('Downloading 2024 county election data from Harvard Dataverse…');
    try {
      rawText = await download(DOWNLOAD_URL);
      console.log(`Downloaded ${rawText.length} bytes`);
    } catch (err) {
      console.error('Download failed:', err.message);
      console.error('');
      console.error('Please download the file manually:');
      console.error('  1. Go to: https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/VOQCHQ');
      console.error('  2. Download the tab-separated (.tab) file for 2024');
      console.error('  3. Re-run: node scripts/merge-2024-election.js --csv /path/to/file.tab');
      process.exit(1);
    }
  }

  // Detect delimiter (tab or comma)
  const delimiter = rawText.indexOf('\t') !== -1 ? '\t' : ',';
  const rows = delimiter === '\t' ? parseTsv(rawText) : parseCsv(rawText);

  // Detect column names (vary between data sources)
  const sample = rows[0] || {};
  console.log('Columns detected:', Object.keys(sample).join(', '));

  const fipsCol = Object.keys(sample).find(k => /county_fips/i.test(k));
  if (!fipsCol) {
    console.error('Could not find county_fips column. Detected:', Object.keys(sample).join(', '));
    process.exit(1);
  }

  // Support two column layouts:
  //   Layout A (pre-aggregated): votes_gop, votes_dem  (one row per county)
  //   Layout B (long-form MIT):  party, candidatevotes  (one row per candidate)
  const gopCol  = Object.keys(sample).find(k => /^votes_gop$/i.test(k));
  const demCol  = Object.keys(sample).find(k => /^votes_dem$/i.test(k));
  const partyCol = Object.keys(sample).find(k => /^party$/i.test(k));
  const votesCol = Object.keys(sample).find(k => /^candidatevotes$/i.test(k));
  const yearCol  = Object.keys(sample).find(k => /^year$/i.test(k));

  const byFips = {}; // fips5 -> { rep, dem }

  if (gopCol && demCol) {
    // Layout A: one row per county, pre-aggregated
    for (const row of rows) {
      const fips = padFips(row[fipsCol]);
      if (!fips || fips === '00000') continue;
      byFips[fips] = {
        rep: parseInt(row[gopCol], 10) || 0,
        dem: parseInt(row[demCol], 10) || 0,
      };
    }
  } else if (partyCol && votesCol) {
    // Layout B: long-form, one row per candidate
    for (const row of rows) {
      if (yearCol && row[yearCol] !== '2024') continue;
      const fips = padFips(row[fipsCol]);
      if (!fips || fips === '00000') continue;
      const party = (row[partyCol] || '').toUpperCase();
      const votes = parseInt(row[votesCol], 10) || 0;
      if (!byFips[fips]) byFips[fips] = { rep: 0, dem: 0 };
      if (party === 'REPUBLICAN') byFips[fips].rep += votes;
      else if (party === 'DEMOCRAT') byFips[fips].dem += votes;
    }
  } else {
    console.error('Could not identify vote columns. Expected votes_gop/votes_dem or party/candidatevotes.');
    console.error('Detected columns:', Object.keys(sample).join(', '));
    process.exit(1);
  }

  const matchedFips = Object.keys(byFips);
  console.log(`Parsed results for ${matchedFips.length} counties`);

  if (matchedFips.length === 0) {
    console.error('No county results found — check that the file contains 2024 data and uses the expected column names.');
    process.exit(1);
  }

  // Load region data
  const regionData = JSON.parse(fs.readFileSync(REGION_DATA_PATH, 'utf8'));
  const counties = regionData.counties;
  const states   = regionData.states;

  // Merge county data
  let countyMatched = 0, countyMissing = 0;
  for (const [fips5, { rep, dem }] of Object.entries(byFips)) {
    const county = counties[fips5];
    if (!county) { countyMissing++; continue; }
    county.election_2024_rep = rep;
    county.election_2024_dem = dem;
    county.election_2024_winner = rep > dem ? 'Republican' : 'Democrat';
    countyMatched++;
  }

  console.log(`Counties updated: ${countyMatched}, unmatched FIPS: ${countyMissing}`);

  // Roll up state totals from county data
  const stateRollup = {}; // state_fips -> { rep, dem }
  for (const [fips5, county] of Object.entries(counties)) {
    if (county.election_2024_rep == null) continue;
    const sf = stateFipsFromCounty(fips5);
    if (!stateRollup[sf]) stateRollup[sf] = { rep: 0, dem: 0 };
    stateRollup[sf].rep += county.election_2024_rep;
    stateRollup[sf].dem += county.election_2024_dem;
  }

  let stateMatched = 0;
  for (const [sf, { rep, dem }] of Object.entries(stateRollup)) {
    const state = states[sf];
    if (!state) continue;
    const total = rep + dem;
    state.election_2024_rep_pct = total > 0 ? Math.round((rep / total) * 1000) / 10 : null;
    state.election_2024_winner  = rep > dem ? 'Republican' : 'Democrat';
    stateMatched++;
  }

  console.log(`States updated: ${stateMatched}`);

  // Write back
  fs.writeFileSync(REGION_DATA_PATH, JSON.stringify(regionData, null, 2));
  console.log(`✓ Written to ${REGION_DATA_PATH}`);

  // Summary
  const repCounties = Object.values(counties).filter(c => c.election_2024_winner === 'Republican').length;
  const demCounties = Object.values(counties).filter(c => c.election_2024_winner === 'Democrat').length;
  const repStates   = Object.values(states).filter(s => s.election_2024_winner === 'Republican').length;
  const demStates   = Object.values(states).filter(s => s.election_2024_winner === 'Democrat').length;
  console.log(`\nResult check:`);
  console.log(`  Counties — Republican: ${repCounties}, Democrat: ${demCounties}`);
  console.log(`  States   — Republican: ${repStates}, Democrat: ${demStates}`);
}

main().catch(err => { console.error(err); process.exit(1); });
