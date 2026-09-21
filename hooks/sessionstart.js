#!/usr/bin/env node
/* SessionStart hook — secret-cheeragent orphan consumer + 24h floor (Tier 2 & Tier 4) */

const { listOrphans, remove } = require('../lib/queue');
const { log } = require('../lib/logger');
const { canInject, recordInjection, estimateTokens } = require('../lib/budget');
const { generateText } = require('../lib/generate');
const { getConfig } = require('../lib/corpus');
const { update: updateLastInjected, hoursSinceLast } = require('../lib/injected_tracker');

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

async function handleOrphan(orphans, sessionId) {
  const cfg = getConfig();
  const jackpot = Math.min(orphans.length, cfg.jackpot_max_count ?? 3);
  // main note is the newest; older ones stack as extra cheer lines
  const newestFirst = [...orphans].sort((a, b) => b.mtime - a.mtime);
  const newest = newestFirst[0];
  const consumed = newestFirst.slice(0, jackpot);

  const extraLines = jackpot - 1;
  const maxTokens = cfg.max_injection_tokens + extraLines * (cfg.jackpot_bonus_tokens ?? 10);
  const budgetCheck = canInject(maxTokens, 2);
  if (!budgetCheck.ok) {
    // keep the WHOLE backlog untouched: blocking rolls the jackpot to next round
    log({
      action: `skipped_${budgetCheck.reason}`,
      session_id: sessionId,
      tier: 2,
      note: 'orphans not consumed, kept in queue',
      jackpot
    });
    return silent();
  }

  const prefix = jackpot >= 2
    ? `【應援・累積 ${jackpot} 份】`
    : '【應援・上一輪】';
  const { text, mode, latency_ms } = await generateText(
    newest.data,
    prefix,
    { maxTokens, extraLines }
  );

  if (text == null) {
    // cheer-first failed: never inject a cue-only note (9278)
    log({
      action: 'skipped_cheer_budget_too_small',
      session_id: sessionId,
      tier: 2,
      jackpot,
      note: 'cheer could not fit, nothing consumed'
    });
    return silent();
  }

  const tokens = estimateTokens(text);

  recordInjection(tokens, budgetCheck.data);
  updateLastInjected();
  for (const o of consumed) remove(o.filepath);

  log({
    action: 'injected_orphan',
    session_id: sessionId,
    tier: 2,
    original_session: newest.data.session_id,
    jackpot,
    consumed: consumed.length,
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

  const budgetCheck = canInject(cfg.max_injection_tokens, 4);
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
    '【應援・久違】'
  );
  if (text == null) {
    log({ action: 'skipped_cheer_budget_too_small', session_id: sessionId, tier: 4 });
    return silent();
  }
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
      return await handleOrphan(orphans, sessionId);
    }

    return await handleFloor(sessionId);
  } catch (err) {
    log({ action: 'error', where: 'sessionstart', message: err.message, stack: err.stack?.slice(0, 400) });
    silent();
  }
}

main();
