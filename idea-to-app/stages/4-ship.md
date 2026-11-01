# Stage 4 — Ship

**Goal:** a live app, five real users, and a learner who can change it safely
without you.
**Gate the learner signs:** *Live URL, 5 real users, final Trust Card.*
**Expect:** week 4, then a short handover.

## Before you start

Read `project-docs/progress.md`. If the Trust Card is not signed, go back to
`stages/3-trust.md`. Nothing goes live on an unsigned card.

## Part A — the pre-flight list

Walk the learner through this and show the result of each line. Do not go live
with an unanswered row.

| Check | How you show it |
| --- | --- |
| All acceptance checks pass | The full run, as a list |
| The break-it fixes are still in | Rerun those tests |
| Works on the learner's own phone | They open the preview link and say so |
| Nothing secret is in the code | You searched the repository and show the result |
| Keys and passwords are in the host's settings screen | The learner put them there themselves |
| The app does nothing that costs money without a yes | Name every paid service and its price |
| Someone can get their data deleted | The learner performs the step once |
| The Trust Card matches what the app really does | Read it together |

## Part B — going live

Going live needs an explicit yes in the same conversation turn. Ask for it like
this, and wait:

> "This will put your app on a public address anyone can open. The pre-flight
> list is clean. Reply **yes, take it live** when you are ready."

Then, with them watching:

1. Deploy to production. Explain in one sentence: "Live means the same app on an
   address you can give people."
2. Open the live address on a phone and run the core flow once, together.
3. Put the live address at the top of `progress.md` and on the Trust Card.
4. Commit and note the deploy in `change-notes.md`.

If anything looks wrong, say so immediately and offer to put the previous version
back. Rolling back is a normal move, not a failure.

## Part C — five real users

Five people who are not the learner and not building the app. Help them do this,
but it is the learner's job to ask.

- Draft a three-line message they can send, in their own voice, with the live
  link and what to try.
- Give them one question to ask each user afterwards: "Where did you hesitate?"
- As answers come in, write each into `change-notes.md` and mark it *fix now*,
  *version 2*, or *not a problem*. The learner decides which.
- Fix only the *fix now* items, one at a time, each with a test and a change note.

Stop at five users who have actually used it. Not five people who said they would.

## Part D — handover: changing it safely

Teach these four moves, and have the learner do each one once, with you watching:

1. **Ask for a change** — plain English, pointing at what they saw.
2. **Check it on a preview link** before it goes live.
3. **Say yes to going live** — and know that nothing goes live without it.
4. **Undo** — "Undo the last change" always works, and the trail in
   `/project-docs` is how anyone, including a developer they hire later, picks
   this up.

Show them where everything lives: `spec.md` for what it does,
`decision-log.md` for why, `acceptance-checks.md` for what is guaranteed,
`trust-card.md` for what users are told, `change-notes.md` for the history.

## The gate

Update the Trust Card with the live address, the final check count, and today's
date. Then ask exactly this, and wait:

> "Your app is live at [address], [n] people have used it, and the Trust Card is
> up to date. If you are happy to call this shipped, reply **yes, this is
> shipped** — or tell me what is left."

Record it in `progress.md` with the date and their exact words.

## After shipping

Write the last `progress.md` entry as a short handover: what is live, what is in
version 2, and the next three things the learner might do. Then tell them the
truth plainly:

> "You decided every part of this. The code is the easy half."

Then tell them how to come back, because this is the session they will be
furthest from when they next need it:

> "Any time you want to change something, open this folder and type `/start`.
> If you have forgotten where anything lives, `/where-am-i` will tell you."
