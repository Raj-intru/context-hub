# Security model & honest limitations

This document states what Lyra actually enforces, and — just as importantly —
what it does **not**. Please keep marketing language aligned with this file.

## Identity & sessions

- Passwords are hashed with **scrypt** (`src/crypto/password.js`), stored in a
  self-describing format so parameters can evolve.
- Sessions are stateless **HS256 tokens** (`src/crypto/token.js`) carrying the
  user id, tenant id, role, and a `token_version`.
- **Revocation:** bumping `users.token_version` invalidates all outstanding
  sessions for that user. Pausing a member does this automatically.
- Login uses a constant-ish-time path and a dummy verify for unknown emails to
  reduce account-enumeration signal. This is a mitigation, not a guarantee.

## Data isolation (the core privacy promise)

Two layers, defence in depth:

1. **Application authorization** — routes derive identity from the session and
   scope every query to the caller's tenant; children/students can only touch
   their own conversations.
2. **Postgres Row-Level Security** — `conversations`, `messages`, and
   `usage_events` carry RLS policies keyed to a per-request context set with
   `set_config('app.user_id', …)`. Crucially, the app connects as the
   **non-owner `lyra_app` role**, because table owners and superusers *bypass*
   RLS. This is what makes the isolation real rather than decorative.

   Verified in `test/e2e.mjs` and by a direct DB test: a second child sees `0`
   of another child's conversations and is refused when trying to write into
   one (`new row violates row-level security policy`).

**Admins cannot read chat content.** There is no code path that decrypts and
returns another user's messages to an admin. Dashboards read only the
content-free `usage_events` table. This backs the "see stats, not chats" claim.

## Encryption at rest

- Chat content is stored as `iv(12) || authTag(16) || ciphertext`, where
  ciphertext is **AES-256-GCM** over gzip-compressed plaintext
  (`src/crypto/content.js`). Tampering fails the GCM auth check.
- The key comes from `CONTENT_ENCRYPTION_KEY` (32 bytes / 64 hex). It must be
  managed as a secret (KMS/secret manager in production).
- **Key rotation is not yet automated.** Rotating the key without re-encrypting
  existing rows makes old messages undecryptable. A rotation job (decrypt with
  old key, re-encrypt with new) is a required follow-up before you advertise
  rotation. Encrypting per-message keys with a KMS-wrapped data key is the
  recommended next step.
- Encryption is at the application layer; also enable disk/volume encryption and
  encrypted backups at the infrastructure layer.

## Content safety for minors

- Supervised roles (child/student) are run through OpenAI moderation
  (`src/services/moderation.js`) **before** the model call.
- It **fails closed**: if moderation is unavailable, the request is blocked.
  `MODERATION_FAIL_OPEN=true` reverses this — only set it if you accept the risk.
- The Socratic persona uses a prompt "sandwich" (`src/services/prompts.js`) that
  brackets the conversation with safety instructions.

  **Honest limitation:** a prompt sandwich raises the cost of trivial jailbreaks;
  it is **not** a proof against a determined attacker. Real safety is the layered
  combination of moderation + persona + model choice + human review of flagged
  events (surfaced on the admin dashboard). Do not claim the tutor is
  "unbreakable" or "jailbreak-proof".

## Abuse & availability

- Auth and chat endpoints are rate-limited (`src/middleware/rateLimit.js`). The
  limiter is **in-memory**, so it is per-instance; for multi-instance
  deployments back it with Redis.
- Token budgets are enforced with a soft pre-check then atomic increment.
  Concurrent requests at the boundary can overshoot a budget slightly — standard
  for metered APIs. If you require hard caps, add a reservation step.
- Request bodies are capped (`256kb`; prompts `12k` chars).

## Transport & headers

- Baseline headers are set (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, COOP). Terminate TLS at your proxy/load balancer.
- For the web client, add a strict **Content-Security-Policy** at your edge; the
  app ships no inline-script CSP yet.

## Secrets & config

- `src/config.js` **refuses to boot in production** with missing/placeholder
  `JWT_SECRET` or `CONTENT_ENCRYPTION_KEY`, or a dev encryption key.
- Never commit `.env`. The database `lyra_app` password is provisioned from
  `LYRA_APP_DB_PASSWORD`, not baked into SQL.

## Known gaps / follow-ups before "production-hardened"

- [ ] Automated encryption-key rotation + envelope encryption via KMS.
- [ ] Redis-backed rate limiting and token reservations for multi-instance.
- [ ] Email verification + password reset flows.
- [ ] CSRF is not a concern for the token-in-header design, but if you move to
      cookie sessions, add CSRF protection.
- [ ] Edge CSP, WAF, and DDoS protection.
- [ ] Dependency scanning + `npm audit` in CI; SAST/DAST.
- [ ] Third-party penetration test.
- [ ] Data-subject request tooling (export/delete) — see COMPLIANCE.md.
