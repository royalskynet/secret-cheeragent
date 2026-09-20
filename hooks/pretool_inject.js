#!/usr/bin/env node
/* PreToolUse hook — secret-cheeragent stealth inject (Tier 1).
 *
 * Why PreToolUse instead of UserPromptSubmit:
 *   UserPromptSubmit's additionalContext surfaces as <system-reminder> in CLI
 *   (Claude Code transparency-by-design). PreToolUse's additionalContext does
 *   not surface — agent receives it silently before the next tool call. See
 *   STEALTH.md for the full hook-surface analysis. */

const { listForSession, listOrphans, latest, remove } = require('../lib/queue');
const { log } = require('../lib/logger');
const { canInject, recordInjection, estimateTokens } = require('../lib/budget');
const { composeTemplate, finalize } = require('../lib/compose');
const { getConfig } = require('../lib/corpus');
const { update: updateLastInjected } = require('../lib/injected_tracker');

function readStdin() {
  return new Promise(resolve => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(data);
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', done);
    const timer = setTimeout(done, 1500);
    timer.unref();
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

    const eventName = payload.hook_event_name || payload.hookEventName || 'PreToolUse';
    const currentItems = listForSession(sessionId);
    // Gemini intentionally omits SessionStart because it writes hook context
    // into visible conversation history. BeforeAgent silently consumes the
    // newest prior-session item instead.
    const isGeminiBeforeAgent = eventName === 'BeforeAgent';
    const items = currentItems.length > 0
      ? currentItems
      : (isGeminiBeforeAgent ? listOrphans(sessionId) : []);
    if (items.length === 0) return silent();

    const chosen = latest(items);
    const ingredients = chosen.data;
    const tier = currentItems.length > 0 ? 1 : 2;

    const budgetCheck = canInject(getConfig().max_injection_tokens, tier);
    if (!budgetCheck.ok) {
      log({ action: `skipped_${budgetCheck.reason}`, session_id: sessionId, tier });
      return silent();
    }

    const start = Date.now();
    let text, mode;
    if (chosen.data.text) {
      text = finalize(chosen.data.text, '【應援】');
      mode = chosen.data.llm_mode || 'llm:pregen';
    } else {
      text = finalize(composeTemplate(ingredients), '【應援】');
      mode = ingredients.mode === 'llm' ? 'template_fallback' : 'template';
    }
    const latency_ms = Date.now() - start;
    const tokens = estimateTokens(text);

    recordInjection(tokens, budgetCheck.data);
    updateLastInjected();
    remove(chosen.filepath);

    log({
      action: 'injected',
      session_id: sessionId,
      tier,
      hook_event_name: eventName,
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
        hookEventName: eventName,
        additionalContext: text
      }
    });
  } catch (err) {
    log({ action: 'error', where: 'inject', message: err.message, stack: err.stack?.slice(0, 400) });
    silent();
  }
}

main();
