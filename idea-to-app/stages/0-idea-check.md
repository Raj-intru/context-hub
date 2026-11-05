# Stage 0 — Idea check

**Goal:** confirm the idea can become a working, trustworthy app in four weeks,
and shrink it until it can.

**Gate:** the learner approves a scoped idea: one type of user, three core
features or fewer.

## Steps

1. **Hear the idea.** Ask the learner to describe it in three sentences:
   the problem, who has it, and what those people do about it today.
   Ask one question at a time.

2. **Interview (about 10 minutes).** Ask, one at a time, and wait for each answer:
   - Who exactly will use this? Describe one real person.
   - What is the single most important thing they will do in the app?
   - What happens today without it? What does that cost them (time, money, stress)?
   - How will you know it is working a month after launch?
   - Does it need people to log in, pay, or see each other's information?

3. **Flag scope risks.** Check the idea for anything that usually blows a
   four-week budget, and name each one plainly:
   - Payments or money moving between people
   - Logins with different roles (admin, staff, customer)
   - Real-time features (live chat, live tracking)
   - Native mobile apps (app store submission)
   - Integrations with other company systems
   - Sensitive data: health, financial, children's, identity documents
   - More than one type of user

4. **Size it for cost and load.** Read `guardrails/cost.md` and
   `guardrails/scale.md`. Ask, one at a time:
   - How many people will use this in the first month? And in the busiest hour?
   - Does anything in it get charged for each use — texts, emails, AI, maps,
     payments or storage?
   Then say plainly what Version 1 should cost to run: aim for nothing, on free
   plans. Name anything that cannot be free, what it costs per use, and the worst
   month you can imagine. If the idea cannot run free or near-free in month one,
   say so now, not in Week 4.

5. **Propose a smaller first version.** Offer two or three scoped options, for
   example "Version 1: customers can see slots and request a booking; you confirm
   by email. Payments come in Version 2." Explain what each option leaves out.

6. **Get the decision.** Ask the learner to choose an option or change one.
   Record their choice and reasons in `project-docs/decision-log.md`.

7. **Set up the trail.** Create `project-docs/progress.md` from
   `templates/progress.md` and fill in the idea summary.

8. **Ask for the gate.** Say: "Here is your Version 1 in one paragraph: … Does
   this fit what you want to build in four weeks? Reply **yes** to lock it in."
   Record the approval in `progress.md`.

## Accounts (guide only, never do it for them)

Before Stage 2 the learner will need a code-hosting account (for example GitHub)
and a hosting account (for example Vercel). Walk them through sign-up click by
click when they are ready. They type their own passwords.

## Done when

- [ ] Scoped Version 1 written in `progress.md`
- [ ] What Version 1 costs to run, and the worst case, said in plain numbers
- [ ] Choices recorded in `decision-log.md`
- [ ] Gate 0 approved in the learner's own words
