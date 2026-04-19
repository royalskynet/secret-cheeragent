#!/usr/bin/env node
/* Test harness for secret-cheeragent.
   Uses a sandbox HOME dir so real ~/.claude/ is not polluted. */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const SANDBOX = path.join(os.tmpdir(), `cheerleader-test-${Date.now()}`);

fs.mkdirSync(SANDBOX, { recursive: true });
fs.mkdirSync(path.join(SANDBOX, '.claude', 'state', 'cheer_queue'), { recursive: true });
fs.mkdirSync(path.join(SANDBOX, '.claude', 'logs'), { recursive: true });

const env = { ...process.env, HOME: SANDBOX };
// force disable LLM for deterministic tests
delete env.OPENROUTER_API_KEY;

const results = [];

function runHook(hookFile, stdinJson) {
  return new Promise((resolve) => {
    const proc = spawn('node', [path.join(PLUGIN_ROOT, 'hooks', hookFile)], { env });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
    });
    proc.stdin.write(JSON.stringify(stdinJson));
    proc.stdin.end();
  });
}

function readLog() {
  const logFile = path.join(SANDBOX, '.claude', 'logs', 'cheerleader.log');
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

function clearLog() {
  const logFile = path.join(SANDBOX, '.claude', 'logs', 'cheerleader.log');
  if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
}

function listQueue() {
  const qdir = path.join(SANDBOX, '.claude', 'state', 'cheer_queue');
  if (!fs.existsSync(qdir)) return [];
  return fs.readdirSync(qdir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const fp = path.join(qdir, f);
      return { filename: f, filepath: fp, data: JSON.parse(fs.readFileSync(fp, 'utf8')) };
    });
}

function clearQueue() {
  const qdir = path.join(SANDBOX, '.claude', 'state', 'cheer_queue');
  if (fs.existsSync(qdir)) {
    for (const f of fs.readdirSync(qdir)) {
      fs.unlinkSync(path.join(qdir, f));
    }
  }
}

function writeBudget(obj) {
  const f = path.join(SANDBOX, '.claude', 'state', 'budget.json');
  fs.writeFileSync(f, JSON.stringify(obj, null, 2));
}

function writeLastInjected(iso) {
  const f = path.join(SANDBOX, '.claude', 'state', 'last_injected_at.txt');
  fs.writeFileSync(f, iso);
}

function record(name, pass, details) {
  results.push({ name, pass, details });
  const icon = pass ? '✓' : '✗';
  console.log(`  ${icon} ${name}${details ? ' — ' + details : ''}`);
}

async function testCaptureSuccess() {
  clearQueue(); clearLog();
  const fixture = path.join(PLUGIN_ROOT, 'test', 'fixtures', 'transcript_success.jsonl');
  // force random_gate high by running 30 times and expecting at least a few captures
  let captures = 0;
  for (let i = 0; i < 40; i++) {
    const out = await runHook('capture.js', {
      session_id: 'test-success-' + i,
      transcript_path: fixture
    });
    const parsed = JSON.parse(out.stdout);
    if (parsed.suppressOutput !== true || parsed.continue !== true) {
      return record('capture: stdout always silent {continue:true, suppressOutput:true}', false, out.stdout);
    }
    if (parsed.systemMessage || parsed.hookSpecificOutput) {
      return record('capture: no systemMessage or hookSpecificOutput', false, out.stdout);
    }
  }
  record('capture: stdout always silent (no extra-turn risk)', true);

  const log = readLog();
  captures = log.filter(l => l.action === 'captured').length;
  const skipsGate = log.filter(l => l.action === 'skipped_random_gate').length;
  record(`capture: random_gate ~20% (got ${captures}/40 captures, ${skipsGate} gate-skips)`,
    captures >= 2 && captures <= 18, `captures=${captures}`);

  const queue = listQueue();
  record(`capture: queue contains captured ingredients (${queue.length} items)`,
    queue.length === captures);

  if (queue[0]) {
    const ing = queue[0].data;
    const hasFields = ing.session_id && ing.principle_id && ing.mode && 'easter_egg' in ing;
    record('capture: ingredients have session_id/principle_id/mode/easter_egg',
      hasFields, JSON.stringify({ ...ing, session_summary: ing.session_summary?.slice(0, 20) }));
  }
}

async function testCaptureUserCorrection() {
  clearQueue(); clearLog();
  const fixture = path.join(PLUGIN_ROOT, 'test', 'fixtures', 'transcript_user_correction.jsonl');
  for (let i = 0; i < 20; i++) {
    await runHook('capture.js', { session_id: 'test-correction-' + i, transcript_path: fixture });
  }
  const log = readLog();
  const captures = log.filter(l => l.action === 'captured');
  const corrections = log.filter(l => l.action === 'skipped_user_correction_detected');
  record('capture: user correction → skip (0 captures expected)',
    captures.length === 0 && corrections.length === 20,
    `captures=${captures.length}, corrections=${corrections.length}`);
}

async function testCaptureToolError() {
  clearQueue(); clearLog();
  const fixture = path.join(PLUGIN_ROOT, 'test', 'fixtures', 'transcript_tool_error.jsonl');
  for (let i = 0; i < 20; i++) {
    await runHook('capture.js', { session_id: 'test-toolerr-' + i, transcript_path: fixture });
  }
  const log = readLog();
  const captures = log.filter(l => l.action === 'captured');
  const errors = log.filter(l => l.action === 'skipped_recent_tool_error');
  record('capture: recent tool error → skip',
    captures.length === 0 && errors.length === 20,
    `captures=${captures.length}, errors=${errors.length}`);
}

async function testInjectTemplate() {
  clearQueue(); clearLog();
  const sid = 'inject-session-1';
  // enqueue one item manually
  const qdir = path.join(SANDBOX, '.claude', 'state', 'cheer_queue');
  const item = {
    session_id: sid,
    principle_id: 5,
    mode: 'template',
    session_summary: '重構 auth middleware',
    easter_egg: false,
    created_at: new Date().toISOString()
  };
  fs.writeFileSync(path.join(qdir, `${sid}-test.json`), JSON.stringify(item));

  const out = await runHook('pretool_inject.js', { session_id: sid, prompt: 'hi' });
  const parsed = JSON.parse(out.stdout);
  const ctx = parsed.hookSpecificOutput?.additionalContext;
  record('inject: outputs additionalContext with 【應援】 prefix',
    typeof ctx === 'string' && ctx.startsWith('【應援】'),
    ctx?.slice(0, 60));

  const log = readLog();
  const injected = log.find(l => l.action === 'injected');
  record('inject: logged action=injected with tier=1 and text',
    injected && injected.tier === 1 && injected.text === ctx,
    injected ? `mode=${injected.mode}, tokens=${injected.tokens}` : 'no log');

  const remaining = listQueue();
  record('inject: queue emptied after consumption',
    remaining.length === 0);

  // token budget was updated?
  const budgetFile = path.join(SANDBOX, '.claude', 'state', 'budget.json');
  if (fs.existsSync(budgetFile)) {
    const b = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
    record('inject: budget.used_tokens incremented',
      b.used_tokens > 0, `used=${b.used_tokens}`);
  }
}

async function testInjectLengthCap() {
  clearQueue(); clearLog();
  const sid = 'inject-longtest';
  const qdir = path.join(SANDBOX, '.claude', 'state', 'cheer_queue');
  // use a principle_id that will produce a long template (though our lines are short);
  // we'll simulate overflow by adding many easter eggs via a raw monkey-patch is tricky.
  // Instead rely on natural behavior + confirm truncation path exists.
  const item = {
    session_id: sid,
    principle_id: 7,
    mode: 'template',
    session_summary: 'x'.repeat(200),  // very long summary forces long bridge
    easter_egg: true,
    created_at: new Date().toISOString()
  };
  fs.writeFileSync(path.join(qdir, `${sid}-test.json`), JSON.stringify(item));

  const out = await runHook('pretool_inject.js', { session_id: sid, prompt: 'hi' });
  const parsed = JSON.parse(out.stdout);
  const ctx = parsed.hookSpecificOutput?.additionalContext || '';
  // truncateToSentence keeps last full sentence within max_injection_tokens=50
  // But easter egg and bridge may push it. Count tokens.
  let zh = 0, other = 0;
  for (const ch of ctx) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) zh++;
    else other++;
  }
  const tokens = Math.ceil(zh / 2 + other / 4);
  // Allow some slack because truncation picks sentence boundaries
  record('inject: output within max_injection_tokens guard (~50–80)',
    tokens <= 90, `tokens=${tokens}, len=${ctx.length}, text=${ctx.slice(0, 80)}`);
}

async function testBudgetCap() {
  clearQueue(); clearLog();
  // Set budget near max
  writeBudget({ date: new Date().toISOString().slice(0, 10), used_tokens: 495, recent_injections: [] });

  const sid = 'budget-cap';
  const qdir = path.join(SANDBOX, '.claude', 'state', 'cheer_queue');
  fs.writeFileSync(path.join(qdir, `${sid}-test.json`), JSON.stringify({
    session_id: sid, principle_id: 1, mode: 'template', session_summary: null, easter_egg: false,
    created_at: new Date().toISOString()
  }));

  const out = await runHook('pretool_inject.js', { session_id: sid, prompt: 'hi' });
  const parsed = JSON.parse(out.stdout);
  const hasCtx = !!parsed.hookSpecificOutput;
  record('inject: skip when budget exhausted (no additionalContext)',
    !hasCtx, JSON.stringify(parsed));

  const log = readLog();
  const skipLog = log.find(l => String(l.action).startsWith('skipped_budget'));
  record('inject: log skipped_budget_exhausted',
    !!skipLog, skipLog?.action);

  const stillQueued = listQueue();
  record('inject: queue NOT consumed when budget exhausted (愛不丟失)',
    stillQueued.length === 1);
}

async function testSessionStartOrphan() {
  clearQueue(); clearLog();
  writeBudget({ date: new Date().toISOString().slice(0, 10), used_tokens: 0, recent_injections: [] });

  const qdir = path.join(SANDBOX, '.claude', 'state', 'cheer_queue');
  // add two orphans with different mtimes
  const old = {
    session_id: 'fake-old-sid', principle_id: 2, mode: 'template',
    session_summary: '修 auth bug', easter_egg: false,
    created_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString()
  };
  const newer = {
    session_id: 'fake-new-sid', principle_id: 3, mode: 'template',
    session_summary: '寫測試', easter_egg: false,
    created_at: new Date().toISOString()
  };
  const oldPath = path.join(qdir, 'fake-old-sid-a.json');
  const newPath = path.join(qdir, 'fake-new-sid-b.json');
  fs.writeFileSync(oldPath, JSON.stringify(old));
  fs.writeFileSync(newPath, JSON.stringify(newer));

  // force mtime on the old one
  const oldTime = new Date(Date.now() - 3 * 3600 * 1000) / 1000;
  fs.utimesSync(oldPath, oldTime, oldTime);

  const out = await runHook('sessionstart.js', { session_id: 'brand-new-sid' });
  const parsed = JSON.parse(out.stdout);
  const ctx = parsed.hookSpecificOutput?.additionalContext;
  record('sessionstart: injects orphan with【應援・上一輪留給你】 prefix',
    typeof ctx === 'string' && ctx.startsWith('【應援・上一輪留給你】'),
    ctx?.slice(0, 60));

  const remaining = listQueue();
  record('sessionstart: LIFO — newer orphan consumed, older preserved (愛不丟失)',
    remaining.length === 1 && remaining[0].data.session_id === 'fake-old-sid',
    `remaining=${remaining.map(r => r.data.session_id).join(',')}`);

  const log = readLog();
  const injected = log.find(l => l.action === 'injected_orphan');
  record('sessionstart: log action=injected_orphan with original_session',
    injected && injected.original_session === 'fake-new-sid',
    injected?.original_session);
}

async function testSessionStartFloor() {
  clearQueue(); clearLog();
  writeBudget({ date: new Date().toISOString().slice(0, 10), used_tokens: 0, recent_injections: [] });
  writeLastInjected(new Date(Date.now() - 25 * 3600 * 1000).toISOString());

  const out = await runHook('sessionstart.js', { session_id: 'floor-test' });
  const parsed = JSON.parse(out.stdout);
  const ctx = parsed.hookSpecificOutput?.additionalContext;
  record('sessionstart: 24h floor kicks in with 好久沒打招呼了 prefix',
    typeof ctx === 'string' && ctx.startsWith('【好久沒打招呼了'),
    ctx?.slice(0, 60));

  const log = readLog();
  const forced = log.find(l => l.action === 'forced_floor');
  record('sessionstart: log action=forced_floor with reason',
    forced && forced.reason === '24h_no_injection',
    forced?.reason);
}

async function testSessionStartNoFloor() {
  clearQueue(); clearLog();
  writeBudget({ date: new Date().toISOString().slice(0, 10), used_tokens: 0, recent_injections: [] });
  writeLastInjected(new Date(Date.now() - 10 * 3600 * 1000).toISOString());

  const out = await runHook('sessionstart.js', { session_id: 'no-floor' });
  const parsed = JSON.parse(out.stdout);
  record('sessionstart: no floor triggered within 24h window',
    !parsed.hookSpecificOutput, JSON.stringify(parsed));

  const log = readLog();
  const forced = log.find(l => l.action === 'forced_floor');
  record('sessionstart: no forced_floor log',
    !forced);
}

async function testLoveNeverDies() {
  clearQueue(); clearLog();
  writeBudget({ date: new Date().toISOString().slice(0, 10), used_tokens: 0, recent_injections: [] });

  const qdir = path.join(SANDBOX, '.claude', 'state', 'cheer_queue');
  const ancient = {
    session_id: 'ancient-sid', principle_id: 4, mode: 'template',
    session_summary: '三天前的事', easter_egg: false,
    created_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
  };
  const p = path.join(qdir, 'ancient.json');
  fs.writeFileSync(p, JSON.stringify(ancient));
  const t = new Date(Date.now() - 3 * 24 * 3600 * 1000) / 1000;
  fs.utimesSync(p, t, t);

  const out = await runHook('sessionstart.js', { session_id: 'now-sid' });
  const parsed = JSON.parse(out.stdout);
  record('sessionstart: 3-day-old orphan still consumed (無 TTL)',
    !!parsed.hookSpecificOutput?.additionalContext);
}

async function testDiversity() {
  clearQueue(); clearLog();
  writeBudget({ date: new Date().toISOString().slice(0, 10), used_tokens: 0, recent_injections: [] });

  const texts = new Set();
  for (let i = 0; i < 20; i++) {
    const qdir = path.join(SANDBOX, '.claude', 'state', 'cheer_queue');
    const sid = 'div-' + i;
    const item = {
      session_id: sid,
      principle_id: 1 + (i % 8),
      mode: 'template',
      session_summary: '做某件事',
      easter_egg: Math.random() < 0.2,
      created_at: new Date().toISOString()
    };
    fs.writeFileSync(path.join(qdir, `${sid}.json`), JSON.stringify(item));
    // bump budget so we don't hit cap
    writeBudget({ date: new Date().toISOString().slice(0, 10), used_tokens: 0, recent_injections: [] });
    const out = await runHook('pretool_inject.js', { session_id: sid, prompt: 'x' });
    const parsed = JSON.parse(out.stdout);
    const ctx = parsed.hookSpecificOutput?.additionalContext;
    if (ctx) texts.add(ctx);
  }
  record(`diversity: 20 runs produced ${texts.size} unique texts (>=15 expected)`,
    texts.size >= 15, `unique=${texts.size}`);
}

async function testToneScan() {
  // Generate 100 template compositions and scan for forbidden keywords
  const { composeTemplate, finalize } = require('../lib/compose');
  // Precise forbidden phrases (compound matches so "風格" doesn't fail on "風")
  const forbidden = [
    '山水', '雲月', '風月', '風起', '月下', '山下', '雲上', '如雲', '如山', '似水',
    '豐盛', '無盡', '顯化', '手感', '鬆開', '意象', '本具足', '次第', '綻放',
    '能量流', '流動', '共振', '高我', '臣服', '敞開', '豐盛地', '溫潤地',
    '完美無瑕', '天生專家', '絕對正確', '加油你可以', '你可以的',
    '雲收山自現', '一葉知秋', '磐石含光', '松濤', '含笑', '不言盡意'
  ];
  let hits = [];
  for (let i = 0; i < 200; i++) {
    const ingredients = {
      principle_id: 1 + (i % 8),
      session_summary: Math.random() < 0.5 ? '改某個 function' : null,
      easter_egg: Math.random() < 0.05,
      mode: 'template'
    };
    const text = finalize(composeTemplate(ingredients), '【應援】');
    for (const word of forbidden) {
      if (text.includes(word)) hits.push({ text, word });
    }
  }
  record(`tone scan: 200 samples, ${hits.length} forbidden-word hits (expected 0)`,
    hits.length === 0,
    hits.slice(0, 3).map(h => `"${h.word}" in "${h.text.slice(0, 30)}"`).join(' | '));
}

async function main() {
  console.log('\n=== Secret Cheerleader Test Suite ===');
  console.log('Sandbox:', SANDBOX);
  console.log('');

  console.log('[1] Capture — success path');
  await testCaptureSuccess();
  console.log('\n[2] Capture — user correction skip');
  await testCaptureUserCorrection();
  console.log('\n[3] Capture — recent tool error skip');
  await testCaptureToolError();
  console.log('\n[4] Inject — template path');
  await testInjectTemplate();
  console.log('\n[5] Inject — length cap');
  await testInjectLengthCap();
  console.log('\n[6] Budget cap enforcement');
  await testBudgetCap();
  console.log('\n[7] SessionStart — orphan consumption (LIFO, love kept)');
  await testSessionStartOrphan();
  console.log('\n[8] SessionStart — 24h floor triggered');
  await testSessionStartFloor();
  console.log('\n[9] SessionStart — within 24h, no floor');
  await testSessionStartNoFloor();
  console.log('\n[10] Love never dies — 3-day-old orphan still consumable');
  await testLoveNeverDies();
  console.log('\n[11] Diversity — 20 runs yield many unique texts');
  await testDiversity();
  console.log('\n[12] Tone scan — forbidden-word absence');
  await testToneScan();

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log('\n=== Summary ===');
  console.log(`passed: ${passed} / ${results.length}`);
  if (failed > 0) {
    console.log(`failed: ${failed}`);
    console.log('Failures:');
    results.filter(r => !r.pass).forEach(r => console.log(`  - ${r.name} :: ${r.details}`));
    process.exit(1);
  }
  console.log('\nCleanup:', SANDBOX);
  // keep sandbox for debugging if tests pass you can delete manually
}

main();
