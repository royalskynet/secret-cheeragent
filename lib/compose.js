const { load, getConfig } = require('./corpus');
const { estimateTokens } = require('./budget');
const { EVIDENCE_GUIDANCE } = require('./guidance');

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
  const sentences = text.match(/[^。！？.!?]*[。！？.!?]/g) || [];
  const complete = sentences.find(sentence => estimateTokens(sentence.trim()) <= maxTokens);
  return complete ? complete.trim() : '';
}

function finalize(raw, prefix = '【應援】') {
  const cfg = getConfig();
  const maxTokens = cfg.max_injection_tokens;
  const prefixTokens = estimateTokens(prefix);
  const guidanceTokens = estimateTokens(EVIDENCE_GUIDANCE);
  const cheerBudget = Math.max(0, maxTokens - prefixTokens - guidanceTokens - 1);
  const cheer = cheerBudget >= 8
    ? truncateToSentence(raw, cheerBudget)
        .replace(/[。！？.!?]+$/g, '')
        .trim()
    : '';
  const combined = cheer
    ? `${cheer}；${EVIDENCE_GUIDANCE}`
    : EVIDENCE_GUIDANCE;
  return `${prefix}${combined}`;
}

module.exports = { composeTemplate, truncateToSentence, finalize, pick };
