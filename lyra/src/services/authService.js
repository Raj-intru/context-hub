// Signup / login / invite acceptance.

import crypto from 'node:crypto';
import { pool } from '../db.js';
import { hashPassword, verifyPassword } from '../crypto/password.js';
import { issueToken } from '../crypto/token.js';
import { HttpError } from '../middleware/errors.js';
import { ownerRoleFor, isValidRole } from '../domain/roles.js';

const DEFAULT_QUOTA = { family: 10_000_000, school: 3_000_000 };

function sessionFor(user) {
  return issueToken({
    sub: user.id,
    tenant: user.tenant_id,
    role: user.role,
    ver: user.token_version ?? 0,
  });
}

export function publicUser(u) {
  return {
    id: u.id,
    tenantId: u.tenant_id,
    role: u.role,
    firstName: u.first_name,
    email: u.email,
    groupId: u.group_id ?? null,
  };
}

/** Create a new tenant (family|school) and its owner-admin account. */
export async function signup({ tenantType, tenantName, firstName, email, password }) {
  if (tenantType !== 'family' && tenantType !== 'school') {
    throw new HttpError(400, 'BAD_TENANT_TYPE', 'tenantType must be family or school');
  }
  if (!tenantName || !email || !password) {
    throw new HttpError(400, 'MISSING_FIELDS', 'tenantName, email and password are required');
  }
  const password_hash = await hashPassword(password);
  const role = ownerRoleFor(tenantType);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT 1 FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) throw new HttpError(409, 'EMAIL_TAKEN', 'That email is already registered');

    const tenant = await client.query(
      `INSERT INTO tenants (type, name, plan_type, token_pool_limit)
       VALUES ($1, $2, 'basic', $3) RETURNING id`,
      [tenantType, tenantName, DEFAULT_QUOTA[tenantType]],
    );
    const tenantId = tenant.rows[0].id;

    const user = await client.query(
      `INSERT INTO users (tenant_id, email, role, first_name, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id, group_id, role, first_name, email, token_version`,
      [tenantId, email.toLowerCase(), role, firstName || null, password_hash],
    );
    await client.query('COMMIT');
    const u = user.rows[0];
    return { user: publicUser(u), token: sessionFor(u) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function login({ email, password }) {
  if (!email || !password) throw new HttpError(400, 'MISSING_FIELDS', 'email and password required');
  const { rows } = await pool.query(
    `SELECT id, tenant_id, group_id, role, first_name, email, password_hash, token_version, is_active
       FROM users WHERE email = $1`,
    [email.toLowerCase()],
  );
  const user = rows[0];
  // Verify against a dummy hash when the user is missing to reduce timing/enumeration signal.
  const ok = user && user.is_active && user.password_hash
    ? await verifyPassword(password, user.password_hash)
    : await verifyPassword(password, 'scrypt$16384$8$1$00$00').then(() => false);
  if (!user || !ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
  return { user: publicUser(user), token: sessionFor(user) };
}

/** Generate an invite token (returned once, in plaintext) + its stored hash. */
export function makeInviteToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const token_hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, token_hash };
}

export async function acceptInvite({ token, firstName, password }) {
  if (!token || !password) throw new HttpError(400, 'MISSING_FIELDS', 'token and password required');
  const token_hash = crypto.createHash('sha256').update(token).digest('hex');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inv = await client.query(
      `SELECT * FROM invites WHERE token_hash = $1 FOR UPDATE`,
      [token_hash],
    );
    const invite = inv.rows[0];
    if (!invite) throw new HttpError(404, 'INVITE_NOT_FOUND', 'Invalid invite');
    if (invite.accepted_at) throw new HttpError(409, 'INVITE_USED', 'Invite already used');
    if (new Date(invite.expires_at) < new Date()) throw new HttpError(410, 'INVITE_EXPIRED', 'Invite expired');
    if (!isValidRole(invite.role)) throw new HttpError(400, 'BAD_ROLE', 'Invite has invalid role');

    const password_hash = await hashPassword(password);
    const user = await client.query(
      `INSERT INTO users (tenant_id, group_id, email, role, first_name, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, tenant_id, group_id, role, first_name, email, token_version`,
      [invite.tenant_id, invite.group_id, invite.email, invite.role,
        firstName || invite.first_name || null, password_hash],
    );
    await client.query('UPDATE invites SET accepted_at = NOW() WHERE id = $1', [invite.id]);
    // Link any consent record captured at invite time to the now-created account.
    await client.query(
      'UPDATE consent_records SET subject_user_id = $1 WHERE invite_id = $2 AND subject_user_id IS NULL',
      [user.rows[0].id, invite.id],
    );
    await client.query('COMMIT');
    const u = user.rows[0];
    return { user: publicUser(u), token: sessionFor(u) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
