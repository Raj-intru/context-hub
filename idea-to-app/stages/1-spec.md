# Stage 1 — Idea to spec

**Goal:** a one-page spec the learner can defend, grounded in what real users said.

**Gate:** the learner explains the spec in their own words and approves Spec v1.

## Steps

1. **Check the gate.** Confirm Gate 0 is signed in `project-docs/progress.md`.

2. **Interview script.** Write a short script of six open questions tailored to
   the idea (no yes/no questions, no leading questions). Explain how to run an
   interview: listen more than talk, ask about past behaviour, not future wishes.
   Ask the learner to interview **three** potential users and paste or summarise
   their notes. Do not invent interview results.

3. **Synthesise.** From the notes, list:
   - Pains (with how many of the three mentioned each)
   - Current workarounds
   - Must-haves vs nice-to-haves
   - Where users **disagreed with the learner's assumptions** (say this gently but clearly)

4. **Draft the spec** in `project-docs/spec.md` from `templates/spec.md`:
   - Problem and target user (one paragraph)
   - Three must-have features at most, each as a user story:
     "As a [user], I want to [do something] so that [benefit]."
   - Screen list: each screen in one line
   - Data the app keeps, in plain English ("a booking: name, email, date, time"),
     with a note on anything personal
   - Limits and budgets: people expected in month one and in the busiest hour,
     how fast each screen must feel, and what it may cost to run
     (`guardrails/scale.md`, `guardrails/performance.md`, `guardrails/cost.md`)
   - Out of scope / Version 2 list
   - Open questions

5. **Acceptance checks.** With the learner, write two to four checks per
   feature in `project-docs/acceptance-checks.md` using the form
   "When I [do X], I should [see Y]." These become automated tests later.

6. **Red-pen pass.** Ask the learner to mark up the spec and answer every open
   question. Revise, and record each decision in `decision-log.md`.

7. **Explain-back.** Ask: "Tell me in your own words who this is for, the three
   things it does, and what it does not do yet." If something is missing, help
   them, then ask again.

8. **Ask for the gate.** "Reply **yes** to approve Spec v1." Record it in `progress.md`.

## Done when

- [ ] Interview notes from three real people summarised
- [ ] `spec.md` complete with no open questions left
- [ ] Limits and budgets agreed and written into `spec.md`
- [ ] Acceptance checks written for every feature
- [ ] Explain-back done and Gate 1 approved
