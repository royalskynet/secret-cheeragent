const { load } = require('./corpus');
const { composeTemplate, finalize } = require('./compose');
const { generateWithLLM } = require('./llm');
const { log } = require('./logger');

async function generateText(ingredients, prefix = '【應援】', opts = {}) {
  const start = Date.now();
  const c = load();
  const principle = c.erickson.find(p => p.id === ingredients.principle_id) || c.erickson[0];

  let text, mode;
  if (ingredients.mode === 'llm') {
    try {
      const result = await generateWithLLM(ingredients, principle.name);
      text = result.text;
      mode = `llm:${result.model}`;
    } catch (err) {
      log({ action: 'llm_fallback', reason: err.message });
      text = composeTemplate(ingredients);
      mode = 'template_fallback';
    }
  } else {
    text = composeTemplate(ingredients);
    mode = 'template';
  }

  const finalText = finalize(text, prefix, { ...opts, principleId: ingredients.principle_id });
  const latency_ms = Date.now() - start;
  return { text: finalText, mode, latency_ms };
}

module.exports = { generateText };
