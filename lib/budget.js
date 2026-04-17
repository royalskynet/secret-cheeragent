const fs = require('fs');
const { BUDGET_FILE, STATE_DIR } = require('./paths');
const { getConfig } = require('./corpus');

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function read() {
  try {
    const raw = fs.readFileSync(BUDGET_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data.date !== todayStr()) {
      return { date: todayStr(), used_tokens: 0, recent_injections: [] };
    }
    return data;
  } catch (_) {
    return { date: todayStr(), used_tokens: 0, recent_injections: [] };
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
  data.used_tokens += tokens;
  data.recent_injections.push({ ts: new Date().toISOString(), tokens });
  const cutoff = Date.now() - 24 * 3600 * 1000;
  data.recent_injections = data.recent_injections.filter(r =>
    new Date(r.ts).getTime() >= cutoff
  );
  write(data);
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
