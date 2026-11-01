import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBank } from './helpers.mjs';

// The runtime is exercised with the offline planner, so these assert the
// *wiring* — that a tool call becomes a kernel submission, that the kernel's
// answer is what goes back into the conversation, and that an agent cannot
// reach past its mandate. They do not assert anything about model quality.

test('a tool call becomes a kernel submission and the result reaches the model', async () => {
  const { bank, ids } = await makeBank({
    plans: [{
      match: /balance/i,
      steps: [
        { tool: 'accounts_balance', input: { accountId: '$EVERYDAY' } },
        { text: 'Your available balance is in the tool result above.' },
      ],
    }],
  });
  const { turn } = await bank.agent.runTurn({
    entityId: ids.consumer.entityId,
    actor: { type: 'agent', id: ids.consumer.agentId },
    message: 'what is my balance',
  });

  assert.equal(turn.steps.length, 1);
  assert.equal(turn.steps[0].capabilityId, 'accounts.balance');
  // The account id was a placeholder, so the kernel refused it — which is the
  // point: a made-up id does not become a successful read.
  assert.equal(turn.steps[0].status, 'error');
});

test('a real journey: read the balance, then pay, with the kernel deciding', async () => {
  const { bank, ids } = await makeBank({
    plans: [{
      match: /rent/i,
      steps: [
        { tool: 'accounts_list', input: {} },
        {
          tool: 'payments_domestic_initiate',
          input: {
            fromAccountId: { $ref: 'id' },
            counterpartyId: '$CPT',
            amount: '1800.00',
            currency: 'AUD',
          },
        },
        { text: 'Rent is handled.' },
      ],
    }],
  });

  // Rewrite the scripted payee id to the seeded one by wrapping converse.
  const inner = bank.llm.converse.bind(bank.llm);
  bank.llm.converse = async (args) => {
    const response = await inner(args);
    for (const block of response.content) {
      if (block.type === 'tool_use' && block.input?.counterpartyId === '$CPT') {
        block.input.counterpartyId = ids.consumer.landlordId;
      }
    }
    return response;
  };

  const { turn } = await bank.agent.runTurn({
    entityId: ids.consumer.entityId,
    actor: { type: 'agent', id: ids.consumer.agentId },
    message: 'pay the rent',
  });

  assert.equal(turn.steps.length, 2);
  assert.equal(turn.steps[0].capabilityId, 'accounts.list');
  assert.equal(turn.steps[0].status, 'executed');
  assert.equal(turn.steps[1].capabilityId, 'payments.domestic.initiate');
  assert.equal(turn.steps[1].status, 'executed');
  assert.equal(turn.reply, 'Rent is handled.');
});

test('the tool set offered is scoped to the mandate, not to the segment', async () => {
  const { bank, ids } = await makeBank();
  const consumerScope = await bank.agent.scopeTools({
    entityId: ids.consumer.entityId,
    actor: { type: 'agent', id: ids.consumer.agentId },
    segment: 'consumer',
  });
  // The seeded consumer mandate omits nothing in its segment, so compare a
  // deliberately narrow one instead.
  const narrow = await bank.mandates.create({
    entityId: ids.business.entityId,
    grantee: { type: 'agent', id: 'agt_narrow' },
    grantedBy: ids.business.ownerId,
    autonomy: 'propose_only',
    capabilities: ['accounts.balance'],
    accounts: ['*'],
  });
  const narrowScope = await bank.agent.scopeTools({
    entityId: ids.business.entityId,
    actor: { type: 'agent', id: 'agt_narrow' },
    segment: 'business',
  });
  assert.deepEqual(narrowScope.capabilityIds, ['accounts.balance']);
  assert.ok(consumerScope.capabilityIds.length > narrowScope.capabilityIds.length);
  assert.equal(narrowScope.tools.length, 1);
  assert.equal(narrow.status, 'active');
});

test('an agent with no mandate is offered nothing', async () => {
  const { bank, ids } = await makeBank();
  const scope = await bank.agent.scopeTools({
    entityId: ids.consumer.entityId,
    actor: { type: 'agent', id: 'agt_stranger' },
    segment: 'consumer',
  });
  assert.deepEqual(scope.capabilityIds, []);
  assert.deepEqual(scope.tools, []);
});

test('a tool outside the mandate is refused in-band, not executed', async () => {
  const { bank, ids } = await makeBank({
    plans: [{
      match: /liquidity/i,
      steps: [
        // The consumer agent's mandate does not cover this, and the capability
        // is not even in its segment.
        { tool: 'liquidity_position', input: {} },
        { text: 'done' },
      ],
    }],
  });
  const { turn } = await bank.agent.runTurn({
    entityId: ids.consumer.entityId,
    actor: { type: 'agent', id: ids.consumer.agentId },
    message: 'show me group liquidity',
  });
  assert.equal(turn.steps.length, 0, 'nothing should have been submitted to the kernel');
});

test('a denial is reported as a refusal the model is told not to work around', async () => {
  const { bank, ids } = await makeBank({
    plans: [{
      match: /big/i,
      steps: [
        {
          tool: 'payments_domestic_initiate',
          input: { fromAccountId: '$ACC', counterpartyId: '$CPT', amount: '9000.00', currency: 'AUD' },
        },
        { text: 'That was refused.' },
      ],
    }],
  });
  const inner = bank.llm.converse.bind(bank.llm);
  const seen = [];
  bank.llm.converse = async (args) => {
    // Capture what the model is shown after the tool call.
    for (const message of args.messages) {
      if (message.role !== 'user' || typeof message.content === 'string') continue;
      for (const block of message.content) {
        if (block.type === 'tool_result') seen.push(JSON.parse(block.content));
      }
    }
    const response = await inner(args);
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        if (block.input?.fromAccountId === '$ACC') block.input.fromAccountId = ids.consumer.everydayId;
        if (block.input?.counterpartyId === '$CPT') block.input.counterpartyId = ids.consumer.landlordId;
      }
    }
    return response;
  };

  const { turn } = await bank.agent.runTurn({
    entityId: ids.consumer.entityId,
    actor: { type: 'agent', id: ids.consumer.agentId },
    message: 'make a big payment',
  });

  assert.equal(turn.steps[0].status, 'denied');
  const result = seen.find((r) => r.status === 'denied');
  assert.ok(result, 'the model must be shown the denial');
  assert.match(result.instruction, /REFUSED/);
  assert.match(result.instruction, /Do not retry/);
  assert.ok(result.reasons.some((r) => r.code === 'PER_TRANSACTION_LIMIT_EXCEEDED'));
});

test('a pending approval is never reported to the model as done', async () => {
  const { bank, ids } = await makeBank({
    plans: [{
      match: /pay hanseatic/i,
      steps: [
        {
          tool: 'payments_crossborder_initiate',
          input: { fromAccountId: '$EUR', counterpartyId: '$CPT', amount: '750000.00', currency: 'EUR' },
        },
        { text: 'It needs two approvals.' },
      ],
    }],
  });
  const inner = bank.llm.converse.bind(bank.llm);
  const seen = [];
  bank.llm.converse = async (args) => {
    for (const message of args.messages) {
      if (message.role !== 'user' || typeof message.content === 'string') continue;
      for (const block of message.content) {
        if (block.type === 'tool_result') seen.push(JSON.parse(block.content));
      }
    }
    const response = await inner(args);
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        if (block.input?.fromAccountId === '$EUR') block.input.fromAccountId = ids.institutional.treasuryEurId;
        if (block.input?.counterpartyId === '$CPT') block.input.counterpartyId = ids.institutional.supplierId;
      }
    }
    return response;
  };

  const { turn } = await bank.agent.runTurn({
    entityId: ids.institutional.treasuryEntityId,
    actor: { type: 'agent', id: ids.institutional.agentId },
    message: 'pay hanseatic',
  });

  assert.equal(turn.steps[0].status, 'pending_approval');
  const result = seen.find((r) => r.status === 'pending_approval');
  assert.match(result.instruction, /NOT DONE/);
  assert.equal(result.approval.approvalsRequired, 2);
  assert.equal(result.result, undefined, 'a pending instruction has no result');
});

test('a bounded loop reports running out of steps instead of going quiet', async () => {
  const { bank, ids } = await makeBank({
    env: { AGENT_MAX_STEPS: '2' },
    plans: [{
      match: /loop/i,
      // Never terminates on its own.
      steps: Array.from({ length: 10 }, () => ({ tool: 'accounts_list', input: {} })),
    }],
  });
  const { turn } = await bank.agent.runTurn({
    entityId: ids.consumer.entityId,
    actor: { type: 'agent', id: ids.consumer.agentId },
    message: 'loop forever',
  });
  assert.equal(turn.stoppedBecause, 'max_steps');
  assert.match(turn.reply, /ran out of steps/);
  assert.equal(turn.steps.length, 2);
});

test('the same turn replaying a tool call does not pay twice', async () => {
  const { bank, ids } = await makeBank();
  const first = await bank.kernel.submit({
    entityId: ids.consumer.entityId,
    capabilityId: 'payments.domestic.initiate',
    args: {
      fromAccountId: ids.consumer.everydayId,
      counterpartyId: ids.consumer.landlordId,
      amount: '500.00', currency: 'AUD',
    },
    initiator: { type: 'agent', id: ids.consumer.agentId },
    idempotencyKey: 'trn_1:toolu_abc',
  });
  const replay = await bank.kernel.submit({
    entityId: ids.consumer.entityId,
    capabilityId: 'payments.domestic.initiate',
    args: {
      fromAccountId: ids.consumer.everydayId,
      counterpartyId: ids.consumer.landlordId,
      amount: '500.00', currency: 'AUD',
    },
    initiator: { type: 'agent', id: ids.consumer.agentId },
    idempotencyKey: 'trn_1:toolu_abc',
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.transactionId, first.result.transactionId);
});

test('every turn is audited with the capabilities that were in scope', async () => {
  const { bank, ids } = await makeBank({
    plans: [{ match: /hello/i, steps: [{ text: 'Hi.' }] }],
  });
  const { turn } = await bank.agent.runTurn({
    entityId: ids.consumer.entityId,
    actor: { type: 'agent', id: ids.consumer.agentId },
    message: 'hello',
  });
  const records = await bank.audit.list({ subjectId: turn.id });
  assert.equal(records.length, 1);
  assert.equal(records[0].type, 'agent.turn');
  assert.ok(records[0].payload.toolsOffered.includes('accounts.balance'));
  assert.equal((await bank.audit.verify()).ok, true);
});
