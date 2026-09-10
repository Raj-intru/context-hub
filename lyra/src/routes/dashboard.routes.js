// Admin dashboard: AGGREGATE usage only. By design (and enforced by RLS on
// messages/conversations) this endpoint can never return chat text — it reads
// the content-free usage_events table. This is the technical backing for the
// "parents/teachers see stats, not their kids' conversations" promise.

import { Router } from 'express';
import { withUser } from '../db.js';
import { asyncHandler } from '../middleware/errors.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireAdmin);

router.get('/dashboard', asyncHandler(async (req, res) => {
  const tenantId = req.user.tenant_id;
  const data = await withUser(req.user, async (c) => {
    const tenant = await c.query(
      `SELECT type, name, plan_type, token_pool_limit, tokens_consumed_this_period, period_started_at
         FROM tenants WHERE id = $1`,
      [tenantId],
    );

    // Per-member aggregates for the current billing period. No message content.
    const members = await c.query(
      `SELECT u.id AS user_id, u.first_name, u.role, u.group_id, u.is_active,
              u.monthly_token_cap,
              COALESCE(SUM(e.tokens_used), 0)::bigint AS tokens_this_period,
              COUNT(e.id) FILTER (WHERE e.tokens_used > 0) AS requests_this_period,
              COUNT(e.id) FILTER (WHERE e.was_flagged) AS flagged_this_period
         FROM users u
         LEFT JOIN usage_events e
           ON e.user_id = u.id
          AND e.created_at >= (SELECT period_started_at FROM tenants WHERE id = $1)
        WHERE u.tenant_id = $1
        GROUP BY u.id
        ORDER BY tokens_this_period DESC`,
      [tenantId],
    );

    const groups = await c.query(
      `SELECT id, name, token_allocation, tokens_consumed_this_period FROM groups
        WHERE tenant_id = $1 ORDER BY name`,
      [tenantId],
    );

    return { tenant: tenant.rows[0], members: members.rows, groups: groups.rows };
  });
  res.json(data);
}));

export default router;
