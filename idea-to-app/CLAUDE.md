@AGENTS.md

## Claude Code notes

- The learner can start each stage with a slash command: `/start`, `/idea-check`,
  `/spec`, `/build`, `/trust-check` and `/ship`, plus `/where-am-i` for a progress
  summary and `/ops-check` for the cost, speed and load review.
  These run the same playbooks in `/stages` as any other agent would.
- The four guardrails in `/guardrails` apply across every stage. Read the one you
  need before the step, not after it.
- Deploys, pushes and deletions are set to ask for permission in
  `.claude/settings.json`. That is a safety net, not a replacement for asking the
  learner first as `AGENTS.md` requires.
