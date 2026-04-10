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
Available fields for "county" level:
  state                      — state name, e.g. "Texas"
  population                 — total population (integer)
  median_age                 — median age in years (float)
  median_household_income    — median household income in USD (integer)
  election_2016_winner       — "Republican" or "Democrat"
  election_2016_rep          — Republican vote count (integer)
  election_2016_dem          — Democrat vote count (integer)
  election_2020_winner       — "Republican" or "Democrat"
  election_2020_rep          — Republican vote count (integer)
  election_2020_dem          — Democrat vote count (integer)

Available fields for "state" level:
  population                 — total population (integer)
  median_age                 — median age in years (float)
  median_household_income    — median household income in USD (integer)
  election_2016_winner       — "Republican" or "Democrat"
  election_2016_rep_pct      — Republican vote percentage (float, 0–100)
  election_2020_winner       — "Republican" or "Democrat"
  election_2020_rep_pct      — Republican vote percentage (float, 0–100)

Operators: eq, ne, gt, lt, gte, lte, in (value is an array for "in")
Logic: "and" (default) or "or"
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
      case "in":  return Array.isArray(value) &&
                         value.some(x => String(x).toLowerCase() === String(v).toLowerCase());
      default:    return false;
    }
  });
  return logic === "or" ? results.some(Boolean) : results.every(Boolean);
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
            level:   { type: "string", enum: ["county", "state"] },
            logic:   { type: "string", enum: ["and", "or"] },
            filters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  op:    { type: "string", enum: ["eq","ne","gt","lt","gte","lte","in"] },
                  value: {},
                },
                required: ["field", "op", "value"],
              },
            },
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

  const { level, filters, logic = "and" } = filterSpec;
  if (!["county", "state"].includes(level) || !Array.isArray(filters)) {
    return res.status(422).json({ error: "Invalid filter spec from AI", spec: filterSpec });
  }

  // Apply filters to actual data — no hallucination possible here
  const matches = [];
  if (level === "county") {
    for (const [fips, record] of Object.entries(data.counties)) {
      if (applyFilters(record, filters, logic)) matches.push(record.display_name);
    }
  } else {
    const STATE_FIPS = data.states;
    for (const [fips, record] of Object.entries(data.states)) {
      if (applyFilters(record, filters, logic)) matches.push(record.name);
    }
  }

  res.json({ level, filterSpec, matches, count: matches.length });
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
