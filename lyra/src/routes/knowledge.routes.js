// Knowledge base management. Admins add/remove sources; any member can list the
// catalogue (titles only). All queries run RLS-scoped to the caller's tenant.

import { Router } from 'express';
import { withUser } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ingestSource } from '../services/ingest.js';

const router = Router();
router.use(requireAuth);

// List the tenant's knowledge sources (no chunk content).
router.get('/knowledge/sources', asyncHandler(async (req, res) => {
  const out = await withUser(req.user, (c) => c.query(
    `SELECT id, title, kind, license, subject, year_level, chunk_count, created_at
       FROM knowledge_sources ORDER BY created_at DESC`,
  ));
  res.json({ sources: out.rows });
}));

// Add a source and ingest it (chunk + embed + encrypt), admin only.
router.post('/knowledge/sources', requireAdmin, asyncHandler(async (req, res) => {
  const { title, text, kind, license, subject, yearLevel } = req.body || {};
  if (!title || !text || !text.trim()) {
    throw new HttpError(400, 'MISSING_FIELDS', 'title and non-empty text are required');
  }
  if (text.length > 500_000) throw new HttpError(413, 'TOO_LARGE', 'Source text exceeds the limit');

  const result = await withUser(req.user, (c) => ingestSource(c, {
    tenantId: req.user.tenant_id, createdBy: req.user.id,
    title, kind, license, subject, yearLevel, text,
  }));
  res.status(201).json(result);
}));

// Remove a source (and its chunks cascade), admin only.
router.delete('/knowledge/sources/:id', requireAdmin, asyncHandler(async (req, res) => {
  const out = await withUser(req.user, (c) =>
    c.query('DELETE FROM knowledge_sources WHERE id = $1 RETURNING id', [req.params.id]));
  if (!out.rows.length) throw new HttpError(404, 'SOURCE_NOT_FOUND', 'No such source in your workspace');
  res.json({ deleted: out.rows[0].id });
}));

export default router;
