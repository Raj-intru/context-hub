# Stage 3 — Make it trustworthy

**Goal:** the app does what it promises, fails gracefully, and handles people's
data responsibly. This is the stage most AI-built apps skip.

**Gate:** every acceptance check passes and the learner signs the Trust Card.

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

4. **Data and privacy review.** Walk through every piece of personal data the
   app keeps. For each, ask: "Do you really need this?" Remove what is not
   needed (with approval). Then check and report on:
   - Secrets: no passwords or API keys in the code or the repository
   - Access: people can only see what they should
   - Inputs: user input is validated and cannot break the app
   - Accessibility: labels, contrast, keyboard use, phone layout
   Draft a short plain-English privacy notice for the app.

5. **Draft the Trust Card** in `project-docs/trust-card.md` from
   `templates/trust-card.md`, filled only with facts you have checked. Never
   claim a check passed unless you ran it in this session.

6. **Explain-back.** Ask the learner to explain, in their own words, what data
   the app keeps, why, and how it is protected.

7. **Ask for the gate.** Show the Trust Card and test results. "Reply **yes** to
   sign your Trust Card." Record it in `progress.md`.

## Done when

- [ ] All acceptance checks have tests, and all pass
- [ ] Every break found has a fix and a test
- [ ] Unneeded personal data removed; privacy notice drafted
- [ ] Trust Card complete with only verified facts; Gate 3 approved
