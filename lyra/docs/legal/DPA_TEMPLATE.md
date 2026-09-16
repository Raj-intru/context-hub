# Data Processing Addendum — TEMPLATE (not legal advice)

> ⚠️ **Drafting template, not a finished legal document.** Review with counsel
> and align every statement with your real configuration, sub-processors, and
> contracts. It deliberately avoids the inaccurate claims in the original
> material (e.g. an unqualified "zero-training guarantee"); see
> `docs/COMPLIANCE.md` for what the implementation actually supports.

_Between **[CUSTOMER]** ("Controller") and **[PROVIDER]** ("Processor")._
_Effective: [DATE]. Forms part of the Terms of Service._

## 1. Roles & scope
The Processor processes Personal Data solely to provide the Lyra service, on the
Controller's documented instructions. For a **school** deployment the school is
typically the Controller (or acts in loco parentis / under a school-official
exception); for a **family** deployment the account-holding adult is the
Controller for their household. Processing outside these instructions requires
written agreement or is compelled by law (with notice where lawful).

## 2. Categories of data & data subjects
- **Data subjects:** account holders, adult members, and supervised minors
  (children / students).
- **Personal Data:** name, email, role, group membership; conversation content;
  usage metadata (token counts, model, timestamps, moderation-flag flags);
  consent records for minors; limited billing metadata (via Stripe).
- **Special-category / minors' data:** conversation content may include it;
  minors' data is processed only after recorded parental/institutional consent.

## 3. Sub-processors
The Processor uses the sub-processors listed in **Annex A** and will give the
Controller [30] days' notice of additions, during which the Controller may
object. Current categories:
- **AI model providers** — reached through the configured gateway (e.g.
  OpenRouter, or a self-hosted LiteLLM gateway). The specific upstream models
  are configurable per deployment; see `docs/DEPLOY.md`.
- **Hosting / managed Postgres** — [e.g. Neon / RDS / Supabase], region [•].
- **Moderation** — [OpenAI moderation] for supervised accounts.
- **Email** — [e.g. Resend] for digests/invites, if enabled.
- **Billing** — Stripe.

State in Annex A, per provider: purpose, region, and whether inputs may be used
for model training. Do **not** assert "no training" for any provider unless that
provider's contract actually says so for your plan.

## 4. Security measures
- Chat content and knowledge-base chunks encrypted at rest (AES-256-GCM);
  the database stores ciphertext only.
- Per-user isolation enforced in the database by Row-Level Security (the app
  connects as a non-owner role; FORCE RLS applies policies even to the owner).
- Passwords hashed with scrypt; sessions are signed tokens with revocation.
- Supervised (minor) inputs — text and images — pass content moderation that
  fails closed; the Socratic persona is applied with prompt-injection hardening.
- Least-privilege access, audit logging of admin actions, encrypted backups.
- Full model and honest limitations: `docs/SECURITY.md`.

## 5. International transfers
Where the configured gateway/hosting processes data outside the Controller's
region, transfers rely on [SCCs / adequacy / your mechanism]. For data-residency
requirements (e.g. AU schools), deploy the self-hosted in-region gateway and an
in-region Postgres so content does not leave the region (`docs/DEPLOY.md`).

## 6. Data-subject rights (assistance to the Controller)
The service provides:
- **Access / portability** — `GET /api/me/export` (own conversations, decrypted).
- **Erasure** — `DELETE /api/me/account` (self, adults) and
  `DELETE /api/members/:id` (guardian/admin-initiated, incl. minors); deletion
  cascades to conversations, messages, and usage.
- **Restriction** — pause a member (revokes sessions) via the members API.
The Processor will assist the Controller in responding to data-subject requests
it receives directly, without undue delay.

## 7. Retention & deletion
Content is retained until deleted by the user/admin or purged by the retention
job (`RETENTION_DAYS` / `purge_old_data()`), whichever is first. On termination
the Processor deletes or returns Personal Data within [30] days, except where
retention is legally required. Encrypted backups age out per the backup policy.

## 8. Breach notification
The Processor notifies the Controller without undue delay and within [72] hours
of becoming aware of a Personal Data breach, with the information needed for the
Controller's own obligations.

## 9. Audits
The Processor makes available information necessary to demonstrate compliance and
allows for audits [subject to reasonable notice and confidentiality], or provides
third-party audit reports where available.

## 10. Liability & term
Liability and term follow the main agreement. This DPA survives for as long as
the Processor processes Personal Data on the Controller's behalf.

---
**Annex A — Sub-processors:** [table: name · purpose · region · training-use? · safeguards]
**Annex B — Technical & organizational measures:** cross-reference `docs/SECURITY.md`.
