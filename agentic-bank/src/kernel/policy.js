// The policy engine.
//
// This is the whole point of the architecture: a deterministic, side-effect-free
// function that decides whether a proposed action is permitted. The language
// model proposes; this decides. It takes a fully-materialised context and
// returns a decision — no database, no clock of its own, no network. That makes
// every control in the bank a unit test rather than an integration test, and it
// makes a decision reproducible years later from the audit record alone.
//
// The three outcomes are ALLOW, REQUIRE_APPROVAL and DENY. There is no fourth
// outcome, and there is no path from the agent layer to the ledger that skips
// this function.

import { add, compare, formatWithCurrency, zero } from '../ledger/money.js';
import { AUTONOMY, capabilityMatches, withinLimit } from './mandates.js';
import { SCREENING_STATUS } from './screening.js';
import { resolveValueDate, zonedParts } from '../util/time.js';

export const POLICY_VERSION = '2026-11-01';

export const OUTCOME = Object.freeze({
  ALLOW: 'allow',
  REQUIRE_APPROVAL: 'require_approval',
  DENY: 'deny',
});

const SEVERITY = Object.freeze({
  INFO: 'info',
  APPROVAL: 'approval',
  BLOCK: 'block',
});

/**
 * @param {object} proposal  What the agent wants to do.
 * @param {object} context   Everything needed to decide, already loaded.
 * @returns {object} decision
 */
export function evaluate(proposal, context) {
  const reasons = [];
  const deny = (code, message, detail) =>
    reasons.push({ code, severity: SEVERITY.BLOCK, message, detail });
  const approval = (code, message, detail) =>
    reasons.push({ code, severity: SEVERITY.APPROVAL, message, detail });
  const info = (code, message, detail) =>
    reasons.push({ code, severity: SEVERITY.INFO, message, detail });

  const { capability, entity, mandate, accounts = [], counterparty, screening, usage } = context;
  const now = context.now ?? new Date();
  let requiredApprovals = 0;
  let approvers = [];

  // --- Capability -----------------------------------------------------------
  if (!capability) {
    deny('CAPABILITY_UNKNOWN', `No such capability: ${proposal.capabilityId}`, {
      capabilityId: proposal.capabilityId,
    });
    return finalise({ reasons, requiredApprovals, approvers, now, context, proposal });
  }
  if (capability.enabled === false) {
    deny('CAPABILITY_DISABLED', `${capability.id} is currently disabled`, { capabilityId: capability.id });
  }
  if (capability.segments && entity && !capability.segments.includes(entity.segment)) {
    deny(
      'CAPABILITY_NOT_AVAILABLE_FOR_SEGMENT',
      `${capability.id} is not offered to ${entity.segment} customers`,
      { segments: capability.segments, segment: entity.segment },
    );
  }

  // --- Principal ------------------------------------------------------------
  if (!entity) {
    deny('ENTITY_UNKNOWN', 'The proposal names no known customer', { entityId: proposal.entityId });
  } else {
    if (entity.status !== 'active') {
      deny('ENTITY_NOT_ACTIVE', `Customer ${entity.id} is ${entity.status}`, { status: entity.status });
    }
    if (capability.requiresKyc !== false && entity.kycStatus !== 'verified') {
      deny('KYC_INCOMPLETE', `Customer identification is ${entity.kycStatus}`, {
        kycStatus: entity.kycStatus,
      });
    }
  }

  // --- Authority ------------------------------------------------------------
  if (!mandate) {
    deny(
      'NO_MANDATE',
      `${describeActor(proposal.initiator)} holds no mandate covering ${proposal.capabilityId}`,
      { considered: context.mandateRejections ?? [] },
    );
  } else {
    if (!capabilityMatches(mandate.capabilities, capability.id)) {
      // Defensive: resolve() should already have filtered this out.
      deny('MANDATE_CAPABILITY_NOT_GRANTED', `Mandate ${mandate.id} does not grant ${capability.id}`, {
        granted: mandate.capabilities,
      });
    }
    if (capability.mutating && mandate.autonomy === AUTONOMY.PROPOSE_ONLY) {
      approval('AUTONOMY_PROPOSE_ONLY', 'This mandate allows drafting only; a human must approve', {
        autonomy: mandate.autonomy,
      });
      requiredApprovals = Math.max(requiredApprovals, 1);
    }
    if (capability.mutating && mandate.autonomy === AUTONOMY.EXECUTE_WITH_APPROVAL) {
      approval('AUTONOMY_REQUIRES_APPROVAL', 'This mandate requires approval for every instruction', {
        autonomy: mandate.autonomy,
      });
      requiredApprovals = Math.max(requiredApprovals, 1);
    }
  }

  // --- Accounts -------------------------------------------------------------
  for (const accountId of proposal.accountIds ?? []) {
    const account = accounts.find((a) => a.id === accountId);
    if (!account) {
      deny('ACCOUNT_UNKNOWN', `No account ${accountId}`, { accountId });
      continue;
    }
    if (entity && account.entityId !== entity.id) {
      deny('ACCOUNT_NOT_OWNED', `Account ${accountId} does not belong to ${entity.id}`, { accountId });
    }
    if (account.status === 'closed') {
      deny('ACCOUNT_CLOSED', `Account ${accountId} is closed`, { accountId });
    } else if (account.status === 'frozen' && capability.mutating) {
      deny('ACCOUNT_FROZEN', `Account ${accountId} is frozen`, { accountId });
    }
  }

  // --- Amount against delegated limits -------------------------------------
  const amount = proposal.amount ?? null;
  if (amount && mandate) {
    const perTransaction = mandate.limits?.perTransaction?.[amount.currency];
    const hasPerTransactionBucket = Boolean(mandate.limits?.perTransaction);
    if (hasPerTransactionBucket && !perTransaction) {
      deny(
        'CURRENCY_NOT_AUTHORISED',
        `Mandate ${mandate.id} authorises no ${amount.currency} limit`,
        { currency: amount.currency, authorised: Object.keys(mandate.limits.perTransaction) },
      );
    }
    const perTxCheck = withinLimit(amount, perTransaction);
    if (!perTxCheck.ok) {
      deny(
        perTxCheck.code === 'LIMIT_EXCEEDED' ? 'PER_TRANSACTION_LIMIT_EXCEEDED' : perTxCheck.code,
        `${formatWithCurrency(amount)} exceeds the per-instruction limit of ${formatWithCurrency(perTransaction)}`,
        perTxCheck.detail,
      );
    }

    for (const [bucket, code] of [['daily', 'DAILY_LIMIT_EXCEEDED'], ['monthly', 'MONTHLY_LIMIT_EXCEEDED']]) {
      const limit = mandate.limits?.[bucket]?.[amount.currency];
      if (!limit) continue;
      const spent = usage?.[bucket]?.[amount.currency] ?? zero(amount.currency);
      const projected = add(spent, amount);
      if (compare(projected, limit) > 0) {
        deny(
          code,
          `${formatWithCurrency(amount)} would take ${bucket} usage to ${formatWithCurrency(projected)}, past the ${formatWithCurrency(limit)} ${bucket} limit`,
          { bucket, limit, spent, projected },
        );
      }
    }
  }

  // --- Counterparty and screening ------------------------------------------
  if (capability.requiresCounterparty) {
    if (!counterparty) {
      deny('COUNTERPARTY_REQUIRED', `${capability.id} needs a known counterparty`, {});
    } else {
      if (mandate?.counterparties?.mode === 'allowlist') {
        const allowed = mandate.counterparties.ids ?? [];
        if (!allowed.includes(counterparty.id)) {
          deny(
            'COUNTERPARTY_NOT_ALLOWLISTED',
            `${counterparty.name} is not on this mandate's payee allowlist`,
            { counterpartyId: counterparty.id, allowed },
          );
        }
      }

      const status = screening?.status ?? SCREENING_STATUS.UNAVAILABLE;
      if (status === SCREENING_STATUS.BLOCKED) {
        deny('SCREENING_BLOCKED', `${counterparty.name} is blocked by screening`, {
          matches: screening?.matches ?? [],
        });
      } else if (status === SCREENING_STATUS.UNAVAILABLE) {
        deny(
          'SCREENING_UNAVAILABLE',
          'Screening could not be completed, so the payment cannot proceed',
          { provider: screening?.provider, error: screening?.error },
        );
      } else if (status === SCREENING_STATUS.REVIEW) {
        approval('SCREENING_REVIEW', `${counterparty.name} needs a human screening decision`, {
          matches: screening?.matches ?? [],
        });
        requiredApprovals = Math.max(requiredApprovals, 1);
      }
      if (context.screeningStale) {
        approval('SCREENING_STALE', `Screening for ${counterparty.name} is out of date`, {
          screenedAt: screening?.screenedAt,
        });
        requiredApprovals = Math.max(requiredApprovals, 1);
      }

      if (counterparty.coolingOff) {
        approval(
          'COUNTERPARTY_IN_COOLING_OFF',
          `${counterparty.name} was added recently and is still in its cooling-off period`,
          { addedAt: counterparty.addedAt },
        );
        requiredApprovals = Math.max(requiredApprovals, 1);
      }
    }
  }

  // --- Funds ---------------------------------------------------------------
  if (amount && capability.debitsFunds && proposal.sourceAccountId) {
    const source = accounts.find((a) => a.id === proposal.sourceAccountId);
    if (source?.available) {
      if (source.available.currency !== amount.currency) {
        deny(
          'SOURCE_CURRENCY_MISMATCH',
          `Account ${source.id} is ${source.available.currency}; the instruction is ${amount.currency}`,
          { accountCurrency: source.available.currency, amountCurrency: amount.currency },
        );
      } else if (compare(source.available, amount) < 0) {
        deny(
          'INSUFFICIENT_FUNDS',
          `${formatWithCurrency(amount)} exceeds the ${formatWithCurrency(source.available)} available on ${source.id}`,
          { available: source.available, requested: amount },
        );
      }
    }
  }

  // --- Duplicate detection -------------------------------------------------
  if ((context.recentSimilar ?? []).length > 0) {
    approval(
      'POSSIBLE_DUPLICATE',
      `A matching instruction was already made ${context.recentSimilar.length} time(s) recently`,
      { matches: context.recentSimilar },
    );
    requiredApprovals = Math.max(requiredApprovals, 1);
  }

  // --- Dual control --------------------------------------------------------
  if (mandate?.dualControl && capability.mutating) {
    const thresholds = mandate.dualControl.thresholdAbove ?? null;
    const threshold = thresholds?.[amount?.currency ?? ''] ?? null;
    // No threshold table at all means "always two signatures". A threshold
    // table with no amount to compare against (a rate request, a card freeze,
    // a standing-rule change) is not an instruction the threshold describes, so
    // it does not trigger here — the mandate's autonomy level still governs it.
    // Without this, a mandate with a payment threshold would need two
    // signatures to ask for an FX rate, which no treasury would use.
    const triggered = thresholds === null
      ? true
      : Boolean(amount && threshold && compare(amount, threshold) >= 0);
    if (triggered) {
      approval(
        'DUAL_CONTROL_REQUIRED',
        threshold
          ? `Instructions of ${formatWithCurrency(threshold)} or more need ${mandate.dualControl.requiredApprovals} approval(s)`
          : `This mandate requires ${mandate.dualControl.requiredApprovals} approval(s)`,
        { threshold, requiredApprovals: mandate.dualControl.requiredApprovals },
      );
      requiredApprovals = Math.max(requiredApprovals, mandate.dualControl.requiredApprovals);
      approvers = mandate.dualControl.approvers ?? [];
    }
  }

  // --- Residual risk -------------------------------------------------------
  //
  // A high-risk capability may run unattended only where the customer has
  // explicitly said so *and* bounded it: autonomy `execute_within_limits` plus
  // a per-instruction limit in the instruction's own currency. The limit is
  // what makes unattended execution a decision the customer made rather than a
  // default they inherited — so a mandate with no ceiling in that currency
  // falls back to a human, instead of quietly allowing an unbounded payment.
  if (capability.riskClass === 'high' && capability.mutating && requiredApprovals === 0) {
    const bounded = Boolean(
      mandate
      && mandate.autonomy === AUTONOMY.EXECUTE_WITHIN_LIMITS
      && amount
      && mandate.limits?.perTransaction?.[amount.currency],
    );
    if (!bounded) {
      approval(
        'HIGH_RISK_UNBOUNDED',
        `${capability.id} is high risk and this mandate does not authorise it unattended`
        + `${amount ? ` with a ${amount.currency} per-instruction limit` : ''}`,
        {
          riskClass: capability.riskClass,
          autonomy: mandate?.autonomy ?? null,
          currency: amount?.currency ?? null,
        },
      );
      requiredApprovals = 1;
    }
  }

  // --- Cut-off -------------------------------------------------------------
  if (capability.rail) {
    const timeZone = context.bankTimeZone ?? 'UTC';
    const valueDate = resolveValueDate(now, {
      timeZone,
      cutOff: capability.rail.cutOff,
      holidays: context.holidays ?? [],
      lagDays: capability.rail.lagDays ?? 0,
    });
    // "Today" means today in the bank's timezone, not in UTC. Comparing against
    // the UTC date would tell a Sydney customer at 10am that their same-day
    // payment had rolled, because UTC is still on yesterday.
    const today = zonedParts(now, timeZone).date;
    if (valueDate !== today) {
      info('VALUE_DATE_ROLLED', `Value date is ${valueDate}, not today`, {
        valueDate,
        cutOff: capability.rail.cutOff,
        timeZone: context.bankTimeZone,
      });
    }
    return finalise({ reasons, requiredApprovals, approvers, now, context, proposal, valueDate });
  }

  return finalise({ reasons, requiredApprovals, approvers, now, context, proposal });
}

function describeActor(actor) {
  if (!actor) return 'The caller';
  return `${actor.type === 'agent' ? 'Agent' : 'User'} ${actor.id}`;
}

function finalise({ reasons, requiredApprovals, approvers, now, context, proposal, valueDate = null }) {
  const blocked = reasons.filter((r) => r.severity === SEVERITY.BLOCK);
  const outcome = blocked.length
    ? OUTCOME.DENY
    : requiredApprovals > 0
      ? OUTCOME.REQUIRE_APPROVAL
      : OUTCOME.ALLOW;

  return {
    outcome,
    reasons,
    requirements:
      outcome === OUTCOME.REQUIRE_APPROVAL
        ? {
          approvals: requiredApprovals,
          approvers,
          // The person who told the agent to do it cannot be the person who
          // approves it. Without this, "two approvals" is one person twice.
          segregationOfDuties: true,
          initiator: proposal.initiator,
        }
        : null,
    valueDate,
    policyVersion: POLICY_VERSION,
    evaluatedAt: now.toISOString(),
    // Everything the decision was made from, so it can be replayed exactly.
    contextDigest: {
      capabilityId: context.capability?.id ?? null,
      mandateId: context.mandate?.id ?? null,
      entityId: context.entity?.id ?? null,
      counterpartyId: context.counterparty?.id ?? null,
      screeningStatus: context.screening?.status ?? null,
    },
  };
}

/** One-line summary for an agent to repeat back to a customer. */
export function explain(decision) {
  if (decision.outcome === OUTCOME.ALLOW) {
    const rolled = decision.reasons.find((r) => r.code === 'VALUE_DATE_ROLLED');
    return rolled ? `Permitted. ${rolled.message}.` : 'Permitted.';
  }
  if (decision.outcome === OUTCOME.REQUIRE_APPROVAL) {
    const why = decision.reasons
      .filter((r) => r.severity === SEVERITY.APPROVAL)
      .map((r) => r.message)
      .join('; ');
    return `Needs ${decision.requirements.approvals} approval(s): ${why}.`;
  }
  const why = decision.reasons
    .filter((r) => r.severity === SEVERITY.BLOCK)
    .map((r) => r.message)
    .join('; ');
  return `Not permitted: ${why}.`;
}
