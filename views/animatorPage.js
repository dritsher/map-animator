const fs = require("fs");
const path = require("path");

function animatorPage({ cesiumToken = "", maptilerApiKey = "" } = {}) {
  const template = fs.readFileSync(path.join(__dirname, "animator.html"), "utf8");
  const configScript = `<script>window.__config = ${JSON.stringify({ cesiumToken, maptilerApiKey })};</script>`;
  return template.replace("<!-- CONFIG_PLACEHOLDER -->", configScript);
}

module.exports = { animatorPage };
