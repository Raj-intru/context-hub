# Stage 3 — Trust

**Goal:** evidence the app does what it says, holds only what it needs, and
behaves when people misuse it — written down on a card the learner signs.
**Gate the learner signs:** *All acceptance checks pass; Trust Card signed.*
**Expect:** one week, three sittings.

## Before you start

Read `project-docs/progress.md`. If the Stage 2 gate is not signed, go back to
`stages/2-build.md`. Nothing here is a substitute for a working core flow.

## Part A — every check, green

Run the whole test suite in front of the learner and show the result as a list
they can read: every acceptance check, and whether it passes.

- Every check in `acceptance-checks.md` has a test, and every test runs.
- A check with no test is not done. Write the test.
- A failing test is reported plainly and fixed. Never skip, disable or soften a
  test to get a clean run, and never present a partial run as a full one.

Report it as a count: "Eleven checks, eleven passing." If it is not all of them,
say which ones and what you are doing about it.

## Part B — the break-it session

Thirty minutes where the learner's job is to be the worst user their app will
ever have. Give them the list, let them work through it, and write down what
happens.

1. Submit every form empty.
2. Submit a form twice, fast.
3. Put silly things in: a date in 1823, a 500-word name, emoji, a web address in
   a phone field.
4. Press the browser Back button halfway through.
5. Turn the phone sideways.
6. Open the app on a phone, on a laptop, and in a second browser at the same time.
7. Turn off the wifi mid-way and turn it back on.
8. Try to reach a page they should not be able to reach by typing its address.

Each thing that breaks becomes a line in `change-notes.md`, a test, and a fix.
Rerun everything after the fixes. Then say, in plain words, what the app now does
when someone does the wrong thing.

## Part C — the data review

Open `spec.md`'s *Data* section next to what the app actually saves, and go
through it line by line with the learner.

For each item ask: **do we still need this?** Then record the answer:

| Question | What to do with the answer |
| --- | --- |
| What does the app save about a real person? | List it in plain words on the Trust Card |
| Why does it need each item? | No reason, delete the item and its field |
| Who can see it? | Name them. "Only you" is a valid answer |
| How long is it kept? | A number, not "for now" |
| What happens if someone asks for their data to be deleted? | A step the learner can actually perform |

If the app collects anything the spec does not list, stop and tell the learner.
Collecting a new kind of personal data needs their explicit yes, and the spec
updated in the same step.

## Part D — the Trust Card

Fill `project-docs/trust-card.md` from the template. It is written for the
learner's users, not for you: no jargon, nothing that needs this chat to
understand. It says what the app does, what it saves and why, what was tested,
what is known to be missing, and who to contact.

Before the gate, ask for the explain-back:

> "In your own words — what does your app do, what does it keep about people, and
> what did we check? If someone asked 'is this safe to use?', what would you say?"

If they cannot answer from the card, the card is too complicated. Simplify it and
ask again. Never explain-back for them.

## The gate

Ask exactly this, and wait:

> "All [n] checks pass, we broke it [n] ways and fixed them, and your data review
> is on the card. If you are happy to stand behind this, reply **yes, I sign the
> Trust Card** — or tell me what is missing."

Record it in `progress.md` with the date and their exact words, and put their
name and the date on the card itself.

## End the session

Three bullets, then:

> "Before Stage 4, line up five people who will actually use this in the first
> week, and send them nothing yet."
