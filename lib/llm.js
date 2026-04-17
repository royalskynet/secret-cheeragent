const { getConfig } = require('./corpus');

const SYSTEM_PROMPT = '用日常白話中文寫一句 30–60 字的鼓勵，像朋友在 LINE 上傳訊息。禁止：文言腔、任何比喻意象（山水雲月光能量手感等）、靈性用語（豐盛無盡顯化等）、誇張讚美（完美無瑕天生專家等）、空洞口號（加油你可以）。必須：貼合 agent 剛做的實際任務、用正向情緒詞（開心/溫暖/安心/踏實/謝謝/辛苦了/做得不錯）、忠於事實不誇大。只輸出鼓勵句本身，不加前後綴、不加引號、不自稱。';

function buildUserPrompt(ingredients, principleName) {
  const summary = ingredients.session_summary || '（未提供具體任務資訊）';
  return `內在精神落在原則「${principleName}」上（但不要寫出原則原文，轉成白話日常句）。agent 剛完成的事：${summary}。`;
}

async function callOpenRouter(model, ingredients, principleName) {
  const cfg = getConfig();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('no_api_key');

  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(ingredients, principleName) }
    ],
    temperature: cfg.llm_temperature ?? 0.9,
    max_tokens: cfg.llm_max_tokens ?? 40
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.llm_timeout_ms ?? 4000);

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/royalskynet/secret-cheerleader',
        'X-Title': 'secret-cheerleader'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`http_${res.status}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('empty_response');
    return text.replace(/^["「『]|["」』]$/g, '').trim();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function generateWithLLM(ingredients, principleName) {
  const cfg = getConfig();
  for (const model of cfg.llm_model_chain) {
    try {
      const out = await callOpenRouter(model, ingredients, principleName);
      return { text: out, model };
    } catch (err) {
      continue;
    }
  }
  throw new Error('all_models_failed');
}

module.exports = { generateWithLLM };
