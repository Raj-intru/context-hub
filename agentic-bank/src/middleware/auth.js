// Identity.
//
// THIS IS A DEMO SHIM, and the README says so in as many words. It establishes
// *who is calling* in a way that is good enough to exercise the kernel and
// honest about what it is not: there is no customer login, no device binding,
// no token refresh, no mTLS for the API channel, and no step-up for a
// high-value instruction.
//
// Two modes:
//   AUTH_SECRET set    -> a bearer token must be a valid HMAC-signed identity.
//   AUTH_SECRET unset  -> identity headers are trusted. Local use only.

import { createHmac, timingSafeEqual } from 'node:crypto';

function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function issueToken(identity, secret) {
  if (!secret) throw new Error('Cannot issue a token without AUTH_SECRET');
  return sign({ ...identity, iat: Date.now() }, secret);
}

function verify(token, secret) {
  const [body, mac] = String(token).split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function authenticate({ config }) {
  return (req, res, next) => {
    const bearer = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');

    if (config.authSecret) {
      if (!bearer) {
        return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Bearer token required' });
      }
      const identity = verify(bearer, config.authSecret);
      if (!identity) {
        return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Invalid token' });
      }
      req.identity = identity;
      return next();
    }

    const entityId = req.get('x-bank-entity');
    const actorId = req.get('x-bank-actor-id');
    const actorType = req.get('x-bank-actor-type');
    if (!entityId || !actorId || !['user', 'agent'].includes(actorType)) {
      return res.status(401).json({
        error: 'UNAUTHENTICATED',
        message:
          'Set AUTH_SECRET and send a bearer token, or (local only) send '
          + 'X-Bank-Entity, X-Bank-Actor-Type (user|agent) and X-Bank-Actor-Id.',
      });
    }
    req.identity = { entityId, actor: { type: actorType, id: actorId } };
    return next();
  };
}

/** An identity may only ever act for its own customer. */
export function requireEntityMatch(req, res, next) {
  const requested = req.params.entityId ?? req.body?.entityId ?? req.identity.entityId;
  if (requested !== req.identity.entityId) {
    return res.status(403).json({
      error: 'FORBIDDEN',
      message: 'That identity cannot act for another customer',
    });
  }
  req.entityId = requested;
  return next();
}
