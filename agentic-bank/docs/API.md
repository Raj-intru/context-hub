# API

Three surfaces over one kernel. Nothing has a privileged path.

## Identity

Demo shim — see [RISK-AND-CONTROLS.md](RISK-AND-CONTROLS.md).

With `AUTH_SECRET` set, send `Authorization: Bearer <token>` (mint one with
`issueToken()` from `src/middleware/auth.js`). Without it, local only:

```
X-Bank-Entity:      ent_...      # the customer being acted for
X-Bank-Actor-Type:  agent | user
X-Bank-Actor-Id:    agt_... | usr_...
```

An identity may only ever act for its own customer.

## Conventions

- **Amounts are decimal strings** at the currency's exact precision:
  `"1250.00"`. A JSON number is a 400. Excess precision is a 400.
- **Mutating calls require `Idempotency-Key`.** Replaying a key returns the
  stored response with `"replayed": true`. The same key with different
  arguments is a `409 IDEMPOTENCY_CONFLICT`.
- **A 200 does not mean money moved.** Read `status`.

```jsonc
{
  "status": "executed" | "pending_approval" | "denied" | "dry_run",
  "explanation": "Needs 2 approval(s): ...",
  "proposalId": "prp_...",
  "summary": "Pay EUR 750,000.00 to Hanseatic Components GmbH via SWIFT",
  "result": { /* only when executed */ },
  "valueDate": "2026-11-06",
  "decision": {
    "outcome": "require_approval",
    "policyVersion": "2026-11-01",
    "reasons": [{ "code": "DUAL_CONTROL_REQUIRED", "severity": "approval", "message": "..." }]
  },
  "approval": { "id": "apv_...", "required": 2, "approvers": ["usr_a"], "expiresAt": "..." },
  "replayed": false
}
```

`severity` is `block` (contributes to a denial), `approval` (contributes to a
hold) or `info`. A denial lists **every** blocking reason, not just the first.

## Health

| | |
|---|---|
| `GET /healthz` | liveness |
| `GET /readyz` | store backend, capability count, agent provider, and an unprompted production-readiness verdict |

## The agentic surface

### `POST /v1/agent/turns`

One conversational turn. The mobile client is a client of *this*, not of a
separate screen-shaped API.

```jsonc
// request
{ "message": "pay the suppliers due this week", "history": [], "sessionId": null }

// response
{
  "turnId": "trn_...",
  "reply": "...",
  "stoppedBecause": "end_turn" | "max_steps" | "refusal",
  "steps": [
    { "step": 0, "capabilityId": "payables.run.prepare", "status": "pending_approval",
      "proposalId": "prp_...", "decisionOutcome": "require_approval",
      "reasonCodes": ["DUAL_CONTROL_REQUIRED"] }
  ],
  "capabilitiesInScope": ["accounts.list", "..."],
  "model": "claude-opus-5-5",
  "provider": "anthropic"
}
```

`steps` is the audit trail of the turn: what the agent attempted and what the
kernel decided. A turn that ran out of steps says so rather than going quiet.

### `GET /v1/agent/capabilities`

The agent-to-agent surface: what a **customer's own** agent needs to call the
bank directly. Served from the same registry the bank's agent uses, so the two
cannot drift.

Returns the segment `catalogue`, `inScopeForYou` (what this caller's mandates
actually permit — a different question), the caller's `mandates`,
`toolDefinitions` ready to pass to a model, and `conventions`.

## The capability surface

| | |
|---|---|
| `GET /v1/capabilities` | the catalogue for the caller's segment |
| `POST /v1/capabilities/:id/preview` | decide without creating anything |
| `POST /v1/capabilities/:id/execute` | submit; `403` on a denial |

`/preview` runs validation, planning and the full policy decision, then stops.
It is how an agent tells a customer *"that would need two approvals and would
value tomorrow"* before committing.

## Approvals

| | |
|---|---|
| `GET /v1/approvals` | the pending queue, each item with `requestedBy` and `youMayApprove` |
| `POST /v1/approvals/:id/decision` | `{ "decision": "approve" \| "reject", "comment": "..." }` |
| `GET /v1/proposals?status=` | proposal history |
| `GET /v1/proposals/:id` | one proposal, with its decision |

A decision that completes the required approvals **releases the instruction in
the same call** — and re-evaluates it first, so conditions that changed since
it was raised still apply. The response carries `execution`.

Only a person can decide (`actor.type === "user"`), and never their own
instruction.

## Mandates

| | |
|---|---|
| `GET /v1/mandates` | the caller's mandates |
| `POST /v1/mandates` | grant — **person only** |
| `DELETE /v1/mandates/:id` | revoke — **person only** |
| `GET /v1/mandates/:id/usage` | daily and monthly authority consumed |

Limits are posted as decimal strings and parsed at the boundary:

```jsonc
{
  "grantee": { "type": "agent", "id": "agt_..." },
  "autonomy": "execute_within_limits",
  "capabilities": ["accounts.*", "payments.domestic.initiate"],
  "accounts": ["*"],
  "limits": { "perTransaction": { "AUD": "2500.00" }, "daily": { "AUD": "5000.00" } },
  "dualControl": { "thresholdAbove": { "AUD": "50000.00" }, "requiredApprovals": 2,
                   "approvers": ["usr_a", "usr_b"] },
  "window": { "timeZone": "Australia/Sydney", "days": ["Mon","Tue","Wed","Thu","Fri"],
              "hours": { "from": "07:00", "to": "19:00" } }
}
```

## Oversight

| | |
|---|---|
| `GET /v1/admin/audit?subjectId=&limit=` | decision log, scoped to the caller's customer |
| `GET /v1/admin/audit/verify` | recompute the hash chain; reports the first break and where |
| `GET /v1/admin/integrity` | journal balance, cached-balance drift, chain state |
| `GET /v1/admin/readiness` | what is not production-ready |

## Error shape

```jsonc
{ "error": "IDEMPOTENCY_CONFLICT", "message": "...", "details": { } }
```

| Status | When |
|---|---|
| 400 | bad arguments, malformed amount, unknown payee in a file |
| 401 | no or invalid identity |
| 403 | acting for another customer; an agent trying to approve or grant; a policy **denial** |
| 404 | unknown customer, capability, proposal or mandate |
| 409 | idempotency conflict, approval already decided, re-check denial |
| 422 | execution failed (insufficient funds at posting, expired quote) |
| 429 | rate limited |

A 500 never carries a message — the detail stays in the log.
