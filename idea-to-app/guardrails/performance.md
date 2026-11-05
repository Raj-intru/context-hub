# Guardrail 3 — Performance

**The principle:** slow is a bug. A learner who says "it feels sluggish" has
found a real defect, and it gets a fix and a test like any other.

Read this before you build each screen, and again at the Stage 3 review.

## The budget

Agree these with the learner at Stage 1 and write them into `spec.md`. Use
these numbers unless the spec gives better ones:

| What | Budget |
| --- | --- |
| First screen usable | Under 3 seconds, on a mid-range phone on mobile data |
| Any button or tap shows it heard you | Under 1 second — a spinner counts, silence does not |
| A screen with a thousand records | Under 3 seconds, same as any other |
| Main page weight | Under 1 MB, images included |

A budget that is missed is a bug. Report the measured number, never an
impression: "the booking screen loads in 4.2 seconds on a phone" beats "it feels
fine to me".

## Phone first, always

Most people will open the app on a phone, on mobile data, one-handed, in a
hurry. Test there before you test on a laptop on fast broadband. An app that is
quick on your machine and slow on a phone is a slow app.

## The usual culprits

- **Large images.** Resize and compress before they ship. One photo straight off
  a camera can outweigh everything else on the page.
- **Loading everything, then filtering in the browser.** Ask the database for
  what you need. See `guardrails/scale.md`.
- **Blocking the screen on a slow call.** Show the page, then fill it in.
- **Too much code to download.** Every extra package is weight on a phone.
- **A waterfall of requests.** Three calls that wait for each other take three
  times as long as three that run together.

## How to check

- Open the host's own performance numbers and read them out
- Run a Lighthouse report on the preview link and report the score and the
  biggest single problem it names
- Throttle the connection in the browser's developer tools to "slow 4G" and
  time the core flow yourself
- Hand the phone to the learner and watch them use it

Measure first. Never optimise something you have not timed — it wastes the
learner's four weeks on a problem they do not have.
