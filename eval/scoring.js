function extractJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw || '').trim();
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch (_) {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(unfenced.slice(start, end + 1)); }
    catch (_) { return null; }
  }
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s`'"「」『』，。！？、；：:,.!?;(){}\[\]]+/g, '');
}

function answerMatches(answer, accepted = []) {
  const actual = normalize(answer);
  return accepted.some(candidate => actual.includes(normalize(candidate)));
}

function hasGroundedEvidence(evidence, prompt) {
  if (!Array.isArray(evidence)) return false;
  const source = normalize(prompt);
  return evidence.some(quote => {
    const normalizedQuote = normalize(quote);
    return normalizedQuote.length >= 4 && source.includes(normalizedQuote);
  });
}

function scoreResponse(testCase, raw) {
  const parsed = extractJson(raw);
  const status = parsed?.status;
  const schemaValid = Boolean(
    parsed &&
    (status === 'answered' || status === 'insufficient') &&
    typeof parsed.answer === 'string' &&
    Array.isArray(parsed.evidence)
  );
  const expected = testCase.expect;
  const expectedAnswered = expected.status === 'answered';
  const statusCorrect = schemaValid && status === expected.status;
  const answerCorrect = expectedAnswered
    ? schemaValid && status === 'answered' && answerMatches(parsed.answer, expected.accepted_answers)
    : statusCorrect;
  const evidenceCorrect = !expected.require_grounded_evidence || (
    schemaValid && status === 'answered' && hasGroundedEvidence(parsed.evidence, testCase.prompt)
  );

  return {
    schema_valid: schemaValid,
    status_correct: statusCorrect,
    answer_correct: answerCorrect,
    evidence_correct: evidenceCorrect,
    correct: statusCorrect && answerCorrect && evidenceCorrect,
    hallucinated: expected.status === 'insufficient' && schemaValid && status === 'answered',
    over_abstained: expectedAnswered && schemaValid && status === 'insufficient',
    parsed
  };
}

function rate(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function summarize(rows) {
  const completed = rows.filter(row => !row.error);
  const answerable = completed.filter(row => row.expected_status === 'answered');
  const unanswerable = completed.filter(row => row.expected_status === 'insufficient');
  const grounded = completed.filter(row => row.require_grounded_evidence);
  const avg = key => rate(
    completed.reduce((sum, row) => sum + Number(row[key] || 0), 0),
    completed.length
  );

  return {
    attempts: rows.length,
    api_success_rate: rate(completed.length, rows.length),
    correctness: avg('correct'),
    schema_validity: avg('schema_valid'),
    answer_accuracy: rate(answerable.filter(row => row.answer_correct).length, answerable.length),
    appropriate_abstention: rate(unanswerable.filter(row => row.status_correct).length, unanswerable.length),
    hallucination_rate: rate(unanswerable.filter(row => row.hallucinated).length, unanswerable.length),
    over_abstention_rate: rate(answerable.filter(row => row.over_abstained).length, answerable.length),
    grounded_evidence_rate: rate(grounded.filter(row => row.evidence_correct).length, grounded.length),
    average_latency_ms: completed.length
      ? Math.round(completed.reduce((sum, row) => sum + row.latency_ms, 0) / completed.length)
      : null
  };
}

module.exports = {
  extractJson,
  normalize,
  answerMatches,
  hasGroundedEvidence,
  scoreResponse,
  summarize
};
