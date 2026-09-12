import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseModel } from '../src/services/router.js';
import config from '../src/config.js';

test('an explicit client model choice always wins', () => {
  const r = chooseModel({ role: 'adult', prompt: 'anything', requestedModel: 'openai/gpt-4o' });
  assert.deepEqual(r, { model: 'openai/gpt-4o', tier: 'client' });
});

test('supervised accounts route to the cheap OSS model', () => {
  assert.equal(chooseModel({ role: 'child', prompt: 'help with fractions' }).model, config.models.simple);
  assert.equal(chooseModel({ role: 'student', prompt: 'why is the sky blue' }).tier, 'simple');
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
