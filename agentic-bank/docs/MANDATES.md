# Mandates: delegated authority

A mandate is the answer to *"on whose authority?"*. It is the object that makes
an agentic bank possible, and it is the one most likely to be missing from a
demo that looks impressive.

## The grant

```jsonc
{
  "entityId":   "ent_...",                      // the principal: a legal entity
  "grantee":    { "type": "agent", "id": "agt_..." },  // or { "type": "user", ... }
  "grantedBy":  "usr_...",                      // a person able to bind the entity
  "autonomy":   "execute_within_limits",
  "capabilities": ["accounts.*", "payments.domestic.initiate"],
  "accounts":   ["*"],
  "limits": {
    "perTransaction": { "AUD": "2500.00" },
    "daily":          { "AUD": "5000.00" },
    "monthly":        { "AUD": "40000.00" }
  },
  "counterparties": { "mode": "allowlist", "ids": ["cpt_..."] },
  "dualControl": {
    "thresholdAbove":   { "AUD": "50000.00" },
    "requiredApprovals": 2,
    "approvers":        ["usr_a", "usr_b", "usr_c"]
  },
  "window": {
    "timeZone": "Australia/Sydney",
    "days":     ["Mon", "Tue", "Wed", "Thu", "Fri"],
    "hours":    { "from": "07:00", "to": "19:00" },
    "notAfter": "2027-06-30T00:00:00.000Z"
  }
}
```

## Autonomy levels

| Level | Meaning |
|---|---|
| `propose_only` | The grantee may read and may draft. Every mutating action waits for a human. |
| `execute_with_approval` | The grantee may raise instructions, but each one needs approval before it lands. |
| `execute_within_limits` | The grantee may execute unattended, inside its limits. |

A read is permitted under all three. `propose_only` restricts *mutation*, not
visibility — an agent that cannot see the position cannot usefully propose
anything about it.

## The rule that matters most

**A high-risk capability runs unattended only where the mandate says
`execute_within_limits` *and* carries a per-instruction limit in the
instruction's own currency.**

Without the second half, `execute_within_limits` would mean "unbounded", and a
customer who granted it for AUD payments would discover it also authorised an
unbounded USD one. A mandate with no ceiling in the instruction's currency
falls back to a human, with reason code `HIGH_RISK_UNBOUNDED`.

This is the control that makes the limit a decision the customer *made* rather
than a default they *inherited*.

## Resolution, and why the most restrictive wins

When several mandates cover the same action, `resolve()` returns the one with
the **most restrictive** autonomy:

```
propose_only  <  execute_with_approval  <  execute_within_limits
```

Granting a broad mandate must never silently upgrade an action that a narrow
one already governed. The alternative — most permissive wins — turns every new
grant into an unreviewable widening of everything that came before it.

Resolution also returns `rejected`: every mandate that was considered and the
reason it did not apply. That is what a customer sees when an agent says "I
can't do that". A refusal with no explanation is a support ticket; a refusal
that names the limit is self-service.

## Dual control, and what "two approvals" has to mean

- **N-of-M.** `requiredApprovals` distinct approvers from the `approvers` list.
- **Segregation of duties.** The initiator can never approve, even when they
  are on the list. Without that, "two approvals" is one person clicking twice.
- **No self-approval by an agent, ever.** `POST /v1/approvals/:id/decision`
  refuses any caller whose actor type is not `user`.
- **One rejection kills it.** There is no "majority".
- **Approvals expire** (24h by default) and an expired instruction is marked
  `expired`, not left pending.

### Thresholds and instructions with no amount

A threshold table describes *amounts*. An instruction with no risk amount — a
rate request, a card freeze, a standing-rule change — is not an instruction the
threshold describes, so it does not trigger dual control; the autonomy level
still governs it.

This is not a loophole, it is the difference between a usable system and an
unusable one. An FX quote lives for ninety seconds. A mandate whose payment
threshold also demanded two signatures to *ask for a rate* would never book
anything, and no treasury would adopt it.

A mandate with **no** `thresholdAbove` at all means "always two signatures",
unconditionally.

## Mandate usage is measured on instructions, not postings

Daily and monthly consumption is summed from **executed proposals**, not from
ledger postings. The limit is on what the agent *instructed*, which is the
thing a customer reasons about. A payment that was instructed and later
returned still consumed that day's authority.

A refused instruction consumes nothing — asserted in
`test/mandates.test.js`.

## Who can change a mandate

Only a person. `POST /v1/mandates` and `DELETE /v1/mandates/:id` refuse any
caller whose actor type is not `user`.

There is no capability in the registry for granting authority, which means
there is no tool definition for it, which means the agent is never offered it.
An agent cannot widen, extend or create a mandate — including its own.

This is the structural reason prompt injection does not escalate here. The
mitigation is not a filter that detects malicious text; it is that the thing
the text would ask for does not exist as a reachable action.

## Worked example: the seeded institutional client

The demo's Meridian Group Treasury holds **two** mandates for one agent,
deliberately split, because this is how a treasury actually delegates:

| | Reporting & pricing | Approved execution |
|---|---|---|
| Autonomy | `execute_within_limits` | `execute_with_approval` |
| Capabilities | reads, `liquidity.position`, `cashflow.forecast`, `tradefinance.lc.status`, `fx.quote` | `fx.book`, `payments.crossborder.initiate`, `payments.file.submit`, `transfers.internal` |
| Dual control | — | 2 approvals above AUD 1m / USD 750k / EUR 500k |
| Window | Mon–Fri 07:00–19:00 Sydney | Mon–Fri 07:00–19:00 Sydney |

In one sentence: *the agent may look at anything and ask for a price
unattended; it may not deal or pay without us.*

And a third mandate, for a person: the treasurer holds `propose_only` over
reads. She approves instructions; she is not the one raising them. That is
segregation of duties expressed in data rather than in a process document.
