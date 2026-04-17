const fs = require('fs');
const { CORPUS_FILE } = require('./paths');

let cache = null;

function load() {
  if (cache) return cache;
  const raw = fs.readFileSync(CORPUS_FILE, 'utf8');
  cache = JSON.parse(raw);
  return cache;
}

function getConfig() {
  return load().config;
}

module.exports = { load, getConfig };
