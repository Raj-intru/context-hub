-- agentic-bank schema.
--
-- Every table has the same shape: a text primary key and a jsonb document.
-- That is a deliberate trade. The application owns the domain types (Money is
-- an integer minor-unit string, a mandate is a nested structure), so a wide
-- relational schema would duplicate those definitions and let them drift. What
-- the database owns instead is the set of invariants the application must never
-- be able to violate, enforced here and not merely asserted in code:
--
--   * postings and audit records cannot be updated or deleted, ever;
--   * every transaction's postings sum to zero, per currency, checked at commit;
--   * an idempotency key maps to at most one transaction.
--
-- Generated columns project the fields that are queried or indexed out of the
-- document, so those invariants and the indexes are real SQL, not conventions.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- customers
create table if not exists entities (
  id          text primary key,
  data        jsonb not null,
  segment     text generated always as (data->>'segment') stored,
  group_id    text generated always as (data->>'groupId') stored,
  created_at  timestamptz not null default now()
);
create index if not exists entities_group_idx on entities (group_id) where group_id is not null;
create index if not exists entities_data_idx on entities using gin (data jsonb_path_ops);

create table if not exists users (
  id          text primary key,
  data        jsonb not null,
  entity_id   text generated always as (data->>'entityId') stored references entities (id),
  created_at  timestamptz not null default now()
);
create index if not exists users_entity_idx on users (entity_id);
create index if not exists users_data_idx on users using gin (data jsonb_path_ops);

create table if not exists agents (
  id          text primary key,
  data        jsonb not null,
  entity_id   text generated always as (data->>'entityId') stored references entities (id),
  created_at  timestamptz not null default now()
);
create index if not exists agents_entity_idx on agents (entity_id);
create index if not exists agents_data_idx on agents using gin (data jsonb_path_ops);

-- ------------------------------------------------------------------- ledger
create table if not exists accounts (
  id          text primary key,
  data        jsonb not null,
  entity_id   text generated always as (data->>'entityId') stored references entities (id),
  currency    text generated always as (data->>'currency') stored,
  purpose     text generated always as (data->>'purpose') stored,
  status      text generated always as (data->>'status') stored,
  created_at  timestamptz not null default now(),
  constraint accounts_status_known check (data->>'status' in ('active', 'frozen', 'closed')),
  constraint accounts_type_known check (data->>'type' in ('asset','liability','equity','income','expense'))
);
create index if not exists accounts_entity_idx on accounts (entity_id);
create index if not exists accounts_purpose_idx on accounts (entity_id, purpose, currency);
create index if not exists accounts_data_idx on accounts using gin (data jsonb_path_ops);

-- Cached cleared balance. Derived from `postings`; /v1/admin/integrity
-- recomputes it and reports any drift.
create table if not exists balances (
  id            text primary key references accounts (id),
  data          jsonb not null,
  balance_minor numeric(38, 0) generated always as ((data->>'balanceMinor')::numeric) stored,
  updated_at    timestamptz not null default now()
);

create table if not exists transactions (
  id               text primary key,
  data             jsonb not null,
  idempotency_key  text generated always as (data->>'idempotencyKey') stored,
  type             text generated always as (data->>'type') stored,
  -- Dates and timestamps are projected as text, not as date/timestamptz: those
  -- casts are STABLE (they read DateStyle/TimeZone) and Postgres only accepts
  -- an IMMUTABLE expression in a generated column. ISO-8601 sorts and ranges
  -- correctly as text, which is the reason the application writes ISO-8601.
  value_date       text generated always as (data->>'valueDate') stored,
  posted_at        text generated always as (data->>'postedAt') stored,
  created_at       timestamptz not null default now()
);
-- A retried instruction must never become a second transaction.
create unique index if not exists transactions_idempotency_key_uniq
  on transactions (idempotency_key);
create index if not exists transactions_value_date_idx on transactions (value_date);
create index if not exists transactions_data_idx on transactions using gin (data jsonb_path_ops);

create table if not exists postings (
  id              text primary key,
  data            jsonb not null,
  transaction_id  text generated always as (data->>'transactionId') stored references transactions (id),
  account_id      text generated always as (data->>'accountId') stored references accounts (id),
  direction       text generated always as (data->>'direction') stored,
  currency        text generated always as (data#>>'{amount,currency}') stored,
  amount_minor    numeric(38, 0) generated always as ((data#>>'{amount,amount}')::numeric) stored,
  value_date      text generated always as (data->>'valueDate') stored,
  created_at      timestamptz not null default now(),
  constraint postings_direction_known check (data->>'direction' in ('debit', 'credit')),
  -- A posting's sign lives in its direction, never in its amount.
  constraint postings_amount_positive check ((data#>>'{amount,amount}')::numeric > 0)
);
create index if not exists postings_account_idx on postings (account_id, created_at desc);
create index if not exists postings_transaction_idx on postings (transaction_id);
create index if not exists postings_data_idx on postings using gin (data jsonb_path_ops);

create table if not exists holds (
  id          text primary key,
  data        jsonb not null,
  account_id  text generated always as (data->>'accountId') stored references accounts (id),
  status      text generated always as (data->>'status') stored,
  created_at  timestamptz not null default now(),
  constraint holds_status_known check (data->>'status' in ('active', 'released', 'captured'))
);
create index if not exists holds_active_idx on holds (account_id) where (data->>'status') = 'active';
create index if not exists holds_data_idx on holds using gin (data jsonb_path_ops);

-- --------------------------------------------------------------- the kernel
create table if not exists counterparties (
  id          text primary key,
  data        jsonb not null,
  entity_id   text generated always as (data->>'entityId') stored references entities (id),
  created_at  timestamptz not null default now()
);
create index if not exists counterparties_entity_idx on counterparties (entity_id);
create index if not exists counterparties_data_idx on counterparties using gin (data jsonb_path_ops);

create table if not exists mandates (
  id          text primary key,
  data        jsonb not null,
  entity_id   text generated always as (data->>'entityId') stored references entities (id),
  grantee_id  text generated always as (data#>>'{grantee,id}') stored,
  status      text generated always as (data->>'status') stored,
  autonomy    text generated always as (data->>'autonomy') stored,
  created_at  timestamptz not null default now(),
  constraint mandates_autonomy_known
    check (data->>'autonomy' in ('propose_only', 'execute_with_approval', 'execute_within_limits'))
);
create index if not exists mandates_lookup_idx on mandates (entity_id, grantee_id, status);
create index if not exists mandates_data_idx on mandates using gin (data jsonb_path_ops);

create table if not exists proposals (
  id             text primary key,
  data           jsonb not null,
  entity_id      text generated always as (data->>'entityId') stored references entities (id),
  capability_id  text generated always as (data->>'capabilityId') stored,
  mandate_id     text generated always as (data->>'mandateId') stored,
  status         text generated always as (data->>'status') stored,
  created_at     timestamptz not null default now()
);
create index if not exists proposals_entity_idx on proposals (entity_id, status);
create index if not exists proposals_mandate_idx on proposals (mandate_id, status);
create index if not exists proposals_data_idx on proposals using gin (data jsonb_path_ops);

create table if not exists approvals (
  id           text primary key,
  data         jsonb not null,
  entity_id    text generated always as (data->>'entityId') stored references entities (id),
  proposal_id  text generated always as (data->>'proposalId') stored references proposals (id),
  status       text generated always as (data->>'status') stored,
  expires_at   text generated always as (data->>'expiresAt') stored,
  created_at   timestamptz not null default now()
);
create index if not exists approvals_pending_idx on approvals (entity_id, status);
create index if not exists approvals_data_idx on approvals using gin (data jsonb_path_ops);

-- The hash-chained decision log.
create table if not exists audit (
  id          text primary key,
  data        jsonb not null,
  seq         bigint generated always as ((data->>'seq')::bigint) stored,
  type        text generated always as (data->>'type') stored,
  subject_id  text generated always as (data#>>'{subject,id}') stored,
  hash        text generated always as (data->>'hash') stored,
  prev_hash   text generated always as (data->>'prevHash') stored,
  created_at  timestamptz not null default now()
);
create unique index if not exists audit_seq_uniq on audit (seq);
create unique index if not exists audit_hash_uniq on audit (hash);
create index if not exists audit_subject_idx on audit (subject_id);
create index if not exists audit_data_idx on audit using gin (data jsonb_path_ops);

create table if not exists idempotency (
  id            text primary key,
  data          jsonb not null,
  request_hash  text generated always as (data->>'requestHash') stored,
  created_at    timestamptz not null default now()
);

create table if not exists rates (
  id          text primary key,
  data        jsonb not null,
  entity_id   text generated always as (data->>'entityId') stored,
  status      text generated always as (data->>'status') stored,
  expires_at  text generated always as (data->>'expiresAt') stored,
  created_at  timestamptz not null default now()
);
create index if not exists rates_data_idx on rates using gin (data jsonb_path_ops);

create table if not exists instruments (
  id          text primary key,
  data        jsonb not null,
  entity_id   text generated always as (data->>'entityId') stored references entities (id),
  type        text generated always as (data->>'type') stored,
  status      text generated always as (data->>'status') stored,
  created_at  timestamptz not null default now()
);
create index if not exists instruments_entity_idx on instruments (entity_id, type, status);
create index if not exists instruments_data_idx on instruments using gin (data jsonb_path_ops);

-- =====================================================================
-- Invariants the application must not be able to violate
-- =====================================================================

-- 1. The journal is append-only. A correction is a new posting, never an edit.
create or replace function refuse_mutation() returns trigger
language plpgsql as $$
begin
  raise exception
    '% is append-only: % is not permitted. Post a correcting entry instead.',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists postings_append_only on postings;
create trigger postings_append_only
  before update or delete on postings
  for each row execute function refuse_mutation();

drop trigger if exists audit_append_only on audit;
create trigger audit_append_only
  before update or delete on audit
  for each row execute function refuse_mutation();

drop trigger if exists transactions_append_only on transactions;
create trigger transactions_append_only
  before update or delete on transactions
  for each row execute function refuse_mutation();

-- 2. Every transaction balances, per currency. Checked once at COMMIT, so the
--    postings of one transaction may be inserted in any order within it.
create or replace function assert_transaction_balanced() returns trigger
language plpgsql as $$
declare
  offending record;
begin
  for offending in
    select p.currency,
           sum(case when p.direction = 'debit'  then p.amount_minor else 0 end) as debits,
           sum(case when p.direction = 'credit' then p.amount_minor else 0 end) as credits
    from postings p
    where p.transaction_id = new.transaction_id
    group by p.currency
    having sum(case when p.direction = 'debit'  then p.amount_minor else 0 end)
         <> sum(case when p.direction = 'credit' then p.amount_minor else 0 end)
  loop
    raise exception
      'transaction % does not balance in %: debits % vs credits %',
      new.transaction_id, offending.currency, offending.debits, offending.credits
      using errcode = 'check_violation';
  end loop;
  return null;
end;
$$;

drop trigger if exists postings_balanced on postings;
create constraint trigger postings_balanced
  after insert on postings
  deferrable initially deferred
  for each row execute function assert_transaction_balanced();

commit;

-- =====================================================================
-- Not done here, and deliberately not claimed
-- =====================================================================
-- * Row-level security. Tenant isolation is enforced in the kernel, by
--   mandate resolution. The generated `entity_id` columns exist so RLS
--   policies can be added as a second, independent layer — which a real
--   deployment should do, because defence in depth means not trusting the
--   application layer to be the only thing standing between two customers.
-- * Encryption at rest and key management.
-- * Partitioning and retention of `postings` and `audit`.
-- * An external anchor for the audit chain. The chain here is tamper-evident
--   against row edits, but anyone who can rewrite the whole table can rebuild
--   it; publishing a periodic digest elsewhere is what closes that gap.
