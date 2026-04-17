const fs = require('fs');
const path = require('path');
const { QUEUE_DIR } = require('./paths');

function ensureDir() {
  fs.mkdirSync(QUEUE_DIR, { recursive: true });
}

function enqueue(item) {
  ensureDir();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const safeSid = String(item.session_id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${safeSid}-${ts}.json`;
  const filepath = path.join(QUEUE_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify({ ...item, created_at: new Date().toISOString() }, null, 2));
  return filepath;
}

function listAll() {
  ensureDir();
  try {
    const files = fs.readdirSync(QUEUE_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const filepath = path.join(QUEUE_DIR, f);
        try {
          const stat = fs.statSync(filepath);
          const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
          return { filepath, filename: f, mtime: stat.mtimeMs, data };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
    return files;
  } catch (_) {
    return [];
  }
}

function listForSession(sessionId) {
  return listAll().filter(f => f.data.session_id === sessionId);
}

function listOrphans(currentSessionId) {
  return listAll().filter(f => f.data.session_id !== currentSessionId);
}

function latest(list) {
  if (list.length === 0) return null;
  return list.slice().sort((a, b) => b.mtime - a.mtime)[0];
}

function remove(filepath) {
  try { fs.unlinkSync(filepath); } catch (_) {}
}

module.exports = { ensureDir, enqueue, listAll, listForSession, listOrphans, latest, remove };
