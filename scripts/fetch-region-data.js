#!/usr/bin/env node
/**
 * Fetches and builds server/data/region-data.json
 *
 * Sources:
 *   - ACS 5-year estimates (Census Bureau API, free, no key required)
 *     population, median age, median household income by county + state
 *   - Presidential election results 2016 + 2020 by county (MIT MEDSL via GitHub)
 *
 * Run: node scripts/fetch-region-data.js
 */

const https   = require("https");
const fs      = require("fs");
const path    = require("path");
const { parse } = require("csv-parse/sync");

const OUT_DIR  = path.join(__dirname, "../server/data");
const OUT_FILE = path.join(OUT_DIR, "region-data.json");

// ── helpers ────────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "map-animator-data-fetch" } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location).then(resolve, reject);
      }
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        else resolve(body);
      });
    }).on("error", reject);
  });
}

function fips5(stFips, coFips) {
  return String(stFips).padStart(2, "0") + String(coFips).padStart(3, "0");
}

// ── State FIPS → name ──────────────────────────────────────────────────────

const STATE_FIPS = {
  "01":"Alabama","02":"Alaska","04":"Arizona","05":"Arkansas","06":"California",
  "08":"Colorado","09":"Connecticut","10":"Delaware","11":"Washington D.C.",
  "12":"Florida","13":"Georgia","15":"Hawaii","16":"Idaho","17":"Illinois",
  "18":"Indiana","19":"Iowa","20":"Kansas","21":"Kentucky","22":"Louisiana",
  "23":"Maine","24":"Maryland","25":"Massachusetts","26":"Michigan","27":"Minnesota",
  "28":"Mississippi","29":"Missouri","30":"Montana","31":"Nebraska","32":"Nevada",
  "33":"New Hampshire","34":"New Jersey","35":"New Mexico","36":"New York",
  "37":"North Carolina","38":"North Dakota","39":"Ohio","40":"Oklahoma",
  "41":"Oregon","42":"Pennsylvania","44":"Rhode Island","45":"South Carolina",
  "46":"South Dakota","47":"Tennessee","48":"Texas","49":"Utah","50":"Vermont",
  "51":"Virginia","53":"Washington","54":"West Virginia","55":"Wisconsin",
  "56":"Wyoming","72":"Puerto Rico",
};

// ── 1. ACS county data ──────────────────────────────────────────────────────

async function fetchACSCounties() {
  console.log("Fetching ACS county data…");
  // B01002_001E = median age, B19013_001E = median HH income, B01003_001E = population
  const url = "https://api.census.gov/data/2022/acs/acs5" +
    "?get=NAME,B01002_001E,B19013_001E,B01003_001E" +
    "&for=county:*&in=state:*";
  const raw = await get(url);
  const rows = JSON.parse(raw); // [header, ...data]
  const [header, ...data] = rows;
  const iName    = header.indexOf("NAME");
  const iAge     = header.indexOf("B01002_001E");
  const iIncome  = header.indexOf("B19013_001E");
  const iPop     = header.indexOf("B01003_001E");
  const iState   = header.indexOf("state");
  const iCounty  = header.indexOf("county");

  const out = {};
  for (const row of data) {
    const st = row[iState];
    const co = row[iCounty];
    const id = fips5(st, co);
    out[id] = {
      median_age:               parseFloat(row[iAge])    || null,
      median_household_income:  parseInt(row[iIncome])   || null,
      population:               parseInt(row[iPop])      || null,
    };
  }
  console.log(`  → ${Object.keys(out).length} counties`);
  return out;
}

async function fetchACSStates() {
  console.log("Fetching ACS state data…");
  const url = "https://api.census.gov/data/2022/acs/acs5" +
    "?get=NAME,B01002_001E,B19013_001E,B01003_001E" +
    "&for=state:*";
  const raw = await get(url);
  const [header, ...data] = JSON.parse(raw);
  const iAge    = header.indexOf("B01002_001E");
  const iIncome = header.indexOf("B19013_001E");
  const iPop    = header.indexOf("B01003_001E");
  const iState  = header.indexOf("state");

  const out = {};
  for (const row of data) {
    const st = String(row[iState]).padStart(2, "0");
    out[st] = {
      median_age:               parseFloat(row[iAge])    || null,
      median_household_income:  parseInt(row[iIncome])   || null,
      population:               parseInt(row[iPop])      || null,
    };
  }
  console.log(`  → ${Object.keys(out).length} states`);
  return out;
}

// ── 2. Election results ─────────────────────────────────────────────────────

async function fetchElectionResults() {
  console.log("Fetching election results…");
  const BASE = "https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-20/master/";

  const [csv16, csv20] = await Promise.all([
    get(BASE + "2016_US_County_Level_Presidential_Results.csv"),
    get(BASE + "2020_US_County_Level_Presidential_Results.csv"),
  ]);

  // 2016 columns: combined_fips, votes_gop, votes_dem
  const rows16 = parse(csv16, { columns: true, skip_empty_lines: true });
  // 2020 columns: county_fips, votes_gop, votes_dem
  const rows20 = parse(csv20, { columns: true, skip_empty_lines: true });

  const byFips = {}; // fips5 → { rep16, dem16, rep20, dem20 }

  for (const row of rows16) {
    const id = String(row.combined_fips || "").padStart(5, "0");
    if (id.length !== 5 || id === "00000") continue;
    if (!byFips[id]) byFips[id] = {};
    byFips[id].rep16 = parseInt(row.votes_gop) || 0;
    byFips[id].dem16 = parseInt(row.votes_dem) || 0;
  }
  for (const row of rows20) {
    const id = String(row.county_fips || "").padStart(5, "0");
    if (id.length !== 5 || id === "00000") continue;
    if (!byFips[id]) byFips[id] = {};
    byFips[id].rep20 = parseInt(row.votes_gop) || 0;
    byFips[id].dem20 = parseInt(row.votes_dem) || 0;
  }

  const counties = {};
  const stateAgg = {};
  for (const [id, v] of Object.entries(byFips)) {
    const fips2 = id.slice(0, 2);
    const rep16 = v.rep16 || 0, dem16 = v.dem16 || 0;
    const rep20 = v.rep20 || 0, dem20 = v.dem20 || 0;
    counties[id] = {
      election_2016_rep: rep16, election_2016_dem: dem16,
      election_2016_winner: rep16 > dem16 ? "Republican" : "Democrat",
      election_2020_rep: rep20, election_2020_dem: dem20,
      election_2020_winner: rep20 > dem20 ? "Republican" : "Democrat",
    };
    if (!stateAgg[fips2]) stateAgg[fips2] = { rep16:0, dem16:0, rep20:0, dem20:0 };
    stateAgg[fips2].rep16 += rep16; stateAgg[fips2].dem16 += dem16;
    stateAgg[fips2].rep20 += rep20; stateAgg[fips2].dem20 += dem20;
  }

  const states = {};
  for (const [fips2, agg] of Object.entries(stateAgg)) {
    states[fips2] = {
      election_2016_winner:  agg.rep16 > agg.dem16 ? "Republican" : "Democrat",
      election_2016_rep_pct: +(agg.rep16 / (agg.rep16 + agg.dem16) * 100).toFixed(1),
      election_2020_winner:  agg.rep20 > agg.dem20 ? "Republican" : "Democrat",
      election_2020_rep_pct: +(agg.rep20 / (agg.rep20 + agg.dem20) * 100).toFixed(1),
    };
  }

  console.log(`  → ${Object.keys(counties).length} counties, ${Object.keys(states).length} states`);
  return { counties, states };
}

// ── 3. Build county FIPS → display name map ────────────────────────────────

function buildNameMap() {
  // Read counties.geojson to map FIPS → "Name LSAD, State"
  const geoPath = path.join(__dirname, "../public/data/counties.geojson");
  if (!fs.existsSync(geoPath)) { console.warn("  ! counties.geojson not found, skipping name map"); return {}; }
  const geo = JSON.parse(fs.readFileSync(geoPath, "utf8"));
  const map = {};
  for (const f of geo.features) {
    const id = String(f.id ?? "").padStart(5, "0");
    const fips2 = id.slice(0, 2);
    const name = f.properties?.NAME || "";
    const lsad = f.properties?.LSAD || "County";
    const state = STATE_FIPS[fips2] || "";
    map[id] = state ? `${name} ${lsad}, ${state}` : name;
  }
  return map;
}

// ── main ────────────────────────────────────────────────────────────────────

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Install csv-parse if needed
  try { require.resolve("csv-parse/sync"); }
  catch {
    console.log("Installing csv-parse…");
    require("child_process").execSync("npm install csv-parse --no-save", { stdio: "inherit" });
  }

  const [acsCounties, acsStates, election] = await Promise.all([
    fetchACSCounties(),
    fetchACSStates(),
    fetchElectionResults(),
  ]);

  const nameMap = buildNameMap();

  // Merge into final structure
  const counties = {};
  const allFips = new Set([
    ...Object.keys(acsCounties),
    ...Object.keys(election.counties),
  ]);
  for (const id of allFips) {
    const fips2 = id.slice(0, 2);
    counties[id] = {
      display_name: nameMap[id] || id,
      state: STATE_FIPS[fips2] || null,
      state_fips: fips2,
      ...acsCounties[id],
      ...election.counties[id],
    };
  }

  const states = {};
  const allStateFips = new Set([
    ...Object.keys(acsStates),
    ...Object.keys(election.states),
  ]);
  for (const fips2 of allStateFips) {
    states[fips2] = {
      name: STATE_FIPS[fips2] || fips2,
      ...acsStates[fips2],
      ...election.states[fips2],
    };
  }

  const out = {
    built: new Date().toISOString(),
    fields: {
      county: ["state", "population", "median_age", "median_household_income",
               "election_2016_winner", "election_2016_rep", "election_2016_dem",
               "election_2020_winner", "election_2020_rep", "election_2020_dem"],
      state:  ["population", "median_age", "median_household_income",
               "election_2016_winner", "election_2016_rep_pct",
               "election_2020_winner", "election_2020_rep_pct"],
    },
    counties,
    states,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  const kb = Math.round(fs.statSync(OUT_FILE).size / 1024);
  console.log(`\n✓ Wrote ${OUT_FILE} (${kb} KB)`);
  console.log(`  Counties: ${Object.keys(counties).length}`);
  console.log(`  States:   ${Object.keys(states).length}`);
})().catch(e => { console.error(e); process.exit(1); });
