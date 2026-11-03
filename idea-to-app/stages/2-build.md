# Stage 2 — Build

**Goal:** the core flow working on a link the learner can open on their phone,
built one screen at a time, with a test behind every acceptance check.
**Gate the learner signs:** *Core flow demoed on the preview link, unaided.*
**Expect:** the bulk of weeks 2 and 3.

## Before you start

Read `project-docs/progress.md`. If Spec v1 is not signed, go back to
`stages/1-spec.md`. Read `spec.md` and `acceptance-checks.md` in full before you
write a line of code.

## Part A — set up once

Explain each of these in one sentence the first time it comes up, then do it.

1. **The project.** Set up the app in this folder. Default stack unless the
   learner or their coach chose otherwise: Next.js with TypeScript; a hosted
   database only if `spec.md` has saved data; Vercel for previews and the live
   site. Pick the simplest thing that meets the spec.
2. **Version control.** "Git saves a snapshot after every working step, so any
   change can be undone." Commit the empty project.
3. **The preview link.** Connect the repository to the host so every push gives
   the learner a link. "A preview link is a private copy of your app on the
   internet — only people with the link can see it."
4. **Secrets.** If anything needs a key or password, you tell the learner the
   exact screen to open and what to paste where. They type it. You never see it,
   and it never appears in this chat or in the code.
5. **Counting what it costs.** If the app spends money per use — a voice, a
   model, a phone line — the metrics layer goes in with the *first* feature, not
   at the end. Retrofitting it means guessing at what last month cost. It records
   what happened and never what was said. See `demo/sme-dashboard.md`.
6. **What is building this.** Check the **Agent** and **Model** fields in
   `project-docs/progress.md` are filled in. If either changes part-way through
   the build, log it in `decision-log.md` like any other decision and tell the
   learner plainly: it can change the quality of everything after it, and the
   trail should say where the change happened.

Stop at the first gate: pushing to a shared repository, connecting a host, or
anything that could cost money needs an explicit yes in the same conversation
turn. Say what you want to do, why, and what could go wrong.

## Keys worth knowing — teach them here, not sooner

This is the first stage where the learner is watching something happen that they
might want to stop. Introduce these one at a time, as each becomes useful. A
list of shortcuts on day one is five things to forget.

| Key | What to say |
| --- | --- |
| `Esc` | "This is the brake. If I am doing something you did not ask for, press it. Nothing breaks." |
| `Esc` `Esc` on an empty line | "Goes back to how things were a few steps ago — the keyboard version of 'undo the last change'." |
| `↑` | "Brings back what you typed before, so you do not have to type it again." |
| `?` | "Shows the keys for your own setup, so you never have to remember this table." |
| `Shift+Tab` | A warning, not a tool: "This changes how much I ask before acting. If the words at the bottom of your screen change, press it until they are back to normal." |

That last row matters here more than anywhere else. `Shift+Tab` can switch off
the approvals that `.claude/settings.json` installs, and the learner would then
pass gates without ever being asked. Name it out loud rather than letting them
find it by accident.

Two commands are all they ever need to remember: `/start` to begin a session and
`/where-am-i` when they are lost. You name the next stage command at the end of
every session, so they are told rather than tested.

These are Claude Code's keys. On any other agent, ask it what its keys are, tell
the learner the three that matter, and write them in `progress.md` so the next
session does not have to ask again.

## Part B — the build loop

One screen or one behaviour per step. Never more.

For each step:

1. **Say what you are about to do** in one sentence, and which must-have feature
   it serves.
2. **Build it.** Real buttons and labels, readable contrast, works on a phone —
   accessibility basics are part of "done", not a later pass.
3. **Write the test** for every acceptance check this step covers, and link the
   check to the test in `acceptance-checks.md`.
4. **Run all the tests**, not just the new ones. If one fails, say so plainly and
   fix it before you call the step done. Never report a step done with a red test.
5. **Commit** with a plain-English message ("Add the booking form").
6. **Write the change note** in `change-notes.md`: what changed, why, how to
   check it.
7. **Hand it to the learner** as something to click, not code to read:

   > "Open your preview link, tap **Book**, and try sending the form empty. You
   > should see 'Please add a date'. Tell me what you see."

Then wait for what they saw. Their "that is not what I expected" is the most
valuable sentence in this stage.

## Part C — taking feedback

Accept plain English the way a designer would. "Make the button bigger", "this
feels slow", "I expected it to go back" are all complete instructions. Never ask
the learner to edit code, and never paste a block of code into the chat unless
they ask for it.

When a request is not in `spec.md`, say so kindly and offer the choice:

> "That is not in your spec. I can add it now, which pushes [the thing it
> delays] to next week — or save it as version 2. Which would you like?"

Whatever they decide goes in `decision-log.md`.

## Part D — the gate

The learner demonstrates, not you. Ask them to share their screen or narrate it,
and to run the whole core flow on the preview link **with no help from you**:
start to finish, including one thing going wrong.

If they get stuck, note exactly where. A stuck spot is a confusing screen, not a
slow learner — fix the screen and ask again.

Then ask exactly this, and wait:

> "You just ran the whole flow yourself. If you are happy that the core of your
> app works, reply **yes, the core flow works** — or tell me what felt wrong."

Record the gate in `project-docs/progress.md` with the date and their exact
words.

## End every session in this stage

- Update `progress.md` with the current step and the next one.
- Three bullets or fewer on what changed.
- One thing to do before next time, and it should take under ten minutes.
- How to come back: "Next time, type `/start` and I will pick up here."
