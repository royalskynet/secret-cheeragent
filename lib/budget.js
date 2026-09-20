const fs = require('fs');
const { BUDGET_FILE, STATE_DIR } = require('./paths');
const { getConfig } = require('./corpus');

// Rolling window (default 24h). No UTC date cut-off: in GMT+8 the old daily
// reset fired at 08:00 local and burned the quota by noon.
function windowHours() {
  return getConfig().budget_window_hours || 24;
}

function cutoffMs() {
  return Date.now() - windowHours() * 3600 * 1000;
}

function trim(data, cutoff) {
  const recent = (data.recent_injections || []).filter(r =>
    new Date(r.ts).getTime() >= cutoff
  );
  // derived value: used_tokens is the trimmed window sum, never a stored counter
  return { date: new Date().toISOString(), recent_injections: recent, used_tokens: recent.reduce((s, r) => s + (r.tokens || 0), 0) };
}

function read() {
  try {
    const raw = fs.readFileSync(BUDGET_FILE, 'utf8');
    return trim(JSON.parse(raw), cutoffMs());
  } catch (_) {
    return { date: new Date().toISOString(), recent_injections: [], used_tokens: 0 };
  }
}

function write(data) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(BUDGET_FILE, JSON.stringify(data, null, 2));
  } catch (_) {}
}

function estimateTokens(text) {
  if (!text) return 0;
  let zh = 0, other = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) zh++;
    else other++;
  }
  return Math.ceil(zh / 2 + other / 4);
}

function canInject(estimatedTokens, tier = 1) {
  const cfg = getConfig();
  const data = read();
  const cap = cfg.daily_token_budget;
  const used = data.used_tokens;
  const warn = cap * (cfg.budget_warn_ratio || 0.7);

  // burst gate: minimum spacing between injections, checked before budget so
  // queued items cannot be consumed back-to-back by consecutive hooks.
  const last = data.recent_injections[data.recent_injections.length - 1];
  const minInterval = (cfg.min_inject_interval_minutes || 30) * 60 * 1000;
  if (last && Date.now() - new Date(last.ts).getTime() < minInterval) {
    return { ok: false, reason: 'min_interval', data };
  }

  if (used + estimatedTokens >= cap) {
    return { ok: false, reason: 'budget_exhausted', data };
  }
  if (used > warn && tier >= 4) {
    return { ok: false, reason: 'budget_warn_tier4_dropped', data };
  }
  if (used > warn && tier >= 2) {
    return { ok: false, reason: 'budget_warn_tier2_dropped', data };
  }
  return { ok: true, data };
}

function recordInjection(tokens, data) {
  data.recent_injections = data.recent_injections || [];
  data.recent_injections.push({ ts: new Date().toISOString(), tokens });
  const next = trim(data, cutoffMs());
  write(next);
  return next;
}

function burstMultiplier() {
  const cfg = getConfig();
  const data = read();
  const windowMs = (cfg.burst_window_hours || 2) * 3600 * 1000;
  const cutoff = Date.now() - windowMs;
  const recent = data.recent_injections.filter(r =>
    new Date(r.ts).getTime() >= cutoff
  );
  if (recent.length >= (cfg.burst_threshold_count || 3)) {
    return cfg.burst_gate_multiplier || 0.5;
  }
  return 1.0;
}

module.exports = { read, write, estimateTokens, canInject, recordInjection, burstMultiplier };
