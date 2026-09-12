import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText } from '../src/services/chunk.js';
import { embedLexical, EMBEDDING_DIM } from '../src/services/embeddings.js';
import { buildMessages, _internal } from '../src/services/prompts.js';

test('chunking splits on headings and produces ordered non-empty chunks', () => {
  const text = `# Intro\nHello world.\n\n# Section two\nMore content here that is useful.`;
  const chunks = chunkText(text, { targetTokens: 10 });
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((c) => c.text.trim().length > 0));
  assert.deepEqual(chunks.map((c) => c.ordinal), chunks.map((_, i) => i));
  assert.ok(chunks.some((c) => c.heading === 'Intro'));
});

test('lexical embedding is deterministic and correctly dimensioned', () => {
  const a = embedLexical('adding fractions with the same denominator');
  const b = embedLexical('adding fractions with the same denominator');
  assert.equal(a.length, EMBEDDING_DIM);
  assert.deepEqual(a, b);
  // L2-normalized
  const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9);
});

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

test('related text embeds closer than unrelated text (lexical)', () => {
  const q = embedLexical('why are leaves green');
  const related = embedLexical('leaves are green because of chlorophyll');
  const unrelated = embedLexical('the best strategy to win a video game');
  assert.ok(dot(q, related) > dot(q, unrelated));
});

test('grounded prompt binds to sources and cites when in scope', () => {
  const msgs = buildMessages({
    supervised: true, userPrompt: 'add fractions', history: [],
    grounding: { sources: '[1] Unit · Fractions\nkeep the denominator', inScope: true },
  });
  const grounding = msgs.find((m) => m.role === 'system' && m.content.includes('[GROUNDING]'));
  assert.ok(grounding, 'grounding system message present');
  assert.match(grounding.content, /ONLY the sources/);
  assert.match(grounding.content, /\[1\]/);
});

test('grounded prompt instructs refusal when out of scope', () => {
  const msg = _internal.groundingInstruction({ sources: null, inScope: false });
  assert.match(msg, /nothing relevant/i);
  assert.match(msg, /do not answer from outside knowledge/i);
});
