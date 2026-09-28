// Evidence detection — only reward answers that are evidence-backed or
// reach a conclusion, never hedged non-answers.
const { extractText } = require('./detect');

// Mirrors lib/detect.js lastOfRole (that one is not exported; behavior copied
// verbatim so role matching stays identical).
function lastOfRole(entries, role) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const r = e.role || e.message?.role || e.type;
    if (r === role || r === `${role}_message`) return e;
  }
  return null;
}

const SOURCE_RE = [
  /https?:\/\/[^\s"'）)】]+/,
  /file:\/\/[^\s"'）)】]+/,
  /[\w./-]+\.(md|js|ts|py|json|html|css|sh|ya?ml)[:#][0-9]+/,
  /\b(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/
];
const SOURCE_WORDS = ['參考', '來源', '見文件', '參閱', '出處'];

const CONCLUSION_RE = [/(結論|答案)[:：]/, /最可能(的)?是/, /應(該|為)/];

const HEDGE_WORDS = [
  '視情況而定', '取決於', '不一定', '難以確定', '都有可能',
  '要看情況', '視需求', '視狀況', 'it depends', 'case by case'
];

function detectEvidence(entries) {
  const empty = { hit: false, kind: 'none', matched: '' };
  if (!Array.isArray(entries) || entries.length === 0) return empty;

  const last = lastOfRole(entries, 'assistant') || entries[entries.length - 1];
  const text = extractText(last);
  if (!text) return empty;

  for (const re of SOURCE_RE) {
    const m = text.match(re);
    if (m) return { hit: true, kind: 'source', matched: m[0] };
  }
  for (const w of SOURCE_WORDS) {
    if (text.includes(w)) return { hit: true, kind: 'source', matched: w };
  }

  for (const re of CONCLUSION_RE) {
    const m = text.match(re);
    if (m) return { hit: true, kind: 'conclusion', matched: m[0] };
  }

  for (const w of HEDGE_WORDS) {
    if (text.toLowerCase().includes(w)) return empty;
  }

  return empty;
}

module.exports = { detectEvidence };