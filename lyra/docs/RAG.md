# Context-bound RAG (Phase 1)

Makes the tutor answer **only from a workspace's own materials**, with citations,
and **refuse** anything outside them — enforced per tenant by the same Row-Level
Security that protects chats. This is what a school means by "responds to our
context only." It is *not* per-school model training (see `docs/COMPLIANCE.md`
on why grounding beats fine-tuning for this).

## Pieces

| File | Role |
| --- | --- |
| `db/init.sql` (`knowledge_sources`, `chunks`) | pgvector store; RLS = tenant-scoped |
| `src/services/embeddings.js` | OpenAI `text-embedding-3-small` in prod; a deterministic **lexical** embedder offline for dev/test/eval |
| `src/services/chunk.js` | heading/paragraph chunking with overlap |
| `src/services/ingest.js` | chunk → embed → **encrypt** → insert (under the tenant's RLS) |
| `src/services/retrieval.js` | embed query → ANN search → decrypt → citations; a **relevance gate** turns weak matches into a refusal |
| `src/services/prompts.js` (`groundingInstruction`) | binds the model to the sources or instructs refusal |
| `src/routes/knowledge.routes.js` | admin add/list/delete sources |
| `src/routes/chat.routes.js` | retrieval step wired before the model call; returns `citations` |
| `scripts/eval-rag.js` | golden-question eval (in-scope cited / out-of-scope refused) |

## Isolation (proven, not asserted)

`chunks` and `knowledge_sources` carry RLS `USING (tenant_id = app_current_tenant_id())`,
and the app connects as the non-owner `lyra_app` role, so a tenant's retrieval
can only ever see its own chunks. `test/rag-e2e.mjs` demonstrates School B
retrieving **nothing** of School A's material.

## The relevance gate (calibrate per embedder)

`retrieval.js` refuses when the best cosine distance exceeds `maxDistance`
(default `0.75`). This threshold is **embedder- and corpus-dependent** — the
golden-question eval is how you calibrate and monitor it. Well-chunked,
focused sources separate cleanly (observed: in-scope ≈0.6, out-of-scope ≈0.85);
over-long chunks dilute the vector and blur the line, so keep chunks tight.

## Run it

```bash
# needs Postgres with the `vector` extension; DATABASE_URL = lyra_app role
npm run migrate            # creates knowledge_sources, chunks, vector index (needs a privileged conn)
npm test                   # unit: chunking, embedding, grounded prompt
npm run eval:rag           # golden questions: in-scope cited, out-of-scope refused
npm run test:rag           # live isolation E2E (two schools, no cross-tenant retrieval)
```

## Production notes

- Embeddings: set `OPENAI_API_KEY`; swap the lexical dev embedder for a real
  model. If a district requires data residency, self-host an open embedding
  model (e5/bge) in-region. `vector(1536)` must match the model's dimension.
- Add PDF/DOCX extraction + connectors (Drive/Classroom/LMS/LTI) ahead of the
  plain-text ingestion contract.
- Embeddings are derived from content and can be partially inverted — treat them
  as sensitive; they're protected by the same RLS + at-rest encryption.
