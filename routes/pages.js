const express = require("express");
const { animatorPage } = require("../views/animatorPage");

const router = express.Router();

router.get("/", (req, res) => {
  res.type("html").send(animatorPage({
    maptilerApiKey: process.env.MAPTILER_API_KEY || "",
  }));
});

module.exports = router;
