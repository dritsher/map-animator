const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const router = express.Router();

const sessions = new Map(); // sessionId -> { dir, frameCount }

function makeSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Geocoding proxy — keeps the MapTiler key server-side so it works on any domain
router.get("/api/geocode", (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Missing query" });

  const key = process.env.MAPTILER_API_KEY;
  if (!key) return res.status(503).json({ error: "Geocoding not configured" });

  const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${encodeURIComponent(key)}&limit=5`;

  https.get(url, { headers: { "User-Agent": "map-animator" } }, upstream => {
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
