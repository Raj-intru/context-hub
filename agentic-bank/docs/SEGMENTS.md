# Segments: one bank, three jobs

One registry, one kernel, one ledger. What differs per segment is the
capability set offered, the agent's brief, and the shape of the delegation a
customer actually wants.

The segment decides what a customer is **offered**. The mandate decides what
they may **use**. Keeping those separate is what lets a business customer hold
an agent on a tighter leash than a consumer, rather than inheriting whatever
the tier implies.

## Consumer

**The bet:** not "a chatbot in front of the app". It is that a customer states
an outcome — *"can I afford rent"*, *"stop anything I'm paying for twice"*,
*"keep two thousand in everyday and the rest earning interest"* — and the bank
configures the mechanics.

| Capability | Risk | Notes |
|---|---|---|
| `accounts.list` / `accounts.balance` / `accounts.statement` | read | Available balance, not cleared — they differ by holds |
| `counterparties.add` / `counterparties.list` | medium / read | Screened on creation, then a cooling-off period |
| `transfers.internal` | medium | Between own accounts, settles immediately |
| `payments.domestic.initiate` | high | NPP, cut-off 22:00 |
| `cards.freeze` | low | Instant and reversible, so it is cheap to get wrong |
| `cards.limit.set` | medium | Raising a limit is neither instant nor reversible |
| `savings.sweep.configure` | medium | Creates a standing rule; each run is itself policy-checked |
| `subscriptions.review` | read | Finds recurring debits; cancelling is a separate instruction |
| `disputes.raise` | medium | Opens a dispute against a posted transaction |

**Delegation shape:** one mandate, `execute_within_limits`, modest
per-instruction and daily caps, any payee. The customer is their own approver,
so a cooling-off payment is a single tap rather than a workflow.

**The design pressure here is honesty, not capability.** The two most damaging
things a consumer agent can do are say "done" when an instruction is parked,
and say "it'll be there today" when the rail has closed. Both are structural in
this build: a parked instruction comes back labelled `NOT DONE`, and every
payment result carries the value date the bank will actually apply.

## Business

**The bet:** an SME's problem is not a nicer app, it is that working-capital
management is a weekly manual chore. Who do I owe, who owes me, will I make
payroll, do I draw on the facility.

| Capability | Risk | Notes |
|---|---|---|
| `cashflow.forecast` | read | Walks the horizon day by day and returns the **low point and its date** |
| `receivables.aging` | read | Bucketed by how overdue |
| `limits.utilisation` | read | Facility headroom |
| `payables.run.prepare` | high | A set of payables as **one** instruction |
| `payroll.fund` | high | Separate from a general run, so it carries its own limit and approvers |
| `fx.quote` / `fx.book` | low / high | Wider spread than institutional |
| + the consumer set | | cards, payments, transfers |

**Delegation shape:** `execute_within_limits` with a meaningful ceiling, plus
`dualControl` at a threshold — in the demo, AUD 75k per instruction and two of
three named humans above AUD 50k.

Two deliberate design choices:

- **A payment run is one policy decision, not one per supplier.** If the total
  needs approval, the run waits as a unit. Half-paying a supplier list is worse
  than paying none of it, and a treasurer already thinks of the run as the
  object.
- **Payees are re-screened at execution**, not just at registration. A run
  approved an hour ago must not pay a payee blocked since. If any line fails,
  the whole run halts — asserted in `test/kernel.test.js`.

## Institutional

**The bet:** this is where agentic stops being a convenience and becomes the
product. A group treasurer's day is a sequence of queries across systems that
do not talk to each other, followed by instructions that need two signatures,
against cut-offs that do not move.

| Capability | Risk | Notes |
|---|---|---|
| `liquidity.position` | read | Across the group, by currency **and** entity, plus facility headroom |
| `limits.utilisation` | read | Facilities and intraday payment limits |
| `tradefinance.lc.status` | read | Documentary credits, utilisation, expiry, discrepancies |
| `fx.quote` | low | Firm, stored, time-limited |
| `fx.book` | high | Must reference an open, unexpired quote of its own |
| `payments.crossborder.initiate` | high | SWIFT, cut-off 16:00, **T+1**, fee quoted up front |
| `payments.file.submit` | high | Host-to-host bulk, all-or-nothing |
| + the business set | | forecast, runs, payroll |

**Delegation shape:** two mandates, split by whether value moves. See the
worked example in [MANDATES.md](MANDATES.md).

Four things this segment forces that the others do not:

1. **Group-wide visibility is a property of the customer record, not of the
   request.** `liquidity.position` spans the group only when the calling entity
   is marked `groupTreasury`. An agent cannot widen its own view by changing
   arguments — asserted in `test/e2e.mjs`, where the subsidiary gets nothing.
2. **Quote, then book against the quote id.** A booking cannot name its own
   rate. An agent that could would be an agent that could give away the spread.
   Quotes are consumed once, by the entity they were given to, before expiry.
3. **Cut-offs are stated, not discovered.** Every rail declares its cut-off and
   lag, and the decision carries the resolved value date. *"Same day if
   instructed in the next 40 minutes, otherwise T+1"* is the useful sentence,
   and the bank can produce it before the client commits via `/preview`.
4. **Which legal entity pays is never a convenience.** Treasury efficiency is
   not a reason to pay from the wrong entity, and the agent's brief says so.

## What the agent's brief changes per segment

`src/agent/packs.js` holds one prompt per segment over a shared set of rules.
The shared rules are about honesty — report the kernel's outcome, never retry a
refusal by another route, never invent an id, amounts as strings. The
segment-specific part is about *what to lead with*:

- Consumer: a number and a yes or no.
- Business: the cash low point and its date, before the closing balance.
- Institutional: the position by currency and entity, and the cut-off.

None of this is a control. The kernel does not trust a word of it. Its job is
to make the agent useful; safety is structural.
