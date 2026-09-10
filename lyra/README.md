# Lyra

A safe, multi-model AI workspace for **families** and **schools**. One codebase
serves both: a tenant is either a *family* (parent admin / adult / child) or a
*school* (IT admin / teacher / student). Supervised accounts (children,
students) are routed through content moderation and a Socratic-tutor persona;
conversations are **encrypted at rest** and **isolated per user** — admins see
usage totals, never their kids' or students' chats.

This app was built from an uploaded architecture sketch. The sketch had good
ideas but several parts were **not production-safe** and some marketing claims
were **inaccurate**. Those were corrected here — see
[What changed vs. the original blueprint](#what-changed-vs-the-original-blueprint)
and [`docs/SECURITY.md`](docs/SECURITY.md). Read
[`docs/COMPLIANCE.md`](docs/COMPLIANCE.md) before making any legal/marketing
claims — several (FERPA/COPPA/SOC 2, "bank-grade", "zero-training") require work
and/or counsel and must not be asserted as-is.

## What's implemented

| Area | Status |
| --- | --- |
| Auth (signup, login, invite acceptance) | ✅ scrypt password hashing, signed session tokens, revocation via `token_version` |
| Authorization | ✅ role-based; every action scoped to the caller's tenant |
| Per-user data isolation | ✅ Postgres Row-Level Security (app runs as a non-owner role so RLS is enforced) |
| Encryption at rest | ✅ AES-256-GCM over gzip for all chat content |
| Content moderation (supervised) | ✅ OpenAI moderation, **fails closed** by default |
| Socratic persona + jailbreak hardening | ✅ prompt "sandwich" for supervised users |
| Token budgets | ✅ tenant pool → group (classroom) allocation → per-user cap |
| Multi-model proxy | ✅ OpenRouter, with safe response parsing |
| Billing | ✅ Stripe Checkout + signature-verified webhooks |
| Admin dashboard | ✅ aggregates only (no chat content) |
| Weekly digest | ✅ optional cron, content-free email |
| Gamification | ✅ badges + unlock endpoint (self-only) |
| Web client | ✅ dependency-free SPA (auth, chat, dashboard, badges, invites) |
| Tests | ✅ unit suite + a real-Postgres E2E smoke test |

## Quick start (Docker)

```bash
cd lyra
cp .env.example .env
# Generate real secrets:
#   openssl rand -hex 32   # for JWT_SECRET
#   openssl rand -hex 32   # for CONTENT_ENCRYPTION_KEY
# Fill in POSTGRES_PASSWORD, LYRA_APP_DB_PASSWORD, and (optionally) provider keys.
$EDITOR .env

docker compose up --build -d
docker compose ps            # db + api should be healthy
open http://localhost:5000
```

The `lyra_app` database password in `DATABASE_URL` (inside compose) is derived
from `LYRA_APP_DB_PASSWORD`; keep them in sync via the single env var.

## Quick start (local, no Docker)

```bash
cd lyra
npm install
# Point MIGRATE_DATABASE_URL at a superuser connection to create the app role:
MIGRATE_DATABASE_URL=postgres://owner:pw@localhost:5432/lyra \
LYRA_APP_DB_PASSWORD=apppw npm run migrate

DATABASE_URL=postgres://lyra_app:apppw@localhost:5432/lyra \
JWT_SECRET=$(openssl rand -hex 32) \
CONTENT_ENCRYPTION_KEY=$(openssl rand -hex 32) \
OPENROUTER_API_KEY=... OPENAI_API_KEY=... \
npm start
```

## Tests

```bash
npm test                     # offline unit tests (crypto, tokens, roles, prompts, moderation, llm)
# Full E2E against a real Postgres (RLS + HTTP flow), providers stubbed:
DATABASE_URL=postgres://lyra_app:apppw@127.0.0.1:5432/lyra npm run test:e2e
```

## API surface

| Method + path | Auth | Purpose |
| --- | --- | --- |
| `POST /api/auth/signup` | — | Create a family/school tenant + owner admin |
| `POST /api/auth/login` | — | Password login |
| `POST /api/auth/accept-invite` | — | Activate an invited account |
| `GET /api/auth/me` | user | Current identity |
| `POST /api/chat` | user | Proxy a message (moderation + Socratic for supervised) |
| `GET /api/conversations` | user | List own conversations |
| `GET /api/conversations/:id/messages` | user | Decrypted history (own only) |
| `POST /api/invites` | admin | Create an invite link |
| `GET /api/members` | admin | Roster (no chat content) |
| `POST /api/groups` · `GET /api/groups` | admin | Classrooms / household units |
| `PATCH /api/members/:id` | admin | Pause/resume, cap, reassign group |
| `GET /api/dashboard` | admin | Aggregate usage only |
| `GET /api/badges/me` · `POST /api/badges/unlock` | user | Gamification |
| `POST /api/billing/checkout` | admin | Start a Stripe subscription |
| `POST /api/webhooks/stripe` | Stripe sig | Renewals / plan changes |
| `GET /healthz` · `GET /readyz` | — | Liveness / readiness |

## Architecture

```
src/
  config.js            env + production validation (fails fast on bad secrets)
  db.js                pg pool + withUser() RLS-context transactions
  crypto/              content (AES-256-GCM), password (scrypt), token (HS256 JWT)
  domain/roles.js      family/school roles: admin vs supervised
  services/            prompts, moderation, llm, tokens, billing, email, digest
  middleware/          auth, rate limiting, error handling
  routes/              auth, chat, tenant, dashboard, badges, billing
  app.js / server.js   wiring + boot + cron
db/init.sql            schema, RLS policies, least-privilege app role, seed badges
public/                dependency-free web client
```

## What changed vs. the original blueprint

The uploaded `server.js` / `init.sql` were a starting point. Corrected here:

1. **Added authentication & authorization.** The original accepted `userId`/
   `familyId` from the request body with no auth — any caller could spend
   another family's tokens or read their data. Now every request carries a
   signed session; the server derives identity from it.
2. **Real encryption at rest.** The original gzip-*compressed* content and
   called it "encryption". Gzip is reversible. Content is now AES-256-GCM
   encrypted (over gzip).
3. **Enforced per-user isolation.** The privacy promise ("parents can't read
   kids' chats") had no technical backing. Implemented via Postgres RLS with a
   least-privileged DB role — verified in `test/e2e.mjs` and by direct DB test.
4. **Safe LLM parsing.** `aiData.choices[0].message.content` crashed on any
   provider error; replaced with validated parsing and typed errors.
5. **Moderation fails closed** for supervised users when unavailable.
6. **Correct Stripe webhook.** Raw-body signature verification and robust price
   → quota resolution (the original read `plan?.id` inconsistently).
7. **Atomic-ish token accounting** with documented overage behaviour.

## License

Inherits the repository's [MIT license](../LICENSE).
