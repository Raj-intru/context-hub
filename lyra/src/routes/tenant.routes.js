// Tenant administration: invites, members, groups (classrooms/households),
// per-user caps and pause/resume. All routes require an admin role, and every
// action is scoped to the caller's own tenant.

import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { makeInviteToken } from '../services/authService.js';
import { isValidRole, roleMatchesTenant, isAdmin, isSupervised } from '../domain/roles.js';
import { CONSENT_TEXT, CONSENT_TEXT_VERSION, CONSENT_TYPE_MINOR } from '../domain/consent.js';
import config from '../config.js';

const router = Router();
router.use(requireAuth, requireAdmin);

async function tenantType(tenantId) {
  const { rows } = await pool.query('SELECT type FROM tenants WHERE id = $1', [tenantId]);
  return rows[0]?.type;
}

// The consent wording admins must acknowledge when provisioning a minor.
router.get('/consent-text', (req, res) => {
  res.json({ version: CONSENT_TEXT_VERSION, text: CONSENT_TEXT });
});

// Create an invite for a new member. Returns a one-time acceptance link.
// Provisioning a supervised (child/student) account requires the admin to
// acknowledge consent; that acknowledgement is recorded for audit.
router.post('/invites', asyncHandler(async (req, res) => {
  const { email, firstName, role, groupId, consentAcknowledged, consentVersion } = req.body || {};
  const type = await tenantType(req.user.tenant_id);
  if (!isValidRole(role) || !roleMatchesTenant(role, type)) {
    throw new HttpError(400, 'BAD_ROLE', `Role must be valid for a ${type} tenant`);
  }
  const minor = isSupervised(role);
  if (minor) {
    if (consentAcknowledged !== true) {
      throw new HttpError(400, 'CONSENT_REQUIRED',
        'You must acknowledge parental/institutional consent to provision a minor account');
    }
    if (consentVersion !== CONSENT_TEXT_VERSION) {
      throw new HttpError(409, 'CONSENT_OUTDATED',
        'The consent text has changed; please re-read and acknowledge the current version');
    }
  }
  if (groupId) {
    const g = await pool.query('SELECT 1 FROM groups WHERE id = $1 AND tenant_id = $2', [groupId, req.user.tenant_id]);
    if (!g.rows.length) throw new HttpError(404, 'GROUP_NOT_FOUND', 'Group not in your tenant');
  }
  const { token, token_hash } = makeInviteToken();
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const { rows } = await pool.query(
    `INSERT INTO invites (tenant_id, group_id, email, first_name, role, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, expires_at`,
    [req.user.tenant_id, groupId || null, email ? email.toLowerCase() : null, firstName || null, role, token_hash, expires],
  );
  if (minor) {
    await pool.query(
      `INSERT INTO consent_records
         (tenant_id, invite_id, consented_by_user_id, subject_role, consent_type, consent_text_version, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.user.tenant_id, rows[0].id, req.user.id, role, CONSENT_TYPE_MINOR, CONSENT_TEXT_VERSION, req.ip],
    );
  }
  await pool.query(
    `INSERT INTO audit_log (tenant_id, actor_user_id, action, target, ip)
     VALUES ($1, $2, 'invite.create', $3, $4)`,
    [req.user.tenant_id, req.user.id, email || role, req.ip],
  );
  res.status(201).json({
    inviteId: rows[0].id,
    expiresAt: rows[0].expires_at,
    // The raw token is shown ONCE; only its hash is stored.
    acceptUrl: `${config.appBaseUrl}/accept-invite?token=${token}`,
    token,
  });
}));

// List members (no chat content — just roster + role/group).
router.get('/members', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, first_name, email, role, group_id, monthly_token_cap, is_active
       FROM users WHERE tenant_id = $1 ORDER BY created_at`,
    [req.user.tenant_id],
  );
  res.json({ members: rows });
}));

// Create a group (classroom or household unit).
router.post('/groups', asyncHandler(async (req, res) => {
  const { name, tokenAllocation } = req.body || {};
  if (!name) throw new HttpError(400, 'MISSING_FIELDS', 'name is required');
  const { rows } = await pool.query(
    `INSERT INTO groups (tenant_id, name, token_allocation) VALUES ($1, $2, $3)
     RETURNING id, name, token_allocation, tokens_consumed_this_period`,
    [req.user.tenant_id, name, tokenAllocation ?? null],
  );
  res.status(201).json({ group: rows[0] });
}));

router.get('/groups', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, token_allocation, tokens_consumed_this_period FROM groups
      WHERE tenant_id = $1 ORDER BY created_at`,
    [req.user.tenant_id],
  );
  res.json({ groups: rows });
}));

// Update a member: pause/resume, set a token cap, or (re)assign a group.
// Guardrails: cannot act outside your tenant; cannot demote/pause the last admin.
router.patch('/members/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const target = await pool.query('SELECT * FROM users WHERE id = $1 AND tenant_id = $2', [id, req.user.tenant_id]);
  if (!target.rows.length) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'No such member in your tenant');

  const { isActive, monthlyTokenCap, groupId } = req.body || {};

  if (isActive === false && isAdmin(target.rows[0].role)) {
    const admins = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users
        WHERE tenant_id = $1 AND is_active = TRUE AND role IN ('parent_admin','it_admin','teacher')`,
      [req.user.tenant_id],
    );
    if (admins.rows[0].n <= 1) throw new HttpError(409, 'LAST_ADMIN', 'Cannot pause the last active admin');
  }

  const fields = [];
  const vals = [];
  let i = 1;
  if (typeof isActive === 'boolean') { fields.push(`is_active = $${i++}`); vals.push(isActive); }
  if (monthlyTokenCap !== undefined) { fields.push(`monthly_token_cap = $${i++}`); vals.push(monthlyTokenCap); }
  if (groupId !== undefined) {
    if (groupId) {
      const g = await pool.query('SELECT 1 FROM groups WHERE id = $1 AND tenant_id = $2', [groupId, req.user.tenant_id]);
      if (!g.rows.length) throw new HttpError(404, 'GROUP_NOT_FOUND', 'Group not in your tenant');
    }
    fields.push(`group_id = $${i++}`); vals.push(groupId || null);
  }
  if (!fields.length) throw new HttpError(400, 'NO_CHANGES', 'Nothing to update');

  // Pausing a user revokes their live sessions by bumping token_version.
  if (isActive === false) fields.push('token_version = token_version + 1');

  vals.push(id, req.user.tenant_id);
  const { rows } = await pool.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${i++} AND tenant_id = $${i}
     RETURNING id, first_name, role, group_id, monthly_token_cap, is_active`,
    vals,
  );
  await pool.query(
    `INSERT INTO audit_log (tenant_id, actor_user_id, action, target, ip)
     VALUES ($1, $2, 'member.update', $3, $4)`,
    [req.user.tenant_id, req.user.id, id, req.ip],
  );
  res.json({ member: rows[0] });
}));

export default router;
