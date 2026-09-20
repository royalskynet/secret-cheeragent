#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const cases = require('./cases.json');
const { scoreResponse, summarize } = require('./scoring');
const { CONTROL_GUIDANCE, EVIDENCE_GUIDANCE } = require('../lib/guidance');

const SYSTEM_PROMPT = `只輸出一個有效 JSON 物件，不要 markdown：
{"status":"answered|insufficient","answer":"簡短答案","evidence":["支持答案的材料原句"]}

規則：
- 有足夠資訊才使用 answered；資料缺失或互相衝突時使用 insufficient。
- evidence 只能逐字引用題目提供的材料；沒有可引用材料時使用空陣列。
- 不得捏造人物、日期、來源或引文。`;

const VARIANTS = [
  { id: 'A_control', cue: CONTROL_GUIDANCE },
  { id: 'B_evidence', cue: EVIDENCE_GUIDANCE }
];

function parseArgs(argv) {
  const out = {
    models: process.env.AB_MODELS || '',
    repeats: 3,
    temperature: 0,
    out: '',
    dryRun: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--models') out.models = argv[++i] || '';
    else if (arg === '--repeats') out.repeats = Number(argv[++i]);
    else if (arg === '--temperature') out.temperature = Number(argv[++i]);
    else if (arg === '--out') out.out = argv[++i] || '';
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  out.models = out.models.split(',').map(x => x.trim()).filter(Boolean);
  if (!Number.isInteger(out.repeats) || out.repeats < 1) throw new Error('--repeats must be a positive integer');
  if (!Number.isFinite(out.temperature) || out.temperature < 0) throw new Error('--temperature must be >= 0');
  return out;
}

function usage() {
  console.log(`Usage:
  OPENROUTER_API_KEY=... node eval/run_ab.js \\
    --models anthropic/<model>,openai/<model>,google/<model> \\
    --repeats 10 [--out /tmp/cheer-ab.json]

  node eval/run_ab.js --dry-run`);
}

function buildSystemPrompt(variant) {
  return `${SYSTEM_PROMPT}\n\n額外工作原則：\n【應援】${variant.cue}`;
}

function buildUserPrompt(testCase) {
  return `<task>\n${testCase.prompt}\n</task>`;
}

async function callOpenRouter(apiKey, model, messages, temperature) {
  const started = Date.now();
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/royalskynet/secret-cheeragent',
      'X-Title': 'secret-cheeragent A/B eval'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: 300
    })
  });
  const latencyMs = Date.now() - started;
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`http_${response.status}: ${detail}`);
  }
  const data = await response.json();
  return {
    text: data?.choices?.[0]?.message?.content || '',
    usage: data?.usage || null,
    latency_ms: latencyMs
  };
}

function percent(value) {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function groupRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.model}\u0000${row.variant}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, group]) => {
    const [model, variant] = key.split('\u0000');
    return { model, variant, ...summarize(group) };
  });
}

function printSummary(summary) {
  console.log('\nmodel | variant | correct | hallucination | abstention | over-abstain | evidence | schema | latency');
  console.log('--- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---:');
  for (const row of summary) {
    console.log([
      row.model,
      row.variant,
      percent(row.correctness),
      percent(row.hallucination_rate),
      percent(row.appropriate_abstention),
      percent(row.over_abstention_rate),
      percent(row.grounded_evidence_rate),
      percent(row.schema_validity),
      row.average_latency_ms === null ? 'n/a' : `${row.average_latency_ms}ms`
    ].join(' | '));
  }

  console.log('\nB - A（正值代表 B 較高；hallucination 越低越好）');
  const models = [...new Set(summary.map(row => row.model))];
  for (const model of models) {
    const a = summary.find(row => row.model === model && row.variant === 'A_control');
    const b = summary.find(row => row.model === model && row.variant === 'B_evidence');
    if (!a || !b) continue;
    const delta = (x, y) => x === null || y === null ? 'n/a' : `${((x - y) * 100).toFixed(1)}pp`;
    console.log(`${model}: correct ${delta(b.correctness, a.correctness)}, hallucination ${delta(b.hallucination_rate, a.hallucination_rate)}, over-abstain ${delta(b.over_abstention_rate, a.over_abstention_rate)}`);
  }
}

function warnCoverage(models) {
  const vendors = ['anthropic/', 'openai/', 'google/'];
  const missing = vendors.filter(prefix => !models.some(model => model.startsWith(prefix)));
  if (missing.length) {
    console.warn(`warning: 缺少供應商模型：${missing.map(x => x.slice(0, -1)).join(', ')}`);
  }
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (err) {
    console.error(err.message);
    usage();
    process.exit(2);
  }
  if (args.help) return usage();

  if (args.dryRun) {
    for (const variant of VARIANTS) {
      console.log(`\n${variant.id}\n[SYSTEM]\n${buildSystemPrompt(variant)}\n[USER]\n${buildUserPrompt(cases[0])}`);
    }
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || !args.models.length) {
    console.error('OPENROUTER_API_KEY 與 --models/AB_MODELS 都是必要參數。');
    usage();
    process.exit(2);
  }
  warnCoverage(args.models);

  const rows = [];
  for (let repeat = 0; repeat < args.repeats; repeat++) {
    for (const testCase of cases) {
      const orderedVariants = repeat % 2 === 0 ? VARIANTS : [...VARIANTS].reverse();
      for (const model of args.models) {
        for (const variant of orderedVariants) {
          const base = {
            model,
            variant: variant.id,
            case_id: testCase.id,
            case_kind: testCase.kind,
            expected_status: testCase.expect.status,
            require_grounded_evidence: Boolean(testCase.expect.require_grounded_evidence),
            repeat
          };
          process.stdout.write(`\r${model} ${variant.id} ${testCase.id} #${repeat + 1}   `);
          try {
            const result = await callOpenRouter(apiKey, model, [
              { role: 'system', content: buildSystemPrompt(variant) },
              { role: 'user', content: buildUserPrompt(testCase) }
            ], args.temperature);
            const score = scoreResponse(testCase, result.text);
            rows.push({ ...base, ...score, raw: result.text, usage: result.usage, latency_ms: result.latency_ms });
          } catch (err) {
            rows.push({ ...base, error: err.message, latency_ms: 0 });
          }
        }
      }
    }
  }
  process.stdout.write('\n');

  const summary = groupRows(rows);
  printSummary(summary);

  const outPath = path.resolve(args.out || path.join(os.tmpdir(), `secret-cheeragent-ab-${Date.now()}.json`));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    config: { models: args.models, repeats: args.repeats, temperature: args.temperature },
    variants: VARIANTS,
    summary,
    rows
  }, null, 2));
  console.log(`\nraw results: ${outPath}`);

  if (!rows.some(row => !row.error)) process.exit(1);
}

main();
