#!/usr/bin/env node
/**
 * download-geonames.js
 *
 * Downloads GeoNames cities1000.txt (populated places with population >= 1000)
 * and saves it to server/data/cities1000.txt.
 *
 * Usage:
 *   node scripts/download-geonames.js
 *
 * Source: https://download.geonames.org/export/dump/
 * License: Creative Commons Attribution 4.0
 */

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { execFileSync } = require('child_process');

const OUT_DIR  = path.join(__dirname, '../server/data');
const OUT_FILE = path.join(OUT_DIR, 'cities1000.txt');
const ZIP_URL  = 'https://download.geonames.org/export/dump/cities1000.zip';
const TMP_ZIP  = path.join(OUT_DIR, '_cities1000.zip');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => { fs.unlinkSync(dest); reject(err); });
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Downloading cities1000.zip from GeoNames…');
  await download(ZIP_URL, TMP_ZIP);
  console.log('Downloaded. Extracting…');

  // Try unzip first, fall back to Python's zipfile module
  try {
    execFileSync('unzip', ['-o', '-j', TMP_ZIP, 'cities1000.txt', '-d', OUT_DIR]);
  } catch (e) {
    if (e.code === 'ENOENT') {
      execFileSync('python3', ['-c',
        `import zipfile, os; zipfile.ZipFile('${TMP_ZIP}').extract('cities1000.txt', '${OUT_DIR}')`
      ]);
    } else throw e;
  }
  fs.unlinkSync(TMP_ZIP);

  const lines = fs.readFileSync(OUT_FILE, 'utf8').trim().split('\n').length;
  console.log(`✓ ${OUT_FILE} (${lines.toLocaleString()} places)`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
