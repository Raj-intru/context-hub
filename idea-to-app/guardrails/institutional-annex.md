# Institutional annex — the same guardrails, in enterprise language

**Who this is for:** coaches, and learners taking an app into an organisation
where it will meet a risk function. It is **not** part of the four-week gates,
and you never put this language in front of a learner during the programme.
The plain-English rules are not a simplification of the real thing — they are
the real thing, named so a non-specialist can hold them.

## Mapping

| Learner rule | Institutional equivalent |
| --- | --- |
| Secrets never touch the code | Key management, rotation policy, secret scanning in the pipeline |
| Every input is a stranger's input | Input validation and output encoding; OWASP ASVS; WAF rules |
| People see only their own data | Role- or attribute-based access control, least privilege, access recertification |
| Close the doors you did not mean to open | Attack-surface review, environment segregation, hardened baselines |
| Never hand-roll the front door | Federated identity, SSO, MFA, session management standards |
| Do not log people | Data minimisation in telemetry, log retention policy, SIEM ingestion rules |
| Limit how often anyone can knock | Throttling, quota management, bot and DDoS protection |
| Use only parts you can name | SBOM, software composition analysis, supply-chain attestation, patch SLAs |
| Fail closed and fail quietly | Secure failure modes, error-handling standards, no information disclosure |
| Write down what you checked | Control attestation, evidence of testing, risk acceptance records |
| Name the number (users, busiest hour) | Capacity planning, demand forecasting, headroom targets |
| The scale check | Load and soak testing, performance test environments |
| The performance budget | SLIs and SLOs, error budgets, p95/p99 latency objectives, APM |
| Free plans, caps and alerts | FinOps practice, budget variance, showback and chargeback, unit economics |
| Turn it off in five minutes | Documented rollback, kill switch, incident response runbook |
| The Trust Card | System or model card, control self-assessment, service description |
| Explain-back | Effective challenge, accountable owner, three lines of defence |
| The safe change loop | Change management, segregation of duties, release governance |

## What a regulated environment adds

The four guardrails are necessary, not sufficient. Before an app built this way
goes anywhere near an organisation's customers or data, expect to add:

- **Data protection:** DPIA or equivalent, records of processing, lawful basis,
  cross-border transfer assessment, retention and deletion schedules
- **Third-party risk:** assessment of every host and API in the stack, exit plan,
  concentration risk
- **Resilience:** RTO and RPO targets, backup and restore testing, business
  continuity and disaster recovery
- **Assurance:** independent penetration test, code review by a second party,
  vulnerability management with remediation SLAs
- **Where AI is in the product:** model governance, evaluation and drift
  monitoring, human-in-the-loop design, explainability, bias testing, and a
  record of what the model is and is not approved to decide
- **Accessibility:** formal conformance (for example WCAG 2.2 AA), not just the
  basics the programme checks

## Using this with a cohort

Two good moments for it:

1. **At Stage 3**, as a five-minute aside: "the check you just did has a name in
   industry, and here it is." It gives learners vocabulary without changing the work.
2. **After Stage 4**, for anyone whose app will be used inside an employer. Hand
   them this page and the Trust Card together — the Trust Card is the honest
   starting point for a risk conversation, and the gap between it and this list
   is the work remaining.
