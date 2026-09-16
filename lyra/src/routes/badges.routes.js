// Gamification: a learner's earned + available badges, and an unlock endpoint.
// A user can only unlock badges for themselves (no userId is accepted from the
// client — it comes from the authenticated session).

import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// All badges with an `earned` flag for the caller.
router.get('/badges/me', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.id, b.title, b.description, b.subject, b.icon_emoji,
            ub.earned_at,
            (ub.id IS NOT NULL) AS earned
       FROM badges b
       LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.user_id = $1
      ORDER BY earned DESC, b.subject, b.title`,
    [req.user.id],
  );
  res.json({ badges: rows });
}));

// Unlock a badge for the caller (idempotent).
router.post('/badges/unlock', asyncHandler(async (req, res) => {
  const { badgeTitle } = req.body || {};
  if (!badgeTitle) throw new HttpError(400, 'MISSING_FIELDS', 'badgeTitle is required');
  const badge = await pool.query('SELECT id, title, icon_emoji FROM badges WHERE title = $1', [badgeTitle]);
  if (!badge.rows.length) throw new HttpError(404, 'BADGE_NOT_FOUND', 'No such badge');

  const inserted = await pool.query(
    `INSERT INTO user_badges (user_id, badge_id) VALUES ($1, $2)
     ON CONFLICT (user_id, badge_id) DO NOTHING RETURNING id`,
    [req.user.id, badge.rows[0].id],
  );
  res.json({
    success: true,
    newUnlock: inserted.rows.length > 0,
    badge: { title: badge.rows[0].title, icon: badge.rows[0].icon_emoji },
  });
}));

export default router;
