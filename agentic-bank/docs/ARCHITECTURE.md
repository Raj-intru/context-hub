# Architecture

## What "agent-first" has to mean

A traditional bank's product is a set of screens. A digital bank's product is a
better set of screens. In both, the customer does the work: they decide which
form to open, which fields to fill, which account to pick, and whether today is
before the cut-off. The bank supplies capability; the customer supplies
judgement and labour.

An agent-first bank inverts that. The customer states an outcome — *"pay the
suppliers that are due this week, but don't go below fifty thousand"*, *"we need
USD 2 million by Thursday, hedge it"*, *"stop anything I'm paying for twice"* —
and an agent does the work of turning that into instructions. The screens
become one rendering of a conversation, not the product.

That is an easy thing to say and a dangerous thing to build, because the
component doing the reasoning is a language model, and a language model is
non-deterministic, occasionally confidently wrong, and steerable by text it
reads. No regulator, and no treasurer, will accept "the model decided" as a
control.

So the architecture here rests on one commitment:

> **The model proposes. A deterministic kernel decides. There is no path from
> the agent to the ledger that does not pass through the kernel.**

Everything else follows from that.

## The two layers

```
                     ┌────────────────────────────────────────────┐
  customer, or       │  AGENT LAYER — non-deterministic           │
  the customer's     │                                            │
  own agent  ───────▶│  intent -> plan -> which capability,       │
                     │  with what arguments, and how to explain   │
                     │  the answer                                │
                     │                                            │
                     │  src/agent/   (runtime, packs, llm)        │
                     └──────────────────┬─────────────────────────┘
                                        │  a Proposal: capability id
                                        │  + validated arguments
                     ┌──────────────────▼─────────────────────────┐
                     │  KERNEL — deterministic, no model, no IO    │
                     │                                            │
                     │  schema validation                         │
                     │  mandate resolution     (who may do this)  │
                     │  policy evaluation      (ALLOW / APPROVAL  │
                     │                          / DENY)           │
                     │  dual control           (N-of-M, SoD)      │
                     │  idempotency                               │
                     │  hash-chained audit                        │
                     │                                            │
                     │  src/kernel/                               │
                     └──────────────────┬─────────────────────────┘
                                        │  only on ALLOW
                     ┌──────────────────▼─────────────────────────┐
                     │  LEDGER — double-entry, append-only        │
                     │  src/ledger/  +  db/schema.sql             │
                     └────────────────────────────────────────────┘
```

The agent layer chooses *what to attempt*. The kernel decides *whether it is
permitted*, and the ledger decides *whether it is possible*. Those are three
different questions and this build never conflates them.

### Why the policy engine is a pure function

`src/kernel/policy.js` exports `evaluate(proposal, context)`. It performs no
database access, holds no clock of its own, and calls nothing. It takes a fully
materialised context and returns a decision.

Three things fall out of that:

1. **Every control in the bank is a unit test.** `test/policy.test.js` asserts
   limit breaches, screening failures, cut-off rolls, segregation of duties and
   mandate windows without a database, a network or a model. A control that can
   only be tested by end-to-end simulation is a control nobody will confidently
   change.
2. **A decision is reproducible.** The audit record stores the decision, its
   `policyVersion`, and the digest of the context it was made from. The question
   *"why did the bank allow this in November"* is answerable years later by
   replaying the function.
3. **The model cannot reach it.** There is no argument, no prompt and no
   injected instruction that changes a pure function's behaviour, because the
   function does not read prompts.

### Why there is exactly one path

`src/kernel/engine.js` is the only way in. The mobile app, the public API, the
bank's own agent and a customer's third-party agent all call the same `submit`:

```
validate args -> plan -> resolve mandate -> build context -> EVALUATE
  ALLOW            -> execute, audit
  REQUIRE_APPROVAL -> park as a proposal, open an approval, audit
  DENY             -> record the refusal and its reasons, audit
```

This matters more than it looks. The usual way a control gets bypassed is not
that someone defeats it — it is that a second path appears which does not have
it. A "fast path" for the mobile app. A batch job that writes to the ledger
directly. An internal endpoint for the operations team. Here the capability
registry is the *only* source of banking functionality, and it is projected to
every channel from one declaration, so a capability cannot exist on one surface
and not another.

## The capability registry

A capability (`src/capabilities/`) is declared once with a JSON Schema for its
arguments, a risk class, the segments it serves, a rail with its cut-off, and
two functions:

- `plan(args, ctx)` — reads only. Works out what this instruction would touch:
  the risk-bearing amount, the accounts, the counterparty. Its output is what
  the policy engine reasons about.
- `execute(proposal, ctx)` — called **only** after an ALLOW, and only from
  inside the kernel's transaction.

That split is what lets the bank answer *"what would happen if I did this"*
without doing it. `POST /v1/capabilities/:id/preview` runs everything up to and
including the decision and then stops, which is how an agent can tell a
customer "that would need two approvals from Priya or Marcus, and it would
value tomorrow" before committing to anything.

The same registry becomes:

| Surface | What it is for |
|---|---|
| `registry.toolDefinitions({ segment })` | Anthropic tool definitions for the bank's own agent |
| `POST /v1/capabilities/:id/execute` | the API-first channel; also what the mobile client uses |
| `GET /v1/agent/capabilities` | the agent-to-agent catalogue, for a customer's own agent |

Internal schemas use custom `format` names (`amount`, `identifier`) that mean
something to this repo's validator and nothing to anyone else. `toolSchema()`
compiles those to `pattern` + `description` before they leave the building, so
the constraint actually reaches the model instead of being dropped as an
unrecognised annotation.

## Delegated authority is the core domain object

The thing a bank needs before it lets any agent do anything is not a better
model. It is an answer to *"on whose authority?"*.

A **mandate** (`src/kernel/mandates.js`) records that a principal, through
someone able to bind it, has granted a grantee — a person **or an AI agent** —
the right to use named capabilities, on named accounts, up to named limits,
inside a named window, with named approval requirements. See
[MANDATES.md](MANDATES.md).

Two properties are worth calling out:

- **Nothing grants itself authority.** `POST /v1/mandates` refuses any caller
  whose actor type is not `user`. An agent cannot create, widen or extend a
  mandate, including its own. There is no capability for it and no route for
  it, which is why a prompt injection has nothing to escalate *to*.
- **Adding a mandate never widens unattended freedom.** When several mandates
  cover an action, resolution picks the **most restrictive** autonomy level.
  Granting a broad new mandate cannot quietly upgrade an action a narrow one
  already governed.

## The agent layer, and what it is allowed to see

`src/agent/runtime.js` is a bounded tool-calling loop. The banking-specific
parts are:

- **The tool set is derived from mandates, not from the segment catalogue.** An
  agent is never offered a capability it has no authority to use. This is the
  single most effective prompt-injection mitigation in the system: not a filter
  on the input, but an absence of anything to reach for.
- **Every mutating tool call carries a deterministic idempotency key** derived
  from the turn id and the `tool_use` id. A retried loop cannot double-pay.
- **The kernel's answer, not the model's intention, goes back into the
  conversation.** A denial comes back labelled `REFUSED` with its reason codes
  and an explicit instruction not to retry by another route; a parked
  instruction comes back labelled `NOT DONE`. The prompt in
  `src/agent/packs.js` also names structuring — splitting a refused payment
  into several permitted ones — as a serious failure rather than a workaround.

The prompt is advisory and the kernel does not trust a word of it. Its job is
to make the agent *useful and honest*, not to make it safe; safety is
structural.

## Money

Integer minor units, `BigInt` arithmetic, no floats anywhere near a balance
(`src/ledger/money.js`). Amounts cross every boundary as decimal **strings**
with the currency's exact precision, because JSON has no integer type that is
safe past 2^53 and an institutional ledger exceeds it.

Excess precision is an **error**, not a rounding opportunity: `"1.005"` in AUD
is refused. Silently rounding someone's instruction is how you pay the wrong
amount, and a model that emits one decimal place too many should be told so.

FX converts through an explicit rate with the minor-unit exponent difference
applied in the same expression, so AUD→JPY needs no special case. Rounding is
half-away-from-zero and symmetric. `allocate()` splits an amount so the parts
sum exactly to the original.

## What the database owns

`db/schema.sql` deliberately does *not* re-declare the domain types — the
application owns those, and a wide relational schema would let the two
definitions drift. What the database owns is the set of invariants the
application must not be able to violate even if its code is wrong:

| Invariant | Mechanism |
|---|---|
| Postings, transactions and audit records cannot be updated or deleted | `before update or delete` triggers that raise |
| Every transaction balances, per currency | deferred constraint trigger, checked at `COMMIT` |
| An idempotency key maps to at most one transaction | unique index |
| A posting amount is positive; sign lives in the direction | check constraint |
| Audit `seq` and `hash` are unique | unique indexes |

All five are exercised directly in SQL — see the "Verifying the invariants"
section of the [README](../README.md).

Dates and timestamps are projected into generated columns as **text**, not
`date`/`timestamptz`: those casts are `STABLE` (they read `DateStyle` and
`TimeZone`) and Postgres only accepts an `IMMUTABLE` expression in a generated
column. ISO-8601 sorts and ranges correctly as text, which is the reason the
application writes ISO-8601 everywhere.

## Supervision

`src/kernel/audit.js` is a hash-chained log: every record commits to the one
before it, so a record cannot be altered or removed without breaking every hash
that follows, which `verify()` detects and localises.

This is tamper **evidence**, not tamper proofing. Anyone who can rewrite the
whole table can rebuild the chain. Closing that gap needs an external anchor —
append-only object storage, or a periodic digest published somewhere else — and
this build does not have one. It is listed in
[RISK-AND-CONTROLS.md](RISK-AND-CONTROLS.md) rather than glossed over.

Reads are audited too, not just writes. Every agent data access produces a
`proposal.evaluated` record. That is a deliberate cost: it means a `proposals`
row for every balance check, which is heavy, and a real deployment would likely
split read audit into a cheaper sink. The uniformity is worth more than the
bytes at this stage, because it means there is no category of agent action that
goes unrecorded.

## The approval path, and the trap in it

A parked instruction is **re-evaluated** when its approvals complete
(`executeApproved`). Time has passed: a limit may have been consumed, an
account frozen, a mandate revoked, a counterparty newly blocked. Executing a
stale decision is how a control gets bypassed by waiting, and
`test/approvals.test.js` asserts that a payee blocked after approval but before
release is still refused.

One subtlety cost real debugging and is worth recording. Expiry and re-check
denial both *record a state change* and *fail the call*. Throwing from inside
the store transaction rolled back the very transition the error was reporting,
leaving instructions pending forever. Both now return an outcome from the
transaction and throw after it commits.

## Trade-offs taken knowingly

- **The memory store is the default.** `npm start` and `npm test` need no
  database, which keeps the controls testable in milliseconds. It is not a
  backend for real balances and `/readyz` says so, unprompted.
- **One registry, three segments.** Separate consumer/business/institutional
  systems would let each move faster alone and guarantee divergence in the
  controls. The segment decides what a customer is *offered*; the mandate
  decides what they may *use*. Those stay separate concerns.
- **Transactions are fully serialised in the memory store.** No isolation level
  to reason about, no lost updates, and no concurrency throughput. Postgres
  gives real transactions; the memory store gives obvious correctness.
- **Screening fails closed with no override.** There is no configuration that
  turns it off. "The screening service was down" is not a defence a bank gets
  to make, so an unavailable screening result is a denial.

## Where this would go next

In rough order of how much it blocks a real deployment, see
[RISK-AND-CONTROLS.md](RISK-AND-CONTROLS.md). The short version: real
authentication and step-up, the bank's own screening and KYC, an external
anchor for the audit chain, row-level security as a second isolation layer,
and an eval suite over the agent layer — because none of the tests here assert
anything about model *quality*, only about the wiring around it.
