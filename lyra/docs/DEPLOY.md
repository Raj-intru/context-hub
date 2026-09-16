# Deploying Lyra

## Options

- **Single box / self-host:** `docker compose up --build -d` (ships Postgres +
  API). Good for pilots.
- **Managed platform (recommended for production):** run the API container on
  your platform of choice and point `DATABASE_URL` at a **managed Postgres**
  (RDS, Cloud SQL, Supabase, Neon). Run `npm run migrate` once against a
  privileged connection to create the schema + `lyra_app` role.

## Fast path — Railway/Render/Fly (persistent server, zero refactor)

The app is a normal long-lived Node server, so a persistent host is the least
work and runs the in-process cron (weekly digest) as-is.

```bash
# 1. Provision a managed Postgres WITH pgvector (Neon/Supabase/RDS) in your
#    users' region (AU schools: ap-southeast-2). Grab a superuser URL for
#    migration and the pooled URL for the app (as the lyra_app role).
# 2. Create schema + app role:
MIGRATE_DATABASE_URL=postgres://owner:...@host/lyra LYRA_APP_DB_PASSWORD=... npm run migrate
# 3. (optional) seed shared curriculum:
DATABASE_URL=postgres://lyra_app:...@host/lyra node scripts/ingest-au-curriculum.js
# 4. Deploy: Railway/Render pick up the Procfile (`web: node src/server.js`).
#    Set env: DATABASE_URL, JWT_SECRET, CONTENT_ENCRYPTION_KEY, OPENROUTER_API_KEY,
#    OPENAI_API_KEY, DEFAULT_MODEL_SIMPLE/COMPLEX, PRODUCT, ENABLE_WEEKLY_DIGEST=true.
```

## Vercel (serverless)

`api/index.js` exports the Express app for `@vercel/node`; `vercel.json` routes
everything to it and registers a weekly-digest cron. Because functions aren't
long-lived, use a **pooled** Postgres URL and Vercel Cron (not node-cron).

```bash
npm i -g vercel && cd lyra && vercel link
vercel env add DATABASE_URL            # Neon POOLED url (…-pooler…), lyra_app role
vercel env add JWT_SECRET              # openssl rand -hex 32
vercel env add CONTENT_ENCRYPTION_KEY  # openssl rand -hex 32
vercel env add OPENROUTER_API_KEY
vercel env add OPENAI_API_KEY
vercel env add CRON_SECRET             # openssl rand -hex 24 (Vercel Cron auth)
vercel env add DEFAULT_MODEL_SIMPLE
vercel env add DEFAULT_MODEL_COMPLEX
vercel deploy --prod
```

Two offerings = two Vercel projects from the same repo, each with `PRODUCT=family`
or `PRODUCT=school` and its own domain.

## Model routing (OSS ↔ paid) + the AI gateway

`src/services/router.js` picks the cheap OSS model (`DEFAULT_MODEL_SIMPLE`) for
supervised/simple turns and the frontier paid model (`DEFAULT_MODEL_COMPLEX`)
for complex adult turns. This is the gross-margin lever — tune the model ids per
your cost target. Two safety rules override cost:

- **Supervised accounts are locked to the routed model.** A child/student turn
  always uses the routed simple (or simple-vision) model; a client-supplied
  `model` is ignored. Adults may pin a model, but only one in the allowlist
  (`MODEL_ALLOWLIST` plus the routed/vision defaults) — an unknown id falls back
  to auto-routing instead of being proxied upstream.
- **Modality-aware routing.** A turn that carries an image is routed to a
  vision-capable model (`VISION_MODEL_SIMPLE` / `VISION_MODEL_COMPLEX`). The
  model registry (`src/services/models.js`) records each model's modalities and
  whether it is `supervisedSafe`; unknown ids are treated as text-only and
  not-supervised-safe (fail closed).

### The gateway ("universal key")

Every model call goes through one gateway (`src/services/gateway.js`) so the app
never holds Anthropic/OpenAI/Google keys directly:

- **Family (default):** OpenRouter — one key, OSS + paid, automatic fallbacks.
- **School (residency):** point `LYRA_GATEWAY_BASE_URL`/`LYRA_GATEWAY_API_KEY`
  at a self-hosted OpenAI-compatible gateway (e.g. LiteLLM) running in-region.
- **BYOK:** map a tenant to its own gateway/key via `LYRA_TENANT_GATEWAYS`
  (JSON `tenantId -> {baseUrl, apiKey}`). **This env map is a stopgap** — in
  production those keys belong in a secret manager / KMS, injected at runtime,
  never committed and never logged.

### Multimodal safety

Image inputs from **supervised** users are moderated (`omni-moderation-latest`,
image parts) with the same fail-closed contract as text: no moderation key →
images are blocked for minors unless `MODERATION_FAIL_OPEN=true`. Image
**generation** is off by default (`ALLOW_IMAGE_GENERATION=false`) and is never
enabled for minors regardless of that flag. `MAX_ATTACHMENTS` caps images/turn.

### Recommended models

| Need | Model(s) | Notes |
|------|----------|-------|
| Cheap text + vision (default supervised/simple) | `google/gemini-flash-1.5` | low cost, multimodal |
| OSS vision / OCR (homework photos, worksheets) | `qwen/qwen-2-vl-7b-instruct`, `meta-llama/llama-3.2-11b-vision-instruct` | self-hostable for residency |
| Complex reasoning + vision (adult) | `anthropic/claude-3.5-sonnet`, `openai/gpt-4o` | frontier tier |
| Newer Claude tier | Opus/Sonnet/Haiku (per your gateway's slugs) | add to `src/services/models.js` and set the routing envs |

Add any model to the registry with its modalities + `supervisedSafe` flag, then
point the routing envs at it — callers don't change.

## Required environment

See `.env.example`. In production the server **refuses to boot** without real
`JWT_SECRET` and `CONTENT_ENCRYPTION_KEY` (32 bytes hex each). Generate with
`openssl rand -hex 32`. Store them in your platform's secret manager, not in the
image.

Minimum to run:

- `DATABASE_URL` (as the `lyra_app` role)
- `JWT_SECRET`, `CONTENT_ENCRYPTION_KEY`
- `OPENROUTER_API_KEY` (chat), `OPENAI_API_KEY` (moderation for minors)

Billing/email are optional; the app degrades gracefully without them.

## Database & RLS (do not skip)

The app **must** connect as `lyra_app`, a non-owner role, or Row-Level Security
is silently bypassed. `db/init.sql` creates the role and grants; the compose
file wires `DATABASE_URL` to it. On managed Postgres, `npm run migrate` applies
the same SQL — run it with a superuser/owner connection
(`MIGRATE_DATABASE_URL`), then confirm:

```sql
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'lyra_app';
-- expect: f | f   (NOT superuser, does NOT bypass RLS)
```

Enable **encrypted storage and encrypted automated backups** at the DB layer in
addition to the app-level content encryption.

## Stripe

1. Create products/prices; put the price → token-quota mapping in
   `STRIPE_PRICE_QUOTAS` (JSON).
2. Set `STRIPE_SECRET_KEY`.
3. Create a webhook endpoint pointing at `POST /api/webhooks/stripe`, subscribe
   to `checkout.session.completed`, `customer.subscription.created|updated|
   deleted`, and `invoice.payment_succeeded`; put its signing secret in
   `STRIPE_WEBHOOK_SECRET`.
4. Test locally with `stripe listen --forward-to localhost:5000/api/webhooks/stripe`.

The webhook uses raw-body signature verification — do not put a body-rewriting
proxy in front of that path.

## Scaling notes

- The app is stateless (sessions are signed tokens) → scale horizontally behind
  a load balancer. Set `trust proxy` is already enabled.
- **Rate limiting is in-memory** → per instance. For multiple instances, move it
  to Redis, or enforce limits at your API gateway.
- Point `APP_BASE_URL` at your public URL (used in invite links + Stripe
  redirects).
- The weekly-digest cron (`ENABLE_WEEKLY_DIGEST=true`) runs in-process; if you
  run many API replicas, run it on exactly one (a dedicated worker or a leader
  lock) to avoid duplicate emails.

## Data rights & retention

- **Export** — `GET /api/me/export` returns the caller's own conversations,
  decrypted, as a JSON download (RLS guarantees own-rows-only).
- **Erasure** — `DELETE /api/me/account` deletes an adult's own account
  (cascades remove their chat/usage/badges); a minor is removed by a guardian
  via `DELETE /api/members/:id`. The last active admin cannot delete themselves.
- **Retention** — set `RETENTION_DAYS` and schedule `GET /api/cron/retention`
  (same `CRON_SECRET` auth as the digest; add a Vercel Cron entry or a node-cron
  job). It runs the `purge_old_data()` SECURITY DEFINER function to delete
  conversations/messages past the window plus expired unaccepted invites. `0`
  disables it. See `docs/legal/DPA_TEMPLATE.md` for the processor commitments.

## Health checks

- `GET /healthz` — process is up.
- `GET /readyz` — DB reachable (use for load-balancer readiness).

## Backups & DR

- Automated encrypted Postgres backups + tested restores.
- Keep `CONTENT_ENCRYPTION_KEY` backed up **separately and securely** — losing it
  makes all stored chat content unrecoverable.
