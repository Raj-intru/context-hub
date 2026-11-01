// A readable transcript of the three segment journeys, run end to end through
// the real kernel with the offline planner. No network, no API key, no
// database. `npm run demo`
//
// The point of the transcript is to show where the agent stops being in
// charge: every line marked [kernel] is a decision the model had no vote in.

import { createBank } from '../src/bank.js';
import { loadConfig } from '../src/config.js';
import { seed } from '../src/seed.js';
import { fixedClock } from '../src/util/time.js';
import { stubProvider } from '../src/agent/llm.js';

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

const STATUS_COLOUR = {
  executed: GREEN,
  pending_approval: YELLOW,
  denied: RED,
  error: RED,
};

// Thursday 5 November 2026, 10:00 Sydney.
const NOW = '2026-11-04T23:00:00Z';

const config = loadConfig({ STORE: 'memory', AGENT_PROVIDER: 'stub', BANK_TIMEZONE: 'Australia/Sydney' });
const bank = await createBank({ config, clock: fixedClock(NOW) });
const ids = await seed(bank);

function heading(text) {
  console.log(`\n${BOLD}${'─'.repeat(74)}${RESET}`);
  console.log(`${BOLD}${text}${RESET}`);
  console.log(`${BOLD}${'─'.repeat(74)}${RESET}`);
}

/**
 * Swap the scripted placeholders for the ids the seed actually minted, the way
 * a model would have read them from a previous tool result.
 */
function withPlaceholders(llm, replacements) {
  const inner = llm.converse.bind(llm);
  llm.converse = async (args) => {
    const response = await inner(args);
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      for (const [key, value] of Object.entries(block.input ?? {})) {
        if (typeof value === 'string' && replacements[value] !== undefined) {
          block.input[key] = replacements[value];
        }
        if (Array.isArray(value)) {
          block.input[key] = value.map((v) => replacements[v] ?? v);
        }
      }
    }
    return response;
  };
  return llm;
}

async function runTurn({ label, entityId, actor, message, plans, replacements = {} }) {
  const llm = withPlaceholders(stubProvider({ plans }), replacements);
  const runtime = (await import('../src/agent/runtime.js')).createAgentRuntime({
    llm,
    registry: bank.registry,
    kernel: bank.kernel,
    ledger: bank.ledger,
    mandates: bank.mandates,
    store: bank.store,
    clock: bank.clock,
    audit: bank.audit,
    config,
  });

  console.log(`\n${DIM}${label}${RESET}`);
  console.log(`  ${BOLD}customer${RESET}  "${message}"`);

  const { turn } = await runtime.runTurn({ entityId, actor, message });

  for (const step of turn.steps) {
    const colour = STATUS_COLOUR[step.status] ?? '';
    console.log(`  ${DIM}[kernel]${RESET}  ${step.capabilityId.padEnd(32)} ${colour}${step.status}${RESET}`);
    if (step.reasonCodes?.length) {
      console.log(`            ${DIM}${step.reasonCodes.join(', ')}${RESET}`);
    }
    if (step.error) {
      console.log(`            ${RED}${step.error.code}${RESET} ${step.error.message}`);
    }
    if (step.proposalId) {
      const proposal = await bank.kernel.getProposal(step.proposalId);
      if (proposal?.result) {
        console.log(`            ${DIM}${JSON.stringify(proposal.result).slice(0, 180)}${RESET}`);
      }
    }
  }
  if (turn.reply) console.log(`  ${BOLD}agent${RESET}     ${turn.reply}`);
  return turn;
}

// ═══════════════════════════════════════════════════════════════ consumer
heading('CONSUMER — Ana Ferreira');
console.log(`${DIM}Mandate: execute_within_limits, AUD 2,500 per instruction, AUD 5,000/day.${RESET}`);

await runTurn({
  label: 'A question, answered from the available balance rather than the cleared one.',
  entityId: ids.consumer.entityId,
  actor: { type: 'agent', id: ids.consumer.agentId },
  message: 'can I afford to pay rent of 1800 this week?',
  replacements: { $EVERYDAY: ids.consumer.everydayId },
  plans: [{
    match: /afford/i,
    steps: [
      { tool: 'accounts_balance', input: { accountId: '$EVERYDAY' } },
      { text: 'Yes — AUD 4,438.18 is available on Everyday, so AUD 1,800.00 leaves AUD 2,638.18.' },
    ],
  }],
});

await runTurn({
  label: 'An instruction inside the mandate: the agent executes unattended.',
  entityId: ids.consumer.entityId,
  actor: { type: 'agent', id: ids.consumer.agentId },
  message: 'pay the rent then',
  replacements: { $EVERYDAY: ids.consumer.everydayId, $LANDLORD: ids.consumer.landlordId },
  plans: [{
    match: /rent/i,
    steps: [
      {
        tool: 'payments_domestic_initiate',
        input: { fromAccountId: '$EVERYDAY', counterpartyId: '$LANDLORD', amount: '1800.00', currency: 'AUD', reference: 'Rent November' },
      },
      { text: 'Paid AUD 1,800.00 to Harbourview Property Management, value date 5 November.' },
    ],
  }],
});

await runTurn({
  label: 'Over the limit. Note that the agent is told not to retry by another route.',
  entityId: ids.consumer.entityId,
  actor: { type: 'agent', id: ids.consumer.agentId },
  message: 'also send them a bond of 4000',
  replacements: { $EVERYDAY: ids.consumer.everydayId, $LANDLORD: ids.consumer.landlordId },
  plans: [{
    match: /bond/i,
    steps: [
      {
        tool: 'payments_domestic_initiate',
        input: { fromAccountId: '$EVERYDAY', counterpartyId: '$LANDLORD', amount: '4000.00', currency: 'AUD', reference: 'Bond' },
      },
      { text: 'That one was refused: AUD 4,000.00 is over your AUD 2,500.00 per-payment limit. Raising the limit needs you to do it, not me.' },
    ],
  }],
});

await runTurn({
  label: 'A read-only review. Cancelling anything would be a separate, approved instruction.',
  entityId: ids.consumer.entityId,
  actor: { type: 'agent', id: ids.consumer.agentId },
  message: 'what am I paying for on repeat?',
  replacements: { $EVERYDAY: ids.consumer.everydayId },
  plans: [{
    match: /repeat/i,
    steps: [
      { tool: 'subscriptions_review', input: { accountId: '$EVERYDAY' } },
      { text: 'Three recurring debits: Streamflix 22.99, City Gym 79.00, Cloud Backup 14.95.' },
    ],
  }],
});

// ═══════════════════════════════════════════════════════════════ business
heading('BUSINESS — Brightline Joinery Pty Ltd');
console.log(`${DIM}Mandate: execute_within_limits to AUD 75,000; two of three humans above AUD 50,000.${RESET}`);

await runTurn({
  label: 'The forecast answers with the low point and its date, not the closing balance.',
  entityId: ids.business.entityId,
  actor: { type: 'agent', id: ids.business.agentId },
  message: 'will we be tight on cash before the end of the month?',
  replacements: { $OPERATING: ids.business.operatingId },
  plans: [{
    match: /tight on cash/i,
    steps: [
      { tool: 'cashflow_forecast', input: { accountId: '$OPERATING', horizonDays: 45 } },
      { tool: 'receivables_aging', input: {} },
      { text: 'No shortfall in the next 45 days. Mornington Fitouts is 21 days overdue at AUD 22,150 — worth chasing.' },
    ],
  }],
});

await runTurn({
  label: 'A payment run is ONE instruction. Under the dual-control threshold, so it goes.',
  entityId: ids.business.entityId,
  actor: { type: 'agent', id: ids.business.agentId },
  message: 'pay the suppliers that are due',
  replacements: {
    $OPERATING: ids.business.operatingId,
    $P1: ids.business.payableIds[0],
    $P2: ids.business.payableIds[1],
    $P3: ids.business.payableIds[2],
  },
  plans: [{
    match: /suppliers/i,
    steps: [
      {
        tool: 'payables_run_prepare',
        input: { fromAccountId: '$OPERATING', payableIds: ['$P1', '$P2', '$P3'], reference: 'November suppliers' },
      },
      { text: 'Three suppliers paid, AUD 23,395.40 total, value date 6 November.' },
    ],
  }],
});

const payroll = await runTurn({
  label: 'Payroll is over the threshold: parked for two signatures, and the agent says so.',
  entityId: ids.business.entityId,
  actor: { type: 'agent', id: ids.business.agentId },
  message: 'fund payroll for this fortnight, 68500',
  replacements: { $OPERATING: ids.business.operatingId, $PAYROLL: ids.business.payrollId },
  plans: [{
    match: /payroll/i,
    steps: [
      {
        tool: 'payroll_fund',
        input: {
          fromAccountId: '$OPERATING', payrollAccountId: '$PAYROLL',
          amount: '68500.00', currency: 'AUD', payPeriod: '2026-11-FN1', headcount: 34,
        },
      },
      { text: 'NOT done yet — AUD 68,500.00 is over the AUD 50,000 threshold, so it needs two approvals from Deepa and Tom.' },
    ],
  }],
});

{
  const proposalId = payroll.steps[0].proposalId;
  const approval = await bank.store.findOne('approvals', { proposalId });
  console.log(`\n  ${DIM}[human]${RESET}   Deepa approves...`);
  await bank.approvals.decide({ approvalId: approval.id, userId: ids.business.ownerId, decision: 'approve' });

  console.log(`  ${DIM}[kernel]${RESET}  segregation of duties: Deepa tries again`);
  try {
    await bank.approvals.decide({ approvalId: approval.id, userId: ids.business.ownerId, decision: 'approve' });
  } catch (err) {
    console.log(`            ${RED}${err.code}${RESET} ${err.message}`);
  }

  console.log(`  ${DIM}[human]${RESET}   Tom approves...`);
  const second = await bank.approvals.decide({ approvalId: approval.id, userId: ids.business.bookkeeperId, decision: 'approve' });
  console.log(`  ${DIM}[kernel]${RESET}  approval ${second.status} -> re-evaluating against current conditions`);
  const released = await bank.kernel.executeApproved({ proposalId, actor: { type: 'user', id: ids.business.bookkeeperId } });
  console.log(`            ${GREEN}executed${RESET} ${DIM}${JSON.stringify(released.result)}${RESET}`);
}

// ══════════════════════════════════════════════════════════ institutional
heading('INSTITUTIONAL — Meridian Group Treasury Pte Ltd');
console.log(`${DIM}Two mandates: reads and pricing unattended; anything that moves value needs approval.${RESET}`);

await runTurn({
  label: 'Group position across two entities and three currencies, plus facility headroom.',
  entityId: ids.institutional.treasuryEntityId,
  actor: { type: 'agent', id: ids.institutional.agentId },
  message: 'where is our cash this morning?',
  plans: [{
    match: /cash this morning/i,
    steps: [
      { tool: 'liquidity_position', input: {} },
      { tool: 'limits_utilisation', input: {} },
      { text: 'AUD 27.6m, USD 8.2m, EUR 1.45m available across two entities. RCF 24% drawn, intraday limit 21%.' },
    ],
  }],
});

const fx = await runTurn({
  label: 'Quote runs unattended. Booking does not — and the quote id is the only rate it may use.',
  entityId: ids.institutional.treasuryEntityId,
  actor: { type: 'agent', id: ids.institutional.agentId },
  message: 'we need 2 million AUD into USD, show me a rate and book it',
  replacements: { $AUD: ids.institutional.treasuryAudId, $USD: ids.institutional.treasuryUsdId },
  plans: [{
    match: /into USD/i,
    steps: [
      { tool: 'fx_quote', input: { sellCurrency: 'AUD', buyCurrency: 'USD', sellAmount: '2000000.00' } },
      { tool: 'fx_book', input: { quoteId: { $ref: 'quoteId' }, sellAccountId: '$AUD', buyAccountId: '$USD' } },
      { text: 'Quoted 0.6594 and raised the booking — it needs two approvals before it deals.' },
    ],
  }],
});

{
  const bookingStep = fx.steps.find((s) => s.capabilityId === 'fx.book');
  const approval = await bank.store.findOne('approvals', { proposalId: bookingStep.proposalId });
  console.log(`\n  ${DIM}[human]${RESET}   Priya and Marcus approve...`);
  await bank.approvals.decide({ approvalId: approval.id, userId: ids.institutional.treasurerId, decision: 'approve' });
  await bank.approvals.decide({ approvalId: approval.id, userId: ids.institutional.headOfTreasuryId, decision: 'approve' });
  const released = await bank.kernel.executeApproved({
    proposalId: bookingStep.proposalId, actor: { type: 'user', id: ids.institutional.headOfTreasuryId },
  });
  console.log(`  ${DIM}[kernel]${RESET}  ${GREEN}executed${RESET} ${DIM}${JSON.stringify(released.result)}${RESET}`);
}

await runTurn({
  label: 'A payee that screening blocks. Refused outright, at any size, with no approval path.',
  entityId: ids.institutional.treasuryEntityId,
  actor: { type: 'agent', id: ids.institutional.agentId },
  message: 'pay volkov industrial 250000 EUR',
  replacements: { $EUR: ids.institutional.treasuryEurId, $BLOCKED: ids.institutional.blockedCounterpartyId },
  plans: [{
    match: /volkov/i,
    steps: [
      {
        tool: 'payments_crossborder_initiate',
        input: { fromAccountId: '$EUR', counterpartyId: '$BLOCKED', amount: '250000.00', currency: 'EUR' },
      },
      { text: 'Refused — that counterparty is blocked by screening. This is not something an approval can release.' },
    ],
  }],
});

// ═══════════════════════════════════════════════════════════════ oversight
heading('OVERSIGHT');
const chain = await bank.audit.verify();
const journal = await bank.ledger.verifyJournal();
console.log(`  audit chain      ${chain.ok ? GREEN + 'verified' : RED + 'BROKEN'}${RESET}  ${chain.records} records, head ${chain.head.slice(0, 16)}...`);
console.log(`  journal          ${journal.ok ? GREEN + 'balanced' : RED + 'UNBALANCED'}${RESET}  ${journal.transactions} transactions`);

const accounts = await bank.store.all('accounts');
let drift = 0;
for (const account of accounts) {
  if (!(await bank.ledger.verifyBalance(account.id)).ok) drift += 1;
}
console.log(`  cached balances  ${drift === 0 ? GREEN + 'no drift' : RED + drift + ' MISMATCHED'}${RESET}  across ${accounts.length} accounts`);

const proposals = await bank.store.all('proposals');
const byStatus = proposals.reduce((acc, p) => ({ ...acc, [p.status]: (acc[p.status] ?? 0) + 1 }), {});
console.log(`  proposals        ${JSON.stringify(byStatus)}`);
console.log(`\n${DIM}Every [kernel] line above was decided by src/kernel/policy.js — a pure`);
console.log(`function the model cannot read, reach or influence.${RESET}\n`);

await bank.close();
