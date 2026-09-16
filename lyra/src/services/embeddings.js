// Embeddings for RAG.
//
// Production: OpenAI `text-embedding-3-small` (1536-dim). Dev/test/eval: a
// deterministic, dependency-free *lexical* embedder that hashes tokens into the
// same 1536-dim space and L2-normalizes. The lexical embedder captures word
// overlap (enough to demonstrate in-scope retrieval vs out-of-scope refusal in
// tests without network), but is NOT semantic — swap in a real model for prod.
//
// Both paths return L2-normalized vectors so cosine distance (pgvector `<=>`
// with vector_cosine_ops) is meaningful.

import crypto from 'node:crypto';
import config from '../config.js';

export const EMBEDDING_DIM = 1536;

function l2normalize(vec) {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

// Common words carry no topical signal; dropping them keeps the lexical dev
// embedder from matching on "the"/"and" (real embeddings don't have this issue).
const STOPWORDS = new Set(('a an and are as at be but by do does for from how i in is it its me my '
  + 'of on or that the their them then there these this to we what when where which who why with you your '
  + 'can could should would will was were been being have has had').split(' '));

function tokenize(text) {
  return (String(text).toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => !STOPWORDS.has(t));
}

/** Deterministic lexical embedding: hashed bag-of-words, TF-weighted, normalized. */
export function embedLexical(text) {
  const vec = new Array(EMBEDDING_DIM).fill(0);
  for (const tok of tokenize(text)) {
    // Two hashed buckets per token with signs → reduces collisions.
    const h = crypto.createHash('md5').update(tok).digest();
    const i1 = h.readUInt32LE(0) % EMBEDDING_DIM;
    const i2 = h.readUInt32LE(4) % EMBEDDING_DIM;
    vec[i1] += 1;
    vec[i2] += (h[8] & 1) ? 1 : -1;
  }
  return l2normalize(vec);
}

async function embedOpenAI(texts, fetchImpl) {
  const resp = await fetchImpl('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openAiApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  });
  if (!resp.ok) throw new Error(`embeddings HTTP ${resp.status}`);
  const data = await resp.json();
  return data.data.map((d) => l2normalize(d.embedding));
}

/**
 * Embed one string or an array. Returns a vector (or array of vectors).
 * Uses OpenAI when a key is present and `preferLexical` is not forced.
 */
export async function embed(input, { fetchImpl = fetch, preferLexical = false } = {}) {
  const arr = Array.isArray(input) ? input : [input];
  const useReal = config.openAiApiKey && !preferLexical;
  const vecs = useReal ? await embedOpenAI(arr, fetchImpl) : arr.map(embedLexical);
  return Array.isArray(input) ? vecs : vecs[0];
}

export function modelName({ preferLexical = false } = {}) {
  return (config.openAiApiKey && !preferLexical) ? 'text-embedding-3-small' : 'lexical-dev';
}

/** Format a JS number[] as a pgvector literal: '[0.1,0.2,...]'. */
export function toVectorLiteral(vec) {
  return '[' + vec.join(',') + ']';
}
