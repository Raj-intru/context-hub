// Ingest the shared Australian Curriculum packs into the Lyra Curriculum Library
// tenant, so families/schools can enable them as context for a child.
// Idempotent: re-ingesting replaces packs with the same scope_key.
//
//   DATABASE_URL=postgres://lyra_app:...@host/db node scripts/ingest-au-curriculum.js
//
// Uses real embeddings when OPENAI_API_KEY is set, else the lexical dev embedder.

import { withUser, close } from '../src/db.js';
import { ingestSource } from '../src/services/ingest.js';
import { libraryContext, LIBRARY_TENANT_ID } from '../src/domain/library.js';
import { AU_PACKS } from './data/au-curriculum-sample.js';

async function main() {
  const ctx = libraryContext();
  const preferLexical = !process.env.OPENAI_API_KEY;
  let total = 0;
  await withUser(ctx, async (c) => {
    const keys = AU_PACKS.map((p) => p.scopeKey);
    await c.query('DELETE FROM knowledge_sources WHERE scope_key = ANY($1::text[])', [keys]);
    for (const p of AU_PACKS) {
      const { chunkCount } = await ingestSource(c, {
        tenantId: LIBRARY_TENANT_ID, createdBy: null,
        title: p.title, kind: 'curriculum',
        license: 'SAMPLE — replace with licensed ACARA/state content before production',
        subject: p.subject, yearLevel: p.yearLevel, scopeKey: p.scopeKey,
        text: p.text, preferLexical,
      });
      total += chunkCount;
      console.log(`  ✓ ${p.scopeKey} — ${chunkCount} chunks`);
    }
  });
  console.log(`Ingested ${AU_PACKS.length} packs (${total} chunks) into the curriculum library` +
    `${preferLexical ? ' [lexical dev embedder]' : ''}.`);
  await close();
}

main().catch((e) => { console.error('AU ingestion failed:', e); process.exit(1); });
