const fs = require("fs");
const path = require("path");

function animatorPage({ maptilerApiKey = "" } = {}) {
  const template = fs.readFileSync(path.join(__dirname, "animator.html"), "utf8");
  const configScript = `<script>window.__config = ${JSON.stringify({ maptilerApiKey })};</script>`;
  return template.replace("<!-- CONFIG_PLACEHOLDER -->", configScript);
}

module.exports = { animatorPage };
