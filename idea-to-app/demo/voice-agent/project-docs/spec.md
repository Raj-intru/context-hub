# Spec v1

**Approved:** 2026-11-03 — "yes, I approve Spec v1" (rehearsal)

## Problem

> For a sole trader who cannot answer the phone while working, this app lets a
> caller ask the three questions they always ask and leave a booking, so that the
> trader stops losing jobs to voicemail.

## Users

- Who it is for: sole traders on the tools — plumbers, sparkies, locksmiths.
- What all three agreed on: they miss calls during a job and lose the work to
  whoever answers first; callers only ever ask three things; they will not type
  anything during the day.
- What they do today: voicemail nobody listens to, or a partner taking messages.

## Must-have features

1. Listen when the caller holds a button, and show what it heard.
2. Answer three questions out loud: hours, where we work, what it costs.
3. Take a booking — name, phone, day — one question at a time, read back.

## Screens

| Screen | What the person does here |
| --- | --- |
| The one page | Holds Talk, speaks, hears the answer, sees the bookings taken |

## Data

| What we save | Why it is needed | How long we keep it |
| --- | --- | --- |
| The caller's name | So Dave knows who to ring back | Until the job is done, then deleted |
| The caller's phone number | So Dave can ring back | Until the job is done, then deleted |
| The day they asked for | So Dave can plan the week | Until the job is done, then deleted |

**Not saved:** the audio. The browser does the listening and nothing keeps the
recording. The transcript stays on the page and is gone on reload.

**Never done:** no voice identification, ever. Recognising *who* someone is from
their voice would make this biometric data with a much higher consent bar. This
app only hears *what* was said.

## Out of scope (version 2)

A real phone number, a calendar, SMS confirmations, taking payment, more than one
trade, more than one language, and anything that identifies a caller by voice.
