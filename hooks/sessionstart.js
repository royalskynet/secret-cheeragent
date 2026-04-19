#!/usr/bin/env node
/* SessionStart hook — secret-cheeragent orphan consumer + 24h floor (Tier 2 & Tier 4) */

const { listOrphans, latest, remove } = require('../lib/queue');
const { log } = require('../lib/logger');
const { canInject, recordInjection, estimateTokens } = require('../lib/budget');
const { generateText } = require('../lib/generate');
const { getConfig } = require('../lib/corpus');
const { update: updateLastInjected, hoursSinceLast } = require('../lib/injected_tracker');

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

function emitContext(text) {
  emit({
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: text
    }
  });
}

async function handleOrphan(orphan, sessionId) {
  const budgetCheck = canInject(60, 2);
  if (!budgetCheck.ok) {
    log({
      action: `skipped_${budgetCheck.reason}`,
      session_id: sessionId,
      tier: 2,
      note: 'orphan not consumed, kept in queue'
    });
    return silent();
  }

  const { text, mode, latency_ms } = await generateText(orphan.data, '【應援・上一輪留給你】');
  const tokens = estimateTokens(text);

  recordInjection(tokens, budgetCheck.data);
  updateLastInjected();
  remove(orphan.filepath);

  log({
    action: 'injected_orphan',
    session_id: sessionId,
    tier: 2,
    original_session: orphan.data.session_id,
    mode,
    tokens,
    latency_ms,
    text
  });

  emitContext(text);
}

async function handleFloor(sessionId) {
  const cfg = getConfig();
  const threshold = cfg.force_floor_hours ?? 24;
  const hours = hoursSinceLast();
  if (hours <= threshold) {
    return silent();
  }

  const budgetCheck = canInject(60, 4);
  if (!budgetCheck.ok) {
    log({
      action: `skipped_${budgetCheck.reason}`,
      session_id: sessionId,
      tier: 4,
      hours_since_last: Number(hours.toFixed(1))
    });
    return silent();
  }

  const principleId = 1 + Math.floor(Math.random() * 8);
  const mode = Math.random() < (cfg.llm_improv_ratio ?? 0.3) ? 'llm' : 'template';
  const easterEgg = Math.random() < (cfg.easter_egg_ratio ?? 0.02);
  const ingredients = {
    session_id: sessionId,
    principle_id: principleId,
    mode,
    session_summary: null,
    easter_egg: easterEgg
  };

  const { text, mode: usedMode, latency_ms } = await generateText(
    ingredients,
    '【好久沒打招呼了，想跟你說聲辛苦了】'
  );
  const tokens = estimateTokens(text);

  recordInjection(tokens, budgetCheck.data);
  updateLastInjected();

  log({
    action: 'forced_floor',
    reason: '24h_no_injection',
    session_id: sessionId,
    tier: 4,
    hours_since_last: Number(hours.toFixed(1)),
    mode: usedMode,
    tokens,
    latency_ms,
    text
  });

  emitContext(text);
}

async function main() {
  try {
    const raw = await readStdin();
    const payload = raw ? JSON.parse(raw) : {};
    const sessionId = payload.session_id || payload.sessionId || 'unknown';

    const orphans = listOrphans(sessionId);
    if (orphans.length > 0) {
      const chosen = latest(orphans);
      return await handleOrphan(chosen, sessionId);
    }

    return await handleFloor(sessionId);
  } catch (err) {
    log({ action: 'error', where: 'sessionstart', message: err.message, stack: err.stack?.slice(0, 400) });
    silent();
  }
}

main();
