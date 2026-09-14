// Self-service account preferences (appearance). A user may only change their
// own theme/accent; supervised roles are restricted to a curated palette.

import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validatePreferences, allowedAccents, ACCENTS, accentOn } from '../domain/theme.js';

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

export default router;
