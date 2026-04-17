const { load, getConfig } = require('./corpus');
const { estimateTokens } = require('./budget');

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function composeTemplate(ingredients) {
  const c = load();
  const principle = c.erickson.find(p => p.id === ingredients.principle_id) || c.erickson[0];
  const core = pick(principle.lines);
  const opener = pick(c.openers);
  const closer = pick(c.closers);

  let bridge = '';
  if (ingredients.session_summary && Math.random() < 0.5) {
    const tpl = pick(c.session_bridges);
    bridge = tpl.replace('{verb}', ingredients.session_summary).replace('{target}', ingredients.session_summary);
    bridge = bridge + '，';
  }

  let line;
  if (bridge) {
    line = `${opener}${bridge}${core} ${closer}`;
  } else {
    line = `${opener}${core} ${closer}`;
  }

  if (ingredients.easter_egg) {
    const egg = pick(c.easter_eggs_en);
    if (Math.random() < 0.5) {
      line = `${egg} ${line}`;
    } else {
      line = `${line} ${egg}`;
    }
  }

  return line.trim();
}

function truncateToSentence(text, maxTokens) {
  if (estimateTokens(text) <= maxTokens) return text;
  const sentenceEnders = ['。', '！', '？', '.', '!', '?'];
  let cursor = 0;
  let best = '';
  while (cursor < text.length) {
    const nextIdxs = sentenceEnders.map(e => text.indexOf(e, cursor)).filter(i => i >= 0);
    if (nextIdxs.length === 0) break;
    const nearest = Math.min(...nextIdxs);
    const candidate = text.slice(0, nearest + 1);
    if (estimateTokens(candidate) > maxTokens) break;
    best = candidate;
    cursor = nearest + 1;
  }
  if (best) return best.trim();
  // no sentence found, hard trim
  return text.slice(0, maxTokens * 2).trim() + '。';
}

function finalize(raw, prefix = '【應援】') {
  const cfg = getConfig();
  const truncated = truncateToSentence(raw, cfg.max_injection_tokens);
  return `${prefix}${truncated}`;
}

module.exports = { composeTemplate, truncateToSentence, finalize, pick };
