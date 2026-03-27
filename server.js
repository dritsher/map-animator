require("dotenv").config();

const express = require("express");
const pageRoutes = require("./routes/pages");
const apiRoutes  = require("./routes/api");

const app = express();
const PORT = 3003;

app.use(express.json({ limit: "20mb" })); // large enough for a 1080p PNG frame
app.use(express.static("public"));
app.use(apiRoutes);
app.use(pageRoutes);

app.listen(PORT, () => {
  console.log("Map Animator running on http://127.0.0.1:" + PORT);
});
