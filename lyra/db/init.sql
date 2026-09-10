-- ===========================================================================
-- Lyra schema
-- A safe, multi-model AI workspace for families and schools.
--
-- Design notes:
--   * A "tenant" is either a family or a school (type column). This unifies the
--     two products in one codebase, as agreed in the build scope.
--   * Chat content is stored ENCRYPTED (AES-256-GCM), not merely compressed.
--     The `content` column holds iv || auth_tag || ciphertext produced by the
--     application (src/crypto.js). The database never sees plaintext.
--   * Row-Level Security (RLS) enforces that a user can only read their own
--     conversations/messages. Admins (parent_admin/teacher/it_admin) get
--     AGGREGATE usage only, never message content. For RLS to actually bite,
--     the app connects as the non-owner, non-superuser role `lyra_app`.
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Least-privileged application role. The app authenticates as THIS role so
-- that RLS policies below are enforced (owners/superusers bypass RLS).
-- The password is injected from the LYRA_APP_DB_PASSWORD env var by the
-- docker-entrypoint wrapper (db/00-role.sh). If you run init.sql by hand,
-- set the password yourself afterwards.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lyra_app') THEN
    CREATE ROLE lyra_app LOGIN;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Tenants: a family or a school (the billing + top-level pool boundary).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(10) NOT NULL CHECK (type IN ('family', 'school')),
    name VARCHAR(150) NOT NULL,
    plan_type VARCHAR(40) DEFAULT 'basic',
    stripe_customer_id VARCHAR(255) UNIQUE,
    stripe_subscription_id VARCHAR(255),
    -- Token budget for the current billing period, pooled across the tenant.
    token_pool_limit BIGINT NOT NULL DEFAULT 10000000,
    tokens_consumed_this_period BIGINT NOT NULL DEFAULT 0,
    period_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Family-only "safety word" for verifying a real family member (anti-scam).
    safety_word VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Groups: a classroom (school) or a household unit (family). Optional.
-- A group may carry its own sub-budget; NULL means "draw from tenant pool".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    token_allocation BIGINT,                 -- NULL = shares the tenant pool
    tokens_consumed_this_period BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Users. Roles:
--   family: parent_admin | adult | child
--   school: it_admin | teacher | student
-- "Supervised" roles (child, student) are routed through moderation + the
-- Socratic tutor persona. "Admin" roles can manage the tenant but CANNOT read
-- others' chat content (enforced by RLS).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    email VARCHAR(255) UNIQUE,               -- children may be invited w/o email
    role VARCHAR(20) NOT NULL CHECK (role IN
        ('parent_admin','adult','child','it_admin','teacher','student')),
    first_name VARCHAR(100),
    -- Password (scrypt) is set when a user activates their account. NULL until
    -- then. Supervised child accounts may sign in via a parent-set passcode.
    password_hash TEXT,
    -- Bumping token_version revokes all outstanding session tokens for a user.
    token_version INTEGER NOT NULL DEFAULT 0,
    -- Optional per-user spend cap (teacher can throttle a single student).
    monthly_token_cap BIGINT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Invites (accept-to-activate). Token is a random 32-byte hex string.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    email VARCHAR(255),
    first_name VARCHAR(100),
    role VARCHAR(20) NOT NULL CHECK (role IN
        ('parent_admin','adult','child','it_admin','teacher','student')),
    token_hash TEXT UNIQUE NOT NULL,         -- SHA-256 of the invite token
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Conversations & messages. `content` is application-encrypted (AES-256-GCM).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(255) DEFAULT 'New chat',
    model_used VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_role VARCHAR(20) NOT NULL CHECK (sender_role IN ('user','assistant')),
    content BYTEA NOT NULL,                  -- iv || auth_tag || ciphertext
    tokens_used INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Usage events: content-free record of token spend, powering admin dashboards
-- and the weekly digest WITHOUT exposing any chat text.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model VARCHAR(80),
    tokens_used INTEGER NOT NULL DEFAULT 0,
    was_flagged BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Gamification.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    subject VARCHAR(50) NOT NULL,
    icon_emoji VARCHAR(12) DEFAULT '🏆',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    badge_id UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, badge_id)
);

-- ---------------------------------------------------------------------------
-- Admin/security audit log (who did what; supports compliance reviews).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(80) NOT NULL,
    target VARCHAR(255),
    ip INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_group ON users(group_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_usage_tenant_time ON usage_events(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage_events(user_id, created_at);

-- ---------------------------------------------------------------------------
-- Helper functions reading the per-request context set via `SET LOCAL`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

-- A user sees only their own conversations. No admin content-peeking path.
DROP POLICY IF EXISTS conversations_owner ON conversations;
CREATE POLICY conversations_owner ON conversations
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

DROP POLICY IF EXISTS messages_owner ON messages;
CREATE POLICY messages_owner ON messages
  USING (conversation_id IN (
      SELECT id FROM conversations WHERE user_id = app_current_user_id()))
  WITH CHECK (conversation_id IN (
      SELECT id FROM conversations WHERE user_id = app_current_user_id()));

-- Usage events (content-free) are readable tenant-wide so admins can build
-- aggregate dashboards; writable only for the acting user's own rows.
DROP POLICY IF EXISTS usage_read ON usage_events;
CREATE POLICY usage_read ON usage_events
  FOR SELECT USING (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS usage_write ON usage_events;
CREATE POLICY usage_write ON usage_events
  FOR INSERT WITH CHECK (user_id = app_current_user_id());

-- ---------------------------------------------------------------------------
-- Grants for the application role. It gets DML but is NOT the owner, so RLS
-- applies. Tables not under RLS are still guarded at the application layer.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO lyra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lyra_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO lyra_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lyra_app;

-- ---------------------------------------------------------------------------
-- Seed a starter badge catalogue.
-- ---------------------------------------------------------------------------
INSERT INTO badges (title, description, subject, icon_emoji) VALUES
  ('Curious Starter', 'Completed your first guided learning session.', 'general', '🌱'),
  ('Bug Hunter Cadet', 'Found your first syntax bug in the code sandbox.', 'coding', '🐛'),
  ('Loop Master', 'Demonstrated understanding of iterative structures.', 'coding', '🔄'),
  ('Fluent Explorer', 'Completed 5 conversational language scenarios.', 'language', '🌍'),
  ('Persistent Thinker', 'Worked through a hard problem step by step.', 'general', '🧠')
ON CONFLICT (title) DO NOTHING;
