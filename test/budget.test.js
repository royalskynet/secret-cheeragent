#!/usr/bin/env node
/* Self-check for lib/budget.js rolling-window + min-interval logic.
 * Isolated via CHEER_STATE_DIR (never touches ~/.claude/state). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const stateDir = path.join(process.env.TMPDIR || '/tmp', `cheer-test-${process.pid}`);
process.env.CHEER_STATE_DIR = stateDir;

const { read, canInject, recordInjection } = require('../lib/budget');
const { BUDGET_FILE } = require('../lib/paths');
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'skills/secret-cheeragent/corpus.json'), 'utf8'));
const cfg = corpus.config;

function writeState(recent, extra = {}) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(BUDGET_FILE, JSON.stringify({ date: extra.date || new Date().toISOString(), recent_injections: recent }, null, 2));
}
function agoMin(m) { return new Date(Date.now() - m * 60 * 1000).toISOString(); }
let pass = 0;
function check(name, fn) { fn(); pass++; console.log(`PASS ${name}`); }

assert(cfg.budget_window_hours === 24 && cfg.min_inject_interval_minutes === 30, 'test config assumptions');
// R3 budget config: jackpot room depends on the raised cap and the bonus fields
assert(cfg.daily_token_budget === 240, 'daily_token_budget must be 240');
assert(cfg.max_injection_tokens === 44, 'max_injection_tokens must be 44');
assert(cfg.jackpot_bonus_tokens === 10, 'jackpot_bonus_tokens must be 10');
assert(cfg.jackpot_max_count === 3, 'jackpot_max_count must be 3');

// 1. rolling window: 3 injections 25h ago → expired, used_tokens 0, canInject ok
writeState([{ ts: agoMin(25 * 60), tokens: 30 }, { ts: agoMin(25 * 60 + 5), tokens: 30 }, { ts: agoMin(26 * 60), tokens: 36 }]);
check('rolling window: old injections fall out, used_tokens === 0', () => {
  const d = read();
  assert.strictEqual(d.used_tokens, 0);
  assert.strictEqual(canInject(32, 1).ok, true);
});

// 2. no date cut-off: stale date "2000-01-01" + 1h-ago 220 tokens → used 220,
//    exhausted against the raised cap 240
writeState([{ ts: agoMin(60), tokens: 220 }], { date: '2000-01-01' });
check('no day cut: stale date ignored, budget still counts', () => {
  const d = read();
  assert.strictEqual(d.used_tokens, 220);
  const r = canInject(32, 1);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'budget_exhausted');
});

// 3. min interval: a 5-minute-ago injection blocks
writeState([{ ts: agoMin(5), tokens: 10 }]);
check('min interval: blocks when last injection < 30min ago', () => {
  const r = canInject(32, 1);
  assert.strictEqual(r.reason, 'min_interval');
  assert.strictEqual(r.ok, false);
});

// 4. interval passed: a 31-minute-ago injection allows
writeState([{ ts: agoMin(31), tokens: 10 }]);
check('interval passed: allows when last injection >= 30min ago', () => {
  const r = canInject(32, 1);
  assert.strictEqual(r.ok, true);
});

// 5. min_inject_interval_minutes: 0 must fully disable the gate (?? vs ||) —
//    a 1-minute-ago injection still does not block, because 1 < 0 is false.
//    cache-bust corpus & budget so canInject reads a patched 0-interval config
writeState([{ ts: agoMin(1), tokens: 10 }]);
{
  const corpusPath = require.resolve('../lib/corpus');
  const budgetPath = require.resolve('../lib/budget');
  delete require.cache[corpusPath];
  delete require.cache[budgetPath];
  const corpusMod = require('../lib/corpus');
  const baseCfg = corpusMod.getConfig();
  corpusMod.getConfig = () => ({ ...baseCfg, min_inject_interval_minutes: 0 });
  const fresh = require('../lib/budget');
  check('min interval 0 disables the gate (recent injection not blocked)', () => {
    assert.strictEqual(fresh.canInject(32, 1).ok, true);
  });
}


// recordInjection round-trip: appends and derives used_tokens
writeState([]);
const recorded = recordInjection(16, { recent_injections: [] });
assert.strictEqual(recorded.used_tokens, 16);
assert.strictEqual(recorded.recent_injections.length, 1);
pass++;
console.log('PASS recordInjection derives used_tokens');

fs.rmSync(stateDir, { recursive: true, force: true });
console.log(`\n${pass}/6 assertions pass for ${path.basename(__filename)}`);
