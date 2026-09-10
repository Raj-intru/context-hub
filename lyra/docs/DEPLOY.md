# Deploying Lyra

## Options

- **Single box / self-host:** `docker compose up --build -d` (ships Postgres +
  API). Good for pilots.
- **Managed platform (recommended for production):** run the API container on
  your platform of choice and point `DATABASE_URL` at a **managed Postgres**
  (RDS, Cloud SQL, Supabase, Neon). Run `npm run migrate` once against a
  privileged connection to create the schema + `lyra_app` role.

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

## Health checks

- `GET /healthz` — process is up.
- `GET /readyz` — DB reachable (use for load-balancer readiness).

## Backups & DR

- Automated encrypted Postgres backups + tested restores.
- Keep `CONTENT_ENCRYPTION_KEY` backed up **separately and securely** — losing it
  makes all stored chat content unrecoverable.
