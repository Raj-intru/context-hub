@AGENTS.md

## Claude Code notes

- The learner can start each stage with a slash command: `/start`, `/idea-check`,
  `/spec`, `/build`, `/trust-check`, `/ship`, and `/where-am-i` for a progress summary.
  These run the same playbooks in `/stages` as any other agent would.
- Deploys, pushes and deletions are set to ask for permission in
  `.claude/settings.json`. That is a safety net, not a replacement for asking the
  learner first as `AGENTS.md` requires.
