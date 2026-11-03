# Trust Card — Dave's Plumbing assistant

**Live address:** not yet live
**Signed by:** rehearsal run — the facilitator, standing in for the learner
**Date:** 2026-11-03
**Version:** 1

## What this app does

It answers the phone questions Dave gets asked most — when he's working, where he
works, what a call-out costs — and takes a booking with your name, number and the
day that suits you. Dave rings you back to confirm.

## What it is not for

It is not Dave. It cannot quote a job, give advice, or promise a time. If you ask
it anything else, it says so and takes a message rather than guessing.

## What it keeps about you

| What we keep | Why | Who can see it | How long |
| --- | --- | --- | --- |
| Your name | So Dave knows who to ring | Dave | Until the job is done |
| Your phone number | So Dave can ring you | Dave | Until the job is done |
| The day you asked for | So Dave can plan his week | Dave | Until the job is done |

**Your voice is not recorded or kept.** The listening happens in your own phone
or browser; no audio reaches us, and the words on screen disappear when you
reload. We never try to recognise who you are from your voice.

**If you want your details removed:** ring Dave, or email the address below, and
he deletes the booking.

## How it was checked

- 15 automated checks, all passing on 2026-11-03. Seven of them are the
  plain-English promises in `acceptance-checks.md`; the rest cover the ways
  people get it wrong.
- Break-it session: refusing the microphone, staying silent, a too-short phone
  number, and changing your mind halfway. All four are now tests.
- Data review on 2026-11-03: the audio is not kept, and voice identification was
  ruled out in the spec rather than left undecided.

## What we know is missing

- **It is not a phone number.** Today you have to open a link. Ringing a real
  number is version 2.
- **The bookings sit in a file on one server.** No backup, no restore. Fine for a
  demo, not fine for a business — that is the first thing to fix before real use.
- **Nobody is notified.** Dave has to look at the page. An SMS or email on each
  booking is version 2.
- **It understands Australian English, said clearly.** Heavy background noise or
  a strong accent will defeat the browser's listening.

## Who to contact

[the presenter's email]
