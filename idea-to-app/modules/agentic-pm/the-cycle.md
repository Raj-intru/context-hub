# The cycle — five steps, two gates

Read the legend first, because it is the content: **what agents do, what your
team decides, and that every release feeds the next cycle.**

---

## Step 1 · Gather every signal — agents, around the clock

Six standing agents, each with one beat:

| Agent | Watches |
| --- | --- |
| Market research | competitors, trends, pricing |
| Customer signal | interviews, support tickets, requests |
| Portfolio | goals, initiatives, strategic bets |
| Engineering | tech debt, platform ideas |
| Analytics | usage, funnels, drop-offs |
| Metrics | what the last release actually did |

**The hard part is not gathering. It is not drowning.** An agent that runs around
the clock will produce more signal than any team can read, and a backlog fed
straight from it becomes noise within a fortnight. Three rules keep it usable:

1. **Every signal carries a source and a date.** A claim with no source is not a
   signal, it is a summary. Teams that skip this spend Gate A arguing about
   whether something is true.
2. **Signals decay.** A support theme from March is not evidence in November
   unless it recurred. Give each signal a half-life and let old ones fall off.
3. **An agent may raise a signal. It may not create a backlog item.** Those are
   different objects, and collapsing them is how the backlog stops being a
   decision queue and becomes an inbox.

**Teach this:** the sixth agent — the one that reports what the last release did —
is the one that turns a funnel into a loop. Without it you have a very fast way
of generating opinions.

---

## Step 2 · Rank the backlog — agents turn signals into a ranked list

One list. Four kinds of item in it, deliberately:

- **Strategic bet** — from the portfolio agent
- **Customer request** — from the customer signal agent
- **Tech debt** — from the engineering agent
- **Analytics finding** — from the analytics agent

**The mixing is the point, and it is the part teams resist.** Most organisations
keep tech debt in a separate list, which is a quiet way of saying it never
competes and therefore never wins. Putting all four in one ranked list forces the
trade-off into the open, where a human has to make it on the record.

The ranking is a **proposal**, not a decision. Say that out loud every time, or
step 4 becomes a formality.

---

## Step 3 · Cost every option — agents

Each candidate is costed in three dimensions: **money, weeks, and expected
movement in a metric.** The method is in `scoring.md`.

Two rules that are not on the poster and should be:

- **At least three options for the same outcome**, not three different features.
  "Ship the full thing", "ship the cheap version", "buy it instead" are options.
  Three unrelated features are a backlog, and choosing between them is not a
  design decision.
- **"Do nothing" is costed too.** It is never free — it has a cost in churn, in
  support load, in the competitor who ships it. A team that cannot state the cost
  of doing nothing does not yet understand the problem.

---

## Step 4 · Gate A — the product lead picks one 🧑

**A human decision. This one does not get automated, delegated to a score, or
taken by whoever is in the room.**

The lead picks one option and records four things:

1. **Which one**, and the date.
2. **Why not the other two.** This is the test of whether a decision happened. A
   lead who cannot say why not the alternatives has ranked, not decided.
3. **The metric that will say whether this worked** — one, named, already being
   measured.
4. **The date of the Gate B review.** Set now, not later.

> A pick with no named metric and no review date is not a decision. It is a
> preference with a budget.

**Teach this:** if the team's agents produce a single composite score and the
lead picks whatever sits at the top, Gate A has been deleted and the ceremony
kept. `scoring.md` explains why the three numbers are shown separately and never
summed.

---

## Step 5 · Agents build and measure — your team reviews the result

Three moves, each with a named human attached:

| Move | Who | What comes out |
| --- | --- | --- |
| **Shape the slice** | Architect + agents | A product slice: epic, stories, acceptance criteria |
| **Build and ship** | Engineer + agents | The thing, in users' hands |
| **Measure the outcome** | Agents track, lead reviews | Conversion, retention, LTV |

**The slice has one constraint above all others: it must be small enough to
produce a signal before the Gate B date you already set.** A slice that cannot be
measured by then is the wrong slice, however good it is — split it or move the
date deliberately, but do not discover this at the review.

---

## Gate B · Outcome review 🧑

The second human decision, and the one teams skip. Three honest outcomes:

| Verdict | What it means | What happens |
| --- | --- | --- |
| **It worked** | The metric moved as predicted, or better | Scale it; feed the result to the portfolio agent |
| **It did not** | The metric did not move, or moved the wrong way | Stop. The original signal goes back into step 1, now with evidence |
| **We cannot tell** | The slice was too big, too slow, or the metric was wrong | **A process failure, not a neutral result.** Name which of the three it was, and fix it before the next cycle |

That third row is the one worth teaching hardest. "We cannot tell" gets recorded
as a soft success in most organisations, and it is the single most expensive habit
in product management: it costs you the cycle *and* the learning.

---

## The loop

**Metrics feed step 1.** The metrics agent reports what the last release did, the
portfolio agent reacts, and the next ranking is better informed than the last.

A cycle that does not close is a funnel: fast, confident, and learning nothing. If
you teach one thing from this diagram, teach the dotted line on the right.
