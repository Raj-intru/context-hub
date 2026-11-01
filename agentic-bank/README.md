# agentic-bank

A working reference implementation of an **agent-first bank** — mobile- and
API-first, serving consumer, business and institutional customers from one
kernel — built around a single commitment:

> **The model proposes. A deterministic kernel decides. There is no path from
> the agent to the ledger that does not pass through the kernel.**

A traditional bank's product is a set of screens; a digital bank's product is a
better set of screens. In both, the customer supplies the judgement and the
labour. Here the customer states an outcome — *"pay the suppliers that are due,
but don't go below fifty thousand"*, *"we need USD 2m by Thursday, hedge it"*,
*"stop anything I'm paying for twice"* — and an agent turns it into
instructions. Screens become one rendering of a conversation.

The hard part is not the agent. It is that a language model is
non-deterministic, occasionally confidently wrong, and steerable by text it
reads — and no treasurer or regulator will accept *"the model decided"* as a
control. So the agent chooses **what to attempt**; a pure, unit-tested policy
engine decides **whether it is permitted**; a double-entry ledger decides
**whether it is possible**.

```
  intent ──▶ AGENT ──▶ Proposal ──▶ KERNEL ──▶ ALLOW ───────────▶ LEDGER
          (model)                 (no model,   REQUIRE_APPROVAL ─▶ human
                                   no IO)      DENY ─────────────▶ reasons
```

## Quick start

No database, no API key, no network.

```bash
cd agentic-bank
npm install

npm run demo        # a transcript of all three segment journeys
npm test            # 109 unit tests
npm run test:e2e    # 24 end-to-end journeys over HTTP
npm start           # a server on :5100 with seeded demo customers
```

`npm run demo` prints the three journeys with every kernel decision marked, so
you can see exactly where the agent stops being in charge:

```
CONSUMER — Ana Ferreira
  customer  "pay the rent then"
  [kernel]  payments.domestic.initiate       executed
            {"paidTo":"Harbourview Property Management","amount":"AUD 1,800.00","valueDate":"2026-11-05","rail":"NPP"}

  customer  "also send them a bond of 4000"
  [kernel]  payments.domestic.initiate       denied
            PER_TRANSACTION_LIMIT_EXCEEDED, DAILY_LIMIT_EXCEEDED, INSUFFICIENT_FUNDS

BUSINESS — Brightline Joinery Pty Ltd
  customer  "fund payroll for this fortnight, 68500"
  [kernel]  payroll.fund                     pending_approval
            DUAL_CONTROL_REQUIRED, VALUE_DATE_ROLLED
  [human]   Deepa approves...
  [kernel]  segregation of duties: Deepa tries again
            APPROVAL_DUPLICATE  usr_3cdd… has already decided on this instruction
  [human]   Tom approves...
  [kernel]  approval approved -> re-evaluating against current conditions
            executed {"payPeriod":"2026-11-FN1","amount":"AUD 68,500.00","valueDate":"2026-11-06"}

INSTITUTIONAL — Meridian Group Treasury Pte Ltd
  customer  "pay volkov industrial 250000 EUR"
  [kernel]  payments.crossborder.initiate    denied
            SCREENING_BLOCKED
```

## What's implemented

| Area | Status |
|---|---|
| **Deterministic policy engine** — pure function, no IO, no model | ✅ 24 unit tests covering limits, velocity, screening, cut-offs, windows, dual control |
| **Mandates** — delegated authority for people *and* AI agents | ✅ three autonomy levels, per-instruction/daily/monthly limits, payee allowlists, time windows, most-restrictive-wins resolution |
| **Dual control** — N-of-M with segregation of duties | ✅ no self-approval, no double vote, one rejection kills it, expiry, re-evaluation on release |
| **Double-entry ledger** — integer minor units, `BigInt`, no floats | ✅ balanced per currency, append-only, holds, overdrafts, multi-currency FX legs |
| **Idempotency** | ✅ required on every mutating call; replay returns the stored response, conflicting arguments are a 409 |
| **Hash-chained audit** | ✅ tamper-evident, verifiable, localises the first break; reads audited too |
| **Capability registry** — one declaration, three surfaces | ✅ 23 capabilities → agent tools, REST endpoints, agent-to-agent catalogue |
| **Agent runtime** | ✅ bounded tool-calling loop; tool set derived from mandates, not the segment catalogue |
| **Model layer** | ✅ Anthropic (official SDK, adaptive thinking, prompt caching, refusal handling) + a deterministic offline planner used by every test |
| **Consumer pack** | ✅ balances, payments, payees, cards, sweeps, recurring-payment review, disputes |
| **Business pack** | ✅ cash-flow forecast with a dated low point, receivables ageing, payment runs as one instruction, payroll funding |
| **Institutional pack** | ✅ group liquidity by currency and entity, facility utilisation, FX quote/book, cross-border with cut-offs and fees, host-to-host files, documentary credits |
| **Storage** | ✅ in-process (default, no setup) and Postgres — identical journeys pass on both |
| **Database-enforced invariants** | ✅ append-only triggers, deferred per-currency balance check, unique idempotency keys |
| Authentication | ⚠️ **demo shim** — see [docs/RISK-AND-CONTROLS.md](docs/RISK-AND-CONTROLS.md) |
| Sanctions screening | ⚠️ **a local demo list, not a sanctions list** |
| Payment rails | ⚠️ cut-off metadata and ledger legs; nothing is sent anywhere |
| Agent evals | ❌ **not built** — the biggest gap; see below |

## Read next

| | |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | the thesis, the two layers, why the policy engine is a pure function, trade-offs taken knowingly |
| [docs/MANDATES.md](docs/MANDATES.md) | delegated authority, autonomy levels, dual control, why most-restrictive wins |
| [docs/SEGMENTS.md](docs/SEGMENTS.md) | what each segment actually needs, and what it forces on the design |
| [docs/RISK-AND-CONTROLS.md](docs/RISK-AND-CONTROLS.md) | every control and its test, what is stubbed, what blocks a real deployment, **claims not to make** |
| [docs/API.md](docs/API.md) | the three surfaces, conventions, error shapes |
| [db/schema.sql](db/schema.sql) | the data model, and the invariants the database enforces itself |

## The design decisions worth arguing about

**The policy engine is a pure function.** `evaluate(proposal, context)` does no
IO and holds no clock. So every control is a millisecond unit test rather than
an end-to-end simulation, a decision is reproducible years later from its audit
record, and there is no prompt for an injection to reach — a pure function does
not read prompts.

**There is exactly one path in.** Controls are rarely defeated; they are
bypassed by a second path that lacks them — a fast path for the app, a batch job
that writes to the ledger, an internal endpoint for operations. Here the
capability registry is the only source of banking functionality and it is
projected to every channel from one declaration.

**The agent is offered only what its mandates permit.** Not the segment
catalogue filtered at call time — the tool list itself is the intersection. The
most effective injection mitigation is not a filter on the input; it is the
absence of anything to reach for.

**Nothing grants itself authority.** Mandate administration is not a capability,
so it has no tool definition and the agent is never offered it; the route
refuses non-human callers outright. An agent cannot widen, extend or create a
mandate, including its own.

**Unattended high-risk execution requires a stated ceiling.** A mandate with no
per-instruction limit in the instruction's currency falls back to a human
(`HIGH_RISK_UNBOUNDED`). The limit is what makes unattended execution a decision
the customer *made* rather than a default they *inherited*.

**A refusal is explained, and the agent is told not to work around it.** Every
denial lists *all* blocking reasons with the limit that stopped it. The tool
result is labelled `REFUSED` with an explicit instruction not to retry by
another route, and the prompt names structuring — splitting a refused payment
into several permitted ones — as a serious failure. That last one is a
prompt-level mitigation, which means it is a weak one, and it is untested here.

**Money is never a float.** Integer minor units, `BigInt`, decimal strings at
the wire. Excess precision is an *error*, not a rounding opportunity: `"1.005"`
in AUD is refused, because silently rounding an instruction is how you pay the
wrong amount.

**Approved instructions are re-evaluated before release.** Executing a stale
decision is how a control gets bypassed by waiting. A payee blocked after
approval but before release is still refused.

**Screening fails closed, with no override.** There is no setting that turns it
off. "The screening service was down" is not a defence a bank gets to make.

## Verifying the invariants

The database enforces what the application must not be able to violate. Each
can be checked directly in SQL:

```bash
export DATABASE_URL=postgres://user@localhost:5432/agentic_bank
npm run migrate

# 1. an unbalanced transaction fails at COMMIT, not at the failing INSERT
#    ERROR: transaction txn_bad does not balance in AUD: debits 1000 vs credits 1100
# 2. postings and audit records cannot be updated or deleted
#    ERROR: postings is append-only: UPDATE is not permitted.
# 3. a posting amount must be positive — sign lives in the direction
#    ERROR: violates check constraint "postings_amount_positive"
# 4. an idempotency key maps to at most one transaction
#    ERROR: duplicate key value violates "transactions_idempotency_key_uniq"

# then run the identical end-to-end journeys against the real database:
STORE=postgres npm run test:e2e        # PASS  24 passed, 0 failed
```

All four were verified against PostgreSQL 16 during development, and the
Postgres store passes the same 24 journeys as the in-memory one — the point of
the store interface being that nothing above it changes.

## Configuration

See [`.env.example`](.env.example). The defaults run offline.

```bash
STORE=memory                  # or postgres, with DATABASE_URL
AGENT_PROVIDER=stub           # or anthropic, with ANTHROPIC_API_KEY
AGENT_MODEL=claude-opus-5-5
AGENT_EFFORT=high
BANK_TIMEZONE=Australia/Sydney
AUTH_SECRET=                  # unset -> identity headers are trusted (local only)
```

`GET /readyz` reports what is not production-ready without being asked:

```json
{
  "backend": "memory", "capabilities": 23, "agentProvider": "stub",
  "readiness": { "ready": false, "blockers": [
    "STORE is \"memory\": balances are not durable and do not survive a restart.",
    "AUTH_SECRET is unset: the demo auth shim accepts unsigned identity headers.",
    "SCREENING_PROVIDER is \"stub\": the local demo list is not a sanctions list."
  ]}
}
```

## The biggest gap

**There is no eval suite over the agent layer.** Every test here asserts the
*wiring* — that a tool call becomes a kernel submission, that the kernel's
answer rather than the model's intention reaches the conversation, that an
out-of-scope tool is refused in-band. None asserts anything about model
*quality*: whether it picks the right capability, reads an ambiguous
instruction correctly, or honours "do not retry a refusal" under pressure.

For a bank whose product *is* the agent, that is the central question, and this
repo does not answer it. It needs a graded set of real customer utterances per
segment, scored on every prompt and model change. That, not more capabilities,
is what the next increment should be.

The rest of the gaps — real authentication and step-up, the bank's own
screening and KYC, an external anchor for the audit chain, row-level security
as a second isolation layer, rail integration and the states it generates
(returns, recalls, investigations) — are in
[docs/RISK-AND-CONTROLS.md](docs/RISK-AND-CONTROLS.md), along with the list of
claims that must not be made from this repo as it stands.

## Layout

```
src/
  kernel/        policy.js (pure)  mandates  approvals  audit  engine  screening  schema
  ledger/        money.js (BigInt minor units)   ledger.js (double-entry)
  capabilities/  registry + shared / consumer / business / institutional packs
  agent/         runtime (tool loop)  packs (segment prompts)  llm (Anthropic | stub)
  store/         memory (default, re-entrant transactions)  postgres
  routes/        agent  capabilities  approvals  mandates  admin
  services/      fx (quote/book)  bank (the bank's own accounts)
db/schema.sql    the data model, and the invariants the DB enforces
test/            109 unit tests + 24 end-to-end journeys
docs/            architecture, mandates, segments, risk and controls, API
```

MIT, consistent with the rest of this repository.
