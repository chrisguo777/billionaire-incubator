// Node 24+, no model calls: node tests/llm-providers.cjs
// Checks the OpenAI-compatible provider in lib/llm.ts. The `openai` client is replaced by a
// local fake; the error classes come from the real SDK so the error mapping is tested for real.
const assert = require('node:assert/strict');
const { registerHooks } = require('node:module');
const { existsSync } = require('node:fs');
const { fileURLToPath, pathToFileURL } = require('node:url');
const path = require('node:path');

const root = pathToFileURL(path.join(__dirname, '..') + path.sep);
const stub = 'data:text/javascript,' + encodeURIComponent(`
export default class OpenAI {
  constructor(options) { globalThis.__openAIOptions = options; }
  chat = { completions: { create: async (params) => globalThis.__fakeCreate(params) } };
}`);
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'openai') return { url: stub, shortCircuit: true };
  if (specifier === 'next/server') return next('next/server.js', context);
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

// Each fake response: { content, finish }, { refusal } or { error }.
let queue = [];
let requests = [];
globalThis.__fakeCreate = async (params) => {
  requests.push(params);
  const next = queue.shift();
  if (!next) throw new Error('fake client: no response queued');
  if (next.error) throw next.error;
  return { choices: [{ finish_reason: next.finish ?? 'stop', message: { role: 'assistant', content: next.content ?? null, refusal: next.refusal ?? null } }] };
};
const respond = (...items) => { queue = items; requests = []; };
const logged = [];
console.error = (...args) => logged.push(args);

(async () => {
  for (const name of ['LLM_MODE', 'LLM_PROVIDER', 'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_JSON_MODE', 'LLM_MAX_TOKENS', 'LLM_MAX_TOKENS_PARAM', 'LLM_REASONING_EFFORT', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) delete process.env[name];
  const { z } = require('zod');
  const OpenAIErrors = await import('openai/error');
  const llm = await import('../lib/llm.ts');
  const { callStructured, getProvider, getMode, getModelName, isProviderConfigured, StructuredOutputError, ModelRefusalError } = llm;
  const { toUserFacingError } = await import('../lib/errors.ts');
  const { GET } = await import('../app/api/step/route.ts');

  let passed = 0;
  const test = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };
  const Kind = z.object({ kind: z.enum(['must_have', 'preferred']), note: z.string().nullable() });
  const ask = (options) => callStructured(Kind, 'Test system.', 'Test prompt.', 'low', options);
  const valid = JSON.stringify({ kind: 'must_have', note: null });
  const headers = new Headers();

  await test('selecting openai-compatible without settings is live but not configured, and makes no call', async () => {
    process.env.LLM_PROVIDER = 'openai-compatible';
    assert.equal(getProvider(), 'openai-compatible');
    assert.equal(getMode(), 'live');
    assert.equal(isProviderConfigured(), false);
    respond({ content: valid });
    await assert.rejects(ask(), /LLM_BASE_URL、LLM_API_KEY 和 LLM_MODEL/);
    assert.equal(requests.length, 0);
  });

  process.env.LLM_BASE_URL = 'https://api.deepseek.com';
  process.env.LLM_API_KEY = 'local-stub-key';
  process.env.LLM_MODEL = 'stub-model';

  await test('configured: sends a strict json_schema request and returns the parsed output', async () => {
    assert.equal(isProviderConfigured(), true);
    assert.equal(getModelName(), 'stub-model');
    respond({ content: valid });
    assert.deepEqual(await ask(), { kind: 'must_have', note: null });
    const req = requests[0];
    assert.equal(req.model, 'stub-model');
    assert.deepEqual(req.messages.map((m) => m.role), ['system', 'user']);
    assert.equal(req.messages[0].content, 'Test system.');
    assert.equal(req.response_format.type, 'json_schema');
    assert.equal(req.response_format.json_schema.strict, true);
    const schema = req.response_format.json_schema.schema;
    assert.equal(schema.$schema, undefined);
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, ['kind', 'note']);
    assert.equal(req.max_tokens, 8192);
    assert.equal(req.max_completion_tokens, undefined);
    assert.equal(req.reasoning_effort, undefined);
    assert.equal(globalThis.__openAIOptions.baseURL, 'https://api.deepseek.com');
  });
  await test('invalid JSON, a schema mismatch and a truncated reply are each retried', async () => {
    respond({ content: '{"kind": "must_' }, { content: JSON.stringify({ kind: 'nice_to_have', note: null }) }, { content: valid });
    assert.deepEqual(await ask(), { kind: 'must_have', note: null });
    assert.equal(requests.length, 3);
    respond({ content: '{"kind":', finish: 'length' }, { content: valid });
    assert.deepEqual(await ask(), { kind: 'must_have', note: null });
    assert.equal(requests.length, 2);
  });
  await test('a reply wrapped in a ```json fence is accepted', async () => {
    respond({ content: '```json\n' + valid + '\n```' });
    assert.deepEqual(await ask(), { kind: 'must_have', note: null });
  });
  await test('three invalid replies stop with the friendly Chinese message', async () => {
    respond({ content: 'not json' }, { content: 'not json' }, { content: 'not json' });
    const err = await ask().then(() => null, (e) => e);
    assert(err instanceof StructuredOutputError);
    assert.equal(requests.length, 3);
    assert.match(toUserFacingError(err).message, /连续 3 次不合格/);
  });
  await test('a failing check retries the step', async () => {
    respond({ content: JSON.stringify({ kind: 'preferred', note: null }) }, { content: valid });
    const out = await ask({ check: (o) => { if (o.kind !== 'must_have') throw new Error('内容不符合规则'); } });
    assert.equal(out.kind, 'must_have');
    assert.equal(requests.length, 2);
  });
  await test('a refusal or content filter is not retried', async () => {
    respond({ refusal: 'I cannot help with that.' }, { content: valid });
    assert((await ask().then(() => null, (e) => e)) instanceof ModelRefusalError);
    assert.equal(requests.length, 1);
    respond({ finish: 'content_filter' }, { content: valid });
    assert((await ask().then(() => null, (e) => e)) instanceof ModelRefusalError);
    assert.equal(requests.length, 1);
  });
  await test('provider errors are shown in Chinese and not retried', async () => {
    respond({ error: new OpenAIErrors.AuthenticationError(401, { message: 'bad key' }, 'bad key', headers) });
    let err = await ask().then(() => null, (e) => e);
    assert.equal(requests.length, 1);
    assert.match(toUserFacingError(err).message, /API key 无效/);
    respond({ error: new OpenAIErrors.NotFoundError(404, { message: 'model not found' }, 'model not found', headers) });
    err = await ask().then(() => null, (e) => e);
    assert.match(toUserFacingError(err).message, /LLM_BASE_URL 和 LLM_MODEL/);
    respond({ error: new OpenAIErrors.RateLimitError(429, { message: 'slow down' }, 'slow down', headers) });
    err = await ask().then(() => null, (e) => e);
    assert.match(toUserFacingError(err).message, /模型服务繁忙/);
  });
  await test('official OpenAI uses max_completion_tokens; LLM_MAX_TOKENS and LLM_REASONING_EFFORT pass through', async () => {
    process.env.LLM_BASE_URL = 'https://api.openai.com/v1';
    respond({ content: valid });
    await ask();
    assert.equal(requests[0].max_completion_tokens, 16000);
    assert.equal(requests[0].max_tokens, undefined);
    process.env.LLM_MAX_TOKENS = '4000';
    process.env.LLM_REASONING_EFFORT = 'low';
    respond({ content: valid });
    await ask();
    assert.equal(requests[0].max_completion_tokens, 4000);
    assert.equal(requests[0].reasoning_effort, 'low');
    for (const name of ['LLM_MAX_TOKENS', 'LLM_REASONING_EFFORT']) delete process.env[name];
    process.env.LLM_BASE_URL = 'https://api.deepseek.com';
  });
  await test('route GET reports the provider and model', async () => {
    const body = await (await GET()).json();
    assert.equal(body.provider, 'openai-compatible');
    assert.equal(body.model, 'stub-model');
    assert.equal(body.configured, true);
  });
  await test('LLM_JSON_MODE=json_object puts the schema in the prompt instead', async () => {
    process.env.LLM_JSON_MODE = 'json_object';
    respond({ content: valid });
    await ask();
    assert.equal(requests[0].response_format.type, 'json_object');
    assert.match(requests[0].messages[0].content, /JSON Schema exactly/);
    assert.match(requests[0].messages[0].content, /"must_have"/);
    delete process.env.LLM_JSON_MODE;
  });
  // Last: the fallback is remembered for the rest of the process.
  await test('a 400 on json_schema switches to json_object within the same attempt, and stays switched', async () => {
    respond({ error: new OpenAIErrors.BadRequestError(400, { message: 'response_format json_schema is not supported' }, 'unsupported', headers) }, { content: valid }, { content: valid });
    assert.deepEqual(await ask(), { kind: 'must_have', note: null });
    assert.deepEqual(requests.map((r) => r.response_format.type), ['json_schema', 'json_object']);
    await ask();
    assert.equal(requests[2].response_format.type, 'json_object');
  });
  await test('unknown providers still fail clearly; mock still wins', () => {
    process.env.LLM_PROVIDER = 'openai';
    assert.throws(getProvider, /anthropic 或 openai-compatible/);
    process.env.LLM_MODE = 'mock';
    assert.equal(getProvider(), 'mock');
    delete process.env.LLM_MODE;
    process.env.LLM_PROVIDER = 'openai-compatible';
  });

  console.log(`\n${passed} provider tests passed; no paid API calls.`);
})().catch((e) => { process.exitCode = 1; process.stderr.write(String(e && e.stack || e) + '\n'); });
