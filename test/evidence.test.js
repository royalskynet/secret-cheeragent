#!/usr/bin/env node
/* Self-check for evidence detection + evidence-mode composition.
 * Pure node:assert, no frameworks. Never writes logs. */
const assert = require('assert');
const path = require('path');

const { detectEvidence } = require('../lib/evidence');
const { composeTemplate } = require('../lib/compose');
const corpus = require('../skills/secret-cheeragent/corpus.json');

let pass = 0;
function check(name, fn) { fn(); pass++; console.log(`PASS ${name}`); }

// 1. cited, concluded answer is evidence-backed
check('evidence: conclusion + citation detected', () => {
  const r = detectEvidence([
    { role: 'assistant', content: '結論：最可能是 X。參考 https://example.com/doc 的說明。' }
  ]);
  assert.strictEqual(r.hit, true);
});

// 2. hedged non-answer is not
check('hedged non-answer is skipped', () => {
  const r = detectEvidence([
    { role: 'assistant', content: '這個要視情況而定，不一定有答案。' }
  ]);
  assert.strictEqual(r.hit, false);
});

// 3. evidence-mode composition uses corpus.evidence as the main line
check('evidence mode composes from corpus.evidence', () => {
  const openers = corpus.openers;
  const closers = corpus.closers.map(x => x.replace(/[。！？.!?]+$/g, ''));
  const stems = corpus.evidence.map(x => x.replace(/[。！？.!?]+$/g, ''));

  for (let i = 0; i < 50; i++) {
    const out = composeTemplate({ principle_id: 1, session_summary: null, evidence_hit: true });
    const opener = openers.find(o => out.startsWith(o));
    assert.ok(opener, `no opener in: ${out}`);
    const closer = closers.find(c => out.endsWith(c));
    assert.ok(closer, `no closer in: ${out}`);
    const middle = out.slice(opener.length, out.length - closer.length - 1); // drop "，"
    assert.ok(stems.includes(middle), `main line not from corpus.evidence: ${middle}`);
  }
});

console.log(`\n${pass}/3 assertions pass for ${path.basename(__filename)}`);