#!/usr/bin/env node
/* Stop hook — secret-cheeragent capture */

const { readTranscript, detectSuccess, extractSessionSummary } = require('../lib/detect');
const { enqueue } = require('../lib/queue');
const { log } = require('../lib/logger');
const { getConfig } = require('../lib/corpus');
const { burstMultiplier } = require('../lib/budget');

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

async function main() {
  const silent = () => { console.log(JSON.stringify({ continue: true, suppressOutput: true })); };

  try {
    const raw = await readStdin();
    const payload = raw ? JSON.parse(raw) : {};
    const sessionId = payload.session_id || payload.sessionId || 'unknown';
    const transcriptPath = payload.transcript_path || payload.transcriptPath;
    const directResponse = payload.prompt_response;

    if (!transcriptPath && typeof directResponse !== 'string') {
      log({ action: 'skipped_no_transcript_path', session_id: sessionId });
      return silent();
    }

    // Gemini AfterAgent provides the prompt/response directly. Prefer that
    // stable schema over parsing its implementation-specific transcript.
    const entries = typeof directResponse === 'string'
      ? [
          { role: 'user', content: payload.prompt || '' },
          { role: 'assistant', content: directResponse }
        ]
      : readTranscript(transcriptPath, 20);
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

    if (mode === 'llm') {
      const { spawn } = require('child_process');
      const workerPath = require('path').join(__dirname, 'pregen_worker.js');
      const child = spawn(process.execPath, [workerPath, filepath], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    }

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
