// Mandates: delegated authority.
//
// This is the object a bank actually needs before it lets an agent do anything.
// A mandate records that a *principal* (a legal entity, through someone with
// authority to bind it) has granted a *grantee* (a person or an AI agent) the
// right to use named capabilities, on named accounts, up to named limits,
// within a named window, with named approval requirements.
//
// Nothing in this system grants itself authority. An agent with no mandate can
// read nothing and move nothing.

import {
  add, assertMoney, compare, formatWithCurrency, zero,
} from '../ledger/money.js';
import { newId } from '../util/ids.js';
import { zonedParts } from '../util/time.js';

export const AUTONOMY = Object.freeze({
  /** The agent may only draft. Every mutating action waits for a human. */
  PROPOSE_ONLY: 'propose_only',
  /** The agent may execute, but each action needs approval before it lands. */
  EXECUTE_WITH_APPROVAL: 'execute_with_approval',
  /** The agent may execute unattended inside its limits. */
  EXECUTE_WITHIN_LIMITS: 'execute_within_limits',
});

export const AUTONOMY_LEVELS = Object.values(AUTONOMY);

export class MandateError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'MandateError';
    this.code = code;
    this.details = details;
  }
}

/** `payments.*` matches `payments.domestic.initiate`; `*` matches everything. */
export function capabilityMatches(patterns, capabilityId) {
  return patterns.some((pattern) => {
    if (pattern === '*') return true;
    if (pattern === capabilityId) return true;
    if (pattern.endsWith('.*')) return capabilityId.startsWith(pattern.slice(0, -1));
    return false;
  });
}

export function accountMatches(patterns, accountIds) {
  if (patterns.includes('*')) return true;
  return accountIds.every((id) => patterns.includes(id));
}

/** Is `at` inside the mandate's permitted window? */
export function withinWindow(mandate, at) {
  const window = mandate.window ?? null;
  if (!window) return { ok: true };

  const iso = at.toISOString();
  if (window.notBefore && iso < window.notBefore) {
    return { ok: false, code: 'MANDATE_NOT_YET_EFFECTIVE', detail: { notBefore: window.notBefore } };
  }
  if (window.notAfter && iso > window.notAfter) {
    return { ok: false, code: 'MANDATE_EXPIRED', detail: { notAfter: window.notAfter } };
  }

  if (window.days?.length || window.hours) {
    const zone = window.timeZone ?? 'UTC';
    const parts = zonedParts(at, zone);
    if (window.days?.length && !window.days.includes(parts.weekday)) {
      return {
        ok: false,
        code: 'MANDATE_OUTSIDE_DAYS',
        detail: { allowed: window.days, actual: parts.weekday },
      };
    }
    if (window.hours) {
      const [fromH, fromM] = window.hours.from.split(':').map(Number);
      const [toH, toM] = window.hours.to.split(':').map(Number);
      const from = fromH * 60 + fromM;
      const to = toH * 60 + toM;
      if (parts.minutesOfDay < from || parts.minutesOfDay >= to) {
        return {
          ok: false,
          code: 'MANDATE_OUTSIDE_HOURS',
          detail: { allowed: window.hours, timeZone: zone, actual: `${parts.hour}:${String(parts.minute).padStart(2, '0')}` },
        };
      }
    }
  }
  return { ok: true };
}

export function createMandates({ store, clock, audit }) {
  function normaliseLimits(limits = {}) {
    const out = {};
    for (const bucket of ['perTransaction', 'daily', 'monthly']) {
      if (!limits[bucket]) continue;
      out[bucket] = {};
      for (const [currency, value] of Object.entries(limits[bucket])) {
        assertMoney(value);
        if (value.currency !== currency) {
          throw new MandateError(
            `Limit for ${currency} holds a ${value.currency} amount`,
            'MANDATE_LIMIT_CURRENCY',
          );
        }
        out[bucket][currency] = value;
      }
    }
    return out;
  }

  return {
    async create({
      entityId,
      grantee,
      grantedBy,
      autonomy,
      capabilities,
      accounts = ['*'],
      limits = {},
      counterparties = { mode: 'any', ids: [] },
      dualControl = null,
      window = null,
      label = null,
    }) {
      if (!AUTONOMY_LEVELS.includes(autonomy)) {
        throw new MandateError(`Unknown autonomy level: ${autonomy}`, 'MANDATE_BAD_AUTONOMY');
      }
      if (!Array.isArray(capabilities) || capabilities.length === 0) {
        throw new MandateError('A mandate must grant at least one capability', 'MANDATE_NO_CAPABILITIES');
      }
      if (!grantee?.type || !grantee?.id) {
        throw new MandateError('A mandate needs a grantee { type, id }', 'MANDATE_NO_GRANTEE');
      }
      if (!['agent', 'user'].includes(grantee.type)) {
        throw new MandateError(`Unknown grantee type: ${grantee.type}`, 'MANDATE_BAD_GRANTEE');
      }
      if (dualControl) {
        if (!Number.isInteger(dualControl.requiredApprovals) || dualControl.requiredApprovals < 1) {
          throw new MandateError('dualControl.requiredApprovals must be >= 1', 'MANDATE_BAD_DUAL_CONTROL');
        }
        if (!Array.isArray(dualControl.approvers) || dualControl.approvers.length < dualControl.requiredApprovals) {
          throw new MandateError(
            'dualControl needs at least as many approvers as required approvals',
            'MANDATE_BAD_DUAL_CONTROL',
          );
        }
      }

      const mandate = {
        id: newId('mandate'),
        entityId,
        label,
        grantee,
        grantedBy,
        autonomy,
        capabilities,
        accounts,
        limits: normaliseLimits(limits),
        counterparties,
        dualControl,
        window,
        status: 'active',
        createdAt: clock.now().toISOString(),
      };

      return store.withTransaction(async (tx) => {
        await tx.insert('mandates', mandate);
        await audit.append(tx, {
          type: 'mandate.granted',
          actor: { type: 'user', id: grantedBy },
          subject: { type: 'mandate', id: mandate.id },
          payload: {
            entityId,
            grantee,
            autonomy,
            capabilities,
            accounts,
            limits: mandate.limits,
            dualControl,
            window,
          },
        });
        return mandate;
      });
    },

    async revoke(mandateId, revokedBy, reason = null) {
      return store.withTransaction(async (tx) => {
        const mandate = await tx.get('mandates', mandateId);
        if (!mandate) throw new MandateError(`No mandate ${mandateId}`, 'MANDATE_NOT_FOUND');
        const updated = await tx.update('mandates', mandateId, {
          status: 'revoked',
          revokedAt: clock.now().toISOString(),
          revokedBy,
          revocationReason: reason,
        });
        await audit.append(tx, {
          type: 'mandate.revoked',
          actor: { type: 'user', id: revokedBy },
          subject: { type: 'mandate', id: mandateId },
          payload: { reason },
        });
        return updated;
      });
    },

    async get(mandateId) {
      return store.get('mandates', mandateId);
    },

    async list({ entityId = null, granteeId = null } = {}) {
      const match = {};
      if (entityId) match.entityId = entityId;
      const all = await store.find('mandates', match);
      return granteeId ? all.filter((m) => m.grantee.id === granteeId) : all;
    },

    /**
     * Find the mandate that lets `grantee` use `capabilityId` on `accountIds`.
     *
     * Returns `{ mandate, rejected }` — `rejected` carries every mandate that
     * was considered and why it did not apply, which is what the customer sees
     * when an agent says "I can't do that". A denial with no explanation is a
     * support ticket; a denial that names the limit is self-service.
     */
    async resolve({ entityId, grantee, capabilityId, accountIds = [], at = null }) {
      const when = at ?? clock.now();
      const candidates = (await store.find('mandates', { entityId })).filter(
        (m) => m.grantee.type === grantee.type && m.grantee.id === grantee.id,
      );

      const rejected = [];
      const eligible = [];

      for (const mandate of candidates) {
        if (mandate.status !== 'active') {
          rejected.push({ mandateId: mandate.id, code: 'MANDATE_INACTIVE', detail: { status: mandate.status } });
          continue;
        }
        if (!capabilityMatches(mandate.capabilities, capabilityId)) {
          rejected.push({
            mandateId: mandate.id,
            code: 'MANDATE_CAPABILITY_NOT_GRANTED',
            detail: { granted: mandate.capabilities, requested: capabilityId },
          });
          continue;
        }
        if (accountIds.length && !accountMatches(mandate.accounts, accountIds)) {
          rejected.push({
            mandateId: mandate.id,
            code: 'MANDATE_ACCOUNT_NOT_GRANTED',
            detail: { granted: mandate.accounts, requested: accountIds },
          });
          continue;
        }
        const windowCheck = withinWindow(mandate, when);
        if (!windowCheck.ok) {
          rejected.push({ mandateId: mandate.id, code: windowCheck.code, detail: windowCheck.detail });
          continue;
        }
        eligible.push(mandate);
      }

      // Prefer the most restrictive autonomy that still permits the action, so
      // adding a broad mandate never silently widens an agent's freedom on an
      // action a narrow mandate already covered.
      const rank = {
        [AUTONOMY.PROPOSE_ONLY]: 0,
        [AUTONOMY.EXECUTE_WITH_APPROVAL]: 1,
        [AUTONOMY.EXECUTE_WITHIN_LIMITS]: 2,
      };
      eligible.sort((a, b) => rank[a.autonomy] - rank[b.autonomy]);

      return { mandate: eligible[0] ?? null, eligible, rejected };
    },

    /**
     * How much authority this mandate has already consumed.
     *
     * Measured from executed proposals rather than from ledger postings: the
     * limit is on *what the agent instructed*, which is the thing a customer
     * reasons about. A payment that was instructed and later returned still
     * consumed the day's authority.
     */
    async usage(mandateId, { at = null } = {}) {
      const when = at ?? clock.now();
      const proposals = (await store.find('proposals', { mandateId })).filter(
        (p) => p.status === 'executed' && p.amount,
      );

      const dayStart = new Date(when);
      dayStart.setUTCHours(0, 0, 0, 0);
      const monthStart = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), 1));

      const daily = {};
      const monthly = {};
      for (const proposal of proposals) {
        const executedAt = new Date(proposal.executedAt ?? proposal.createdAt);
        const { currency } = proposal.amount;
        if (executedAt >= monthStart) {
          monthly[currency] = add(monthly[currency] ?? zero(currency), proposal.amount);
        }
        if (executedAt >= dayStart) {
          daily[currency] = add(daily[currency] ?? zero(currency), proposal.amount);
        }
      }
      return { mandateId, daily, monthly };
    },
  };
}

/** Does `amount` fit inside `limit`, treating a missing limit as "no limit"? */
export function withinLimit(amount, limit) {
  if (!limit) return { ok: true };
  if (limit.currency !== amount.currency) {
    return {
      ok: false,
      code: 'LIMIT_CURRENCY_NOT_AUTHORISED',
      detail: { limitCurrency: limit.currency, amountCurrency: amount.currency },
    };
  }
  if (compare(amount, limit) > 0) {
    return {
      ok: false,
      code: 'LIMIT_EXCEEDED',
      detail: { limit, amount, limitFormatted: formatWithCurrency(limit) },
    };
  }
  return { ok: true };
}
