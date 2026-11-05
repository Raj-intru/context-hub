---
description: Review what the app costs, how fast it is and how much load it can take, then update the Ops Card
disable-model-invocation: true
---

Run the cost, speed and load review. Read `guardrails/cost.md`,
`guardrails/performance.md` and `guardrails/scale.md`, then obey every rule in
`AGENTS.md`.

1. Open `project-docs/ops-card.md`. Create it from `templates/ops-card.md` if it
   does not exist yet.
2. Ask the learner to open each dashboard — hosting, database, and any paid
   service — and read you the numbers: spend this month, and how much of the free
   allowance is used. One at a time. You never need their password, and you never
   ask for it.
3. Measure the speed yourself on the live or preview link, against the budget in
   `spec.md`. Report seconds, not impressions.
4. Fill in the Ops Card with what you were told and what you measured. Leave
   anything you could not verify blank rather than guessing.
5. Check the verdict list at the bottom: caps and alerts on every paid service,
   rate limits on anything a stranger can trigger, speed budgets met, shutdown
   steps still correct.
6. Tell the learner, in five lines or fewer: what this month cost, the worst case,
   whether anything is over budget, and the one thing to fix first.

If anything needs fixing, propose it and wait for a yes before changing the app.
