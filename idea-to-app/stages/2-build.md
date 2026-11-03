# Stage 2 — First working build

**Goal:** the core flow works end to end on a preview link.

**Gate:** the learner demos the core flow on the preview link without help.

## Steps

1. **Check the gate.** Confirm Gate 1 is signed. Re-read `spec.md` and
   `acceptance-checks.md` in full.

2. **Explain the shape (once).** In plain English, using the restaurant analogy:
   - Screens are the dining room (what people see and touch)
   - Logic is the kitchen (what happens when they press a button)
   - Data is the pantry (what the app remembers)
   Tell the learner which of these their app needs and why.

3. **Set up.** Scaffold the project with the default stack in `AGENTS.md`
   (or the chosen one). Initialise git. Guide the learner, step by step, to
   connect their own code-hosting and hosting accounts so every change gets a
   preview link. They enter their own credentials.

   Before the first screen, read `guardrails/security.md` and set up: secrets as
   environment settings the learner types in themselves, a spending cap or budget
   alert on every service (`guardrails/cost.md`), and the shutdown steps written
   into `project-docs/ops-card.md` from `templates/ops-card.md`.

4. **Build in small steps.** One screen or one behaviour at a time, in the
   order of the core flow. After each step:
   - Run all tests
   - Check it on a phone-sized screen against the budget in `spec.md`
   - Commit with a plain-English message
   - Add an entry to `project-docs/change-notes.md`: what changed, why, how to check it
   - Tell the learner: "Open your preview link, do X, and tell me what you see."

5. **Take feedback in plain English.** Teach the learner five ways to steer you,
   with an example of each, the first time they give feedback:
   - **Show:** "This is what I see" (a screenshot or description)
   - **Compare:** "Make it like the confirmation screen"
   - **Constrain:** "Only change the button, nothing else"
   - **Undo:** "Go back to how it was before"
   - **Explain:** "Why does it do that?"

6. **Stay inside the spec.** If the learner asks for something new, say whether
   it is in Spec v1. If not, offer to add it to Version 2, or to change the spec
   (which needs their explicit approval and a decision-log entry).

7. **Pod review (if in a cohort).** Turn issues a pod-mate reports into a fix
   list and ask the learner which to fix now.

8. **Ask for the gate.** Ask the learner to walk through the core flow on the
   preview link themselves and tell you what happens at each step. Do not prompt
   them through it. If it works, ask: "Reply **yes** to sign off your core demo."

## Done when

- [ ] Every must-have feature works on the preview link
- [ ] Tests exist for every acceptance check written so far, and pass
- [ ] Spending caps and shutdown steps were in place before anything was built
- [ ] `change-notes.md` has an entry for every change
- [ ] Learner demoed the flow unaided; Gate 2 approved
