# The demo app — an after-hours voice assistant for a one-person business

This is the worked example the demo builds. It exists so a facilitator knows what
"good" looks like before they run it live. **Do not read this to the audience** —
the point of the demo is that it emerges from the learner's answers. Use it to
recognise when the build is on track, and to steer back when it is not.

## Why this app

- **SMEs feel the pain immediately.** A sole trader who misses a call after
  6pm loses the job to whoever answers. Every person in the room knows this.
- **It is genuinely small.** One screen, three answers, one booking.
- **It needs no accounts and no keys.** The browser's own speech engine does the
  listening and the talking, so a live demo cannot fail on a missing API key or a
  rate limit.
- **It collects real personal information** — a name, a phone number, and a
  voice. That is what makes Stage 3's data review land, and it is the bridge into
  the SME security conversation in `sme-security.md`.

## The scoped idea (what Stage 0 should land on)

> **For** a sole trader who cannot answer the phone while working, **this app
> lets** a caller ask the three questions they always ask and leave a booking,
> **so that** the trader stops losing jobs to voicemail.

**In (the demo build):**

1. A page that listens when you hold a button, and shows what it heard.
2. Spoken answers to three questions: opening hours, where you are, what it costs.
3. A booking: name, phone, day — asked one at a time, read back for confirmation.

**Later (version 2):** a real phone number, a calendar, SMS confirmations,
more than one trade, taking payment, more than one language.

## Acceptance checks

These are the checks the demo should produce in Stage 1. Seven is the right
number — enough to be real, few enough to read on a slide.

| # | When I… | I should… |
| --- | --- | --- |
| 1 | hold Talk and say "what time do you open" | hear the opening hours spoken back |
| 2 | ask something it does not know | hear "I'll take a message for you" — **not** a confident wrong answer |
| 3 | say "book me in for Tuesday" | be asked for my name, then my number, one at a time |
| 4 | give a name and a number | see the booking on the list and hear it read back |
| 5 | refuse microphone permission | get a box I can type into, not a dead page |
| 6 | say nothing for five seconds | have it stop listening instead of hanging |
| 7 | open it on my phone | reach the Talk button without zooming |

Checks 2, 5 and 6 are the ones that make the Stage 3 break-it session short
instead of embarrassing. Insist on them in Stage 1.

## The one architecture decision that matters

**Keep the brain separate from the microphone.**

- A pure function takes a line of text and returns a reply plus an action
  (`answer`, `start booking`, `take a message`). No audio, no browser.
- A thin layer wires the browser's speech recognition into it, and its speech
  synthesis onto the reply.

Why it matters, and it is worth saying out loud to the audience: this is what
makes checks 1–4 testable without a microphone. Tests drive the brain directly;
one browser test stubs the speech engine and feeds a fake transcript. Without
this split, "we have tests" is theatre — you can only test by talking to it.

## What to say when someone asks "is that a real voice agent?"

Be straight about it. The browser's own engine does the **listening**, which is
why no key is needed for it. The **speaking** is a real hosted voice — Cartesia by
default — generated ahead of time into files so the demo plays from disk. It is a
real voice interface and a real intent layer; it is not a phone line, and the
listening is not a large speech model. The production path is in
`sme-security.md`: telephony for real calls, a hosted speech-to-text model for
better recognition in a noisy kitchen, and the same brain in the middle,
untouched.

Say the second half too, because somebody is going to ask: **there is no language
model deciding what it says.** It matches what it heard against a handful of
things it knows, and anything else becomes a message. That is not a shortcut —
it is the only way acceptance check 2, "never invent an answer", is a promise
rather than a hope.

That answer is also the demo's best moment, because it shows the method working:
the thing that changes is the plumbing, and the thing that does not change is the
spec, the checks and the Trust Card.
