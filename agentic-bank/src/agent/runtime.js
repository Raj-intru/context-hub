// The agent runtime.
//
// A bounded tool-calling loop. The only thing that makes it a *banking* agent
// runtime rather than a generic one is what happens to a tool call: it becomes
// a kernel submission, and the kernel's decision — not the model's intention —
// is what goes back into the conversation.
//
// Three properties are worth stating because they are the ones a reviewer will
// look for:
//
//   1. The tool set is derived from the agent's mandates, not from the segment
//      catalogue. An agent is not offered a capability it has no authority to
//      use, so a prompt injection has nothing to reach for.
//   2. Every mutating tool call gets a deterministic idempotency key derived
//      from the turn and the tool_use id. A retried loop cannot double-pay.
//   3. The loop is bounded and audited. A turn that runs out of steps says so.

import { newId } from '../util/ids.js';
import { formatWithCurrency } from '../ledger/money.js';
import { buildSystemPrompt } from './packs.js';
import { toolName } from '../capabilities/registry.js';

export class AgentError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.details = details;
  }
}

export function createAgentRuntime({
  llm, registry, kernel, ledger, mandates, store, clock, audit, config = {},
}) {
  const maxSteps = config.agentMaxSteps ?? 8;
  const bankTimeZone = config.bankTimeZone ?? 'UTC';

  /** Capabilities this actor actually holds authority over, in this segment. */
  async function scopeTools({ entityId, actor, segment }) {
    const held = await mandates.list({ entityId, granteeId: actor.id });
    const active = held.filter((m) => m.status === 'active');
    const segmentCapabilities = registry.list({ segment });

    const allowed = segmentCapabilities.filter((capability) =>
      active.some((m) => m.capabilities.some((pattern) =>
        pattern === '*'
        || pattern === capability.id
        || (pattern.endsWith('.*') && capability.id.startsWith(pattern.slice(0, -1))))));

    return {
      mandates: active,
      capabilityIds: allowed.map((c) => c.id),
      tools: registry.toolDefinitions({ segment, capabilityIds: allowed.map((c) => c.id) }),
    };
  }

  /** What the model is told about an outcome. Never more than the truth. */
  function renderToolResult(outcome) {
    const base = {
      proposalId: outcome.proposal?.id ?? null,
      status: outcome.status,
      explanation: outcome.explanation,
    };

    if (outcome.status === 'executed') {
      return { ...base, result: outcome.result ?? null };
    }
    if (outcome.status === 'pending_approval') {
      return {
        ...base,
        approval: {
          approvalId: outcome.approval.id,
          approvalsRequired: outcome.approval.required,
          approvers: outcome.approval.approvers,
          expiresAt: outcome.approval.expiresAt,
        },
        reasons: outcome.decision.reasons
          .filter((r) => r.severity === 'approval')
          .map((r) => ({ code: r.code, message: r.message })),
        instruction:
          'NOT DONE. The instruction is parked awaiting human approval. Tell the customer this, '
          + 'name the approvers, and do not attempt the action another way.',
      };
    }
    return {
      ...base,
      reasons: outcome.decision.reasons
        .filter((r) => r.severity === 'block')
        .map((r) => ({ code: r.code, message: r.message, detail: r.detail ?? null })),
      instruction:
        'REFUSED. Report the reason to the customer verbatim and stop. Do not retry with '
        + 'different arguments, a smaller amount, or several smaller instructions.',
    };
  }

  /**
   * Run one conversational turn.
   *
   * `actor` is who is talking to the bank — normally `{ type: 'agent', id }`
   * for the bank's own agent acting under a mandate, or `{ type: 'user', id }`
   * when a person drives it directly.
   */
  async function runTurn({ entityId, actor, message, sessionId = null, history = [] }) {
    const entity = await store.get('entities', entityId);
    if (!entity) throw new AgentError(`No customer ${entityId}`, 'ENTITY_NOT_FOUND', {}, 404);

    const turnId = newId('turn');
    const scope = await scopeTools({ entityId, actor, segment: entity.segment });

    const accountRows = await ledger.listAccounts(entityId);
    const accounts = [];
    for (const account of accountRows) {
      const balance = await ledger.getBalance(account.id);
      accounts.push({
        id: account.id,
        name: account.name,
        currency: account.currency,
        status: account.status,
        available: formatWithCurrency(balance.available),
      });
    }

    const system = buildSystemPrompt({
      segment: entity.segment,
      entity,
      accounts,
      mandates: scope.mandates.map((m) => ({
        ...m,
        limits: m.limits?.perTransaction
          ? {
            perTransaction: Object.fromEntries(
              Object.entries(m.limits.perTransaction).map(([c, v]) => [c, formatWithCurrency(v)]),
            ),
          }
          : null,
      })),
      now: clock.now(),
      bankTimeZone,
    });

    const messages = [...history, { role: 'user', content: message }];
    const steps = [];
    let reply = null;
    let stoppedBecause = 'end_turn';

    for (let step = 0; step < maxSteps; step += 1) {
      const response = await llm.converse({ system, messages, tools: scope.tools });

      const toolUses = (response.content ?? []).filter((b) => b.type === 'tool_use');
      const text = (response.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();

      if (response.stopReason !== 'tool_use' || toolUses.length === 0) {
        reply = text || null;
        stoppedBecause = response.stopReason;
        break;
      }

      // Keep the assistant turn verbatim — thinking blocks included — so the
      // conversation stays append-only across the loop.
      messages.push({ role: 'assistant', content: response.content });

      // Parallel tool calls come back in one assistant turn and their results
      // must go back in ONE user message. Splitting them teaches the model to
      // stop calling tools in parallel.
      const results = [];
      for (const toolUse of toolUses) {
        const capability = registry.getByToolName(toolUse.name);
        if (!capability) {
          results.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            is_error: true,
            content: JSON.stringify({ error: 'UNKNOWN_TOOL', message: `No capability behind ${toolUse.name}` }),
          });
          continue;
        }
        if (!scope.capabilityIds.includes(capability.id)) {
          // The model asked for something outside its mandate scope. This is
          // not an error in the model so much as a fact about its authority.
          results.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            is_error: true,
            content: JSON.stringify({
              error: 'NOT_IN_SCOPE',
              message: `You hold no mandate for ${capability.id}. Tell the customer, and do not try another route.`,
            }),
          });
          continue;
        }

        let outcome;
        try {
          outcome = await kernel.submit({
            entityId,
            capabilityId: capability.id,
            args: toolUse.input,
            initiator: actor,
            // Deterministic: the same turn replaying the same tool call is the
            // same instruction, not a second one.
            idempotencyKey: capability.mutating ? `${turnId}:${toolUse.id}` : null,
          });
        } catch (err) {
          steps.push({
            step,
            capabilityId: capability.id,
            args: toolUse.input,
            status: 'error',
            error: { code: err.code ?? 'ERROR', message: err.message },
          });
          results.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            is_error: true,
            content: JSON.stringify({
              error: err.code ?? 'ERROR',
              message: err.message,
              details: err.details ?? null,
            }),
          });
          continue;
        }

        const rendered = renderToolResult(outcome);
        steps.push({
          step,
          capabilityId: capability.id,
          args: toolUse.input,
          status: outcome.status,
          proposalId: outcome.proposal?.id ?? null,
          decisionOutcome: outcome.decision?.outcome ?? null,
          reasonCodes: (outcome.decision?.reasons ?? []).map((r) => r.code),
        });
        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(rendered),
        });
      }

      messages.push({ role: 'user', content: results });

      if (step === maxSteps - 1) {
        stoppedBecause = 'max_steps';
        reply = null;
      }
    }

    const turn = {
      id: turnId,
      sessionId,
      entityId,
      actor,
      message,
      reply,
      stoppedBecause,
      steps,
      model: llm.model,
      provider: llm.name,
      at: clock.now().toISOString(),
    };

    await store.withTransaction(async (tx) => {
      await audit.append(tx, {
        type: 'agent.turn',
        actor,
        subject: { type: 'turn', id: turnId },
        outcome: stoppedBecause,
        payload: {
          entityId,
          message,
          reply,
          stoppedBecause,
          toolsOffered: scope.capabilityIds,
          steps: steps.map((s) => ({
            capabilityId: s.capabilityId,
            status: s.status,
            proposalId: s.proposalId ?? null,
            reasonCodes: s.reasonCodes ?? [],
          })),
        },
      });
    });

    if (stoppedBecause === 'max_steps') {
      turn.reply =
        'I ran out of steps before finishing. Nothing further was attempted. '
        + 'Here is what was done so far: '
        + (steps.length
          ? steps.map((s) => `${s.capabilityId} -> ${s.status}`).join('; ')
          : 'nothing');
    }

    return { turn, messages, scope: { capabilityIds: scope.capabilityIds } };
  }

  return {
    runTurn,
    scopeTools,
    /** The tool names a segment's agent would see, for docs and debugging. */
    toolNamesFor(segment) {
      return registry.list({ segment }).map((c) => toolName(c.id));
    },
  };
}
