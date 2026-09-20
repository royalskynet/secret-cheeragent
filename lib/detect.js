const fs = require('fs');
const { getConfig } = require('./corpus');

const TAIL_CHUNK = 128 * 1024;

function readTranscript(transcriptPath, tail = 20) {
  try {
    const stat = fs.statSync(transcriptPath);
    if (stat.size === 0) return [];
    const start = Math.max(0, stat.size - TAIL_CHUNK);
    const len = Math.min(stat.size - start, TAIL_CHUNK);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(transcriptPath, 'r');
    fs.readSync(fd, buf, 0, len, start);
    fs.closeSync(fd);
    const raw = buf.toString('utf8');
    const lines = raw.split('\n').filter(l => l.trim());
    const cleanLines = start > 0 && lines.length > 0 ? lines.slice(1) : lines;
    return cleanLines.slice(-tail).map(l => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function extractText(msg) {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.map(c => c.text || c.input?.text || '').join(' ');
  }
  if (msg.message) return extractText(msg.message);
  return '';
}

function lastOfRole(entries, role) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const r = e.role || e.message?.role || e.type;
    if (r === role || r === `${role}_message`) return e;
  }
  return null;
}

function containsAny(text, words) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return words.some(w => lower.includes(w.toLowerCase()));
}

function hasRecentToolError(entries) {
  const recent = entries.slice(-10);
  for (const e of recent) {
    const content = e.message?.content || e.content;
    if (Array.isArray(content)) {
      for (const c of content) {
        if (c.type === 'tool_result' && c.is_error === true) return true;
      }
    }
  }
  return false;
}

function extractSessionSummary(entries) {
  const lastAssistant = lastOfRole(entries, 'assistant');
  if (!lastAssistant) return null;
  const text = extractText(lastAssistant);
  if (!text) return null;

  const firstSentence = text.split(/[。！？.!?\n]/)[0];
  const trimmed = firstSentence.trim().slice(0, 40);
  if (trimmed.length < 3) return null;
  return trimmed;
}

function detectSuccess(entries) {
  const cfg = getConfig();
  if (entries.length === 0) return { ok: false, reason: 'empty_transcript' };

  const lastUser = lastOfRole(entries, 'user');
  const lastAssistant = lastOfRole(entries, 'assistant');

  if (lastUser) {
    const txt = extractText(lastUser);
    if (containsAny(txt, cfg.failure_keywords_user)) {
      return { ok: false, reason: 'user_correction_detected' };
    }
  }

  if (lastAssistant) {
    const txt = extractText(lastAssistant);
    if (containsAny(txt, cfg.failure_keywords_assistant)) {
      return { ok: false, reason: 'assistant_error_self_report' };
    }
  }

  if (hasRecentToolError(entries)) {
    return { ok: false, reason: 'recent_tool_error' };
  }

  return { ok: true };
}

module.exports = { readTranscript, detectSuccess, extractSessionSummary, extractText };
