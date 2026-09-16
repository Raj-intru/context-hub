# Compliance notes (read before making any claims)

**This is engineering guidance, not legal advice.** The uploaded chat asserted
FERPA / COPPA / SOC 2 compliance and "bank-grade" / "zero-training" guarantees
as if already achieved. They are **not**. Below is what is true today, what the
architecture *supports*, and what still requires work and/or counsel. Do not put
compliance claims on a website or sales deck without a qualified reviewer.

## Claim-by-claim

| Claim from the original material | Accurate status |
| --- | --- |
| "Bank-grade encryption / encrypted at rest" | Chat content **is** AES-256-GCM encrypted at rest now. "Bank-grade" is marketing puffery — avoid it; describe the actual algorithm instead. |
| "Zero-training guarantee" | You **cannot** guarantee this yourself — it depends on each provider's data-use terms (OpenRouter routes to many providers). State the provider terms you actually rely on and link them; don't promise on their behalf. |
| "RLS makes us FERPA compliant" | RLS is a strong access-control building block and is genuinely enforced here. FERPA compliance is an **organizational** program (contracts, data-handling, breach process, parental/eligible-student rights), not a single feature. |
| "COPPA compliant" | The parent-provisioned model supports **verifiable parental consent** patterns, but COPPA compliance also requires a compliant privacy notice, data-minimization, retention limits, and deletion on request. Treat as "designed to support", not "compliant". |
| "SOC 2 Type II" | Not achieved. SOC 2 requires an auditor and months of evidence. The audit log (`audit_log`) and access controls help, but this is a program with Vanta/Drata-style tooling + an audit, not a code feature. |
| "PCI-DSS handled by Stripe" | Broadly correct **iff** you use Stripe Checkout/Elements and never touch raw card data — which this app does (redirect to Stripe Checkout; card data never hits the server). Keep it that way (SAQ-A scope). |

## What the architecture already gives you

- **Verifiable parental/institutional consent (implemented):** provisioning a
  supervised (child/student) account requires the admin to acknowledge a
  versioned consent statement. Each acknowledgement is written to
  `consent_records` — who consented, when, the subject role, the consent text
  version, and IP — and is linked to the minor's account when they activate.
  The API refuses a minor invite without it (`CONSENT_REQUIRED`) and refuses a
  stale consent version (`CONSENT_OUTDATED`). See `src/domain/consent.js`,
  `POST /api/invites`, and the E2E test. Note: this records the authorizing
  adult's acknowledgement; it is not, by itself, identity verification of that
  adult — pair with an appropriate COPPA verifiable-consent method (e.g.
  a nominal card charge via Stripe, or signed form) for under-13 in the US.
- **Data isolation & least privilege:** RLS + non-owner DB role.
- **Audit trail:** `audit_log` records admin actions (invites, member changes).
  Extend to cover logins and data exports for audit readiness.
- **Content-free admin visibility:** aggregates only, supporting the "we don't
  read children's messages" posture.

## Required before you can credibly claim COPPA/FERPA support

- [ ] Privacy notice + Terms reviewed by counsel (drafts in `docs/legal/` are
      **templates**, clearly marked, and must be reviewed).
- [ ] **Data retention & deletion:** implement retention limits and a
      data-subject **export + delete** path (there is a to-do for this; the
      schema's `ON DELETE CASCADE` makes account deletion clean).
- [x] **Consent capture:** persist the consenting admin, timestamp, and scope
      (done — `consent_records`). Still to add for US under-13: a verifiable
      consent *method* (not just acknowledgement).
- [ ] **Data Processing Agreements** with each subprocessor you actually use
      (OpenRouter, the underlying model providers, OpenAI moderation, Stripe,
      your email provider, your host).
- [ ] **Subprocessor list** published and kept current.
- [ ] **Incident response / breach notification** process.
- [ ] For schools: a **student-data-privacy addendum** (many US states/districts
      require their own; e.g. the SDPC national DPA).

## Data flow (for your privacy notice)

Prompt from a supervised user → OpenAI moderation → (if allowed) OpenRouter →
model provider → response. Prompt + response are encrypted and stored. Token
counts (no content) are recorded for budgeting and admin dashboards. Disclose
each of these processors in your privacy notice.
