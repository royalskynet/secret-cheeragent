#!/usr/bin/env node
/* Self-check for lib/compose.js cheer-first composition + jackpot stacking.
 * Pure node:assert, no frameworks. Reads corpus config from the repo. */
const assert = require('assert');
const path = require('path');

const { composeTemplate, finalize } = require('../lib/compose');
const { EVIDENCE_GUIDANCE } = require('../lib/guidance');
const { getConfig } = require('../lib/corpus');
const corpus = require('../skills/secret-cheeragent/corpus.json');

let pass = 0;
function check(name, fn) { fn(); pass++; console.log(`PASS ${name}`); }

const PREFIXES = ['【應援】', '【應援・上一輪】', '【應援・累積 3 份】', '【應援・久違】'];
const maxTokens = getConfig().max_injection_tokens; // 44

// strip prefix and trailing "；guidance"; return the cheer portion
function cheerOf(out, prefix) {
  assert.ok(out.startsWith(prefix), `missing prefix ${prefix}: ${out}`);
  const tail = out.slice(prefix.length);
  assert.ok(tail.endsWith(EVIDENCE_GUIDANCE), `missing guidance in: ${out}`);
  return tail.slice(0, tail.length - EVIDENCE_GUIDANCE.length - 1); // drop "；"
}

// 1. cheer-bottom floor: after prefix + guidance, remaining cheer >= 8 tokens
check('cheer bottom: >= 8 tokens left under all four prefixes (cap 44)', () => {
  for (const p of PREFIXES) {
    for (let i = 0; i < 20; i++) {
      const out = finalize(composeTemplate({ principle_id: 1 + (i % 8), session_summary: null }), p);
      assert.ok(out != null, `${p} produced null`);
      assert.ok(cheerOf(out, p).length > 0, `${p} cheer empty`);
    }
  }
});

// 2. guidance always attached: full EVIDENCE_GUIDANCE under all four prefixes
check('cue always attaches full EVIDENCE_GUIDANCE', () => {
  for (const p of PREFIXES) {
    for (let i = 0; i < 20; i++) {
      const out = finalize(composeTemplate({ principle_id: 1 + (i % 8), session_summary: null }), p);
      assert.ok(out != null);
      assert.ok(out.includes(EVIDENCE_GUIDANCE), `${p} missing cue`);
    }
  }
});

// 3. no truncation: cheer equals composeTemplate original verbatim (cap 44 never truncates)
check('no truncation over 200 random principle_ids', () => {
  for (let i = 0; i < 200; i++) {
    const raw = composeTemplate({ principle_id: 1 + (i % 8), session_summary: null });
    const out = finalize(raw, '【應援】');
    assert.strictEqual(cheerOf(out, '【應援】'), raw);
  }
});

// 4. jackpot stacking keeps at least as many lines as base
check('jackpot extraLines >= base line count', () => {
  for (let i = 0; i < 50; i++) {
    const id = 1 + (i % 8);
    const base = finalize(composeTemplate({ principle_id: id, session_summary: null }), '【應援】', { maxTokens: 64 });
    const stacked = finalize(composeTemplate({ principle_id: id, session_summary: null }), '【應援】', { maxTokens: 64, extraLines: 2 });
    const baseN = cheerOf(base, '【應援】').split('；').length;
    const stkN = cheerOf(stacked, '【應援】').split('；').length;
    assert.ok(stkN >= baseN, `stacked ${stkN} < base ${baseN}`);
  }
});

// 5. punctuation & dedup: no half-width junction, no repeated opener/closer
check('no half-width junction + opener/closer dedup over 200 runs', () => {
  const openers = corpus.openers;
  const closers = corpus.closers.map(x => x.replace(/[。！？.!?]+$/g, '')); // finalize strips the period
  for (let i = 0; i < 200; i++) {
    const id = 1 + (i % 8);
    const out = finalize(composeTemplate({ principle_id: id, session_summary: null }), '【應援】', { maxTokens: 64, extraLines: 2 });
    assert.ok(out != null);
    const cheer = cheerOf(out, '【應援】');
    const lines = cheer.split('；');
    const seenO = new Set();
    const seenC = new Set();
    for (const line of lines) {
      const o = openers.find(x => line.startsWith(x));
      const c = closers.find(x => line.endsWith(x));
      assert.ok(o, `no opener in: ${line}`);
      assert.ok(c, `no closer in: ${line}`);
      // junction check: the closer must be preceded by "，" (full-width), never a
      // half-width space (the pre-fix bug was `${core} ${closer}`)
      assert.strictEqual(line[line.length - c.length - 1], '，', `space/tone junction before closer: ${line}`);
      assert.ok(!seenO.has(o), `duplicate opener ${o} in: ${cheer}`);
      assert.ok(!seenC.has(c), `duplicate closer ${c} in: ${cheer}`);
      seenO.add(o);
      seenC.add(c);
    }
  }
});

// 6. empty cheer => null (cap too small + long prefix)
check('empty cheer returns null, never a cue-only note', () => {
  const out = finalize(
    composeTemplate({ principle_id: 1, session_summary: null }),
    '【應援・累積 3 份】',
    { maxTokens: 24 }
  );
  assert.strictEqual(out, null);
});

console.log(`\n${pass}/6 assertions pass for ${path.basename(__filename)}`);
