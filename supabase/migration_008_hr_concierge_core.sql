-- ============================================================================
-- Migration 008 — HR Concierge core (showcase v0.1)
-- ============================================================================
-- Additive only. Creates six new tables; does not alter, drop, or rename
-- any existing table, column, view, function, or policy. The existing
-- leave-request / manager-approval pipeline (employees, leave_balances,
-- leave_requests, current_leave_balances, log_audit()) is untouched and
-- remains the sole authoritative path for leave decisions.
--
-- ⚠️ DEMO-ENVIRONMENT ONLY. This migration — and the seed file that follows
-- it (seed_hr_concierge_demo.sql) — must be applied only to the isolated
-- "HR Concierge Demo" Supabase project seeded with fictional Northstar
-- Global data. Never run against the production Verofax project.
--
-- Depends on: employees (schema.sql) already existing, since
-- training_registrations and hr_requests reference it by FK. Apply
-- schema.sql + migration_002 through migration_007 first if this is a
-- genuinely fresh project.
-- ============================================================================

-- 1. hr_knowledge_base — hand-authored HR policy/onboarding/learning content.
--    No confidence scoring, no crawl provenance, no draft/review workflow —
--    deliberately the simplest shape that lets HR author and activate an
--    entry directly (see HR_CONCIERGE_SHOWCASE_PLAN.md §2 for why the
--    richer digital-rise-lead-conversion knowledge_entries shape was not
--    reused here: it is built for crawled facts, not manual authoring).
create table if not exists hr_knowledge_base (
  id          uuid primary key default gen_random_uuid(),
  category    text not null check (category in (
                'leave', 'benefits', 'onboarding', 'policies', 'learning',
                'mentorship', 'coaching', 'wellbeing', 'general'
              )),
  topic       text,
  question    text,
  answer      text not null,
  keywords    text[],
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_hr_kb_category on hr_knowledge_base(category);
create index if not exists idx_hr_kb_active   on hr_knowledge_base(active);

-- 2. concierge_conversations — one row per HR Concierge chat session.
--    employee_id uses ON DELETE SET NULL rather than CASCADE (unlike
--    leave_requests, which cascades): conversation/audit history is kept
--    even if an employee record is later removed, for compliance.
create table if not exists concierge_conversations (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid references employees(id) on delete set null,
  channel           text not null default 'web' check (channel in ('web')),
  status            text not null default 'active' check (status in (
                      'active', 'escalated', 'completed', 'abandoned'
                    )),
  started_at        timestamptz not null default now(),
  last_activity_at  timestamptz not null default now(),
  turn_count        integer not null default 0 check (turn_count >= 0),
  escalation_reason text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_concierge_conv_employee on concierge_conversations(employee_id);
create index if not exists idx_concierge_conv_status   on concierge_conversations(status);

-- 3. concierge_messages — append-only turn transcript.
--    tool_calls stores which permitted Tool(s) this turn invoked and a
--    short result summary for the Insights dashboard — never a raw
--    database row or another employee's data; the tool-executor (Slice 3)
--    is responsible for keeping this summary minimal.
create table if not exists concierge_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references concierge_conversations(id) on delete cascade,
  role            text not null check (role in ('employee', 'assistant', 'system')),
  content         text not null,
  tool_calls      jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_concierge_msg_conversation on concierge_messages(conversation_id);

-- 4. training_programs — lightweight catalogue. Deliberately not the
--    Appointments Module: "session" is denormalized onto the program row
--    (next_cohort_start, seats) rather than a separate sessions table, per
--    the explicit instruction not to import the appointment system just to
--    schedule training.
create table if not exists training_programs (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null,
  description                 text,
  duration_label              text,
  delivery_mode               text check (delivery_mode in ('virtual', 'in_person', 'hybrid')),
  location                    text,
  eligibility                 text,
  requires_manager_approval   boolean not null default false,
  seats_total                 integer,
  seats_available             integer,
  next_cohort_start           date,
  mandatory                   boolean not null default false,
  active                      boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_training_programs_active on training_programs(active);

-- 5. training_registrations — an employee's interest/enrollment request.
--    Concierge can only ever create a 'requested' row (see hr_requests
--    below for the same non-approval-authority principle) — status
--    progression to confirmed/waitlisted/declined is an HR-admin action.
create table if not exists training_registrations (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employees(id) on delete cascade,
  program_id     uuid not null references training_programs(id) on delete cascade,
  status         text not null default 'requested' check (status in (
                   'requested', 'confirmed', 'waitlisted', 'declined', 'cancelled', 'completed'
                 )),
  requested_via  text not null default 'concierge' check (requested_via in ('concierge', 'admin')),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (employee_id, program_id)
);

create index if not exists idx_training_reg_employee on training_registrations(employee_id);
create index if not exists idx_training_reg_status   on training_registrations(status);

-- 6. hr_requests — mentorship / coaching / general HR requests AND
--    escalations, one shared shape. `note` is deliberately short,
--    employee-provided context — the Concierge must not ask an employee to
--    disclose sensitive details to the AI (per the sprint brief); it links
--    conversation_id for HR's own reference rather than duplicating the
--    transcript into this row.
create table if not exists hr_requests (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references employees(id) on delete cascade,
  request_type    text not null check (request_type in ('mentorship', 'coaching', 'general', 'escalation')),
  category        text,
  note            text,
  conversation_id uuid references concierge_conversations(id) on delete set null,
  status          text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  urgent          boolean not null default false,
  handled_by      text,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_hr_requests_employee on hr_requests(employee_id);
create index if not exists idx_hr_requests_status   on hr_requests(status);
create index if not exists idx_hr_requests_type     on hr_requests(request_type);

-- ============================================================================
-- 7. Row Level Security
-- ============================================================================
-- Same shape as leave_requests' existing policies (migration_002): HR/admin
-- staff (via the existing finance_role()/is_finance_user() helpers already
-- defined in schema.sql) can read and manage; the Concierge's own
-- server-side code uses the service-role client — the same bypass pattern
-- /api/leave-submit already uses — with the app layer (Slice 3's identity
-- module) enforcing which employee's data a given request may touch. No
-- anon/public RLS policy is added on any of these tables.

alter table hr_knowledge_base     enable row level security;
alter table concierge_conversations enable row level security;
alter table concierge_messages    enable row level security;
alter table training_programs     enable row level security;
alter table training_registrations enable row level security;
alter table hr_requests           enable row level security;

drop policy if exists "hr manages knowledge base" on hr_knowledge_base;
create policy "hr manages knowledge base" on hr_knowledge_base
  for all using (finance_role() in ('admin', 'hr')) with check (finance_role() in ('admin', 'hr'));

drop policy if exists "hr reads conversations" on concierge_conversations;
create policy "hr reads conversations" on concierge_conversations
  for select using (is_finance_user());

drop policy if exists "hr reads messages" on concierge_messages;
create policy "hr reads messages" on concierge_messages
  for select using (is_finance_user());

drop policy if exists "hr manages training programs" on training_programs;
create policy "hr manages training programs" on training_programs
  for all using (finance_role() in ('admin', 'hr')) with check (finance_role() in ('admin', 'hr'));

drop policy if exists "hr reads training registrations" on training_registrations;
create policy "hr reads training registrations" on training_registrations
  for select using (is_finance_user());

drop policy if exists "hr manages training registrations" on training_registrations;
create policy "hr manages training registrations" on training_registrations
  for update using (finance_role() in ('admin', 'hr')) with check (finance_role() in ('admin', 'hr'));

drop policy if exists "hr reads requests" on hr_requests;
create policy "hr reads requests" on hr_requests
  for select using (is_finance_user());

drop policy if exists "hr manages requests" on hr_requests;
create policy "hr manages requests" on hr_requests
  for update using (finance_role() in ('admin', 'hr')) with check (finance_role() in ('admin', 'hr'));

-- ============================================================================
-- 8. Audit triggers
-- ============================================================================
-- Reuses the existing log_audit() SECURITY DEFINER function (schema.sql) —
-- no new audit mechanism is introduced. concierge_messages is intentionally
-- NOT attached: it is itself an append-only transcript, and auditing every
-- chat message into audit_logs as well would duplicate that record for no
-- added compliance value. Everything an admin edits, or an employee causes
-- a state change to, is audited.

drop trigger if exists audit_hr_knowledge_base on hr_knowledge_base;
create trigger audit_hr_knowledge_base after insert or update or delete on hr_knowledge_base
  for each row execute function log_audit();

drop trigger if exists audit_concierge_conversations on concierge_conversations;
create trigger audit_concierge_conversations after insert or update or delete on concierge_conversations
  for each row execute function log_audit();

drop trigger if exists audit_training_programs on training_programs;
create trigger audit_training_programs after insert or update or delete on training_programs
  for each row execute function log_audit();

drop trigger if exists audit_training_registrations on training_registrations;
create trigger audit_training_registrations after insert or update or delete on training_registrations
  for each row execute function log_audit();

drop trigger if exists audit_hr_requests on hr_requests;
create trigger audit_hr_requests after insert or update or delete on hr_requests
  for each row execute function log_audit();

-- ============================================================================
-- End of migration 008. No existing table, view, function, trigger, or
-- policy was altered. No data was deleted. Safe to re-run (idempotent).
-- ============================================================================
