import { test } from 'node:test';
import assert from 'node:assert/strict';
import { complete, LlmError } from '../src/services/llm.js';

test('parses a well-formed completion', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ model: 'x/y', choices: [{ message: { content: 'Let us think step by step.' } }], usage: { total_tokens: 42 } }),
  });
  const r = await complete({ model: 'x/y', messages: [], apiKey: 'k', fetchImpl: fakeFetch });
  assert.equal(r.content, 'Let us think step by step.');
  assert.equal(r.tokensUsed, 42);
});

test('throws typed error on upstream error (no crash on choices[0])', async () => {
  const fakeFetch = async () => ({ ok: false, status: 502, json: async () => ({ error: { message: 'model down' } }) });
  await assert.rejects(
    () => complete({ model: 'x/y', messages: [], apiKey: 'k', fetchImpl: fakeFetch }),
    (e) => e instanceof LlmError && e.status === 502,
  );
});

test('rate limit is surfaced as 429', async () => {
  const fakeFetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'slow down' } }) });
  await assert.rejects(
    () => complete({ messages: [], apiKey: 'k', fetchImpl: fakeFetch }),
    (e) => e.status === 429,
  );
});

test('missing content is rejected, not returned as undefined', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ choices: [{}] }) });
  await assert.rejects(() => complete({ messages: [], apiKey: 'k', fetchImpl: fakeFetch }));
});

test('unconfigured provider throws 503', async () => {
  await assert.rejects(
    () => complete({ messages: [], apiKey: '' }),
    (e) => e.status === 503 && e.code === 'LLM_NOT_CONFIGURED',
  );
});
