# Idea to App — Starter Kit

This kit turns the coding agent of your choice into your Idea to App build
partner. The agent writes the code; you make every decision. Over four weeks it
takes you from an idea to a live, tested app with a signed Trust Card.

## Choose your agent

The method lives in plain files, so it works with whichever agent you prefer.

| Agent | How it picks up the method | How you start a stage |
| --- | --- | --- |
| **Claude Code** (used in our demos) | Reads `CLAUDE.md`, which includes `AGENTS.md` | Type a command: `/start`, `/idea-check`, `/spec`, `/build`, `/trust-check`, `/ship`, `/where-am-i` |
| **Codex, Cursor and other agents that read `AGENTS.md`** | Reads `AGENTS.md` automatically | Type the stage in plain words, for example "Start Stage 1: spec" |
| **Any other agent** | Paste this as your first message: "Read AGENTS.md in this folder and follow it exactly." | Same as above |

Whichever you pick, the rules, stages, gates and templates are identical, and
your coach can help you in the same way.

## Getting started

1. **Copy this kit into a new folder** for your app (your coach will share it
   as a template repository or a download).
2. **Open the folder in your agent.**
3. **Say hello.** In Claude Code, type `/start`. In other agents, type
   "Start Idea to App, Stage 0."
4. **Answer the agent's questions.** It will ask one thing at a time.

You will need two free accounts before Week 2: a code-hosting account (for
example GitHub) and a hosting account (for example Vercel). The agent will walk
you through creating them. **Always type passwords and keys yourself, never
into the chat.**

## The five stages

| Stage | What happens | You sign off when |
| --- | --- | --- |
| 0. Idea check | The agent interviews you and shrinks the idea to fit four weeks | The scoped idea feels right |
| 1. Spec | You interview three real users; the agent drafts a one-page spec | You can explain the spec in your own words |
| 2. Build | The agent builds screen by screen; you check each step on a preview link | You can demo the core flow yourself |
| 3. Trust | Tests, a break-it session, a data review, and your Trust Card | Every check passes and you sign the card |
| 4. Ship | Go live, get five real users, learn to change it safely | Your app is live and in use |

## What is in this kit

| Path | What it is |
| --- | --- |
| `AGENTS.md` | The agent's operating instructions: rules, gates, guardrails |
| `CLAUDE.md` | Connects Claude Code to `AGENTS.md` |
| `stages/` | One playbook per stage |
| `templates/` | Starting points for your project trail |
| `project-docs/` | Created as you go: your progress, spec, decisions, checks, Trust Card |
| `.claude/` | Claude Code commands and safety settings |

## Your project trail

Everything you decide is written down in `project-docs/` as you go. If you
switch agents, take a break, or bring in a developer later, the trail tells
them exactly what the app does, why, and how it was checked.

## Good habits

- If you don't understand something, ask "Explain that more simply."
- If something breaks, say "Undo the last change."
- If you want something new, ask "Is that in my spec?" before building it.
- Nothing goes live until you say yes.
