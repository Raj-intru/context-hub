# Risk and controls

What is actually built, what is deliberately stubbed, and what a bank would
have to do before this touched a real balance. Read this before repeating any
claim from the README in a document that matters.

## Controls that are built and tested

| Control | Where | Reason codes | Test |
|---|---|---|---|
| Authority to act at all | `kernel/mandates.js` | `NO_MANDATE`, `MANDATE_CAPABILITY_NOT_GRANTED`, `MANDATE_ACCOUNT_NOT_GRANTED` | `mandates.test.js`, `policy.test.js` |
| Mandate time window | `mandates.js` | `MANDATE_OUTSIDE_HOURS`, `MANDATE_OUTSIDE_DAYS`, `MANDATE_EXPIRED`, `MANDATE_NOT_YET_EFFECTIVE` | `mandates.test.js`, `kernel.test.js` |
| Per-instruction limit | `policy.js` | `PER_TRANSACTION_LIMIT_EXCEEDED` | `policy.test.js` |
| Daily / monthly velocity | `policy.js` | `DAILY_LIMIT_EXCEEDED`, `MONTHLY_LIMIT_EXCEEDED` | `policy.test.js` |
| Currency not authorised | `policy.js` | `CURRENCY_NOT_AUTHORISED` | `policy.test.js` |
| Unattended high risk needs a ceiling | `policy.js` | `HIGH_RISK_UNBOUNDED` | `policy.test.js` |
| Payee allowlist | `policy.js` | `COUNTERPARTY_NOT_ALLOWLISTED` | `policy.test.js` |
| New-payee cooling-off | `policy.js` | `COUNTERPARTY_IN_COOLING_OFF` | `policy.test.js`, `e2e.mjs` |
| Screening, failing closed | `kernel/screening.js` | `SCREENING_BLOCKED`, `SCREENING_UNAVAILABLE`, `SCREENING_REVIEW`, `SCREENING_STALE` | `policy.test.js`, `kernel.test.js` |
| Re-screening at execution (runs, files) | `capabilities/business.js`, `institutional.js` | `RUN_SCREENING_BLOCKED`, `FILE_SCREENING_BLOCKED` | `kernel.test.js` |
| Duplicate-instruction detection | `kernel/engine.js` | `POSSIBLE_DUPLICATE` | `kernel.test.js` |
| Available funds | `policy.js` + `ledger.js` | `INSUFFICIENT_FUNDS`, `LEDGER_INSUFFICIENT_FUNDS` | `policy.test.js`, `ledger.test.js` |
| Account status | `policy.js` + `ledger.js` | `ACCOUNT_FROZEN`, `ACCOUNT_CLOSED`, `ACCOUNT_NOT_OWNED` | `policy.test.js`, `ledger.test.js` |
| KYC completeness | `policy.js` | `KYC_INCOMPLETE` | `policy.test.js` |
| Cut-off and value date | `util/time.js` + `policy.js` | `VALUE_DATE_ROLLED` | `policy.test.js` |
| Dual control, N-of-M | `kernel/approvals.js` | `DUAL_CONTROL_REQUIRED` | `approvals.test.js`, `e2e.mjs` |
| Segregation of duties | `approvals.js` | `APPROVAL_SELF`, `APPROVAL_DUPLICATE`, `APPROVAL_NOT_AUTHORISED` | `approvals.test.js` |
| Approval expiry | `approvals.js` | `APPROVAL_EXPIRED` | `approvals.test.js` |
| Re-evaluation on release | `engine.js` | `RECHECK_DENIED` | `approvals.test.js` |
| Idempotency | `engine.js` + `ledger.js` + unique index | `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_CONFLICT` | `kernel.test.js`, `e2e.mjs` |
| Agent cannot grant authority | `routes/mandates.routes.js` | `FORBIDDEN` | `e2e.mjs` |
| Agent cannot approve | `routes/approvals.routes.js` | `FORBIDDEN` | `e2e.mjs` |
| Agent offered only mandated tools | `agent/runtime.js` | `NOT_IN_SCOPE` | `agent.test.js` |
| Closed argument schemas | `kernel/schema.js` | `CAPABILITY_BAD_ARGS` | `schema.test.js` |
| Double-entry balance | `ledger.js` + deferred DB trigger | `LEDGER_UNBALANCED` | `ledger.test.js` + SQL |
| Append-only journal and audit | DB triggers | — | SQL |
| Tamper-evident decision log | `kernel/audit.js` | — | `audit.test.js` |
| Atomic submit-decide-post-audit | re-entrant store transactions | — | `audit.test.js` |

## Prompt injection: why the mitigation is structural

The agent reads customer text, payee names, payment references and document
content. Any of it can contain instructions.

This build does not rely on detecting that. It relies on there being nothing to
escalate to:

- **No capability grants authority.** Mandate administration is not in the
  registry, so it has no tool definition and the agent is never offered it. The
  route refuses non-human callers outright.
- **No capability approves anything.** Same.
- **The tool set is the intersection of segment and mandate.** Text cannot name
  a tool the agent does not hold.
- **The policy engine does not read prompts.** It is a pure function over a
  materialised context.
- **Arguments are schema-closed.** `additionalProperties: false` on every
  capability, asserted for all of them in `schema.test.js`, so an injected
  `"skipScreening": true` is a validation error rather than a field someone
  might one day honour.

What is left is the agent being *persuaded to misuse a capability it legitimately
holds* — paying the wrong payee the right way. The controls above are what bound
that: limits, allowlists, cooling-off, duplicate detection, dual control. The
residual risk is real and is not eliminated by this design.

The prompt also names structuring explicitly — splitting a refused payment into
several permitted ones — because an agent that "helpfully" works around a limit
is the single most plausible way this goes wrong in production. That is a
prompt-level mitigation, which means it is a weak one. **It is not tested here,
because this repo has no eval suite over model behaviour.** See the gaps below.

## Deliberately stubbed

| Thing | What is there | What it is not |
|---|---|---|
| **Authentication** | `middleware/auth.js`: an HMAC token when `AUTH_SECRET` is set, trusted identity headers when it is not | No customer login, no device binding, no token refresh or revocation, no mTLS on the API channel, no step-up for a high-value instruction. It establishes *who is calling* well enough to exercise the kernel. |
| **Screening** | `kernel/screening.js`: a local demo list of three names and a few jurisdictions | **Not a sanctions list.** No PEP, no adverse media, no fuzzy matching, no name transliteration, no false-positive workflow. |
| **KYC** | a `kycStatus` field the policy engine reads | No identity verification, no beneficial-ownership checks, no periodic review. |
| **FX rates** | `services/fx.js`: a static book with per-segment spreads | Not a pricing engine. No market data, no position or risk limits, no credit check on a forward. |
| **Rails** | cut-off and lag metadata, and a clearing/nostro leg in the ledger | Nothing is sent anywhere. No NPP, no SWIFT, no ISO 20022 message generation, no returns, no investigations. |
| **Rate limiting** | `middleware/rateLimit.js`, fixed window, in-process | Per-instance, so behind more than one instance it is a speed bump. |
| **Memory store** | the default, fully serialised, atomic rollback | No durability, no cross-process visibility. `/readyz` reports this as a blocker without being asked. |

## Gaps that would block a real deployment

Roughly in order of how much they block.

1. **No eval suite over the agent layer.** Every test here asserts the
   *wiring* — that a tool call becomes a kernel submission, that the kernel's
   answer is what reaches the model. None asserts anything about model
   *quality*: whether it picks the right capability, reads an ambiguous
   instruction correctly, or honours the "do not retry a refusal" rule under
   pressure. For an agent-first bank that is the central question and it is
   unanswered here. It needs a graded set of real customer utterances, scored
   per segment, run on every prompt or model change.
2. **No real authentication or step-up.** Above.
3. **No external anchor for the audit chain.** Tamper-evident against row
   edits; rebuildable by anyone who can rewrite the whole table.
4. **No row-level security.** Tenant isolation is enforced in the kernel by
   mandate resolution — one layer. The generated `entity_id` columns exist so
   RLS can be added as a second, independent one, and it should be: defence in
   depth means not trusting the application to be the only thing between two
   customers.
5. **No payment-rail integration**, and therefore no handling of the states
   that actually generate customer contact: returns, recalls, investigations,
   partial settlement, correspondent charges deducted downstream.
6. **No reconciliation against an external source of truth.** The ledger here
   *is* the truth. A real bank reconciles to a core and to nostro statements,
   and the interesting failures live in the break.
7. **No key management, encryption at rest, or data retention policy.**
8. **No model-failure runbook.** What the bank does when the provider is down,
   rate-limited, or returns a refusal mid-instruction. The code surfaces
   `LLM_REFUSAL` and `LLM_SDK_MISSING`; there is no degraded mode behind them.
9. **Reads cost a `proposals` row.** Uniform and auditable, but heavy. A real
   deployment would split read audit into a cheaper sink.
10. **No customer-facing explainability surface.** The decision and its reasons
    are stored and returned; there is no statement-level "why did my agent do
    this" view, which is what a regulator will eventually ask for.

## Claims that must not be made from this repo as it stands

- Anything about **sanctions screening**, **AML** or **CTF** compliance.
- Anything about **SOC 2**, **ISO 27001**, **PCI DSS** or **APRA CPS 234**.
- "**Bank-grade security**" — there is no authentication worth the name.
- "**Regulator-ready audit trail**" — tamper-evident is not tamper-proof, and
  there is no external anchor.
- Any **availability or durability** figure. The default store is in-process
  memory.
- Any claim that the **agent is safe**. The *kernel* constrains the agent. The
  agent's own judgement is untested here.

What can fairly be said: this is a working reference implementation of an
agent-first banking architecture in which a language model cannot move money,
every instruction is policy-checked by a deterministic and unit-tested kernel,
authority is explicit and revocable, and every decision is recorded in a
tamper-evident chain — with 109 unit tests, 24 end-to-end journeys across three
segments, and the database's own invariants verified in SQL.
