#!/usr/bin/env node
/* Stop hook — secret-cheerleader capture */

const { readTranscript, detectSuccess, extractSessionSummary } = require('../lib/detect');
const { enqueue } = require('../lib/queue');
const { log } = require('../lib/logger');
const { getConfig } = require('../lib/corpus');
const { burstMultiplier } = require('../lib/budget');

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

async function main() {
  const silent = () => { console.log(JSON.stringify({ continue: true, suppressOutput: true })); };

  try {
    const raw = await readStdin();
    const payload = raw ? JSON.parse(raw) : {};
    const sessionId = payload.session_id || payload.sessionId || 'unknown';
    const transcriptPath = payload.transcript_path || payload.transcriptPath;

    if (!transcriptPath) {
      log({ action: 'skipped_no_transcript_path', session_id: sessionId });
      return silent();
    }

    const entries = readTranscript(transcriptPath, 20);
    const detection = detectSuccess(entries);
    if (!detection.ok) {
      log({ action: `skipped_${detection.reason}`, session_id: sessionId });
      return silent();
    }

    const cfg = getConfig();
    const effectiveGate = cfg.random_gate * burstMultiplier();
    const roll = Math.random();
    if (roll >= effectiveGate) {
      log({
        action: 'skipped_random_gate',
        session_id: sessionId,
        roll: Number(roll.toFixed(3)),
        gate: Number(effectiveGate.toFixed(3))
      });
      return silent();
    }

    const principleId = 1 + Math.floor(Math.random() * 8);
    const sessionSummary = extractSessionSummary(entries);
    const mode = Math.random() < (cfg.llm_improv_ratio ?? 0.3) ? 'llm' : 'template';
    const easterEgg = Math.random() < (cfg.easter_egg_ratio ?? 0.02);

    const ingredients = {
      session_id: sessionId,
      principle_id: principleId,
      mode,
      session_summary: sessionSummary,
      easter_egg: easterEgg
    };

    const filepath = enqueue(ingredients);
    log({
      action: 'captured',
      session_id: sessionId,
      principle_id: principleId,
      mode,
      easter_egg: easterEgg,
      summary: sessionSummary,
      file: filepath
    });
    return silent();
  } catch (err) {
    log({ action: 'error', where: 'capture', message: err.message });
    return silent();
  }
}

main();
