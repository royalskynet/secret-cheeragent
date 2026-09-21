#!/usr/bin/env node
/* Self-check for orphan jackpot rollover: SessionStart consumes the whole
 * backlog as one injection (jackpot), removes the newest jackpot_max_count
 * notes, and leaves the rest for the next round. Isolated via CHEER_STATE_DIR. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const stateDir = path.join(process.env.TMPDIR || '/tmp', `cheer-queue-${process.pid}`);
process.env.CHEER_STATE_DIR = stateDir;

const { enqueue, listAll, listOrphans } = require('../lib/queue');
const { LOG_FILE } = require('../lib/paths');
const { BUDGET_FILE } = require('../lib/paths');

function resetState() {
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(BUDGET_FILE, JSON.stringify({ date: new Date().toISOString(), recent_injections: [] }));
}

function runHook(sessionId) {
  const out = execFileSync('node', [path.join(__dirname, '..', 'hooks', 'sessionstart.js')], {
    input: JSON.stringify({ session_id: sessionId }),
    env: { ...process.env, CHEER_STATE_DIR: stateDir },
    encoding: 'utf8'
  });
  return out;
}

function lastInjectedLog(sessionId) {
  const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n');
  const hit = [];
  for (const l of lines) {
    try {
      const o = JSON.parse(l);
      if (o.action === 'injected_orphan' && o.session_id === sessionId) hit.push(o);
    } catch (_) {}
  }
  return hit[hit.length - 1];
}

let pass = 0;
function check(name, fn) { fn(); pass++; console.log(`PASS ${name}`); }

// 7. three orphans from three sessions -> all three consumed, jackpot === 3
resetState();
const sessions7 = ['orph-a', 'orph-b', 'orph-c'];
for (const s of sessions7) enqueue({ session_id: s, principle_id: 1, mode: 'template', session_summary: null, easter_egg: false });
runHook('current-7');
check('jackpot consumes all 3 orphans, jackpot field === 3', () => {
  assert.strictEqual(listAll().length, 0, `expected 0 left, got ${listAll().length}`);
  const rec = lastInjectedLog('current-7');
  assert.ok(rec, 'no injected_orphan log for current-7');
  assert.strictEqual(rec.consumed, 3);
  assert.strictEqual(rec.jackpot, 3);
});

// 8. seven orphans, jackpot_max_count 3 -> 3 removed, 4 kept for next round
resetState();
const sessions8 = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'];
for (const s of sessions8) enqueue({ session_id: s, principle_id: 2, mode: 'template', session_summary: null, easter_egg: false });
assert.strictEqual(listAll().length, 7, 'setup: 7 orphans');
runHook('current-8');
check('jackpot capped at 3: 3 removed, 4 roll over', () => {
  const left = listAll();
  assert.strictEqual(left.length, 4, `expected 4 left, got ${left.length}`);
  const rec = lastInjectedLog('current-8');
  assert.ok(rec, 'no injected_orphan log for current-8');
  assert.strictEqual(rec.consumed, 3);
  assert.strictEqual(rec.jackpot, 3);
});

fs.rmSync(stateDir, { recursive: true, force: true });
console.log(`\n${pass}/2 assertions pass for ${path.basename(__filename)}`);
