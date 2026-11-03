# Acceptance checks

**Last full run:** 2026-11-03 — 26 of 26 passing in about 3 seconds (`npm test`)

## Core flow

| # | When I… | I should… | Test | Status |
| --- | --- | --- | --- | --- |
| 1 | ask what time you open | hear the opening hours spoken back | `brain.test.js` checks 1 (×2) | pass |
| 2 | ask something it does not know | hear "I'll take a message" — not a guess | `brain.test.js` check 2 | pass |
| 3 | say "book me in for Tuesday" | be asked my name, then my number, one at a time | `brain.test.js` check 3 | pass |
| 4 | give a name and a number | see the booking on the list and hear it read back | `brain.test.js` check 4 + `ui.test.mjs` checks 1-4 | pass |

## When things go wrong

| # | When I… | I should… | Test | Status |
| --- | --- | --- | --- | --- |
| 5 | refuse microphone permission | get a box I can type into, not a dead page | `ui.test.mjs` check 5 | pass |
| 6 | say nothing for five seconds | have it stop listening instead of hanging | `ui.test.mjs` check 6 | pass |
| — | give a number that is too short | be asked again, not booked | `brain.test.js` | pass |
| — | say "never mind" halfway through | have the booking dropped | `brain.test.js` | pass |
| — | say nothing at all | get "I didn't catch that", not a crash | `brain.test.js` | pass |

## What it costs and how it is going

| # | When I… | I should… | Test | Status |
| --- | --- | --- | --- | --- |
| 8 | open the dashboard | see what each booking cost, and this month's spend against my cap | `ui.test.mjs` dashboard | pass |
| 9 | look at the dashboard | see nothing a caller said — no name, no number, no recording | `metrics.test.js` + `ui.test.mjs` | pass |
| — | have taken no calls yet | see dashes, not a crash or a division by zero | `metrics.test.js` | pass |
| — | leave it running a long time | not have the event log grow without limit | `metrics.test.js` | pass |

## On a phone

| # | When I… | I should… | Test | Status |
| --- | --- | --- | --- | --- |
| 7 | open it on my phone | reach the Talk button without zooming or scrolling sideways | `ui.test.mjs` check 7 | pass |
