import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moderate } from '../src/services/moderation.js';

test('fails CLOSED when moderation is unavailable (default)', async () => {
  const v = await moderate('anything', { apiKey: '', failOpen: false });
  assert.equal(v.flagged, true);
  assert.equal(v.reason, 'moderation_unavailable');
});

test('fails OPEN only when explicitly configured', async () => {
  const v = await moderate('anything', { apiKey: '', failOpen: true });
  assert.equal(v.flagged, false);
});

test('parses a flagged verdict from the API', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ results: [{ flagged: true, categories: { violence: true } }] }),
  });
  const v = await moderate('bad stuff', { apiKey: 'sk-test', failOpen: false, fetchImpl: fakeFetch });
  assert.equal(v.flagged, true);
  assert.equal(v.available, true);
});

test('passes clean content', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ results: [{ flagged: false, categories: {} }] }) });
  const v = await moderate('how do plants grow?', { apiKey: 'sk-test', fetchImpl: fakeFetch });
  assert.equal(v.flagged, false);
});

test('HTTP error from moderation fails closed', async () => {
  const fakeFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const v = await moderate('x', { apiKey: 'sk-test', failOpen: false, fetchImpl: fakeFetch });
  assert.equal(v.flagged, true);
});
