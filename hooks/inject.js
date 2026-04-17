#!/usr/bin/env node
/* UserPromptSubmit hook — secret-cheerleader inject (Tier 1) */

const { listForSession, latest, remove } = require('../lib/queue');
const { log } = require('../lib/logger');
const { canInject, recordInjection, estimateTokens } = require('../lib/budget');
const { generateText } = require('../lib/generate');
const { update: updateLastInjected } = require('../lib/injected_tracker');

function readStdin() {
  return new Promise(resolve => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data), 1500);
  });
}

function emit(obj) {
  console.log(JSON.stringify(obj));
}

const silent = () => emit({ continue: true, suppressOutput: true });

async function main() {
  try {
    const raw = await readStdin();
    const payload = raw ? JSON.parse(raw) : {};
    const sessionId = payload.session_id || payload.sessionId;
    if (!sessionId) return silent();

    const items = listForSession(sessionId);
    if (items.length === 0) return silent();

    const chosen = latest(items);
    const ingredients = chosen.data;

    const budgetCheck = canInject(60, 1);
    if (!budgetCheck.ok) {
      log({ action: `skipped_${budgetCheck.reason}`, session_id: sessionId, tier: 1 });
      return silent();
    }

    const { text, mode, latency_ms } = await generateText(ingredients, '【應援】');
    const tokens = estimateTokens(text);

    recordInjection(tokens, budgetCheck.data);
    updateLastInjected();
    remove(chosen.filepath);

    log({
      action: 'injected',
      session_id: sessionId,
      tier: 1,
      mode,
      principle_id: ingredients.principle_id,
      easter_egg: ingredients.easter_egg,
      tokens,
      latency_ms,
      text
    });

    emit({
      continue: true,
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: text
      }
    });
  } catch (err) {
    log({ action: 'error', where: 'inject', message: err.message, stack: err.stack?.slice(0, 400) });
    silent();
  }
}

main();
