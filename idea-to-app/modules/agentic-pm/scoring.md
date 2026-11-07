# Scoring — how agents cost an option before anyone decides

Three numbers per option: **cost**, **time to market**, **value**. They are shown
side by side and they are never added together. The reason is at the bottom, and
it is the most important page in this module.

---

## 1 · Cost — what it takes to build *and run*

| Part | How to get it | Who usually forgets it |
| --- | --- | --- |
| **Build — people** | People-weeks × loaded weekly rate | Nobody |
| **Build — agents** | Agent spend during the build | Almost everybody |
| **Run — infrastructure** | Hosting, storage, third-party services, per year | Nobody |
| **Run — agents** | Agent spend per month × 12 | Almost everybody |
| **Run — people** | Support load, on-call, the monthly half-day somebody now owns | Almost everybody |

**The run cost of the agents is the new line, and it is the one that moves a
decision.** A feature whose build is cheap and whose per-use agent spend is
proportional to traffic has a completely different shape from a feature that
costs a lot once. Classic cost models were built for the second kind and quietly
assume the first does not exist.

This is measurable rather than guessable: it is exactly what the cost and
performance dashboard in `../../demo/sme-dashboard.md` exists to report. **Cost
per outcome from a live feature is the best estimate you will ever have for the
next one.** A team running that dashboard is scoring from evidence; a team
without it is scoring from memory.

State cost as a **range**, never a point. `€40–70k build · €1.2–2.0k/mo run`.

---

## 2 · Time to market — and time to *signal*

Two numbers, not one. The poster says it in a half-sentence that is easy to miss:
*how soon users see it, **and how soon we learn whether it worked**.*

| Number | The question |
| --- | --- |
| **Weeks to users** | When can somebody use this? |
| **Weeks to signal** | When will we know whether it mattered? |

They come apart more often than people expect. A feature that ships in two weeks
but needs a quarter of traffic to show a conversion effect has a **time to signal
of thirteen weeks**, and planning the next cycle as though you will know in two
is how a roadmap becomes fiction.

**Weeks to signal is what you put in the Gate B date.** Not weeks to users.

---

## 3 · Value — expected movement in a named metric

> Expected move in product metrics: conversion ↑, LTV ↑, churn ↓ — weighted by
> strategic fit.

Make an agent produce four things, and refuse the score without all four:

1. **The metric.** One, named, already instrumented. "Engagement" is not a metric.
2. **The expected move, as a range.** "Checkout conversion 2.1% → 2.4–2.8%."
3. **The confidence**, in words with fixed meanings — agree them once as a team:
   *measured* (we have run this before), *comparable* (someone credible has),
   *argued* (a chain of reasoning, no data).
4. **The strategic fit weight**, from the portfolio agent, against a stated goal.

Then show the working. **A score whose source cannot be inspected is not evidence,
it is confidence with a number attached** — and an agent will produce that all
day. The signals behind each claim carry a source and a date for exactly this
moment.

---

## The rule that protects Gate A

> **Never sort the options by a single composite score.**

It is tempting, it is one line of code, and it ends the practice. Here is the
mechanism:

A composite forces you to fix the exchange rate between a euro, a week and a
basis point of conversion — permanently, in advance, for every decision. But that
exchange rate *is* the strategy, and it is different in a quarter where you are
defending a position from one where you are entering a market. Freezing it into a
formula does not remove the judgement; it hides it in a weighting nobody revisits
and applies it to decisions it was never meant for.

So: three columns, every time. The lead reads all three and picks. That moment of
looking at an expensive option with a fast signal next to a cheap one with a slow
signal, and choosing — **that is the job**. It is the only part of this cycle that
is not automatable, which is precisely why it is the part worth protecting.

**The symptom to watch for:** when Gate A's "why not the other two" starts reading
*"because it scored lower"*, the gate is already gone.

---

## The option sheet

One per option. Three on a page at Gate A. Template in
`templates/option-sheet.md`.

| | Option A: ship it | Option B: cheap version | Option C: do nothing |
| --- | --- | --- | --- |
| Build cost | €40–70k | €12–18k | €0 |
| Run cost / year | €14–24k | €6–9k | €0 |
| Weeks to users | 9 | 3 | — |
| **Weeks to signal** | 13 | 7 | — |
| Metric | checkout conversion | checkout conversion | — |
| Expected move | 2.1% → 2.4–2.8% | 2.1% → 2.2–2.4% | 2.1% → 1.9–2.1% |
| Confidence | comparable | argued | measured |
| Strategic fit | high — retention goal | high | — |

Note what the table makes impossible to avoid: **doing nothing has a cost**, the
cheap version reaches a signal six weeks sooner, and the expensive option's
confidence is weaker than the one for doing nothing. None of that survives being
summed into a single number.
