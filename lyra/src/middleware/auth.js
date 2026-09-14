// Authentication + authorization middleware.
//
// requireAuth: validates the Bearer session token, loads the user, and checks
// token_version (so revocation via bumping the column works). It attaches
// req.user = { id, tenant_id, role, group_id, ... }.
//
// This is the layer the uploaded blueprint was missing entirely — without it
// any caller could impersonate any user/family.

import { verifyToken } from '../crypto/token.js';
import { query } from '../db.js';
import { isAdmin, canManageBilling } from '../domain/roles.js';
import { HttpError } from './errors.js';

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (!m) throw new HttpError(401, 'UNAUTHENTICATED', 'Missing bearer token');
    const claims = verifyToken(m[1]);

    const { rows } = await query(
      `SELECT id, tenant_id, group_id, role, first_name, email, token_version,
              monthly_token_cap, is_active, theme_pref, accent_pref
         FROM users WHERE id = $1`,
      [claims.sub],
    );
    const user = rows[0];
    if (!user || !user.is_active) throw new HttpError(401, 'UNAUTHENTICATED', 'Account inactive');
    if (user.token_version !== claims.ver) {
      throw new HttpError(401, 'SESSION_REVOKED', 'Session no longer valid');
    }
    if (user.tenant_id !== claims.tenant) {
      throw new HttpError(401, 'UNAUTHENTICATED', 'Token/tenant mismatch');
    }
    req.user = user;
    next();
  } catch (err) {
    if (err instanceof HttpError) return next(err);
    next(new HttpError(401, 'UNAUTHENTICATED', 'Invalid token'));
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || !isAdmin(req.user.role)) {
    return next(new HttpError(403, 'FORBIDDEN', 'Admin role required'));
  }
  next();
}

// Billing management is a strict subset of admin: a classroom teacher is an
// admin but must not touch the tenant's subscription. Only parent_admin/it_admin.
export function requireBilling(req, res, next) {
  if (!req.user || !canManageBilling(req.user.role)) {
    return next(new HttpError(403, 'FORBIDDEN', 'Billing admin role required'));
  }
  next();
}
