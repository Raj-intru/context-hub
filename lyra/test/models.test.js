import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getModel, supportsModality, isSupervisedSafe, isImageGenerationModel, MODELS } from '../src/services/models.js';

test('registry entries are well-formed', () => {
  for (const [id, m] of Object.entries(MODELS)) {
    assert.ok(Array.isArray(m.modalities) && m.modalities.length, `${id} needs modalities`);
    assert.ok(['simple', 'complex'].includes(m.tier), `${id} needs a tier`);
    assert.equal(typeof m.supervisedSafe, 'boolean', `${id} needs supervisedSafe`);
  }
});

test('vision capability is reported from the registry', () => {
  assert.equal(supportsModality('google/gemini-flash-1.5', 'vision'), true);
  assert.equal(supportsModality('meta-llama/llama-3.1-8b-instruct', 'vision'), false);
  // Unknown ids are treated as text-only (conservative).
  assert.equal(supportsModality('some/unknown-model', 'vision'), false);
  assert.equal(supportsModality('some/unknown-model', 'text'), true);
});

test('image generators are never supervised-safe', () => {
  assert.equal(isSupervisedSafe('openai/gpt-image-1'), false);
  assert.equal(isImageGenerationModel('openai/gpt-image-1'), true);
  assert.equal(isImageGenerationModel('google/gemini-flash-1.5'), false); // vision input, not a generator
});

test('unknown ids are not supervised-safe (fail closed)', () => {
  assert.equal(isSupervisedSafe('some/unknown-model'), false);
  assert.equal(getModel('some/unknown-model'), null);
});
