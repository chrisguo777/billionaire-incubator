// Node 24+, no model calls: node tests/llm-retry.cjs
// The Anthropic client is replaced by a local fake. Its responses still go through the
// SDK's real zodOutputFormat parser, so schema failures throw exactly as SDK 0.135 does.
const assert = require('node:assert/strict');
const { registerHooks } = require('node:module');
const { existsSync } = require('node:fs');
const { fileURLToPath, pathToFileURL } = require('node:url');
const path = require('node:path');

const root = pathToFileURL(path.join(__dirname, '..') + path.sep);
const stub = 'data:text/javascript,' + encodeURIComponent(`
export default class Anthropic {
  messages = { parse: async (options) => globalThis.__fakeParse(options) };
}`);
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@anthropic-ai/sdk') return { url: stub, shortCircuit: true };
  if (specifier === 'next/server') return next('next/server.js', context); // Next has no "exports" map for plain Node
  if (specifier.startsWith('@/')) {
    const url = new URL(specifier.slice(2) + '.ts', root);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  if (specifier.startsWith('.') && context.parentURL) {
    const url = new URL(specifier + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
} });

// Each fake response: { text } (run through the real SDK parser), { stopReason }, { parsedOutput: null } or { error }.
let queue = [];
let calls = 0;
globalThis.__fakeParse = async (options) => {
  calls++;
  const next = queue.shift();
  if (!next) throw new Error('fake client: no response queued');
  if (next.error) throw next.error;
  if (next.stopReason) return { stop_reason: next.stopReason, parsed_output: null, content: [] };
  if ('parsedOutput' in next) return { stop_reason: 'end_turn', parsed_output: next.parsedOutput, content: [] };
  return { stop_reason: 'end_turn', parsed_output: options.output_config.format.parse(next.text), content: [] };
};
const respond = (...items) => { queue = items; calls = 0; };

// Retries log the raw error on the server; keep the test output readable.
const logged = [];
console.error = (...args) => logged.push(args);

(async () => {
  for (const name of ['LLM_MODE', 'LLM_PROVIDER', 'ANTHROPIC_AUTH_TOKEN']) delete process.env[name];
  process.env.LLM_PROVIDER = 'anthropic';
  process.env.ANTHROPIC_API_KEY = 'local-stub-key';
  const { z } = require('zod');
  const { AuthenticationError, RateLimitError } = await import('@anthropic-ai/sdk/error');
  const { callStructured, StructuredOutputError, ModelRefusalError, MAX_ATTEMPTS } = await import('../lib/llm.ts');
  const { toUserFacingError } = await import('../lib/errors.ts');
  const { parseCV } = await import('../lib/pipeline.ts');
  const { evaluateResume } = await import('../lib/evaluation.ts');
  const { mockParseCV, mockAnalyzeJD } = await import('../lib/mock.ts');
  const { SAMPLE_CV } = await import('../lib/sample.ts');
  const { POST } = await import('../app/api/step/route.ts');
  const { InvalidCardSelectionError } = await import('../lib/resume-selection.ts');

  let passed = 0;
  const test = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };
  const Kind = z.object({ kind: z.enum(['must_have', 'preferred']) });
  const ask = (options) => callStructured(Kind, 'Test system.', 'Test prompt.', 'low', options);
  const valid = JSON.stringify({ kind: 'must_have' });
  const outOfList = JSON.stringify({ kind: 'nice_to_have' }); // the enum value SDK 0.135 lets through
  const post = (body) => POST(new Request('http://localhost/api/step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

  await test('an enum value outside the list is retried and the second attempt is returned', async () => {
    respond({ text: outOfList }, { text: valid });
    assert.deepEqual(await ask(), { kind: 'must_have' });
    assert.equal(calls, 2);
  });
  await test('invalid JSON and an empty parsed_output are retried too', async () => {
    respond({ text: '{"kind": "must_' }, { parsedOutput: null }, { text: valid });
    assert.deepEqual(await ask(), { kind: 'must_have' });
    assert.equal(calls, 3);
  });
  await test('three invalid outputs in a row stop with a friendly Chinese message', async () => {
    respond({ text: outOfList }, { text: outOfList }, { text: outOfList }, { text: valid });
    const err = await ask().then(() => null, (e) => e);
    assert(err instanceof StructuredOutputError);
    assert.equal(calls, MAX_ATTEMPTS);
    assert.equal(MAX_ATTEMPTS, 3);
    const shown = toUserFacingError(err);
    assert.equal(shown.status, 502);
    assert.match(shown.message, /连续 3 次不合格，请再点一次按钮；已完成的步骤不会丢失/);
    assert.doesNotMatch(shown.message, /Failed to parse|nice_to_have/);
  });
  await test('a failing check retries the step; the next valid output is returned', async () => {
    let checked = 0;
    respond({ text: JSON.stringify({ kind: 'preferred' }) }, { text: valid });
    const result = await ask({ check: (out) => { checked++; if (out.kind !== 'must_have') throw new Error('内容不符合规则'); } });
    assert.deepEqual(result, { kind: 'must_have' });
    assert.equal(calls, 2);
    assert.equal(checked, 2);
  });
  await test('when the check keeps failing, its Chinese reason is added to the message', async () => {
    respond({ text: valid }, { text: valid }, { text: valid });
    const err = await ask({ check: () => { throw new Error('「示例经历」未能对应到完整原句'); } }).then(() => null, (e) => e);
    assert.equal(calls, 3);
    assert.match(toUserFacingError(err).message, /连续 3 次不合格.*最后一次的问题：「示例经历」未能对应到完整原句/);
  });
  await test('a refusal is not retried', async () => {
    respond({ stopReason: 'refusal' }, { text: valid });
    const err = await ask().then(() => null, (e) => e);
    assert(err instanceof ModelRefusalError);
    assert.equal(calls, 1);
    assert.match(toUserFacingError(err).message, /模型拒绝处理/);
  });
  await test('an invalid API key and rate limits are not retried here (the SDK already retries 429)', async () => {
    respond({ error: new AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, undefined, new Headers()) });
    let err = await ask().then(() => null, (e) => e);
    assert.equal(calls, 1);
    assert.equal(toUserFacingError(err).message, 'API key 无效或没有权限，请检查 .env.local 后重启开发服务。');
    respond({ error: new RateLimitError(429, undefined, 'rate limited', new Headers()) });
    err = await ask().then(() => null, (e) => e);
    assert.equal(calls, 1);
    assert.match(toUserFacingError(err).message, /模型服务繁忙，请稍后再试/);
  });
  await test('a missing key fails before any call and keeps its own Chinese message', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    respond({ text: valid });
    const err = await ask().then(() => null, (e) => e);
    process.env.ANTHROPIC_API_KEY = 'local-stub-key';
    assert.equal(calls, 0);
    assert.match(toUserFacingError(err).message, /ANTHROPIC_API_KEY/);
  });
  await test('project errors pass through; unknown English errors are replaced', () => {
    assert.deepEqual(toUserFacingError(new InvalidCardSelectionError('请至少保留一段经历')), { status: 400, message: '请至少保留一段经历' });
    assert.equal(toUserFacingError(new Error('当前经历库缺少完整原句')).message, '当前经历库缺少完整原句');
    assert.doesNotMatch(toUserFacingError(new Error('Cannot read properties of undefined')).message, /Cannot read/);
  });

  await test('parseCV retries when the model cites a source block that does not exist', async () => {
    const good = mockParseCV();
    const bad = structuredClone(good);
    bad.affiliations[0].cards[0].original_bullet_ids = ['cvb999'];
    respond({ text: JSON.stringify(bad) }, { text: JSON.stringify(good) });
    const db = await parseCV(SAMPLE_CV);
    assert.equal(calls, 2);
    assert(db.cards.length > 0);
    assert(db.cards.every((c) => (c.original_bullets ?? []).every((b) => b.text)));
  });
  await test('parseCV retries when an experience card has no complete original bullet', async () => {
    const good = mockParseCV();
    const bad = structuredClone(good);
    const card = bad.affiliations.flatMap((a) => a.type === 'skills_list' ? [] : a.cards).find((c) => c.my_actions.length);
    card.original_bullet_ids = [];
    respond({ text: JSON.stringify(bad) }, { text: JSON.stringify(bad) }, { text: JSON.stringify(good) });
    await parseCV(SAMPLE_CV);
    assert.equal(calls, 3);
  });

  await test('evaluation retries when a dimension is missing', async () => {
    const assessment = { score: null, reason: '-', evidence: [] };
    const ids = ['relevance', 'contribution', 'methods', 'outcomes', 'clarity', 'faithfulness'];
    const report = (n) => JSON.stringify({ summary: 's', fact_risks: [], next_actions: [],
      dimensions: ids.slice(0, n).map((id) => ({ id, before: assessment, after: assessment, missing: [], suggestion: '-' })) });
    const db = await (async () => { respond({ text: JSON.stringify(mockParseCV()) }); return parseCV(SAMPLE_CV); })();
    respond({ text: report(5) }, { text: report(6) });
    const result = await evaluateResume(SAMPLE_CV, SAMPLE_CV, db, mockAnalyzeJD());
    assert.equal(calls, 2);
    assert.equal(result.dimensions.length, 6);
  });

  await test('route: empty or non-string CV / JD returns 400 in Chinese without calling the model', async () => {
    for (const body of [{ step: 'parse', cv: '' }, { step: 'parse', cv: '  \n\t ' }, { step: 'parse' }, { step: 'parse', cv: 42 },
      { step: 'jd', jd: '' }, { step: 'jd', jd: '   ' }, { step: 'jd', jd: null }]) {
      respond({ text: valid });
      const res = await post(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.match((await res.json()).error, body.step === 'parse' ? /简历内容为空/ : /JD 内容为空/);
      assert.equal(calls, 0);
    }
  });
  await test('route: three invalid model outputs return the friendly message, not the SDK error', async () => {
    const bad = JSON.stringify({ requirements: [{ id: 'r1', text: 'SQL', kind: 'nice_to_have', priority: 'high', keywords: ['sql'] }] });
    respond({ text: bad }, { text: bad }, { text: bad });
    const res = await post({ step: 'jd', jd: 'Must know SQL.' });
    assert.equal(res.status, 502);
    assert.equal(calls, 3);
    const { error } = await res.json();
    assert.match(error, /AI 这一步的输出连续 3 次不合格/);
    assert.doesNotMatch(error, /Failed to parse|Invalid option/);
  });

  assert(logged.some((args) => String(args[0]).includes('[callStructured] attempt 1/3')), 'raw errors are logged on the server');
  console.log(`\n${passed} tests passed`);
})().catch((e) => { process.exitCode = 1; process.stderr.write(String(e && e.stack || e) + '\n'); });
