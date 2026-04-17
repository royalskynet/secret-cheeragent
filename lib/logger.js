const fs = require('fs');
const { LOG_FILE, LOG_DIR } = require('./paths');

function log(entry) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) {
    // silent: logging must never break the hook
  }
}

module.exports = { log };
