# Stage 3 — Make it trustworthy

**Goal:** the app does what it promises, fails gracefully, handles people's data
responsibly, stays fast, and cannot run up a bill the owner has not approved.
This is the stage most AI-built apps skip.

**Gate:** every acceptance check passes, the Ops Card is filled in, and the
learner signs the Trust Card.

## Steps

1. **Check the gate.** Confirm Gate 2 is signed.

2. **Complete the acceptance checks.** Review `acceptance-checks.md` with the
   learner and add checks for unhappy paths, for example:
   - "When I leave a required field empty, I should see a clear message."
   - "When I double-click Book, I should get one booking, not two."
   - "When the internet drops, I should not lose what I typed."
   Make sure each check has an automated test. Run them all and report results
   in plain words: which pass, which fail, and what a failure means for a user.

3. **Break-it session.** Invite the learner (or a pod-mate) to try to break the
   app: empty fields, very long text, wrong formats, the back button, a phone
   screen. For every break: log it, propose a fix, get a yes, fix it, and add a
   test so it cannot come back.

4. **Security review.** Read `guardrails/security.md` and work through all ten
   rules. Report each in plain English: what you checked, what you found, what
   you fixed. Then go through the "what AI-written code gets wrong most often"
   list in that file and say whether each applies here. Add a test for anything a
   test can hold.

5. **Data and privacy review.** Walk through every piece of personal data the
   app keeps. For each, ask: "Do you really need this?" Remove what is not
   needed (with approval). Then check and report on:
   - Secrets: no passwords or API keys in the code or the repository
   - Access: people can only see what they should
   - Inputs: user input is validated and cannot break the app
   - Accessibility: labels, contrast, keyboard use, phone layout
   Draft a short plain-English privacy notice for the app.

6. **Speed and load check.** Read `guardrails/performance.md` and
   `guardrails/scale.md`. Then:
   - Measure every screen against the budget in `spec.md`, on a phone and on a
     slow connection. Report seconds, not impressions.
   - Fill the app with far more data than the learner expects — a few thousand
     records — and open the busiest screen again. Report before and after. If it
     slowed, fix the cause; never hide it behind a spinner.
   - Answer in one line: what would this app do if a hundred people arrived at once?

7. **Cost check and Ops Card.** Read `guardrails/cost.md`. Create
   `project-docs/ops-card.md` from `templates/ops-card.md` and fill it in. Ask the
   learner to open each dashboard and read you the numbers — you never need their
   password. Confirm every paid service has a cap or an alert, everything a
   stranger can trigger has a rate limit, and the shutdown steps work. Tell the
   learner this month's spend and the worst case, in actual numbers.

8. **Draft the Trust Card** in `project-docs/trust-card.md` from
   `templates/trust-card.md`, filled only with facts you have checked. Never
   claim a check passed unless you ran it in this session.

9. **Explain-back.** Ask the learner to explain, in their own words, what data
   the app keeps, why, and how it is protected.

10. **Ask for the gate.** Show the Trust Card and test results. "Reply **yes** to
   sign your Trust Card." Record it in `progress.md`.

## Done when

- [ ] All acceptance checks have tests, and all pass
- [ ] Every break found has a fix and a test
- [ ] All ten security rules checked and reported
- [ ] Unneeded personal data removed; privacy notice drafted
- [ ] Speed budgets measured and met; load check done
- [ ] Ops Card filled in; every paid service capped or alerted
- [ ] Trust Card complete with only verified facts; Gate 3 approved
