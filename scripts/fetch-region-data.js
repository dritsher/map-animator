#!/usr/bin/env node
/**
 * Fetches and builds server/data/region-data.json
 *
 * Sources:
 *   - ACS 5-year estimates (Census Bureau API, free, no key required)
 *     population, median age, median household income, poverty rate,
 *     unemployment rate, bachelor's degree attainment — county + state
 *   - Presidential election results 2016 + 2020 by county (MIT MEDSL via GitHub)
 *   - Presidential election results 2024 by county (MIT MEDSL / best available)
 *   - CDC PLACES 2024 (2022 model-based estimates) — county health outcomes
 *   - World Bank API (free, no key) — country population, GDP, life expectancy, CO₂
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

// ── 1. ACS core: population, age, income ──────────────────────────────────

async function fetchACSCounties() {
  console.log("Fetching ACS county data (population, age, income)…");
  const url = "https://api.census.gov/data/2022/acs/acs5" +
    "?get=NAME,B01002_001E,B19013_001E,B01003_001E" +
    "&for=county:*&in=state:*";
  const raw = await get(url);
  const [header, ...data] = JSON.parse(raw);
  const iAge    = header.indexOf("B01002_001E");
  const iIncome = header.indexOf("B19013_001E");
  const iPop    = header.indexOf("B01003_001E");
  const iState  = header.indexOf("state");
  const iCounty = header.indexOf("county");

  const out = {};
  for (const row of data) {
    const id = fips5(row[iState], row[iCounty]);
    out[id] = {
      median_age:              parseFloat(row[iAge])   || null,
      median_household_income: parseInt(row[iIncome])  || null,
      population:              parseInt(row[iPop])     || null,
    };
  }
  console.log(`  → ${Object.keys(out).length} counties`);
  return out;
}

async function fetchACSStates() {
  console.log("Fetching ACS state data (population, age, income)…");
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
      median_age:              parseFloat(row[iAge])   || null,
      median_household_income: parseInt(row[iIncome])  || null,
      population:              parseInt(row[iPop])     || null,
    };
  }
  console.log(`  → ${Object.keys(out).length} states`);
  return out;
}

// ── 2. ACS extra: poverty, unemployment, education ────────────────────────

async function fetchACSExtra() {
  console.log("Fetching ACS extra fields (poverty, unemployment, education)…");
  const vars = [
    "B17001_002E", "B17001_001E",                               // poverty
    "B23025_005E", "B23025_003E",                               // unemployment
    "B15003_022E", "B15003_023E", "B15003_024E", "B15003_025E", // bachelor's+
    "B15003_001E",                                              // education universe
  ].join(",");

  function parseRows(rawJson) {
    const [header, ...data] = JSON.parse(rawJson);
    const idx = k => header.indexOf(k);
    const hasCounty = header.includes("county");
    const out = {};
    for (const row of data) {
      const stFips = String(row[idx("state")]).padStart(2, "0");
      const id = hasCounty
        ? stFips + String(row[idx("county")]).padStart(3, "0")
        : stFips;
      const povBelow = +row[idx("B17001_002E")] || 0;
      const povTotal = +row[idx("B17001_001E")] || 0;
      const unemp    = +row[idx("B23025_005E")] || 0;
      const lf       = +row[idx("B23025_003E")] || 0;
      const bach     = ["B15003_022E","B15003_023E","B15003_024E","B15003_025E"]
                       .reduce((s, k) => s + (+row[idx(k)] || 0), 0);
      const eduTotal = +row[idx("B15003_001E")] || 0;
      out[id] = {
        poverty_pct:      povTotal > 0 ? +(povBelow / povTotal * 100).toFixed(1) : null,
        unemployment_pct: lf > 0       ? +(unemp / lf * 100).toFixed(1)          : null,
        bachelors_pct:    eduTotal > 0  ? +(bach / eduTotal * 100).toFixed(1)     : null,
      };
    }
    return out;
  }

  const [rawCounty, rawState] = await Promise.all([
    get(`https://api.census.gov/data/2022/acs/acs5?get=${vars}&for=county:*&in=state:*`),
    get(`https://api.census.gov/data/2022/acs/acs5?get=${vars}&for=state:*`),
  ]);
  const counties = parseRows(rawCounty);
  const states   = parseRows(rawState);
  console.log(`  → ${Object.keys(counties).length} counties, ${Object.keys(states).length} states`);
  return { counties, states };
}

// ── 3. Election results 2016 + 2020 ───────────────────────────────────────

async function fetchElectionResults() {
  console.log("Fetching election results 2016 + 2020…");
  const BASE = "https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-20/master/";

  const [csv16, csv20] = await Promise.all([
    get(BASE + "2016_US_County_Level_Presidential_Results.csv"),
    get(BASE + "2020_US_County_Level_Presidential_Results.csv"),
  ]);

  const rows16 = parse(csv16, { columns: true, skip_empty_lines: true });
  const rows20 = parse(csv20, { columns: true, skip_empty_lines: true });

  const byFips = {};

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

// ── 4. Election results 2024 ───────────────────────────────────────────────

async function fetchElection2024() {
  console.log("Fetching election results 2024…");

  // Try sources in order — MIT MEDSL official, then community mirrors
  const SOURCES = [
    {
      url: "https://raw.githubusercontent.com/MEDSL/2024-elections-official/main/county/county-president.csv",
      fipsCol: "county_fips", repCol: "votes_gop", demCol: "votes_dem",
    },
    {
      url: "https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-20/master/2024_US_County_Level_Presidential_Results.csv",
      fipsCol: "county_fips", repCol: "votes_gop", demCol: "votes_dem",
    },
  ];

  let rows = null;
  let src = null;
  for (const s of SOURCES) {
    try {
      const csv = await get(s.url);
      rows = parse(csv, { columns: true, skip_empty_lines: true });
      src = s;
      console.log(`  → Source: ${s.url}`);
      break;
    } catch (e) {
      console.warn(`  ! Could not fetch ${s.url}: ${e.message}`);
    }
  }

  if (!rows) {
    console.warn("  ! No 2024 election data available — skipping");
    return { counties: {}, states: {} };
  }

  const byFips = {};
  for (const row of rows) {
    const id = String(row[src.fipsCol] || "").padStart(5, "0");
    if (id.length !== 5 || id === "00000") continue;
    byFips[id] = {
      rep24: parseInt(row[src.repCol]) || 0,
      dem24: parseInt(row[src.demCol]) || 0,
    };
  }

  const counties = {};
  const stateAgg = {};
  for (const [id, v] of Object.entries(byFips)) {
    const fips2 = id.slice(0, 2);
    counties[id] = {
      election_2024_rep:    v.rep24,
      election_2024_dem:    v.dem24,
      election_2024_winner: v.rep24 > v.dem24 ? "Republican" : "Democrat",
    };
    if (!stateAgg[fips2]) stateAgg[fips2] = { rep24: 0, dem24: 0 };
    stateAgg[fips2].rep24 += v.rep24;
    stateAgg[fips2].dem24 += v.dem24;
  }

  const states = {};
  for (const [fips2, agg] of Object.entries(stateAgg)) {
    const total = agg.rep24 + agg.dem24;
    states[fips2] = {
      election_2024_winner:  agg.rep24 > agg.dem24 ? "Republican" : "Democrat",
      election_2024_rep_pct: total > 0 ? +(agg.rep24 / total * 100).toFixed(1) : null,
    };
  }

  console.log(`  → ${Object.keys(counties).length} counties, ${Object.keys(states).length} states`);
  return { counties, states };
}

// ── 5. CDC PLACES health data ──────────────────────────────────────────────

async function fetchCDCPlaces() {
  console.log("Fetching CDC PLACES health data…");

  // CDC PLACES 2024 release (2022 model-based estimates), county level.
  // Socrata dataset IDs to try in order (most recent first).
  const DATASET_IDS = ["swc5-untb", "pqpp-u99h"];
  const MEASURES = { OBESITY: "obesity_pct", CSMOKING: "smoking_pct", DIABETES: "diabetes_pct", ACCESS2: "no_insurance_pct" };
  const whereClause = Object.keys(MEASURES).map(m => `'${m}'`).join(",");

  let rows = null;
  for (const id of DATASET_IDS) {
    try {
      const url = `https://data.cdc.gov/resource/${id}.json` +
        `?$select=locationid,measureid,data_value` +
        `&$where=measureid IN(${whereClause})` +
        `&$limit=100000`;
      const raw = await get(url);
      rows = JSON.parse(raw);
      if (rows.length > 0) { console.log(`  → Dataset: ${id} (${rows.length} rows)`); break; }
    } catch (e) {
      console.warn(`  ! Dataset ${id} failed: ${e.message}`);
    }
  }

  if (!rows?.length) {
    console.warn("  ! CDC PLACES data unavailable — skipping");
    return {};
  }

  const out = {};
  for (const row of rows) {
    const fips = String(row.locationid || "").padStart(5, "0");
    if (fips.length !== 5 || fips === "00000") continue;
    const field = MEASURES[row.measureid];
    if (!field || row.data_value == null) continue;
    if (!out[fips]) out[fips] = {};
    out[fips][field] = parseFloat(row.data_value);
  }

  console.log(`  → ${Object.keys(out).length} counties with health data`);
  return out;
}

// ── 6. World Bank country data ─────────────────────────────────────────────

// Normalize World Bank country names to common English names used in GeoJSON / AI queries
const WB_NAME_MAP = {
  "United States":                  "United States of America",
  "Russian Federation":             "Russia",
  "Korea, Rep.":                    "South Korea",
  "Korea, Dem. People's Rep.":      "North Korea",
  "Viet Nam":                       "Vietnam",
  "Iran, Islamic Rep.":             "Iran",
  "Egypt, Arab Rep.":               "Egypt",
  "Slovak Republic":                "Slovakia",
  "Kyrgyz Republic":                "Kyrgyzstan",
  "Lao PDR":                        "Laos",
  "Congo, Dem. Rep.":               "Democratic Republic of the Congo",
  "Congo, Rep.":                    "Republic of the Congo",
  "Bahamas, The":                   "The Bahamas",
  "Gambia, The":                    "The Gambia",
  "Yemen, Rep.":                    "Yemen",
  "Micronesia, Fed. Sts.":          "Federated States of Micronesia",
  "Cote d'Ivoire":                  "Ivory Coast",
  "Venezuela, RB":                  "Venezuela",
  "Turkiye":                        "Turkey",
  "Cabo Verde":                     "Cape Verde",
  "Eswatini":                       "Eswatini",
  "North Macedonia":                "North Macedonia",
  "Syrian Arab Republic":           "Syria",
  "Libya":                          "Libya",
  "Bolivia":                        "Bolivia",
  "Tanzania":                       "Tanzania",
  "Czechia":                        "Czech Republic",
  "China":                          "China",
  "Timor-Leste":                    "East Timor",
  "Guinea-Bissau":                  "Guinea-Bissau",
  "Sao Tome and Principe":          "São Tomé and Príncipe",
  "St. Kitts and Nevis":            "Saint Kitts and Nevis",
  "St. Lucia":                      "Saint Lucia",
  "St. Vincent and the Grenadines": "Saint Vincent and the Grenadines",
};

async function fetchWorldBank() {
  console.log("Fetching World Bank country data…");

  // Build a set of valid ISO3 codes for actual countries (those with a capital city).
  // This excludes World Bank regional/income aggregates ("High income", "North America", etc.)
  const validISO3 = new Set();
  try {
    let page = 1, totalPages = 1;
    while (page <= totalPages) {
      const raw = await get(`https://api.worldbank.org/v2/country?format=json&per_page=300&page=${page}`);
      const [meta, countries] = JSON.parse(raw);
      totalPages = meta?.pages || 1;
      for (const c of (countries || [])) {
        if (c.capitalCity?.trim() && c.id) validISO3.add(c.id);
      }
      page++;
    }
    console.log(`  → ${validISO3.size} country ISO3 codes loaded`);
  } catch (e) {
    console.warn(`  ! Could not load country list: ${e.message} — will use region filter fallback`);
  }

  const INDICATORS = {
    "SP.POP.TOTL":    "population",
    "NY.GDP.PCAP.CD": "gdp_per_capita",
    "SP.DYN.LE00.IN": "life_expectancy",
    "EN.ATM.CO2E.PC": "co2_per_capita",
  };

  // byName: normalized country name → { field: value }
  const byName = {};

  for (const [indicatorId, fieldName] of Object.entries(INDICATORS)) {
    try {
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const url = `https://api.worldbank.org/v2/country/all/indicator/${indicatorId}` +
          `?format=json&per_page=300&mrv=1&page=${page}`;
        const raw = await get(url);
        const [meta, data] = JSON.parse(raw);
        if (!meta || !data) break;
        totalPages = meta.pages || 1;

        for (const entry of data) {
          if (entry.value == null || !entry.country?.value) continue;
          // Skip aggregates: use ISO3 allowlist if available, else fall back to region check
          const iso3 = entry.countryiso3code;
          if (validISO3.size > 0 ? !validISO3.has(iso3) : entry.region?.value === "Aggregates") continue;

          let name = entry.country.value;
          name = WB_NAME_MAP[name] || name;

          if (!byName[name]) byName[name] = {};
          byName[name][fieldName] = fieldName === "population"
            ? Math.round(entry.value)
            : +(entry.value.toFixed(fieldName === "gdp_per_capita" ? 0 : 2));
        }
        page++;
      }
      process.stdout.write(`  → ${fieldName} ✓  `);
    } catch (e) {
      console.warn(`\n  ! ${fieldName} failed: ${e.message}`);
    }
  }
  console.log();
  console.log(`  → ${Object.keys(byName).length} countries`);
  return byName;
}

// ── 7. County name map from GeoJSON ───────────────────────────────────────

function buildNameMap() {
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

  try { require.resolve("csv-parse/sync"); }
  catch {
    console.log("Installing csv-parse…");
    require("child_process").execSync("npm install csv-parse --no-save", { stdio: "inherit" });
  }

  // Fetch all sources in parallel where safe; election2024 and cdcPlaces are independent
  const [
    acsCounties, acsStates, acsExtra, election, election2024, cdcPlaces, worldBank,
  ] = await Promise.all([
    fetchACSCounties(),
    fetchACSStates(),
    fetchACSExtra(),
    fetchElectionResults(),
    fetchElection2024(),
    fetchCDCPlaces(),
    fetchWorldBank(),
  ]);

  const nameMap = buildNameMap();

  // ── Merge counties ────────────────────────────────────────────────────────
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
      ...acsExtra.counties[id],
      ...election.counties[id],
      ...election2024.counties[id],
      ...cdcPlaces[id],
    };
  }

  // ── Aggregate county health data → state (population-weighted average) ────
  const HEALTH_FIELDS = ["obesity_pct", "smoking_pct", "diabetes_pct", "no_insurance_pct"];
  const stateHealthAgg = {}; // fips2 → { field → { sum, weightSum } }
  for (const [id, county] of Object.entries(counties)) {
    const fips2 = id.slice(0, 2);
    const pop = county.population || 0;
    if (!pop) continue;
    if (!stateHealthAgg[fips2]) stateHealthAgg[fips2] = {};
    for (const field of HEALTH_FIELDS) {
      if (county[field] == null) continue;
      if (!stateHealthAgg[fips2][field]) stateHealthAgg[fips2][field] = { sum: 0, weightSum: 0 };
      stateHealthAgg[fips2][field].sum       += county[field] * pop;
      stateHealthAgg[fips2][field].weightSum += pop;
    }
  }
  const stateHealth = {};
  for (const [fips2, fields] of Object.entries(stateHealthAgg)) {
    stateHealth[fips2] = {};
    for (const [field, { sum, weightSum }] of Object.entries(fields)) {
      stateHealth[fips2][field] = weightSum > 0 ? +(sum / weightSum).toFixed(1) : null;
    }
  }

  // ── Merge states ──────────────────────────────────────────────────────────
  const states = {};
  const allStateFips = new Set([
    ...Object.keys(acsStates),
    ...Object.keys(election.states),
  ]);
  for (const fips2 of allStateFips) {
    states[fips2] = {
      name: STATE_FIPS[fips2] || fips2,
      ...acsStates[fips2],
      ...acsExtra.states[fips2],
      ...election.states[fips2],
      ...election2024.states[fips2],
      ...stateHealth[fips2],
    };
  }

  const out = {
    built: new Date().toISOString(),
    fields: {
      county: [
        "state", "population", "median_age", "median_household_income",
        "poverty_pct", "unemployment_pct", "bachelors_pct",
        "election_2016_winner", "election_2016_rep", "election_2016_dem",
        "election_2020_winner", "election_2020_rep", "election_2020_dem",
        "election_2024_winner", "election_2024_rep", "election_2024_dem",
        "obesity_pct", "smoking_pct", "diabetes_pct", "no_insurance_pct",
      ],
      state: [
        "population", "median_age", "median_household_income",
        "poverty_pct", "unemployment_pct", "bachelors_pct",
        "election_2016_winner", "election_2016_rep_pct",
        "election_2020_winner", "election_2020_rep_pct",
        "election_2024_winner", "election_2024_rep_pct",
        "obesity_pct", "smoking_pct", "diabetes_pct", "no_insurance_pct",
      ],
      country: ["population", "gdp_per_capita", "life_expectancy", "co2_per_capita"],
    },
    counties,
    states,
    countries: worldBank,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  const kb = Math.round(fs.statSync(OUT_FILE).size / 1024);
  console.log(`\n✓ Wrote ${OUT_FILE} (${kb} KB)`);
  console.log(`  Counties: ${Object.keys(counties).length}`);
  console.log(`  States:   ${Object.keys(states).length}`);
  console.log(`  Countries: ${Object.keys(worldBank).length}`);
})().catch(e => { console.error(e); process.exit(1); });
