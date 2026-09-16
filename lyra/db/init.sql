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
-- Consent records: an auditable trail of the authorizing adult's consent to
-- provision a MINOR account (COPPA verifiable parental consent / school
-- in-loco-parentis authorization). Captured when an admin invites a supervised
-- role. Records WHO consented, WHEN, to WHAT (role), and the consent text
-- version, so consent can be evidenced and re-collected if the text changes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consent_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invite_id UUID REFERENCES invites(id) ON DELETE SET NULL,
    subject_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    consented_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    subject_role VARCHAR(20) NOT NULL,
    consent_type VARCHAR(40) NOT NULL,       -- e.g. 'minor_provisioning'
    consent_text_version VARCHAR(40) NOT NULL,
    ip INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consent_tenant ON consent_records(tenant_id);

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

-- ===========================================================================
-- Phase 1: per-tenant knowledge base for Retrieval-Augmented Generation (RAG).
--
-- This is what makes the tutor "context-bound": a school (or family) provides
-- its own materials; retrieval is filtered to the caller's tenant, ENFORCED by
-- RLS (not just app code). A tenant physically cannot retrieve another's chunks.
-- Chunk text is encrypted at rest (like chat); a short, non-sensitive citation
-- label is kept in the clear so answers can cite their source.
-- ===========================================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- A source document/collection the tenant added (upload, connector, curriculum).
CREATE TABLE IF NOT EXISTS knowledge_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(300) NOT NULL,
    kind VARCHAR(40) NOT NULL DEFAULT 'upload',   -- upload | curriculum | oer | connector
    uri TEXT,
    license VARCHAR(120),                          -- e.g. 'CC BY 4.0', 'school-owned'
    subject VARCHAR(60),
    year_level VARCHAR(30),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    chunk_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Embedded, retrievable chunks. EMBEDDING_DIM (config) must match vector(N).
CREATE TABLE IF NOT EXISTS chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
    ordinal INT NOT NULL,
    citation_label VARCHAR(300),                   -- e.g. 'Room 3B Fractions Unit · p2'
    content_ciphertext BYTEA NOT NULL,             -- AES-256-GCM, like messages
    embedding vector(1536),
    embed_model VARCHAR(60),
    token_count INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source_id);
-- HNSW ANN index on cosine distance (embeddings are L2-normalized in the app).
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
    ON chunks USING hnsw (embedding vector_cosine_ops);

-- RLS: knowledge is TENANT-scoped (the whole school/family shares its KB),
-- unlike conversations which are per-user. Isolation across tenants is absolute.
ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ks_tenant ON knowledge_sources;
CREATE POLICY ks_tenant ON knowledge_sources
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS chunks_tenant ON chunks;
CREATE POLICY chunks_tenant ON chunks
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

-- New tables need explicit grants (the earlier ALL TABLES grant ran before this).
GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_sources TO lyra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON chunks TO lyra_app;

-- ===========================================================================
-- Phase 2: per-user appearance preferences (theme + accent colour).
-- Applied as ALTERs so existing databases upgrade in place.
-- ===========================================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_pref  VARCHAR(10) NOT NULL DEFAULT 'system';
ALTER TABLE users ADD COLUMN IF NOT EXISTS accent_pref VARCHAR(20) NOT NULL DEFAULT 'indigo';

-- ===========================================================================
-- Phase 4: families/schools choose which context the tutor may use per child.
--
-- Shared curriculum packs (e.g. Australian Curriculum by year/subject) live in
-- a dedicated "Lyra Curriculum Library" tenant and are tagged with a scope_key
-- like 'au:year4:maths'. They are read under that library's own tenant context,
-- so no RLS is relaxed. A per-child `child_context` row records which shared
-- packs and which of the family's own sources are active for that child; the
-- tutor retrieves only from the selected set.
-- ===========================================================================
ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS scope_key VARCHAR(80);
CREATE INDEX IF NOT EXISTS idx_ks_scope ON knowledge_sources(scope_key);

-- The well-known library tenant that holds shared curriculum packs.
INSERT INTO tenants (id, type, name, token_pool_limit)
VALUES ('00000000-0000-4000-8000-000000000001', 'school', 'Lyra Curriculum Library', 0)
ON CONFLICT (id) DO NOTHING;

-- One row per supervised child: what context is enabled for them.
CREATE TABLE IF NOT EXISTS child_context (
    child_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    year_level VARCHAR(30),
    region VARCHAR(30),                         -- e.g. 'AU-NSW'
    scope_keys TEXT[] NOT NULL DEFAULT '{}',    -- selected shared packs
    enabled_source_ids UUID[],                  -- NULL = all family sources
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE child_context ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS child_ctx_tenant ON child_context;
CREATE POLICY child_ctx_tenant ON child_context
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON child_context TO lyra_app;

-- ===========================================================================
-- Tier A: Stripe webhook idempotency.
--
-- Stripe delivers each event at-least-once and retries on any non-2xx, so the
-- same event id can arrive multiple times. We record each processed event id
-- and skip duplicates, so a replay never double-applies a quota reset or plan
-- change. This table is NOT tenant-scoped (it keys on Stripe's global event id)
-- and carries no user content, so it is not under RLS.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS processed_webhook_events (
    event_id   VARCHAR(255) PRIMARY KEY,   -- Stripe event id (evt_...)
    type       VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT SELECT, INSERT, DELETE ON processed_webhook_events TO lyra_app;

-- ===========================================================================
-- Tier B: defense-in-depth RLS + data-retention purge.
-- ===========================================================================

-- FORCE RLS so policies apply even to the table OWNER. The app already connects
-- as the non-owner lyra_app (so RLS bites regardless), but this closes the gap
-- if someone ever points the app at an owner/superuser connection by mistake.
-- Roles with the BYPASSRLS attribute (e.g. the migration owner) still bypass —
-- which is what lets the SECURITY DEFINER purge function below run.
ALTER TABLE conversations     FORCE ROW LEVEL SECURITY;
ALTER TABLE messages          FORCE ROW LEVEL SECURITY;
ALTER TABLE usage_events      FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE chunks            FORCE ROW LEVEL SECURITY;
ALTER TABLE child_context     FORCE ROW LEVEL SECURITY;

-- Retention purge. Deleting old chat spans every user's rows, which per-user RLS
-- deliberately hides from the app role — so this runs as a SECURITY DEFINER
-- function owned by the schema owner (a BYPASSRLS role). It deletes conversations
-- (messages cascade) untouched for `retention_days`, plus expired unaccepted
-- invites. retention_days <= 0 (or NULL) is a no-op. The app role may only
-- EXECUTE it; it cannot read across tenants any other way.
CREATE OR REPLACE FUNCTION purge_old_data(retention_days INT)
RETURNS TABLE(deleted_conversations BIGINT, deleted_invites BIGINT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE conv BIGINT := 0; inv BIGINT := 0;
BEGIN
  IF retention_days IS NULL OR retention_days <= 0 THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint;
    RETURN;
  END IF;
  DELETE FROM conversations WHERE updated_at < NOW() - make_interval(days => retention_days);
  GET DIAGNOSTICS conv = ROW_COUNT;  -- messages cascade via FK
  DELETE FROM invites WHERE accepted_at IS NULL AND expires_at < NOW();
  GET DIAGNOSTICS inv = ROW_COUNT;
  RETURN QUERY SELECT conv, inv;
END;
$$;
-- Only the app role may call it; nobody else needs to.
REVOKE ALL ON FUNCTION purge_old_data(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_old_data(INT) TO lyra_app;
