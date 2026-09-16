// Self-service account preferences (appearance). A user may only change their
// own theme/accent; supervised roles are restricted to a curated palette.

import { Router } from 'express';
import { pool, withUser } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validatePreferences, allowedAccents, ACCENTS, accentOn } from '../domain/theme.js';
import { isAdmin, isSupervised } from '../domain/roles.js';
import { decryptContent } from '../crypto/content.js';

const router = Router();
router.use(requireAuth);

// What accents this user is allowed to pick (drives the client swatches).
router.get('/me/appearance-options', (req, res) => {
  const names = allowedAccents(req.user.role);
  res.json({
    theme: req.user.theme_pref, accent: req.user.accent_pref,
    accents: names.map((name) => ({ name, hex: ACCENTS[name], on: accentOn(name) })),
  });
});

router.patch('/me/preferences', asyncHandler(async (req, res) => {
  let patch;
  try {
    patch = validatePreferences(req.body || {}, req.user.role);
  } catch (err) {
    throw new HttpError(400, 'BAD_PREFERENCE', err.message);
  }
  const sets = [];
  const vals = [];
  let i = 1;
  if (patch.theme !== undefined) { sets.push(`theme_pref = $${i++}`); vals.push(patch.theme); }
  if (patch.accent !== undefined) { sets.push(`accent_pref = $${i++}`); vals.push(patch.accent); }
  vals.push(req.user.id);
  const { rows } = await pool.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING theme_pref, accent_pref`,
    vals,
  );
  res.json({ theme: rows[0].theme_pref, accent: rows[0].accent_pref });
}));

// Data-subject access: export ALL of the caller's own conversations (decrypted).
// RLS guarantees this only ever returns the caller's rows.
router.get('/me/export', asyncHandler(async (req, res) => {
  const conversations = await withUser(req.user, async (c) => {
    const convs = await c.query(
      'SELECT id, title, model_used, created_at, updated_at FROM conversations ORDER BY created_at',
    );
    const out = [];
    for (const conv of convs.rows) {
      const msgs = await c.query(
        'SELECT sender_role, content, tokens_used, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at',
        [conv.id],
      );
      const messages = [];
      for (const m of msgs.rows) {
        messages.push({
          role: m.sender_role, content: await decryptContent(m.content),
          tokensUsed: m.tokens_used, createdAt: m.created_at,
        });
      }
      out.push({ ...conv, messages });
    }
    return out;
  });
  res.setHeader('Content-Disposition', 'attachment; filename="lyra-export.json"');
  res.json({
    exportedAt: new Date().toISOString(),
    user: { id: req.user.id, role: req.user.role, firstName: req.user.first_name, email: req.user.email },
    conversations,
  });
}));

// Data-subject erasure: an adult deletes their own account. Cascades remove
// their conversations/messages/usage/badges (see ON DELETE CASCADE in the
// schema). A supervised minor cannot self-delete — a parent/teacher removes the
// account via DELETE /members/:id, keeping guardians in control. The last active
// admin cannot delete themselves and orphan the tenant.
router.delete('/me/account', asyncHandler(async (req, res) => {
  if (isSupervised(req.user.role)) {
    throw new HttpError(403, 'GUARDIAN_REQUIRED',
      'A supervised account is removed by a parent or teacher, not self-deleted.');
  }
  if (isAdmin(req.user.role)) {
    const admins = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users
        WHERE tenant_id = $1 AND is_active = TRUE AND role IN ('parent_admin','it_admin')`,
      [req.user.tenant_id],
    );
    if (admins.rows[0].n <= 1) {
      throw new HttpError(409, 'LAST_ADMIN',
        'You are the last admin. Transfer ownership or close the workspace instead.');
    }
  }
  await pool.query('DELETE FROM users WHERE id = $1', [req.user.id]);
  await pool.query(
    `INSERT INTO audit_log (tenant_id, actor_user_id, action, target, ip)
     VALUES ($1, NULL, 'account.self_delete', $2, $3)`,
    [req.user.tenant_id, req.user.id, req.ip],
  );
  res.json({ deleted: true });
}));

export default router;
