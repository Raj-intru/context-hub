# Stage 1 — Spec

**Goal:** one page that says what the app does, for whom, and how you will know
it works — written so the learner can explain it without reading it.
**Gate the learner signs:** *Spec v1 approved.*
**Expect:** two sessions with three real conversations in between.

## Before you start

Read `project-docs/progress.md`. If the Stage 0 gate is not signed, say so kindly
and go back to `stages/0-idea-check.md`. Do not draft a spec from your own
assumptions.

## Part A — three real conversations

The learner does the talking; you prepare them and write up what comes back.

Give them five questions to ask, and tell them the rule: **ask about today, not
about your idea.** People are polite about ideas and honest about their week.

1. "Walk me through the last time you had to [the job]."
2. "What did you use? What did that cost you — time, money, worry?"
3. "What was the most annoying part?"
4. "Have you tried fixing it before? What happened?"
5. "If it were solved tomorrow, what would you stop doing?"

Then: "Do not pitch. If they ask what you are building, say 'I'm still
listening.'"

When they come back, take the three conversations one at a time and ask what the
person actually said. Write up, in `project-docs/spec.md` under *Users*:

- What all three agreed on. This is what you build.
- What only one person wanted. This goes to *Out of scope* for now.
- Anything that contradicts the Stage 0 idea. Say it straight: "Two of your three
  people already have a way to do this. Here is what I would change."

If the conversations break the idea, that is a good week, not a bad one. Offer
the revised one-sentence idea and log the change in
`project-docs/decision-log.md`.

## Part B — the one-page spec

Fill every section of `project-docs/spec.md`. Keep it to one page. Plain English
only — no technical words the learner has not asked about.

| Section | What goes in it | Rule |
| --- | --- | --- |
| Problem | The one-sentence idea from Stage 0, revised if the conversations changed it | One sentence |
| Users | Who it is for, in their own words, and what the three people agreed on | Three bullets |
| Must-have features | What the app must do for the one job to work | Three to five, no more |
| Screens | One line per screen: its name, and what the person does on it | Three to five |
| Data | Every piece of information the app saves, and why it needs it | If you cannot say why, do not save it |
| Out of scope | Everything agreed for version 2 | Add to this list freely |

Two rules on *Data*, and say them out loud:

- Name each item plainly ("the customer's phone number"), not as a field name.
- Anything about a real person needs a reason in the same line. No reason, no
  saving it. This list becomes the data review in Stage 3.

## Part C — acceptance checks

Turn each must-have feature into plain-English checks in
`project-docs/acceptance-checks.md`, in this shape:

> **When I** [do this], **I should** [see this].

Write the unhappy ones too — the empty form, the wrong date, the double tap.
Aim for six to twelve in total. Every check gets an automated test in Stage 2,
so if a check cannot be checked, rewrite it until it can.

## Part D — explain-back, then the gate

Before the gate, ask the learner to explain the spec back:

> "Without looking at the page — who is this for, what are the three things it
> does, and what does it save about people?"

If they cannot, that is your fault, not theirs. Simplify the spec and ask again.
Never explain it back for them.

Then ask exactly this, and wait:

> "This is Spec v1: [one-line summary]. If it is right, reply **yes, I approve
> Spec v1** — or tell me what to change."

Record the gate in `project-docs/progress.md` with the date and their exact
words. From now on, anything not in this spec is a change request: it goes to the
learner first, and into `decision-log.md` and `change-notes.md` when approved.

## End the session

Three bullets on what changed, then what to do next:

> "Before Stage 2 you need two free accounts: one for code (GitHub) and one for
> hosting (Vercel). Sign up with your email, and keep every password in your
> password manager — never type one into this chat."

> "Next session, type `/start` — or `/build` to go straight into Stage 2."
