# Gate B — outcome review

**Reviewed by:** [name, role] · **Date:** [date]
**Decision being reviewed:** [link to the Gate A record] · **Shipped:** [date]

## What we predicted, and what happened

| | Predicted at Gate A | Actual |
| --- | --- | --- |
| Metric | [name] | [name] |
| Move | [range] | [actual] |
| Weeks to signal | [n] | [n] |
| Cost | [range] | [actual, build and run so far] |

## Verdict — one of three

- [ ] **It worked.** The metric moved as predicted or better.
      → Scale it. Send the result to the portfolio agent.
- [ ] **It did not.** The metric did not move, or moved the wrong way.
      → Stop. The original signal returns to step 1 with this evidence attached.
- [ ] **We cannot tell.** → **A process failure, not a neutral result.** Name
      which: the slice was too big · the signal was too slow · the metric was
      wrong. Fix that cause before the next cycle starts.

**Named cause (if we cannot tell):** [which of the three, and what changes]

## What the next cycle inherits

- [What the metrics agent now reports]
- [What the portfolio agent should reconsider]
- [What we now know about our own estimates — were the costs right? the weeks?]

That last line is how a team's scoring gets better. It is also the first thing
dropped when reviews are rushed.
