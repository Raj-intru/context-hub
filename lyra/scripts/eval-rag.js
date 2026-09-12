// Golden-question eval for the RAG retrieval layer.
//
// Ingests a small fixture corpus into a throwaway tenant, then checks that:
//   - in-scope questions retrieve the RIGHT source (below the relevance gate)
//   - out-of-scope questions retrieve nothing (→ the grounded prompt refuses)
// This is the artifact a school signs off on before go-live. Runs OFFLINE using
// the lexical dev embedder (preferLexical), so no API key is needed.
//
//   DATABASE_URL=postgres://lyra_app:...@host/db node scripts/eval-rag.js

import crypto from 'node:crypto';
import { pool, withUser, close } from '../src/db.js';
import { ingestSource } from '../src/services/ingest.js';
import { retrieve } from '../src/services/retrieval.js';

// Focused, curriculum-sized chunks. (Chunk quality directly affects the
// relevance gate — over-long chunks dilute the vector; keep them tight.)
const CORPUS = [
  { title: 'Room 3B — Adding Fractions', subject: 'maths', text:
`# Adding fractions with the same denominator
Keep the denominator and add the numerators. One quarter plus two quarters
equals three quarters.` },
  { title: 'Room 3B — Plants and Light', subject: 'science', text:
`# Why leaves are green
Leaves look green because they contain chlorophyll, which reflects green light
and absorbs red and blue light for photosynthesis.` },
  { title: 'Oakridge — Classroom Agreement', subject: 'policy', text:
`# Being kind online
Students agree to be respectful, keep personal information private, and ask a
teacher if something feels wrong.` },
];

const GOLDEN = [
  { q: 'how do I add fractions with the same denominator?', expect: 'in', source: /Adding Fractions/ },
  { q: 'why do leaves look green?', expect: 'in', source: /Plants and Light/ },
  { q: 'what should I do if something online feels wrong?', expect: 'in', source: /Classroom Agreement/ },
  { q: 'what is the best strategy to win at fortnite?', expect: 'out' },
  { q: 'who won the 2049 football world cup?', expect: 'out' },
];

async function main() {
  const suffix = crypto.randomBytes(3).toString('hex');
  // Seed a throwaway tenant + admin (owner-level inserts; no RLS on these tables).
  const t = await pool.query(
    `INSERT INTO tenants (type, name) VALUES ('school', $1) RETURNING id`, [`Eval School ${suffix}`]);
  const tenantId = t.rows[0].id;
  const u = await pool.query(
    `INSERT INTO users (tenant_id, email, role, first_name) VALUES ($1,$2,'it_admin','Eval')
     RETURNING id, tenant_id, role`, [tenantId, `eval_${suffix}@example.com`]);
  const admin = u.rows[0];

  try {
    for (const doc of CORPUS) {
      await withUser(admin, (c) => ingestSource(c, {
        tenantId, createdBy: admin.id, title: doc.title, subject: doc.subject,
        kind: 'curriculum', license: 'eval-fixture', text: doc.text, preferLexical: true,
      }));
    }

    let pass = 0;
    const rows = [];
    for (const g of GOLDEN) {
      const { hits, inScope } = await withUser(admin, (c) =>
        retrieve(c, { query: g.q, preferLexical: true }));
      let ok, detail;
      if (g.expect === 'out') {
        ok = !inScope;
        detail = inScope ? `LEAKED: matched ${hits[0].sourceTitle} (d=${hits[0].distance.toFixed(3)})` : 'refused ✓';
      } else {
        const top = hits[0];
        ok = inScope && g.source.test(top?.sourceTitle || '');
        detail = inScope ? `${top.sourceTitle} (d=${top.distance.toFixed(3)})` : 'NO MATCH (would refuse)';
      }
      if (ok) pass++;
      rows.push({ ok, expect: g.expect, q: g.q, detail });
    }

    console.log('\nGolden-question RAG eval\n' + '─'.repeat(60));
    for (const r of rows) {
      console.log(`${r.ok ? '✓' : '✗'} [${r.expect.padEnd(3)}] ${r.q}\n      → ${r.detail}`);
    }
    console.log('─'.repeat(60));
    console.log(`${pass}/${GOLDEN.length} passed`);
    if (pass !== GOLDEN.length) process.exitCode = 1;
  } finally {
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]); // cascade cleanup
    await close();
  }
}

main().catch((e) => { console.error('eval failed:', e); process.exit(1); });
