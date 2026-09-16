// Families/schools choose which context a child's tutor may use: shared
// curriculum packs + which of the workspace's own sources. Admin-managed.

import { Router } from 'express';
import { withUser, pool } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { isSupervised } from '../domain/roles.js';
import { libraryContext } from '../domain/library.js';

const router = Router();
router.use(requireAuth);

// Available shared curriculum packs (read under the library's own tenant context).
router.get('/scopes', asyncHandler(async (req, res) => {
  const rows = await withUser(libraryContext(), (c) => c.query(
    `SELECT scope_key, subject, year_level, title FROM knowledge_sources
      WHERE scope_key IS NOT NULL ORDER BY year_level, subject`,
  ));
  res.json({ scopes: rows.rows });
}));

router.use(requireAdmin); // everything below is admin-only

async function loadSupervisedChild(tenantId, childId) {
  const { rows } = await pool.query(
    'SELECT id, role FROM users WHERE id = $1 AND tenant_id = $2', [childId, tenantId]);
  if (!rows.length) throw new HttpError(404, 'CHILD_NOT_FOUND', 'No such member in your workspace');
  if (!isSupervised(rows[0].role)) throw new HttpError(400, 'NOT_SUPERVISED', 'Context applies to child/student accounts only');
  return rows[0];
}

// Read a child's context (defaults if unset) + the family's own sources.
router.get('/children/:id/context', asyncHandler(async (req, res) => {
  await loadSupervisedChild(req.user.tenant_id, req.params.id);
  const data = await withUser(req.user, async (c) => {
    const ctx = await c.query('SELECT year_level, region, scope_keys, enabled_source_ids FROM child_context WHERE child_user_id = $1', [req.params.id]);
    const sources = await c.query('SELECT id, title, subject FROM knowledge_sources WHERE scope_key IS NULL ORDER BY created_at DESC');
    return { context: ctx.rows[0] || { year_level: null, region: null, scope_keys: [], enabled_source_ids: null }, familySources: sources.rows };
  });
  res.json(data);
}));

// Set a child's context (upsert).
router.put('/children/:id/context', asyncHandler(async (req, res) => {
  await loadSupervisedChild(req.user.tenant_id, req.params.id);
  const { yearLevel = null, region = null, scopeKeys = [], enabledSourceIds = null } = req.body || {};
  if (!Array.isArray(scopeKeys)) throw new HttpError(400, 'BAD_SCOPES', 'scopeKeys must be an array');
  if (enabledSourceIds !== null && !Array.isArray(enabledSourceIds)) throw new HttpError(400, 'BAD_SOURCES', 'enabledSourceIds must be an array or null');

  const saved = await withUser(req.user, (c) => c.query(
    `INSERT INTO child_context (child_user_id, tenant_id, year_level, region, scope_keys, enabled_source_ids, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (child_user_id) DO UPDATE SET
       year_level = EXCLUDED.year_level, region = EXCLUDED.region,
       scope_keys = EXCLUDED.scope_keys, enabled_source_ids = EXCLUDED.enabled_source_ids,
       updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING year_level, region, scope_keys, enabled_source_ids`,
    [req.params.id, req.user.tenant_id, yearLevel, region, scopeKeys, enabledSourceIds, req.user.id],
  ));
  res.json({ context: saved.rows[0] });
}));

export default router;
