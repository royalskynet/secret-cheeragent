const { load, getConfig } = require('./corpus');
const { estimateTokens } = require('./budget');
const { EVIDENCE_GUIDANCE } = require('./guidance');

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// pick an opener not already used in this injection; fall back to all when
// candidates are exhausted so a long stack still composes.
function pickAvailable(arr, used) {
  const avail = arr.filter(x => !used.has(x));
  return avail.length ? pick(avail) : pick(arr);
}

// closers are stored with a trailing period in the corpus, but segments use the
// stemmed form — dedup on the stemmed form so main + stacked lines never share
// the same closer.
function pickCloser(usedClosers) {
  const c = load();
  const stemmed = c.closers.map(cl => cl.replace(/[。！？.!?]+$/g, ''));
  const avail = stemmed.filter(x => !usedClosers.has(x));
  const picked = avail.length ? pick(avail) : pick(stemmed);
  usedClosers.add(picked);
  return picked;
}

// Build one cheer segment (main or extra). Joins opener/core/closer with
// Chinese punctuation, never a half-width space.
function buildSegment(id, sessionSummary, easterEgg, usedOpeners, usedClosers) {
  const c = load();
  const principle = c.erickson.find(p => p.id === id) || c.erickson[0];
  const core = pick(principle.lines).replace(/[。！？.!?]+$/g, '');
  const opener = pickAvailable(c.openers, usedOpeners);
  const closer = pickCloser(usedClosers);
  usedOpeners.add(opener);

  let body = core;
  if (sessionSummary && Math.random() < 0.5) {
    const tpl = pick(c.session_bridges);
    body = tpl.replace('{verb}', sessionSummary).replace('{target}', sessionSummary) + '，' + core;
  }

  let line = `${opener}${body}，${closer}`;
  if (easterEgg && Math.random() < 0.5) {
    line = `${pick(c.easter_eggs_en)} ${line}`;
  }
  return line;
}

function composeTemplate(ingredients) {
  return buildSegment(
    ingredients.principle_id,
    ingredients.session_summary,
    ingredients.easter_egg,
    new Set(),
    new Set()
  );
}

function truncateToSentence(text, maxTokens) {
  if (estimateTokens(text) <= maxTokens) return text;
  const sentences = text.match(/[^。！？.!?]*[。！？.!?]/g) || [];
  const complete = sentences.find(sentence => estimateTokens(sentence.trim()) <= maxTokens);
  // ponytail: composed lines have no 。！？.!? boundary (they end plain), so a
  // single line slightly over budget cannot be split sentence-wise. Return the
  // full line rather than empty the cheer — dropping the cheer entirely is
  // worse than going a token over on a rare long line.
  return complete ? complete.trim() : text.trim();
}

// Detect which opener/closer a composed main line starts/ends with, so stack
// lines can dedup against it. Returns null opener/closer when not matched
// (e.g. LLM-generated line), which just skips marking them used.
function detectParts(line) {
  const c = load();
  const opener = c.openers.find(o => line.startsWith(o)) || null;
  // closers are stored with a trailing period, but buildSegment strips it —
  // mark the stripped form used so it dedups against stacked lines
  const matched = c.closers.find(cl => line.endsWith(cl.replace(/[。！？.!?]+$/g, ''))) || null;
  const closer = matched ? matched.replace(/[。！？.!?]+$/g, '') : null;
  return { opener, closer };
}

function finalize(raw, prefix = '【應援】', opts = {}) {
  const cfg = getConfig();
  const maxTokens = opts.maxTokens ?? cfg.max_injection_tokens;
  const extraLines = opts.extraLines ?? 0;
  const principleId = opts.principleId ?? 1;
  const prefixTokens = estimateTokens(prefix);
  const guidanceTokens = estimateTokens(EVIDENCE_GUIDANCE);
  // cheer-first: the cheer gets every token left after prefix, guidance and 1 separator
  const cheerBudget = Math.max(0, maxTokens - prefixTokens - guidanceTokens - 1);

  if (cheerBudget < 8) return null; // empty cheer is a failure, never a cue-only note

  const usedOpeners = new Set();
  const usedClosers = new Set();
  const main = raw && typeof raw === 'string'
    ? raw
    : buildSegment(principleId, null, false, usedOpeners, usedClosers);

  const parts = detectParts(main);
  if (parts.opener) usedOpeners.add(parts.opener);
  if (parts.closer) usedClosers.add(parts.closer);

  const segments = [main];

  // best-effort stack: take different principle_ids, stop when budget is short
  const others = shuffle(load().erickson.filter(p => p.id !== principleId).map(p => p.id));
  for (const id of others.slice(0, extraLines)) {
    const extra = buildSegment(id, null, false, usedOpeners, usedClosers);
    // room check against the *cheer* budget (guidance+prefix already reserved)
    if (estimateTokens(segments.join('；')) + estimateTokens(extra) + 1 > cheerBudget) break;
    segments.push(extra);
  }

  // main cheer still capped to the cheer budget (never truncates at cap 44);
  // empty after truncate => no cheer => fail
  const cheer = truncateToSentence(segments.join('；'), cheerBudget).replace(/[。！？.!?]+$/g, '');
  if (!cheer) return null;

  return `${prefix}${cheer}；${EVIDENCE_GUIDANCE}`;
}

module.exports = { composeTemplate, truncateToSentence, finalize, pick };
