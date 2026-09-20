#!/usr/bin/env node
/* Detached background worker — pre-generates LLM cheer text.
   Runs decoupled from the hook process. Writes result back to the queue file. */

const fs = require('fs');
const { load } = require('../lib/corpus');
const { composeTemplate } = require('../lib/compose');
const { generateWithLLM } = require('../lib/llm');

const queueFile = process.argv[2];
if (!queueFile) process.exit(0);

function log(entry) {
  try { require('../lib/logger').log(entry); } catch (_) {}
}

async function main() {
  let entry;
  try { entry = JSON.parse(fs.readFileSync(queueFile, 'utf8')); }
  catch (_) { process.exit(0); }

  if (!entry || entry.mode !== 'llm') process.exit(0);

  try {
    const c = load();
    const principle = c.erickson.find(p => p.id === entry.principle_id) || c.erickson[0];
    const result = await generateWithLLM(entry, principle.name);
    entry.text = result.text;
    entry.llm_mode = 'llm:' + result.model;
  } catch (err) {
    log({ action: 'pregen_llm_fail', reason: err.message, session_id: entry.session_id });
    // Don't write text — inject will use template fallback
    process.exit(0);
  }

  // Atomic write-back with guard: file may have been consumed by inject
  try {
    if (!fs.existsSync(queueFile)) return;
    const tmp = queueFile + '.pregen.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(entry));
    fs.renameSync(tmp, queueFile);
  } catch (_) {}
}

main();
