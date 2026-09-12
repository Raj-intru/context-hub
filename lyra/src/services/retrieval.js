// Retrieval: embed the query, ANN-search the tenant's chunks (RLS-scoped),
// decrypt the top matches, and return citation-ready snippets.
//
// `maxDistance` is the relevance gate: if the best match is farther than this
// (cosine distance in [0,2]), we treat the query as OUT OF SCOPE and return
// nothing, so the grounded prompt refuses instead of hallucinating. This is the
// knob the golden-question eval tunes and verifies.

import { embed, toVectorLiteral } from './embeddings.js';
import { decryptContent } from '../crypto/content.js';

const DEFAULT_K = 5;
const DEFAULT_MAX_DISTANCE = 0.75; // cosine distance; tune per embedder/corpus

/**
 * @param client  pg client bound to the tenant (via withUser)
 * @returns { hits: Array<{sourceTitle, label, snippet, distance}>, inScope: boolean }
 */
export async function retrieve(client, { query, k = DEFAULT_K, maxDistance = DEFAULT_MAX_DISTANCE, preferLexical = false }) {
  const qvec = await embed(query, { preferLexical });
  const res = await client.query(
    `SELECT c.citation_label, c.content_ciphertext,
            ks.title AS source_title,
            (c.embedding <=> $1::vector) AS distance
       FROM chunks c
       JOIN knowledge_sources ks ON ks.id = c.source_id
      ORDER BY c.embedding <=> $1::vector
      LIMIT $2`,
    [toVectorLiteral(qvec), k],
  );

  const hits = [];
  for (const row of res.rows) {
    if (Number(row.distance) > maxDistance) continue; // gate out weak matches
    hits.push({
      sourceTitle: row.source_title,
      label: row.citation_label,
      snippet: await decryptContent(row.content_ciphertext),
      distance: Number(row.distance),
    });
  }
  return { hits, inScope: hits.length > 0 };
}

/** Build the grounded context block + citation list for the prompt. */
export function formatContext(hits) {
  const sources = hits.map((h, i) => `[${i + 1}] ${h.label}\n${h.snippet}`).join('\n\n');
  const citations = hits.map((h, i) => ({ n: i + 1, label: h.label, source: h.sourceTitle }));
  return { sources, citations };
}
