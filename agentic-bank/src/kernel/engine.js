// The kernel.
//
// Every instruction in this bank — whether it came from the mobile app, a
// direct API call, the bank's own agent, or a customer's agent — travels this
// one path:
//
//   validate args -> plan -> resolve mandate -> build context -> EVALUATE
//     -> allow:            execute, audit
//     -> require_approval: park as a proposal, open an approval, audit
//     -> deny:             record the refusal with its reasons, audit
//
// There is no second path. That is the property the whole design rests on: an
// agent cannot be prompt-injected into skipping a control it has no way to
// reach. The model chooses *which* capability to propose and with what
// arguments; it has no vote on whether the proposal is permitted.

import { createHash } from 'node:crypto';
import { canonicalJson } from '../util/canonical.js';
import { newId } from '../util/ids.js';
import { compare } from '../ledger/money.js';
import { evaluate, explain, OUTCOME } from './policy.js';
import { CapabilityError } from '../capabilities/registry.js';

export class KernelError extends Error {
  constructor(message, code, details = {}, status = 400) {
    super(message);
    this.name = 'KernelError';
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export function createKernel({
  store, clock, ledger, registry, mandates, approvals, audit, screening, fx, config = {},
}) {
  const duplicateWindowMinutes = config.duplicateWindowMinutes ?? 60;
  const screeningMaxAgeHours = config.screeningMaxAgeHours ?? 24 * 30;
  const counterpartyCoolingOffMinutes = config.counterpartyCoolingOffMinutes ?? 60;

  function requestHash(payload) {
    return createHash('sha256').update(canonicalJson(payload)).digest('hex');
  }

  async function loadEntity(entityId) {
    const entity = await store.get('entities', entityId);
    if (!entity) throw new KernelError(`No customer ${entityId}`, 'ENTITY_NOT_FOUND', { entityId }, 404);
    return entity;
  }

  /** Accounts referenced by a plan, with live balances attached. */
  async function loadAccounts(accountIds) {
    const out = [];
    for (const id of new Set(accountIds)) {
      const account = await store.get('accounts', id);
      if (!account) continue;
      const balance = await ledger.getBalance(id);
      out.push({ ...account, available: balance.available, cleared: balance.cleared });
    }
    return out;
  }

  /** Current screening for a counterparty, refreshed if missing or stale. */
  async function resolveScreening(counterparty) {
    if (!counterparty) return { screening: null, stale: false };
    const existing = counterparty.screening ?? null;
    const stale = screening.isStale(existing, screeningMaxAgeHours);
    if (existing && !stale) return { screening: existing, stale: false };

    const fresh = await screening.screen({
      name: counterparty.name,
      country: counterparty.country ?? null,
      bic: counterparty.bic ?? null,
    });
    await store.withTransaction((tx) => tx.update('counterparties', counterparty.id, { screening: fresh }));
    return { screening: fresh, stale: false };
  }

  /** Instructions that look like this one and already went through recently. */
  async function findRecentSimilar(proposal) {
    if (!proposal.amount) return [];
    const since = new Date(clock.now().getTime() - duplicateWindowMinutes * 60 * 1000).toISOString();
    const prior = await store.find('proposals', {
      entityId: proposal.entityId,
      capabilityId: proposal.capabilityId,
      status: 'executed',
    });
    return prior
      .filter((p) => {
        if ((p.executedAt ?? p.createdAt) < since) return false;
        if (p.counterpartyId !== proposal.counterpartyId) return false;
        if (!p.amount || p.amount.currency !== proposal.amount.currency) return false;
        return compare(p.amount, proposal.amount) === 0;
      })
      .map((p) => ({ proposalId: p.id, at: p.executedAt ?? p.createdAt }));
  }

  async function buildContext({ capability, entity, plan, initiator, mandateResolution }) {
    const accounts = await loadAccounts(plan.accountIds ?? []);
    const counterparty = plan.counterpartyId
      ? await store.get('counterparties', plan.counterpartyId)
      : null;

    if (plan.counterpartyId && !counterparty) {
      throw new KernelError(
        `No counterparty ${plan.counterpartyId}`,
        'COUNTERPARTY_NOT_FOUND',
        { counterpartyId: plan.counterpartyId },
        404,
      );
    }

    const { screening: screeningResult, stale } = await resolveScreening(counterparty);
    const usage = mandateResolution.mandate
      ? await mandates.usage(mandateResolution.mandate.id, { at: clock.now() })
      : { daily: {}, monthly: {} };

    const coolingOff = counterparty?.addedAt
      ? clock.now().getTime() - new Date(counterparty.addedAt).getTime()
        < counterpartyCoolingOffMinutes * 60 * 1000
      : false;

    return {
      now: clock.now(),
      capability,
      entity,
      initiator,
      mandate: mandateResolution.mandate,
      mandateRejections: mandateResolution.rejected,
      accounts,
      counterparty: counterparty ? { ...counterparty, coolingOff } : null,
      screening: screeningResult,
      screeningStale: stale,
      usage,
      bankTimeZone: config.bankTimeZone ?? 'UTC',
      holidays: config.holidays ?? [],
    };
  }

  function capabilityContext(extra = {}) {
    return { ledger, store, clock, registry, fx, screening, mandates, config, ...extra };
  }

  /**
   * Submit an instruction.
   *
   * `dryRun` runs everything up to and including the policy decision, then
   * stops. The agent uses it to tell a customer what would happen — including
   * what approval it would need — without creating anything.
   */
  async function submit({
    entityId,
    capabilityId,
    args = {},
    initiator,
    idempotencyKey = null,
    dryRun = false,
    ttlHours,
  }) {
    if (!initiator?.type || !initiator?.id) {
      throw new KernelError('An instruction needs an initiator { type, id }', 'NO_INITIATOR');
    }

    const capability = registry.get(capabilityId);
    if (!capability) {
      throw new KernelError(`No capability ${capabilityId}`, 'CAPABILITY_UNKNOWN', { capabilityId }, 404);
    }

    // Idempotency. Mutating instructions must carry a key: a retried payment
    // that becomes a second payment is the worst bug this system could have.
    let scopedKey = null;
    if (capability.mutating && !dryRun) {
      if (!idempotencyKey) {
        throw new KernelError(
          `${capabilityId} is mutating and requires an Idempotency-Key`,
          'IDEMPOTENCY_KEY_REQUIRED',
          {},
          400,
        );
      }
      scopedKey = `${entityId}:${capabilityId}:${idempotencyKey}`;
      const hash = requestHash({ entityId, capabilityId, args, initiator });
      const prior = await store.get('idempotency', scopedKey);
      if (prior) {
        if (prior.requestHash !== hash) {
          throw new KernelError(
            'This Idempotency-Key was already used with different arguments',
            'IDEMPOTENCY_CONFLICT',
            { idempotencyKey },
            409,
          );
        }
        return { ...prior.response, replayed: true };
      }
    }

    const entity = await loadEntity(entityId);
    const validatedArgs = registry.validateArgs(capability, args);

    // `plan` works out what the instruction would touch. It reads, never writes.
    let plan;
    try {
      plan = await capability.plan(validatedArgs, capabilityContext({ entity, initiator }));
    } catch (err) {
      if (err instanceof CapabilityError || err instanceof KernelError) throw err;
      // Keep the capability's own error code when it set one. `FILE_CURRENCY_MISMATCH`
      // tells a caller — or an agent — what to do differently; a generic
      // `CAPABILITY_PLAN_FAILED` tells them only that something went wrong.
      throw new KernelError(
        `Could not plan ${capabilityId}: ${err.message}`,
        err.code ?? 'CAPABILITY_PLAN_FAILED',
        { cause: err.message, details: err.details ?? null },
      );
    }

    const mandateResolution = await mandates.resolve({
      entityId,
      grantee: initiator,
      capabilityId,
      accountIds: plan.accountIds ?? [],
      at: clock.now(),
    });

    const proposalDraft = {
      id: newId('proposal'),
      entityId,
      capabilityId,
      args: validatedArgs,
      initiator,
      mandateId: mandateResolution.mandate?.id ?? null,
      summary: plan.summary,
      amount: plan.amount ?? null,
      accountIds: plan.accountIds ?? [],
      sourceAccountId: plan.sourceAccountId ?? null,
      counterpartyId: plan.counterpartyId ?? null,
      details: plan.details ?? {},
      riskClass: capability.riskClass,
      createdAt: clock.now().toISOString(),
      status: 'draft',
    };

    const context = await buildContext({
      capability, entity, plan, initiator, mandateResolution,
    });
    context.recentSimilar = await findRecentSimilar(proposalDraft);

    const decision = evaluate(proposalDraft, context);
    const explanation = explain(decision);

    if (dryRun) {
      return {
        status: 'dry_run',
        proposal: { ...proposalDraft, status: 'draft' },
        decision,
        explanation,
        approval: null,
        result: null,
      };
    }

    // One transaction covers the proposal, the decision record, the postings
    // (the ledger joins this transaction) and the audit entries.
    const outcome = await store.withTransaction(async (tx) => {
      const proposal = await tx.insert('proposals', {
        ...proposalDraft,
        status:
          decision.outcome === OUTCOME.ALLOW
            ? 'approved'
            : decision.outcome === OUTCOME.REQUIRE_APPROVAL
              ? 'pending_approval'
              : 'denied',
        decision,
      });

      await audit.append(tx, {
        type: 'proposal.evaluated',
        actor: initiator,
        subject: { type: 'proposal', id: proposal.id },
        outcome: decision.outcome,
        payload: {
          entityId,
          capabilityId,
          args: validatedArgs,
          summary: plan.summary,
          amount: plan.amount ?? null,
          mandateId: proposal.mandateId,
          reasons: decision.reasons.map((r) => ({ code: r.code, severity: r.severity })),
          policyVersion: decision.policyVersion,
          contextDigest: decision.contextDigest,
        },
      });

      if (decision.outcome === OUTCOME.DENY) {
        return { status: 'denied', proposal, decision, approval: null, result: null, explanation };
      }

      if (decision.outcome === OUTCOME.REQUIRE_APPROVAL) {
        const approval = await approvals.open(tx, { proposal, decision, ttlHours });
        return {
          status: 'pending_approval',
          proposal,
          decision,
          approval,
          result: null,
          explanation,
        };
      }

      const result = await runExecution(tx, { capability, proposal, decision, entity, initiator });
      return { status: 'executed', proposal: result.proposal, decision, approval: null, result: result.result, explanation };
    });

    if (scopedKey) {
      await store.withTransaction((tx) =>
        tx.put('idempotency', {
          id: scopedKey,
          requestHash: requestHash({ entityId, capabilityId, args, initiator }),
          response: outcome,
          createdAt: clock.now().toISOString(),
        }));
    }

    return outcome;
  }

  /** Run a capability's execute() and record what happened. */
  async function runExecution(tx, { capability, proposal, decision, entity, initiator }) {
    if (!capability.mutating) {
      const value = capability.execute
        ? await capability.execute(proposal, capabilityContext({ entity, initiator, proposal, decision }))
        : null;
      const updated = await tx.update('proposals', proposal.id, {
        status: 'executed',
        executedAt: clock.now().toISOString(),
        result: value,
      });
      return { proposal: updated, result: value };
    }

    let result;
    try {
      result = await capability.execute(
        proposal,
        capabilityContext({ entity, initiator, proposal, decision, idempotencyKey: proposal.id }),
      );
    } catch (err) {
      // The enclosing transaction will roll back; record the failure outside it
      // is not possible, so re-throw with context and let the caller audit.
      throw new KernelError(
        `Execution of ${capability.id} failed: ${err.message}`,
        err.code ?? 'EXECUTION_FAILED',
        { proposalId: proposal.id, cause: err.message, details: err.details ?? null },
        err.status ?? 422,
      );
    }

    const updated = await tx.update('proposals', proposal.id, {
      status: 'executed',
      executedAt: clock.now().toISOString(),
      result,
    });

    await audit.append(tx, {
      type: 'proposal.executed',
      actor: initiator,
      subject: { type: 'proposal', id: proposal.id },
      outcome: 'executed',
      payload: {
        capabilityId: capability.id,
        amount: proposal.amount,
        result,
        mandateId: proposal.mandateId,
      },
    });

    return { proposal: updated, result };
  }

  return {
    submit,

    /** Re-run the policy decision and execute, once approvals are complete. */
    async executeApproved({ proposalId, actor }) {
      // A re-check denial is a recorded outcome *and* a failed call. Throwing
      // from inside the transaction would roll back the denial, so the
      // transaction returns the outcome and the throw happens after it commits.
      const settled = await store.withTransaction(async (tx) => {
        const proposal = await tx.get('proposals', proposalId);
        if (!proposal) {
          throw new KernelError(`No proposal ${proposalId}`, 'PROPOSAL_NOT_FOUND', {}, 404);
        }
        if (proposal.status === 'executed') {
          return {
            kind: 'executed',
            value: { status: 'executed', proposal, result: proposal.result, replayed: true },
          };
        }
        if (proposal.status !== 'pending_approval') {
          throw new KernelError(
            `Proposal ${proposalId} is ${proposal.status}`,
            'PROPOSAL_NOT_PENDING',
            { status: proposal.status },
            409,
          );
        }

        const approval = await tx.findOne('approvals', { proposalId });
        if (!approval || approval.status !== 'approved') {
          throw new KernelError(
            `Proposal ${proposalId} is not fully approved`,
            'APPROVAL_INCOMPLETE',
            { approvalStatus: approval?.status ?? null },
            409,
          );
        }

        const capability = registry.get(proposal.capabilityId);
        const entity = await tx.get('entities', proposal.entityId);

        // Re-evaluate. Time has passed since the proposal was raised: a limit
        // may have been consumed, an account frozen, a mandate revoked, a
        // counterparty newly blocked. Approving a stale decision is how a
        // control gets bypassed by waiting.
        const plan = {
          accountIds: proposal.accountIds,
          counterpartyId: proposal.counterpartyId,
          amount: proposal.amount,
          summary: proposal.summary,
        };
        const mandateResolution = await mandates.resolve({
          entityId: proposal.entityId,
          grantee: proposal.initiator,
          capabilityId: proposal.capabilityId,
          accountIds: proposal.accountIds,
          at: clock.now(),
        });
        const context = await buildContext({
          capability, entity, plan, initiator: proposal.initiator, mandateResolution,
        });
        // The approvals just granted satisfy the approval requirement, so the
        // re-check only looks for new *blocking* reasons.
        const recheck = evaluate(proposal, context);
        const blocked = recheck.reasons.filter((r) => r.severity === 'block');
        if (blocked.length) {
          await tx.update('proposals', proposalId, {
            status: 'denied',
            decision: recheck,
            deniedAt: clock.now().toISOString(),
          });
          await audit.append(tx, {
            type: 'proposal.denied_on_recheck',
            actor,
            subject: { type: 'proposal', id: proposalId },
            outcome: 'deny',
            payload: { reasons: blocked.map((r) => ({ code: r.code, message: r.message })) },
          });
          return { kind: 'recheck_denied', reasons: blocked };
        }

        const executed = await runExecution(tx, {
          capability,
          proposal,
          decision: recheck,
          entity,
          initiator: proposal.initiator,
        });
        await audit.append(tx, {
          type: 'proposal.released_by_approval',
          actor,
          subject: { type: 'proposal', id: proposalId },
          outcome: 'executed',
          payload: { approvalId: approval.id, approvals: approval.decisions.length },
        });
        return {
          kind: 'executed',
          value: { status: 'executed', proposal: executed.proposal, result: executed.result },
        };
      });

      if (settled.kind === 'recheck_denied') {
        throw new KernelError(
          `Conditions changed since approval: ${settled.reasons.map((r) => r.message).join('; ')}`,
          'RECHECK_DENIED',
          { reasons: settled.reasons },
          409,
        );
      }
      return settled.value;
    },

    async getProposal(proposalId) {
      return store.get('proposals', proposalId);
    },

    async listProposals({ entityId = null, status = null } = {}) {
      const match = {};
      if (entityId) match.entityId = entityId;
      if (status) match.status = status;
      return store.find('proposals', match);
    },

    /** Read-only preview used by the agent before it commits to anything. */
    async preview(input) {
      return submit({ ...input, dryRun: true });
    },
  };
}
