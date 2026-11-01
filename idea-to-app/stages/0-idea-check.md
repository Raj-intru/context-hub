# Stage 0 — Idea check

**Goal:** turn "I have an idea" into one sentence small enough to build, test and
ship in four weeks.
**Gate the learner signs:** *The idea fits four weeks.*
**Expect:** one session, 30–45 minutes.

## Before you start

Read `project-docs/progress.md`. If it is missing, create it from
`templates/progress.md`. Say in one line where the learner is.

## How to run it

Ask these one at a time. Wait for each answer. Keep your replies to two or three
sentences, and play back what you heard in their own words before moving on.

1. **The idea.** "In one or two sentences, what do you want to build?"
2. **The person.** "Who exactly is it for? Describe one real person you know who
   would use it."
3. **The pain.** "What do they do today instead, and what goes wrong?"
4. **The one job.** "If the app only did one thing, what would it be?"
5. **Proof it worked.** "A month after it is live, what would tell you it is
   working?" Push for something countable: five bookings taken, ten notes saved.
6. **Limits.** "Anything it must do, must not do, or must avoid? Money, privacy,
   a deadline?"

## Shrink it

Propose a four-week version as one sentence in this shape:

> **For** [the person] **who** [the pain], **this app lets them** [the one job]
> **so that** [the proof].

Then show two short lists and ask the learner to approve or change them:

- **In (weeks 1–4):** the smallest set of screens and behaviours that make the
  one job work from start to finish. Three to five items, one screen each where
  you can.
- **Later (version 2):** everything else they mentioned. Nothing is thrown away;
  it moves here.

If the "In" list will not shrink to three to five items, say so plainly and offer
two smaller versions to choose between. Never carry an oversized idea forward.

## Red flags — raise these now, kindly

Name the ones that apply, say what each means for four weeks, and offer the
smaller version instead.

| Flag | Why it hurts in four weeks | Smaller version |
| --- | --- | --- |
| Takes payments | Real money, refunds, tax, a payments review | Take an enquiry or booking; handle money off-app for now |
| Holds health, financial or children's data | Consent, retention and legal duties | Use made-up data for the demo, or hold far less |
| Needs two kinds of user at once (buyer *and* seller) | That is two apps, not one | Build one side; be the other side by hand |
| Needs an app in the phone stores | Review queues you do not control | A web app that works well on a phone |
| Depends on someone else's API | Accounts, keys, approvals, waiting | Type the data in by hand in version 1 |
| Only works once many people join | Nothing works until the crowd arrives | Make it useful for one person alone |

## Write it down

- `project-docs/progress.md` — created if missing, stage set to 0.
- `project-docs/spec.md` — from `templates/spec.md`. Fill *Problem*, *Must-have
  features* and *Out of scope* only. The rest is Stage 1's job.
- `project-docs/decision-log.md` — one entry for the shrink: what was cut, why.

## The gate

Ask exactly this, then wait:

> "Here is your four-week idea: [one sentence]. In scope: [list]. Saved for
> version 2: [list]. If that is right, reply **yes, the idea fits four weeks** —
> or tell me what to change."

Nothing but a clear yes to this question counts. When it comes, record it in
`project-docs/progress.md`: today's date, their exact words, a one-line summary.

## End the session

Update `progress.md`, give three bullets or fewer on what changed, then name the
one thing to do before next time:

> "Before Stage 1, find three people who have this problem and ask for fifteen
> minutes each. We need three conversations, not three yeses."
