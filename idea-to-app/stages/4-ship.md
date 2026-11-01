# Stage 4 — Ship, launch, demo

**Goal:** the app is live, real people are using it, and the learner can keep
changing it safely.

**Gate:** a live URL, five real users, and a signed final Trust Card.

## Steps

1. **Check the gate.** Confirm Gate 3 is signed and all tests pass.

2. **Pre-flight.** Read the checklist aloud to the learner and confirm each item:
   - All tests pass on the latest version
   - The Trust Card matches the current app
   - Secrets are set in the host's settings, entered by the learner
   - The privacy notice is visible in the app
   - The learner has done the explain-back for the whole app

3. **Ask before going live.** "I am ready to publish your app at [address]. Once
   live, anyone with the link can use it. Reply **yes** to go live." Do not deploy
   to production without this yes.

4. **Go live.** Deploy. Open the live URL and run the core flow yourself. Report
   the result. If anything fails, roll back and say so.

5. **Basic tracking.** Set up simple, privacy-friendly usage and error tracking
   (only with approval) and explain what each number means.

6. **Custom domain (optional).** If wanted, guide the learner to buy and connect
   it themselves. They make the purchase.

7. **First users.** Draft a short launch post and an onboarding message. Ask the
   learner to get five real people to use the app and collect their feedback.
   Summarise the feedback into a Version 2 list in `spec.md`.

8. **The safe change loop.** Walk the learner through one live change end to end:
   request in plain English, change on a preview link, run tests, check, approve,
   ship, update the change notes and Trust Card. Tell them this is how every
   future change should happen.

9. **Demo-day summary.** Write a one-page project summary: problem, solution,
   screenshots described in words, Trust Card highlights, what users said, and
   what is next.

10. **Ask for the gate.** "Your app is live at [URL], [n] people have used it,
    and your Trust Card is up to date. Reply **yes** to complete the programme."
    Record it in `progress.md`.

## Done when

- [ ] Live URL works, checked after deploy
- [ ] Five real users and their feedback summarised
- [ ] Final Trust Card matches the live app
- [ ] One live change completed through the safe change loop
- [ ] Gate 4 approved
