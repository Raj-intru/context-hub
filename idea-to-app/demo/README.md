# Running the Idea to App demo

Forty-five minutes, five stages, a working voice assistant, and a signed Trust
Card. The app is not the point. The point is that someone who cannot code drove
every decision, and can prove what was checked.

The app being built is in `voice-agent-brief.md`. Read it before you run this.
The SME follow-on is in `sme-security.md`.

---

## Part 1 — The day before (30 minutes, do not skip)

**1. Make a clean copy of the kit.** The demo must start from nothing, and the
repository's copy must stay clean.

```
cp -r idea-to-app ~/voice-demo
cd ~/voice-demo
rm -rf project-docs/*          # the trail must be empty on stage
git init && git add -A && git commit -m "Idea to App kit, clean"
```

**2. Rehearse the whole thing once, start to finish, with the prompts in Part 3.**
This is the step people skip and regret. You are not rehearsing your words — you
are finding out how long your agent actually takes on your machine, which is the
only number that matters.

**3. Keep the rehearsal as your fallback.**

```
git branch demo-fallback        # the finished app, ready to check out
```

If the live build stalls, you say "here's one I built earlier", check out the
branch, and carry on. Nobody minds. A presenter waiting silently for an agent is
the only real failure.

**A finished build already exists** at `demo/voice-agent/`, on the
`demo-fallback` branch of this repository. It passes 15 checks in about two
seconds. Copy it into your demo folder and you have a fallback before you have
rehearsed anything:

```
cp -r idea-to-app/demo/voice-agent ~/voice-demo-fallback
cd ~/voice-demo-fallback && npm start
```

Rehearsing is still worth the half hour, because the number you actually need —
how long *your* agent takes to build this conversationally, on *your* machine —
is the one thing nobody can hand you.

**4. Check these on the actual demo machine, not your usual one.**

- [ ] Chrome or Edge — the browser speech engine is weakest in Safari and Firefox
- [ ] If you want a real voice rather than the browser's: `npm run voice` once,
      with your key in `.env`. About 900 characters, a fraction of a cent, and it
      plays from disk afterwards so nothing is called from the stage
- [ ] Rehearse with the **same fake name** you will use live — the read-back line
      has a name in it, so it can only be cached by having been said once
- [ ] Microphone works, and the browser has permission
- [ ] **Speaker volume up, and notifications off** — the app talks out loud
- [ ] Terminal font at presentation size; agent open in `~/voice-demo`
- [ ] A phone on the same wifi, for the "it works on a phone" moment
- [ ] Wifi tested where you will stand, not at your desk

**5. Decide your honesty line now.** You will compress Stage 1's three user
interviews — there is no time to do them live. Say so when you get there. An
audience forgives a shortcut you name and distrusts everything after one they
catch.

---

## Part 2 — The first three minutes

Say this, or something like it, before you touch the keyboard:

> "I'm going to build a working voice assistant in about half an hour, and I'm
> going to do it without writing any code or reading any. What I want you to
> watch is not the app. It's the five moments where the thing stops and makes me
> approve something — because that's the part that makes this safe to put in
> front of a customer."

Then show the empty folder. `AGENTS.md`, five playbooks, six templates, nothing
else. "There is no product here. It's a method in plain files."

---

## Part 3 — The live run

Type the prompts in the boxes. Everything else is what you say while the agent
works. **Narrate the gates, not the code.** If the agent shows code, scroll past
it and say "we don't read this — that's the whole idea."

### Stage 0 — Idea check (7 minutes)

```
/start
```

It reads the empty trail, greets you, and asks for your idea. Then:

```
A voice assistant for a sole trader — a plumber — who can't pick up the
phone while he's under a sink. Callers should be able to ask the few
questions they always ask and leave a booking, out loud, without him
touching it.
```

It will ask one question at a time: who exactly, what they do today, the one job,
what proof would look like. **Answer in character, briefly.** Do not help it.

When it proposes the four-week version and the two lists:

- Point at the **Later** list. "Watch what it just did. Payments, a calendar, SMS
  — nothing was rejected. It all moved to version 2. That's how you stop an idea
  eating four months."
- Point at the red-flag table if it raised one. Taking payment by voice is the
  one it should flag.

```
yes, the idea fits four weeks
```

**Now show the trail.** Open `project-docs/progress.md`. Your exact words are
written into it with today's date. "That sentence is a signature. Everything
after this points back to it."

### Stage 1 — Spec and checks (8 minutes)

```
/spec
```

It will ask for your three user interviews. **This is your honesty line:**

> "In the real programme this is a week of your life — you go and talk to three
> people who actually have the problem, and you're banned from pitching. I'm
> going to fake it in thirty seconds, and I want you to know that's the one thing
> I'm faking."

```
I spoke to three sole traders. All three said the same thing: they miss
calls on the tools and lose the job to whoever answers first. Two said
callers only ever ask three things — are you open, where are you, what
does it cost. All three said they will not type anything during the day.
One wanted invoicing, which I've told him is version 2.
```

Let it write the spec, then **stop on two sections and read them aloud**:

- **Data.** Name, phone number, voice. "Three lines. Each one has a reason next
  to it. If I can't say why, it doesn't get saved. Remember this page — we come
  back to it in ten minutes."
- **Acceptance checks.** Read check 2 out: *ask it something it doesn't know and
  it should offer to take a message, not invent an answer.* "That is a hallucination
  guard written by a plumber in plain English. It becomes an automated test."

Then the explain-back. It will ask you to describe the spec without looking.
**Do it badly on purpose the first time** — leave out the data. Let it simplify
and ask again. That beat is the whole programme in ten seconds.

```
yes, I approve Spec v1
```

### Stage 2 — Build (14 minutes)

```
/build
```

Three steps, each ending with something to click. Let it do its thing; talk over
the quiet bits.

**Step 1 — it listens.** When it hands you a preview, hold the button and say
"what time do you open". The transcript appears.

**Step 2 — it answers.** Ask the three questions out loud. Then ask something
silly — "do you do roof tiling?" — and let the room hear it offer to take a
message. Point at check 2 on the screen. "That's not me being clever. That's a
test that fails if it ever guesses."

**Step 3 — it takes a booking.** Say "book me in for Tuesday". Give a name and a
number when asked. It reads the booking back.

**Then the phone.** Open the preview link on your phone and run it there. This is
the moment the room believes you.

When it mentions keys, secrets or a host, read that part out: *you type it, I
never see it.* And if it asks permission to push or deploy, **stop and show the
prompt**. "That's not politeness. It's a setting in a file, and it's the reason I
can hand this to someone who's never deployed anything."

```
yes, the core flow works
```

### Stage 3 — Trust (8 minutes)

```
/trust-check
```

**The test run.** Let it run every check and report the count. Put the list on
screen. "Seven checks, seven passing — each one a sentence a plumber wrote."

**The break-it session.** Invite the audience. Ask for two things to try and do
them live. Deny the microphone permission. Stay silent for five seconds. The app
should survive both, because checks 5 and 6 exist. If something does break, that
is a gift — fix it live and show the new test.

**The data review.** Go back to the Data page from Stage 1 and go line by line.
Who can see it. How long it is kept. What happens when a caller wants it deleted.
This is the minute the room shifts from "cute" to "could we use this".

**The Trust Card.** Read the "what we know is missing" section out loud. "A
product page says what it does. This one says what it doesn't."

```
yes, I sign the Trust Card
```

### Stage 4 — Ship (5 minutes)

```
/ship
```

Walk the pre-flight list on screen. Then the deploy gate — say the words it asks
for, deliberately, so the room sees that nothing went live without a sentence
from a human.

```
yes, take it live
```

Open the live address on your phone. Ask someone in the front row to try it.

---

## Part 4 — The last three minutes

Close on the trail, not the app. Open `project-docs/` and show six files:

> "This is what you'd hand a developer, an auditor, or your future self. What it
> does. Why. What's guaranteed. What users are told. What changed and when. The
> app took thirty minutes. This folder is the part that's worth something."

Then the one line that moves an SME audience:

> "Everything you just watched cost nothing but my time, and none of it required
> me to trust a vendor's word about what the app does — because I can read every
> rule it followed."

Hand over to `sme-security.md` for the business conversation.

---

## When it goes wrong

| What happens | What you do |
| --- | --- |
| Agent is slow or stalls | "Here's one I built earlier" — `git checkout demo-fallback`, keep the energy up |
| Microphone refuses | Use the typed-input fallback. Check 5 exists precisely for this — say so |
| Speech recognition mishears you | Let it. Then say "this is why the brain is tested separately from the microphone" |
| Agent skips a gate | Stop it. "It just tried to skip my approval — and I'm going to make it go back." Best unscripted moment you can get |
| A build step fails a test | Do not hide it. Read the failure out and let it fix it. A green run after a red one is more convincing than a green run alone |
| Someone asks "is this a real voice agent?" | The answer is in `voice-agent-brief.md`. Be straight: real voice interface, browser speech engine, not a phone line |
| Someone asks what it costs to run | Browser speech is free. The production path has real numbers — `sme-security.md` |

## Three things to never do in this demo

1. **Never read code aloud.** The moment you do, half the room decides this is
   for developers.
2. **Never pass a gate by typing "ok".** Say the full sentence. The audience is
   watching for the ritual, and the ritual is the product.
3. **Never claim the app is secure or compliant.** Say what was checked, and
   point at the Trust Card. Lyra's `docs/COMPLIANCE.md` is the house style:
   state what is enforced and what is not.
