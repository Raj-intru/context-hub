import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseModel, isModelAllowed } from '../src/services/router.js';
import config from '../src/config.js';

test('an adult may pin an allowlisted model', () => {
  const r = chooseModel({ role: 'adult', prompt: 'anything', requestedModel: config.models.complex });
  assert.deepEqual(r, { model: config.models.complex, tier: 'client', modality: 'text' });
});

test('a non-allowlisted requested model falls back to auto-routing', () => {
  const r = chooseModel({ role: 'adult', prompt: 'anything', requestedModel: 'openai/gpt-4o-unlisted' });
  assert.notEqual(r.tier, 'client');
  assert.ok(isModelAllowed(r.model));
});

test('supervised accounts are LOCKED to the cheap OSS model', () => {
  const r = chooseModel({ role: 'child', prompt: 'help with fractions' });
  assert.equal(r.model, config.models.simple);
  assert.equal(r.tier, 'supervised');
  assert.equal(r.locked, true);
});

test('a supervised account can NOT pin a different model', () => {
  // Even an allowlisted paid model is ignored for a minor.
  const r = chooseModel({ role: 'student', prompt: 'why is the sky blue', requestedModel: config.models.complex });
  assert.equal(r.model, config.models.simple);
  assert.equal(r.tier, 'supervised');
});

test('a short adult prompt uses the OSS model', () => {
  assert.equal(chooseModel({ role: 'adult', prompt: 'what time is it in Sydney' }).tier, 'simple');
});

test('a complex adult prompt escalates to the frontier paid model', () => {
  const long = 'Please analyze and compare the trade-offs between these two architectures '
    + 'and design an approach: ' + 'detail '.repeat(70);
  const r = chooseModel({ role: 'adult', prompt: long });
  assert.equal(r.tier, 'complex');
  assert.equal(r.model, config.models.complex);
});

test('a reasoning cue escalates even a shorter prompt', () => {
  assert.equal(chooseModel({ role: 'adult', prompt: 'evaluate this design trade-off' }).tier, 'complex');
});

test('an image-bearing turn routes to a vision-capable model', () => {
  const adult = chooseModel({ role: 'adult', prompt: 'what is in this photo', needsVision: true });
  assert.equal(adult.modality, 'vision');
  assert.equal(adult.model, config.models.visionSimple);

  const kid = chooseModel({ role: 'student', prompt: 'help with this worksheet', needsVision: true });
  assert.equal(kid.tier, 'supervised');
  assert.equal(kid.model, config.models.visionSimple);
});

test('a pinned text-only model is ignored when vision is required', () => {
  const r = chooseModel({
    role: 'adult', prompt: 'what is in this photo', needsVision: true,
    requestedModel: 'meta-llama/llama-3.1-8b-instruct', // text-only
  });
  assert.notEqual(r.tier, 'client');
  assert.equal(r.modality, 'vision');
});
