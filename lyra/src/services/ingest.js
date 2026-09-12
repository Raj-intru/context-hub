// Ingestion: turn a source document into embedded, encrypted, tenant-scoped
// chunks. Runs inside a withUser() transaction (an admin of the tenant), so RLS
// binds every insert to that tenant. Real deployments would add PDF/DOCX
// extraction + connectors ahead of this; the contract here is plain text/markdown.

import { chunkText } from './chunk.js';
import { embed, toVectorLiteral, modelName } from './embeddings.js';
import { encryptContent } from '../crypto/content.js';

/**
 * @param client  a pg client already bound to the tenant (via withUser)
 * @param opts    { tenantId, createdBy, title, kind, uri, license, subject,
 *                  yearLevel, text, preferLexical }
 * @returns { sourceId, chunkCount }
 */
export async function ingestSource(client, opts) {
  const {
    tenantId, createdBy, title, kind = 'upload', uri = null, license = null,
    subject = null, yearLevel = null, scopeKey = null, text, preferLexical = false,
  } = opts;
  if (!title || !text || !text.trim()) throw new Error('ingestSource requires title and non-empty text');

  const chunks = chunkText(text);
  if (!chunks.length) throw new Error('no chunks produced from text');

  const embeddings = await embed(chunks.map((c) => c.text), { preferLexical });
  const model = modelName({ preferLexical });

  const src = await client.query(
    `INSERT INTO knowledge_sources
       (tenant_id, title, kind, uri, license, subject, year_level, scope_key, created_by, chunk_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [tenantId, title, kind, uri, license, subject, yearLevel, scopeKey, createdBy || null, chunks.length],
  );
  const sourceId = src.rows[0].id;

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const label = c.heading ? `${title} · ${c.heading}` : `${title} · part ${i + 1}`;
    const enc = await encryptContent(c.text);
    await client.query(
      `INSERT INTO chunks
         (tenant_id, source_id, ordinal, citation_label, content_ciphertext, embedding, embed_model, token_count)
       VALUES ($1,$2,$3,$4,$5,$6::vector,$7,$8)`,
      [tenantId, sourceId, c.ordinal, label, enc, toVectorLiteral(embeddings[i]), model, c.tokens],
    );
  }
  return { sourceId, chunkCount: chunks.length };
}
