const fs = require('fs');
const { LAST_INJECTED_FILE, STATE_DIR } = require('./paths');

function read() {
  try {
    const raw = fs.readFileSync(LAST_INJECTED_FILE, 'utf8').trim();
    return new Date(raw);
  } catch (_) {
    return new Date(0);
  }
}

function update() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(LAST_INJECTED_FILE, new Date().toISOString());
  } catch (_) {}
}

function hoursSinceLast() {
  const last = read();
  return (Date.now() - last.getTime()) / (3600 * 1000);
}

module.exports = { read, update, hoursSinceLast };
