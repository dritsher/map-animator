const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { execFile } = require("child_process");
const { promisify } = require("util");
const Anthropic = require("@anthropic-ai/sdk");

const execFileAsync = promisify(execFile);
const router = express.Router();

// ── Region query data ────────────────────────────────────────────────────────

const REGION_DATA_PATH = path.join(__dirname, "../server/data/region-data.json");
let regionData = null;

function getRegionData() {
  if (!regionData && fs.existsSync(REGION_DATA_PATH)) {
    regionData = JSON.parse(fs.readFileSync(REGION_DATA_PATH, "utf8"));
  }
  return regionData;
}

// ── /api/region-query ────────────────────────────────────────────────────────

const FIELD_DOCS = `
Query types:

1. level "county" — filter US counties by data fields:

  Fields:
    name                       — county display name, e.g. "Travis County, Texas"
    state                      — state name, e.g. "Texas"
    population                 — total population (integer)
    median_age                 — median age in years (float)
    median_household_income    — median household income in USD (integer)
    poverty_pct                — % of population below poverty line (float)
    unemployment_pct           — unemployment rate % (float)
    bachelors_pct              — % of adults with bachelor's degree or higher (float)
    election_2016_winner       — "Republican" or "Democrat"
    election_2016_rep          — Republican vote count (integer)
    election_2016_dem          — Democrat vote count (integer)
    election_2020_winner       — "Republican" or "Democrat"
    election_2020_rep          — Republican vote count (integer)
    election_2020_dem          — Democrat vote count (integer)
    election_2024_winner       — "Republican" or "Democrat"
    election_2024_rep          — Republican vote count (integer)
    election_2024_dem          — Democrat vote count (integer)
    obesity_pct                — % of adults who are obese (float)
    smoking_pct                — % of adults who currently smoke (float)
    diabetes_pct               — % of adults with diagnosed diabetes (float)
    no_insurance_pct           — % of adults aged 18–64 without health insurance (float)

2. level "state" — filter US states by data fields, OR return by name/geography:

  Fields:
    name                       — state name, e.g. "California"
    population                 — total population (integer)
    median_age                 — median age in years (float)
    median_household_income    — median household income in USD (integer)
    poverty_pct                — % of population below poverty line (float)
    unemployment_pct           — unemployment rate % (float)
    bachelors_pct              — % of adults with bachelor's degree or higher (float)
    election_2016_winner       — "Republican" or "Democrat"
    election_2016_rep_pct      — Republican vote % (float, 0–100)
    election_2020_winner       — "Republican" or "Democrat"
    election_2020_rep_pct      — Republican vote % (float, 0–100)
    election_2024_winner       — "Republican" or "Democrat"
    election_2024_rep_pct      — Republican vote % (float, 0–100)
    obesity_pct                — % of adults who are obese (population-weighted from counties, float)
    smoking_pct                — % of adults who currently smoke (float)
    diabetes_pct               — % of adults with diagnosed diabetes (float)
    no_insurance_pct           — % of adults aged 18–64 without health insurance (float)

  IMPORTANT: "state" is a county-only field. State records use "name" for the state name.
  For name/geography-based state queries (e.g. "states starting with N", "landlocked states",
  "states in the South"), ALWAYS use the "names" array from world knowledge rather than filters.

3. level "country" — filter countries by data fields OR return by name/geography:

  Fields (World Bank data):
    population                 — total population (integer)
    gdp_per_capita             — GDP per capita in USD (float)
    life_expectancy            — life expectancy at birth in years (float)
    co2_per_capita             — CO₂ emissions per capita in metric tons (float)

  For geopolitical/geographic groupings (NATO, EU, landlocked, etc.) use "names" from world knowledge.
  For data-based queries (e.g. "countries with GDP per capita over $50k") use filters.

Operators: eq, ne, gt, lt, gte, lte, in (value is array), startswith, contains
Logic: "and" (default) or "or"
For top-N / bottom-N: set sort_by, sort_dir ("asc"/"desc"), and limit.
`.trim();

function applyFilters(record, filters, logic) {
  const results = filters.map(({ field, op, value }) => {
    const v = record[field];
    if (v === null || v === undefined) return false;
    switch (op) {
      case "eq":  return String(v).toLowerCase() === String(value).toLowerCase();
      case "ne":  return String(v).toLowerCase() !== String(value).toLowerCase();
      case "gt":  return v > value;
      case "lt":  return v < value;
      case "gte": return v >= value;
      case "lte": return v <= value;
      case "in":         return Array.isArray(value) &&
                                value.some(x => String(x).toLowerCase() === String(v).toLowerCase());
      case "startswith": return String(v).toLowerCase().startsWith(String(value).toLowerCase());
      case "contains":   return String(v).toLowerCase().includes(String(value).toLowerCase());
      default:    return false;
    }
  });
  return logic === "or" ? results.some(Boolean) : results.every(Boolean);
}

// Map queryable fields to their data sources
const FIELD_SOURCES = {
  population:               { name: "US Census ACS 2022",            url: "https://www.census.gov/data/developers/data-sets/acs-5year.html" },
  median_age:               { name: "US Census ACS 2022",            url: "https://www.census.gov/data/developers/data-sets/acs-5year.html" },
  median_household_income:  { name: "US Census ACS 2022",            url: "https://www.census.gov/data/developers/data-sets/acs-5year.html" },
  poverty_pct:              { name: "US Census ACS 2022",            url: "https://www.census.gov/data/developers/data-sets/acs-5year.html" },
  unemployment_pct:         { name: "US Census ACS 2022",            url: "https://www.census.gov/data/developers/data-sets/acs-5year.html" },
  bachelors_pct:            { name: "US Census ACS 2022",            url: "https://www.census.gov/data/developers/data-sets/acs-5year.html" },
  election_2016_winner:     { name: "MIT Election Data + Science Lab", url: "https://electionlab.mit.edu/data" },
  election_2016_rep:        { name: "MIT Election Data + Science Lab", url: "https://electionlab.mit.edu/data" },
  election_2016_dem:        { name: "MIT Election Data + Science Lab", url: "https://electionlab.mit.edu/data" },
  election_2016_rep_pct:    { name: "MIT Election Data + Science Lab", url: "https://electionlab.mit.edu/data" },
  election_2020_winner:     { name: "MIT Election Data + Science Lab", url: "https://electionlab.mit.edu/data" },
  election_2020_rep:        { name: "MIT Election Data + Science Lab", url: "https://electionlab.mit.edu/data" },
  election_2020_dem:        { name: "MIT Election Data + Science Lab", url: "https://electionlab.mit.edu/data" },
  election_2020_rep_pct:    { name: "MIT Election Data + Science Lab", url: "https://electionlab.mit.edu/data" },
  election_2024_winner:     { name: "2024 County Election Results",   url: "https://github.com/tonmcg/US_County_Level_Election_Results_08-20" },
  election_2024_rep:        { name: "2024 County Election Results",   url: "https://github.com/tonmcg/US_County_Level_Election_Results_08-20" },
  election_2024_dem:        { name: "2024 County Election Results",   url: "https://github.com/tonmcg/US_County_Level_Election_Results_08-20" },
  election_2024_rep_pct:    { name: "2024 County Election Results",   url: "https://github.com/tonmcg/US_County_Level_Election_Results_08-20" },
  obesity_pct:              { name: "CDC PLACES 2024",               url: "https://www.cdc.gov/places/" },
  smoking_pct:              { name: "CDC PLACES 2024",               url: "https://www.cdc.gov/places/" },
  diabetes_pct:             { name: "CDC PLACES 2024",               url: "https://www.cdc.gov/places/" },
  no_insurance_pct:         { name: "CDC PLACES 2024",               url: "https://www.cdc.gov/places/" },
  gdp_per_capita:           { name: "World Bank Open Data",          url: "https://data.worldbank.org/" },
  life_expectancy:          { name: "World Bank Open Data",          url: "https://data.worldbank.org/" },
  co2_per_capita:           { name: "World Bank Open Data",          url: "https://data.worldbank.org/" },
};

const WORLD_KNOWLEDGE_SOURCE = { name: "Claude AI world knowledge", url: null };
const WORLD_BANK_POPULATION  = { name: "World Bank Open Data",      url: "https://data.worldbank.org/" };

function inferSources(filterSpec, level) {
  const { filters = [], names = [], sort_by } = filterSpec;

  // Name/geography-based queries use world knowledge, not a data file
  if (names.length) {
    if (level === "country") return [WORLD_KNOWLEDGE_SOURCE, WORLD_BANK_POPULATION];
    return [WORLD_KNOWLEDGE_SOURCE];
  }

  // Collect all fields referenced (filter fields + sort field)
  const fields = [...filters.map(f => f.field), ...(sort_by ? [sort_by] : [])];

  if (level === "country") {
    // Country data filters → World Bank
    return fields.some(f => FIELD_SOURCES[f])
      ? [{ name: "World Bank Open Data", url: "https://data.worldbank.org/" }]
      : [WORLD_KNOWLEDGE_SOURCE];
  }

  // Deduplicate by source name
  const seen = new Map();
  for (const field of fields) {
    const src = FIELD_SOURCES[field];
    if (src && !seen.has(src.name)) seen.set(src.name, src);
  }
  return seen.size > 0 ? [...seen.values()] : [WORLD_KNOWLEDGE_SOURCE];
}

router.post("/api/region-query", async (req, res) => {
  const { query } = req.body || {};
  if (!query?.trim()) return res.status(400).json({ error: "Missing query" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: "ANTHROPIC_API_KEY not configured" });

  const data = getRegionData();
  if (!data) return res.status(503).json({ error: "Region data not loaded — run scripts/fetch-region-data.js" });

  // Ask Claude to translate the natural language query into a filter spec via tool use
  // Tool use guarantees structured JSON output with no markdown wrapping.
  const anthropic = new Anthropic({ apiKey: key });
  let filterSpec;
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: `You translate natural language map queries into structured region filters.\n\n${FIELD_DOCS}`,
      tools: [{
        name: "region_filter",
        description: "Return the filter spec for the given natural language region query.",
        input_schema: {
          type: "object",
          properties: {
            level:   { type: "string", enum: ["county", "state", "country"] },
            logic:   { type: "string", enum: ["and", "or"] },
            filters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  op:    { type: "string", enum: ["eq","ne","gt","lt","gte","lte","in","startswith","contains"] },
                  value: {},
                },
                required: ["field", "op", "value"],
              },
            },
            names: {
              type: "array",
              items: { type: "string" },
              description: "For country or state queries answerable from world knowledge: list of names directly (e.g. NATO members, states starting with C, landlocked states). Preferred over filters for name/geography-based state queries.",
            },
            sort_by:  { type: "string", description: "Field to sort results by (for top-N or bottom-N queries)." },
            sort_dir: { type: "string", enum: ["asc", "desc"], description: "Sort direction. Use 'desc' for largest/highest, 'asc' for smallest/lowest." },
            limit:    { type: "integer", description: "Maximum number of results to return (for top-N queries)." },
          },
          required: ["level", "filters"],
        },
      }],
      tool_choice: { type: "tool", name: "region_filter" },
      messages: [{ role: "user", content: query }],
    });

    const toolUse = msg.content.find(b => b.type === "tool_use");
    if (!toolUse) throw new Error("No tool_use block in response");
    filterSpec = toolUse.input;
  } catch (e) {
    console.error("[region-query]", e.message);
    const msg = e.message || "";
    if (msg.includes("credit balance") || msg.includes("billing"))
      return res.status(402).json({ error: "Anthropic API credits needed — add credits at console.anthropic.com" });
    if (msg.includes("401") || msg.includes("authentication"))
      return res.status(401).json({ error: "Invalid Anthropic API key" });
    return res.status(422).json({ error: "Could not interpret query", detail: msg });
  }

  const { level, filters = [], names = [], logic = "and", sort_by, sort_dir, limit } = filterSpec;
  if (!["county", "state", "country"].includes(level)) {
    return res.status(422).json({ error: "Invalid filter spec from AI", spec: filterSpec });
  }

  let records = []; // [{ name, sortVal }]
  if (level === "country") {
    if (names.length) {
      // World-knowledge path: AI returns country names directly
      records = names.map(n => ({ name: n, sortVal: null }));
    } else if (filters.length && data.countries) {
      // Data-filter path: filter World Bank country records
      for (const [name, record] of Object.entries(data.countries)) {
        if (applyFilters(record, filters, logic))
          records.push({ name, sortVal: sort_by ? record[sort_by] : null });
      }
    }
  } else if (level === "state" && names.length) {
    // AI answered from world knowledge — use names directly
    records = names.map(n => ({ name: n, sortVal: null }));
  } else if (level === "county") {
    for (const [fips, record] of Object.entries(data.counties)) {
      // Expose display_name as "name" field for name-pattern filters
      const r = { ...record, name: record.display_name };
      if (!filters.length || applyFilters(r, filters, logic))
        records.push({ name: record.display_name, sortVal: sort_by ? r[sort_by] : null });
    }
  } else {
    // level === "state"
    for (const [fips, record] of Object.entries(data.states)) {
      if (!filters.length || applyFilters(record, filters, logic))
        records.push({ name: record.name, sortVal: sort_by ? record[sort_by] : null });
    }
  }

  if (sort_by) {
    const dir = sort_dir === "asc" ? 1 : -1;
    records.sort((a, b) => {
      if (a.sortVal == null && b.sortVal == null) return 0;
      if (a.sortVal == null) return 1;
      if (b.sortVal == null) return -1;
      return dir * (a.sortVal - b.sortVal);
    });
  }
  if (limit) records = records.slice(0, limit);

  const matches = records.map(r => r.name);
  res.json({ level, filterSpec, matches, count: matches.length, sources: inferSources(filterSpec, level) });
});

// ── /api/city-query ──────────────────────────────────────────────────────────

router.post("/api/city-query", async (req, res) => {
  const { query } = req.body || {};
  if (!query?.trim()) return res.status(400).json({ error: "Missing query" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: "ANTHROPIC_API_KEY not configured" });

  const anthropic = new Anthropic({ apiKey: key });
  let result;
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: `You generate ordered lists of cities for map route visualization. Return cities that best match the user's query. Provide accurate latitude/longitude coordinates.`,
      tools: [{
        name: "city_list",
        description: "Return an ordered list of cities matching the query, suitable for drawing a route on a map.",
        input_schema: {
          type: "object",
          properties: {
            label: { type: "string", description: "Short descriptive name for this group of cities (max 40 chars)." },
            cities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name:    { type: "string", description: "City name in English" },
                  country: { type: "string", description: "Country name in English (e.g. 'United States of America', 'France')" },
                  state:   { type: "string", description: "State or province abbreviation where applicable (e.g. 'NY', 'CA', 'TX' for US cities; 'ON' for Canadian cities). Omit for countries that don't use states/provinces." },
                  lat:     { type: "number", description: "Latitude" },
                  lon:     { type: "number", description: "Longitude" },
                },
                required: ["name", "country", "lat", "lon"],
              },
            },
          },
          required: ["cities"],
        },
      }],
      tool_choice: { type: "tool", name: "city_list" },
      messages: [{ role: "user", content: query }],
    });

    const toolUse = msg.content.find(b => b.type === "tool_use");
    if (!toolUse) throw new Error("No tool_use block in response");
    result = toolUse.input;
  } catch (e) {
    console.error("[city-query]", e.message);
    const msg = e.message || "";
    if (msg.includes("credit balance") || msg.includes("billing"))
      return res.status(402).json({ error: "Anthropic API credits needed — add credits at console.anthropic.com" });
    if (msg.includes("401") || msg.includes("authentication"))
      return res.status(401).json({ error: "Invalid Anthropic API key" });
    return res.status(422).json({ error: "Could not interpret query", detail: msg });
  }

  res.json({ cities: result.cities || [], label: result.label || null, count: (result.cities || []).length });
});

const sessions = new Map(); // sessionId -> { dir, frameCount }

function makeSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Counties GeoJSON — fetched from CDN on first request and cached locally
const COUNTIES_CACHE = path.join(__dirname, "../public/data/counties.geojson");
const COUNTIES_CDN   = "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json";

router.get("/api/counties", (req, res) => {
  if (fs.existsSync(COUNTIES_CACHE)) {
    return res.sendFile(COUNTIES_CACHE);
  }
  // Fetch from CDN, stream to disk, then serve
  const tmp = COUNTIES_CACHE + ".tmp";
  const file = fs.createWriteStream(tmp);
  https.get(COUNTIES_CDN, { headers: { "User-Agent": "map-animator" } }, upstream => {
    upstream.pipe(file);
    file.on("finish", () => {
      file.close(() => {
        try { fs.renameSync(tmp, COUNTIES_CACHE); } catch (e) {}
        res.sendFile(COUNTIES_CACHE);
      });
    });
  }).on("error", err => {
    try { fs.unlinkSync(tmp); } catch (e) {}
    res.status(502).json({ error: "Could not fetch county data" });
  });
});

// Geocoding proxy — keeps the MapTiler key server-side so it works on any domain
router.get("/api/geocode", (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Missing query" });

  const key = process.env.MAPTILER_API_KEY;
  if (!key) return res.status(503).json({ error: "Geocoding not configured" });

  const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${encodeURIComponent(key)}&limit=5`;

  // Forward the browser's origin so domain-restricted keys pass MapTiler's referer check
  const origin = req.headers.origin || `${req.protocol}://${req.headers.host}`;
  https.get(url, { headers: { "User-Agent": "map-animator", "Referer": origin, "Origin": origin } }, upstream => {
    let body = "";
    upstream.on("data", chunk => body += chunk);
    upstream.on("end", () => {
      try {
        res.json(JSON.parse(body));
      } catch (e) {
        res.status(502).json({ error: "Bad response from geocoder" });
      }
    });
  }).on("error", err => {
    res.status(502).json({ error: "Geocoder unreachable" });
  });
});

// Start a new export session — creates a temp directory
router.post("/api/export/start", (req, res) => {
  const sessionId = makeSessionId();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "map-anim-"));
  sessions.set(sessionId, { dir, frameCount: 0 });
  res.json({ sessionId });
});

// Receive one frame as base64 PNG
router.post("/api/export/frame", (req, res) => {
  const { sessionId, frameIndex, dataUrl } = req.body;
  const session = sessions.get(sessionId);
  if (!session) return res.status(400).json({ error: "Unknown session" });

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  const filename = `frame_${String(frameIndex).padStart(6, "0")}.png`;
  fs.writeFileSync(path.join(session.dir, filename), Buffer.from(base64, "base64"));
  session.frameCount++;

  res.json({ ok: true });
});

// Render all frames into an MP4 with ffmpeg
router.post("/api/export/render", async (req, res) => {
  const { sessionId, fps } = req.body;
  const session = sessions.get(sessionId);
  if (!session) return res.status(400).json({ error: "Unknown session" });

  const inputPattern = path.join(session.dir, "frame_%06d.png");
  const outputPath   = path.join(session.dir, "output.mp4");

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-framerate", String(fps || 30),
      "-i", inputPattern,
      "-c:v", "libx264",
      "-preset", "slow",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputPath,
    ]);
    res.json({ ok: true, sessionId });
  } catch (err) {
    console.error("[ffmpeg]", err.stderr || err.message);
    res.status(500).json({ error: "ffmpeg failed", detail: err.stderr || err.message });
  }
});

// ── /api/generate-map ────────────────────────────────────────────────────────

const US_STATES = new Set([
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
  "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
  "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
  "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada",
  "New Hampshire","New Jersey","New Mexico","New York","North Carolina",
  "North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island",
  "South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
  "Virginia","Washington","West Virginia","Wisconsin","Wyoming",
  "District of Columbia",
]);

// Normalize a member name from Claude into the displayStr format used by regionLookup.
// US states become "StateName (United States of America)"; everything else is returned as-is.
function normalizeRegionMember(name) {
  if (US_STATES.has(name)) return `${name} (United States of America)`;
  return name;
}

const GENERATE_ROUTE_COLORS = [
  '#3b82f6','#ef4444','#22c55e','#f59e0b','#a855f7',
  '#06b6d4','#f97316','#ec4899','#84cc16','#14b8a6',
];

const BASEMAP_ENUM = ["eox-s2", "carto-dark", "carto-positron", "carto-voyager", "nasa-night", "nasa-blue-marble", "opentopomap", "usgs-relief"];

const REGION_GROUP_SCHEMA = {
  type: "array",
  description: "Groups of countries or states to highlight. Use multiple groups for multi-color maps.",
  items: {
    type: "object",
    properties: {
      name:        { type: "string", description: "Group label" },
      color:       { type: "string", description: "Hex fill color, e.g. #4a9eff" },
      fillOpacity: { type: "number", description: "Fill opacity 0–1, typically 0.3–0.6" },
      members:     { type: "array", items: { type: "string" }, description: "Country or state names" },
    },
    required: ["name", "color", "fillOpacity", "members"],
  },
};

const CITIES_SCHEMA = {
  type: "array",
  description: "Key cities or locations to mark.",
  items: {
    type: "object",
    properties: {
      name: { type: "string" },
      lat:  { type: "number" },
      lon:  { type: "number" },
    },
    required: ["name", "lat", "lon"],
  },
};

const STATIC_SYSTEM = `You generate map configurations for a 3D globe animator. Given a topic or request, choose the best visual representation.

Available basemaps: eox-s2 (satellite, default), carto-dark (dark style), carto-positron (light/clean), carto-voyager (streets), nasa-night (city lights at night), nasa-blue-marble (classic globe), opentopomap (topographic), usgs-relief (shaded relief, US only).

For regionGroups, use country names exactly as they appear in standard geographic databases (e.g. "United States", "United Kingdom", "South Korea"). For US states use full names ("California", "Texas").

Camera height guidance: 1000000m = single country close-up, 3000000m = small region, 8000000m = continent, 15000000m = hemisphere, 20000000m = full globe.

Choose colors that look great on the selected basemap. For dark basemaps use bright/vivid colors. For light basemaps use deeper saturated colors.`;

const ANIMATED_SYSTEM = `You generate animated map configurations for a 3D globe animator. Create a compelling visual story with coordinated camera movement, timed region appearances, and animated routes.

Available basemaps: eox-s2 (satellite, default), carto-dark (dark style), carto-positron (light/clean), carto-voyager (streets), nasa-night (city lights at night), nasa-blue-marble (classic globe), opentopomap (topographic), usgs-relief (shaded relief, US only).

For regionGroups, use country names exactly as they appear in standard geographic databases (e.g. "United States", "United Kingdom", "South Korea"). For US states use full names ("California", "Texas").

Camera height guidance: 1000000m = single city close-up, 3000000m = small region, 8000000m = continent, 15000000m = hemisphere, 20000000m = full globe.

General animation guidance:
- Choose totalDuration of 15–30 seconds for most topics.
- cameraPath must always include a keyframe at time=0.
- sequentialAppearance: stagger members for drama. Use interval 0.2–0.5s for many members; 0.8–1.5s for few.
- Coordinate timing: camera should reach its position 1–2 seconds before regions start appearing.

CAMERA-ROUTE TRACKING (critical — follow this algorithm exactly when a route has drawAnimation):
The camera must follow the route tip as it draws across the globe. For each city in the route (0-indexed, i of N total), the route tip reaches that city at:
  t_city_i = drawAnimation.startTime + (i / (N - 1)) * (drawAnimation.endTime - drawAnimation.startTime)

For each city, add a cameraPath keyframe at t_city_i with:
- lat/lon: that city's coordinates
- height: sized to show the current segment. Use approximately 2.5× the great-circle distance to the next city:
    ~500km between cities  → height ~1500000m
    ~1000km between cities → height ~2500000m
    ~2000km between cities → height ~4000000m
    ~4000km+ between cities → height ~6000000–8000000m

Also add a keyframe 1–2 seconds before drawAnimation.startTime to pre-position the camera at the first city.

Example — Route: New York → Chicago → London, drawAnimation startTime=5 endTime=20, N=3:
  t_NewYork  = 5 + (0/2)*15 = 5.0  → KF at t=3 (pre-position) and t=5, camera at New York, height~2000000
  t_Chicago  = 5 + (1/2)*15 = 12.5 → KF at t=12.5, camera at Chicago, height~7000000 (Chicago→London ~6000km)
  t_London   = 5 + (2/2)*15 = 20.0 → KF at t=20, camera at London, height~3000000

Choose colors that look great on the selected basemap. For dark basemaps use bright/vivid colors.`;

router.post("/api/generate-map", async (req, res) => {
  const { prompt, animate } = req.body || {};
  if (!prompt?.trim()) return res.status(400).json({ error: "Missing prompt" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: "ANTHROPIC_API_KEY not configured" });

  const anthropic = new Anthropic({ apiKey: key });
  let spec;
  try {
    const staticSchema = {
      type: "object",
      properties: {
        basemap: { type: "string", enum: BASEMAP_ENUM, description: "Best basemap for this topic" },
        camera: {
          type: "object",
          properties: {
            lat:    { type: "number", description: "Camera center latitude" },
            lon:    { type: "number", description: "Camera center longitude" },
            height: { type: "number", description: "Camera altitude in meters" },
          },
          required: ["lat", "lon", "height"],
        },
        regionGroups: REGION_GROUP_SCHEMA,
        cities: CITIES_SCHEMA,
      },
      required: ["basemap", "camera", "regionGroups"],
    };

    const animatedRegionGroupSchema = {
      type: "array",
      description: "Groups of countries or states to highlight.",
      items: {
        type: "object",
        properties: {
          name:        { type: "string" },
          color:       { type: "string", description: "Hex fill color" },
          fillOpacity: { type: "number", description: "Fill opacity 0–1" },
          members:     { type: "array", items: { type: "string" }, description: "Country or state names" },
          sequentialAppearance: {
            type: "object",
            description: "Animate members fading in one at a time. Omit for instant appearance.",
            properties: {
              startTime: { type: "number", description: "When the first member appears (seconds)" },
              interval:  { type: "number", description: "Seconds between each successive member appearing" },
            },
            required: ["startTime", "interval"],
          },
        },
        required: ["name", "color", "fillOpacity", "members"],
      },
    };

    const animatedSchema = {
      type: "object",
      properties: {
        basemap:       { type: "string", enum: BASEMAP_ENUM, description: "Best basemap for this topic" },
        totalDuration: { type: "number", description: "Total animation length in seconds (15–30 recommended)" },
        cameraPath: {
          type: "array",
          description: "Camera keyframes. Must include time=0. Use 3–5 keyframes.",
          items: {
            type: "object",
            properties: {
              time:    { type: "number", description: "Time in seconds" },
              lat:     { type: "number" },
              lon:     { type: "number" },
              height:  { type: "number", description: "Altitude in meters" },
              heading: { type: "number", description: "Degrees, 0=north. Defaults to 0." },
              pitch:   { type: "number", description: "Degrees, -90=straight down. Defaults to -90." },
            },
            required: ["time", "lat", "lon", "height"],
          },
        },
        regionGroups: animatedRegionGroupSchema,
        routes: {
          type: "array",
          description: "Animated polylines connecting cities or locations. Great for trade routes, migration paths, travel itineraries.",
          items: {
            type: "object",
            properties: {
              name:      { type: "string" },
              color:     { type: "string", description: "Hex color" },
              lineStyle: { type: "string", enum: ["line", "dashed", "dotted"], description: "Visual line style" },
              lineShape: { type: "string", enum: ["straight", "arc"], description: "Arc curves over the globe — use arc for long distances" },
              cities: {
                type: "array",
                description: "Waypoints along the route in order",
                items: {
                  type: "object",
                  properties: { name: { type: "string" }, lat: { type: "number" }, lon: { type: "number" } },
                  required: ["name", "lat", "lon"],
                },
              },
              drawAnimation: {
                type: "object",
                description: "Animate the route drawing from start to end. Omit for static route.",
                properties: {
                  startTime: { type: "number", description: "When the route begins drawing (seconds)" },
                  endTime:   { type: "number", description: "When the route is fully drawn (seconds)" },
                },
                required: ["startTime", "endTime"],
              },
            },
            required: ["name", "cities"],
          },
        },
        cities: CITIES_SCHEMA,
      },
      required: ["basemap", "totalDuration", "cameraPath", "regionGroups"],
    };

    const msg = await anthropic.messages.create({
      model:      animate ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001",
      max_tokens: animate ? 4096 : 1024,
      system:     animate ? ANIMATED_SYSTEM : STATIC_SYSTEM,
      tools: [{
        name: "map_config",
        description: animate
          ? "Generate a complete animated map configuration with camera path, timed region appearances, and animated routes."
          : "Generate a complete map configuration for the given topic.",
        input_schema: animate ? animatedSchema : staticSchema,
      }],
      tool_choice: { type: "tool", name: "map_config" },
      messages: [{ role: "user", content: prompt }],
    });

    const toolUse = msg.content.find(b => b.type === "tool_use");
    if (!toolUse) throw new Error("No tool_use block in response");
    spec = toolUse.input;
  } catch (e) {
    console.error("[generate-map]", e.message);
    const msg = e.message || "";
    if (msg.includes("credit balance") || msg.includes("billing"))
      return res.status(402).json({ error: "Anthropic API credits needed" });
    if (msg.includes("401") || msg.includes("authentication"))
      return res.status(401).json({ error: "Invalid Anthropic API key" });
    return res.status(422).json({ error: "Could not generate map", detail: msg });
  }

  // ── Build project JSON ──────────────────────────────────────────────────────
  const isDark = ["carto-dark", "nasa-night", "eox-s2"].includes(spec.basemap);
  const textColor = isDark ? "#ffffff" : "#1a1a1a";
  const totalDuration = animate ? (spec.totalDuration ?? 20) : 10;

  let nextGroupId = 1;
  let nextCityId  = 1;
  let nextKfId    = 1;
  let nextRouteId = 1;

  // Groups — include sequentialAppearance metadata for animated maps
  const groups = (spec.regionGroups || []).map(g => {
    const id = nextGroupId++;
    const group = {
      id,
      name: g.name,
      color: g.color || "#4a9eff",
      fillOpacity: g.fillOpacity ?? 0.4,
      invert: false,
      members: (g.members || []).map(name => {
        const displayStr = normalizeRegionMember(name);
        return { key: displayStr, name: displayStr };
      }),
    };
    if (animate && g.sequentialAppearance) {
      group.sequentialAppearance = {
        startTime: g.sequentialAppearance.startTime,
        interval:  g.sequentialAppearance.interval,
      };
    }
    return group;
  });

  // Cities
  const cities = (spec.cities || []).map(c => ({
    id: nextCityId++,
    name: c.name, country: "",
    lat: c.lat, lon: c.lon,
    color: textColor, dotSize: 6, showLabel: true,
    labelColor: textColor, fontSize: 12,
    fontWeight: "normal", fontStyle: "normal", fontFamily: "Arial",
    offsetX: 8, offsetY: 0, outlineWidth: 1,
    showBackground: false, backgroundColor: "#000000", backgroundOpacity: 0.5,
    bgPadX: 4, bgPadY: 2, dotOpacity: 1, labelOpacity: 1,
  }));

  // Camera keyframes
  let cameraKeyframes;
  if (animate && spec.cameraPath?.length > 0) {
    cameraKeyframes = spec.cameraPath.map(cp => ({
      id: nextKfId++,
      time: cp.time, lat: cp.lat, lon: cp.lon, height: cp.height,
      heading: cp.heading ?? 0, pitch: cp.pitch ?? -90, roll: 0, sceneMode: "globe",
    }));
    // Ensure sorted by time
    cameraKeyframes.sort((a, b) => a.time - b.time);
  } else {
    const cam = spec.camera || { lat: 20, lon: 0, height: 15000000 };
    cameraKeyframes = [{ id: nextKfId++, time: 0, lon: cam.lon, lat: cam.lat, height: cam.height, heading: 0, pitch: -90, roll: 0, sceneMode: "globe" }];
  }

  // Tracks object
  const tracks = {
    camera:  { keyframes: cameraKeyframes },
    tod:     { keyframes: [] },
    borders: { keyframes: [] },
  };
  for (const g of groups) {
    tracks[`group_${g.id}`] = {
      id: `group_${g.id}`, label: g.name, category: "group", color: g.color, h: 22,
      keyframes: [],
      // Expand group in timeline if it has sequential appearance so sub-tracks are visible
      collapsed: !(animate && g.sequentialAppearance),
    };
  }
  for (const c of cities) {
    tracks[`city_${c.id}`] = { id: `city_${c.id}`, label: c.name, category: "city", color: c.color, h: 22, keyframes: [], collapsed: true };
  }

  // Routes (animated mode only) — keyframes pre-generated and stored in tracks
  const routes = [];
  if (animate) {
    for (const r of (spec.routes || [])) {
      const id = nextRouteId++;
      const color = r.color || GENERATE_ROUTE_COLORS[(id - 1) % GENERATE_ROUTE_COLORS.length];
      const hasDrawAnim = !!(r.drawAnimation?.startTime !== undefined && r.drawAnimation?.endTime !== undefined);
      routes.push({
        id,
        name: r.name,
        color,
        lineStyle: r.lineStyle || "line",
        lineShape: r.lineShape || "arc",
        routeStart: 0,
        routeEnd: hasDrawAnim ? 0 : 100,
        width: 2,
        visible: true,
        cities: (r.cities || []).map(c => ({ name: c.name, lat: c.lat, lon: c.lon })),
        showCityLabels: false, labelColor: null, labelFontSize: 14,
        labelFontWeight: "normal", labelFontStyle: "normal", labelFontFamily: "Arial",
        labelOffsetX: 4, labelOffsetY: 0, labelOutlineWidth: 2, labelOpacity: 1.0,
        labelShowBackground: false, labelBgColor: "#000000", labelBgOpacity: 0.5, labelBgPadX: 5, labelBgPadY: 3,
        showLabel: false,
        glColor: null, glFontSize: 28, glFontWeight: "bold", glFontStyle: "normal", glFontFamily: "Arial",
        glOffsetX: 0, glOffsetY: 0, glOutlineWidth: 2, glOpacity: 1.0,
        glShowBackground: false, glBgColor: "#000000", glBgOpacity: 0.5, glBgPadX: 5, glBgPadY: 3,
      });
      const routeKeyframes = hasDrawAnim ? [
        { id: nextKfId++, time: r.drawAnimation.startTime, routeStart: 0, routeEnd: 0  },
        { id: nextKfId++, time: r.drawAnimation.endTime,   routeStart: 0, routeEnd: 100 },
      ] : [];
      tracks[`route_${id}`] = {
        id: `route_${id}`, label: "Route: " + r.name, category: "route",
        color, h: 22, keyframes: routeKeyframes, collapsed: true,
      };
    }
  }

  const project = {
    version: 1,
    totalDuration,
    playbackT: 0,
    currentBasemap: spec.basemap || "eox-s2",
    basemapShowLabels: true,
    basemapMaxLevelOverride: null,
    bmAdjust: { brightness: 1, contrast: 1, hue: 0, saturation: 1, gamma: 1 },
    borders: {
      countryOpacity: 0.6, stateOpacity: 0, countyOpacity: 0, countyFilter: "none",
      borderColor: isDark ? "#ffffff" : "#333333", landOnly: true,
    },
    defaults: { regionColor: "#4a9eff", cityColor: textColor, cityDotSize: 6 },
    highlights: [],
    groups,
    cities,
    routes,
    tracks,
    nextKfId,
    nextGroupId,
    nextCityId,
    nextRouteGroupId: nextRouteId,
    kmlOverlays: [], nextKmlId: 1,
    imageOverlays: [], nextImageOverlayId: 1,
    selectedTrackIds: ["camera"],
    annotations: [], nextAnnotationId: 1,
  };

  res.json({ project });
});

// Download the finished MP4
router.get("/api/export/download/:sessionId", (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Unknown session" });

  const outputPath = path.join(session.dir, "output.mp4");
  if (!fs.existsSync(outputPath)) return res.status(404).json({ error: "MP4 not ready" });

  res.download(outputPath, "animation.mp4", (err) => {
    if (!err) {
      // Clean up temp files after download
      fs.rmSync(session.dir, { recursive: true, force: true });
      sessions.delete(req.params.sessionId);
    }
  });
});

module.exports = router;
