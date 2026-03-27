require("dotenv").config();

const express = require("express");
const pageRoutes = require("./routes/pages");

const app = express();
const PORT = 3003;

app.use(express.json());
app.use(express.static("public"));
app.use(pageRoutes);

app.listen(PORT, () => {
  console.log("Map Animator running on http://127.0.0.1:" + PORT);
});
