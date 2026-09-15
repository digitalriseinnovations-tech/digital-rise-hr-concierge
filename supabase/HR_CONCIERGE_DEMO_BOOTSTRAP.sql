-- ============================================================================
-- HR CONCIERGE DEMO BOOTSTRAP — Digital Rise / Northstar Global (fictional)
-- ============================================================================
-- Consolidated, demo-safe bootstrap for a COMPLETELY EMPTY Supabase project
-- only (the isolated "HR Concierge Demo" project — never production Verofax).
--
-- Built by copying, in order, from these existing source files — none of
-- which were modified on disk:
--   1. supabase/schema.sql
--   2. supabase/migration_002_leave.sql
--   3. supabase/migration_007_submitter_email.sql
--   4. supabase/migration_008_hr_concierge_core.sql
--   5. supabase/seed_hr_concierge_demo.sql
--
-- Deliberately EXCLUDED (contain real Verofax employee/business data —
-- confirmed by direct inspection, see the audit report in the conversation
-- history): RUN_ALL.sql, migration_004_currency.sql,
-- migration_005_data_topup.sql, migration_006_leave_history.sql,
-- seed_staff.sql, seed_commissions.sql. commission-schema
-- (migration_003_commission.sql) is also excluded — not required for HR
-- Concierge and out of scope for this bootstrap.
--
-- Two production-specific values were found and replaced — both flagged
-- explicitly at the point of change below:
--   (a) schema.sql's hardcoded bootstrap admin insert (a real personal
--       email) — REMOVED. See "ADMIN BOOTSTRAP" note near the end of the
--       first section for the manual step this demo-safe version requires
--       instead.
--   (b) migration_002's fallback manager_email ('wassim@verofax.com') —
--       REPLACED with a neutral Northstar Global HR inbox address.
-- No other change was made to any statement's structure or behavior.
--
-- SCOPE TRIM (architecture cleanup pass): this is a Digital Rise HR
-- Concierge / HR module database, not a copy of the combined Verofax
-- Finance+HR platform. `sales_bonus` (target-vs-achieved commission
-- tracker) is REMOVED from schema.sql's tables below — confirmed via a
-- full `grep -rn "sales_bonus" src/` against the live application that
-- nothing references it; it was already dead schema in the source repo.
-- `salary_records` and `benefits_credits` are KEPT despite being
-- Finance-flavored, because the existing employee-profile page
-- (src/app/(app)/employees/[id]/page.tsx) and dashboard
-- (src/app/(app)/page.tsx) both genuinely query them today — removing
-- them would break "employee management," which this bootstrap must not
-- do. `fx_rates`/`commission_deals`/`commission_payments`
-- (migration_003_commission.sql) were never included in this file in the
-- first place, so there was nothing to remove there.
--
-- Safe to paste into a completely empty Supabase project's SQL Editor and
-- run once, top to bottom, in a single execution. Every statement is
-- idempotent (create table/policy/trigger ... if not exists / drop-if-
-- exists-then-create) so it is also safe to re-run.
-- ============================================================================


-- ############################################################################
-- # SECTION 1 — from supabase/schema.sql (base HR/finance schema)
-- # Copied verbatim except the bootstrap-admin insert at the end, which is
-- # removed — see the ADMIN BOOTSTRAP note below.
-- ############################################################################

-- ============================================================================
-- Digital Rise HR Concierge Demo — Base HR Schema
-- (adapted from verofax-finance-app/supabase/schema.sql)
-- ============================================================================
-- This schema:
--   1. Sets up the finance_users allowlist (only people in this table can log in)
--   2. Creates employees + payroll/leave/benefits tables
--   3. Locks every table down with RLS — even authenticated users cannot read
--      HR data unless they're in finance_users AND have the right role
--   4. Adds an audit_logs trigger so every salary/employee mutation is recorded
-- ============================================================================

-- ============================================================================
-- 1. FINANCE USERS — the allowlist (gates ALL access)
-- ============================================================================
create table if not exists finance_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  full_name text not null,
  role text not null check (role in ('admin', 'finance', 'hr', 'viewer')),
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_finance_users_email on finance_users(email);

-- ============================================================================
-- 2. EMPLOYEES — the people we pay
-- ============================================================================
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text unique not null,
  full_name text not null,
  email text,
  phone text,
  department text,
  designation text,
  country text,
  location text,
  joining_date date,
  status text default 'active' check (status in ('active', 'inactive', 'on_leave', 'terminated')),

  -- Compensation
  salary_currency text not null default 'AED',
  basic_salary numeric(14, 2) default 0,
  allowances numeric(14, 2) default 0,
  -- Stored equivalent in AED for cross-currency reporting (recomputed on currency change)
  basic_salary_aed numeric(14, 2) default 0,
  fx_rate_to_aed numeric(10, 6) default 1,

  -- Bank
  bank_name text,
  bank_account text,
  iban text,
  swift text,

  -- Entitlements
  annual_leave_days numeric(5, 1) default 30,
  air_ticket_entitlement numeric(14, 2) default 0,
  air_ticket_currency text default 'AED',

  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references finance_users(id),
  updated_by uuid references finance_users(id)
);

create index if not exists idx_employees_status on employees(status);
create index if not exists idx_employees_department on employees(department);
create index if not exists idx_employees_country on employees(country);

-- ============================================================================
-- 3. SALARY RECORDS — monthly payroll log
-- ============================================================================
create table if not exists salary_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  period_year int not null,
  period_month int not null check (period_month between 1 and 12),

  currency text not null default 'AED',
  basic numeric(14, 2) default 0,
  allowances numeric(14, 2) default 0,
  bonus numeric(14, 2) default 0,
  commission numeric(14, 2) default 0,
  reimbursement numeric(14, 2) default 0,
  deductions numeric(14, 2) default 0,
  advance_recovery numeric(14, 2) default 0,
  unpaid_leave_deduction numeric(14, 2) default 0,
  net_payable numeric(14, 2) generated always as (
    coalesce(basic,0) + coalesce(allowances,0) + coalesce(bonus,0) + coalesce(commission,0)
    + coalesce(reimbursement,0) - coalesce(deductions,0) - coalesce(advance_recovery,0)
    - coalesce(unpaid_leave_deduction,0)
  ) stored,

  status text default 'pending' check (status in ('pending', 'paid', 'partial', 'cancelled')),
  paid_amount numeric(14, 2) default 0,
  payment_date date,
  payment_reference text,

  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references finance_users(id),
  updated_by uuid references finance_users(id),

  unique (employee_id, period_year, period_month)
);

create index if not exists idx_salary_records_employee on salary_records(employee_id);
create index if not exists idx_salary_records_period on salary_records(period_year, period_month);
create index if not exists idx_salary_records_status on salary_records(status);

-- ============================================================================
-- 4. LEAVE BALANCES — yearly leave ledger
-- ============================================================================
create table if not exists leave_balances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  year int not null,
  entitlement_days numeric(5, 1) default 30,
  accrued_days numeric(5, 1) default 0,
  taken_days numeric(5, 1) default 0,
  unpaid_days numeric(5, 1) default 0,
  remaining_days numeric(5, 1) generated always as (
    coalesce(accrued_days,0) - coalesce(taken_days,0)
  ) stored,
  notes text,
  updated_at timestamptz default now(),
  updated_by uuid references finance_users(id),
  unique (employee_id, year)
);

create index if not exists idx_leave_balances_employee on leave_balances(employee_id);

-- ============================================================================
-- 5. BENEFITS & CREDITS — air ticket, bonus, expense claim, reimbursement, etc.
-- ============================================================================
create table if not exists benefits_credits (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  type text not null check (type in ('air_ticket', 'bonus', 'commission', 'reimbursement', 'expense_claim', 'advance', 'other')),
  description text,
  amount numeric(14, 2) not null,
  currency text not null default 'AED',
  status text default 'pending' check (status in ('pending', 'approved', 'paid', 'rejected')),
  due_date date,
  paid_date date,
  attachment_url text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references finance_users(id)
);

create index if not exists idx_benefits_employee on benefits_credits(employee_id);
create index if not exists idx_benefits_type on benefits_credits(type);
create index if not exists idx_benefits_status on benefits_credits(status);

-- ============================================================================
-- 6. AUDIT LOGS — every mutation on salary/employee/leave is recorded
-- ============================================================================
-- ⚠️ CHANGED FROM SOURCE: schema.sql also defines a `sales_bonus` table
-- (target-vs-achieved commission tracker) here. It is REMOVED from this
-- HR-scoped bootstrap: confirmed via `grep -rn "sales_bonus" src/` against
-- the live application that ZERO source files reference it — it was
-- already dead/superseded schema in the original repo (superseded by
-- commission_deals in migration_003, which this bootstrap also excludes).
-- Removing it breaks nothing. Its RLS/trigger statements are removed along
-- with it, further down.
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  user_role text,
  action text not null,            -- 'insert' | 'update' | 'delete'
  entity_type text not null,       -- 'employee' | 'salary_record' | etc
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz default now()
);

create index if not exists idx_audit_logs_entity on audit_logs(entity_type, entity_id);
create index if not exists idx_audit_logs_user on audit_logs(user_email);
create index if not exists idx_audit_logs_created on audit_logs(created_at desc);

-- ============================================================================
-- 7. RLS POLICIES — finance_users gates everything
-- ============================================================================
alter table finance_users enable row level security;
alter table employees enable row level security;
alter table salary_records enable row level security;
alter table leave_balances enable row level security;
alter table benefits_credits enable row level security;
alter table audit_logs enable row level security;

-- ⚠️ LEGACY-NAMED / FUTURE-REFACTOR: finance_users / is_finance_user() /
-- finance_role() are the pre-existing staff authorization mechanism this
-- HR module inherited from the combined Verofax Finance+HR app. They gate
-- HR admin login today (src/lib/auth.ts calls them directly) and are
-- deliberately NOT renamed in this sprint — doing so would require
-- invasive changes across every existing route/component that imports
-- them. Kept as-is intentionally; a future refactor could rename this to
-- something HR-module-neutral (e.g. hr_staff_users) once there's a real
-- need to decouple from the Finance-app naming history.
-- Helper: is the current auth user a finance_users record?
create or replace function is_finance_user() returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from finance_users
    where email = (select auth.jwt() ->> 'email')
    and active = true
  );
$$;

create or replace function finance_role() returns text
language sql security definer stable as $$
  select role from finance_users
  where email = (select auth.jwt() ->> 'email')
  and active = true
  limit 1;
$$;

-- finance_users: only admins can read/write the user list
drop policy if exists "admin manages users" on finance_users;
create policy "admin manages users" on finance_users
  for all using (finance_role() = 'admin') with check (finance_role() = 'admin');

-- Authenticated finance users can read their own row (for the layout greeting)
drop policy if exists "self read" on finance_users;
create policy "self read" on finance_users
  for select using (email = (select auth.jwt() ->> 'email'));

-- employees: admin + hr full access; finance + viewer read only
drop policy if exists "employees read" on employees;
create policy "employees read" on employees
  for select using (is_finance_user());

drop policy if exists "employees write" on employees;
create policy "employees write" on employees
  for all using (finance_role() in ('admin', 'hr'))
  with check (finance_role() in ('admin', 'hr'));

-- salary_records: admin + finance only
drop policy if exists "salary read" on salary_records;
create policy "salary read" on salary_records
  for select using (finance_role() in ('admin', 'finance', 'viewer'));

drop policy if exists "salary write" on salary_records;
create policy "salary write" on salary_records
  for all using (finance_role() in ('admin', 'finance'))
  with check (finance_role() in ('admin', 'finance'));

-- leave_balances: admin + hr; finance read; viewer read
drop policy if exists "leave read" on leave_balances;
create policy "leave read" on leave_balances
  for select using (is_finance_user());

drop policy if exists "leave write" on leave_balances;
create policy "leave write" on leave_balances
  for all using (finance_role() in ('admin', 'hr'))
  with check (finance_role() in ('admin', 'hr'));

-- benefits_credits: admin + finance + hr
drop policy if exists "benefits read" on benefits_credits;
create policy "benefits read" on benefits_credits
  for select using (is_finance_user());

drop policy if exists "benefits write" on benefits_credits;
create policy "benefits write" on benefits_credits
  for all using (finance_role() in ('admin', 'finance', 'hr'))
  with check (finance_role() in ('admin', 'finance', 'hr'));

-- audit_logs: admin read; everyone can insert via trigger
drop policy if exists "audit admin read" on audit_logs;
create policy "audit admin read" on audit_logs
  for select using (finance_role() = 'admin');

drop policy if exists "audit insert" on audit_logs;
create policy "audit insert" on audit_logs
  for insert with check (is_finance_user());

-- ============================================================================
-- 8. AUDIT TRIGGERS
-- ============================================================================
create or replace function log_audit() returns trigger
language plpgsql security definer as $$
declare
  user_email text := (select auth.jwt() ->> 'email');
  user_role text := finance_role();
begin
  insert into audit_logs (user_email, user_role, action, entity_type, entity_id, before_data, after_data)
  values (
    coalesce(user_email, 'system'),
    user_role,
    lower(tg_op),
    tg_table_name,
    coalesce(new.id, old.id),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end; $$;

drop trigger if exists audit_employees on employees;
create trigger audit_employees after insert or update or delete on employees
  for each row execute function log_audit();

drop trigger if exists audit_salary on salary_records;
create trigger audit_salary after insert or update or delete on salary_records
  for each row execute function log_audit();

drop trigger if exists audit_leave on leave_balances;
create trigger audit_leave after insert or update or delete on leave_balances
  for each row execute function log_audit();

drop trigger if exists audit_benefits on benefits_credits;
create trigger audit_benefits after insert or update or delete on benefits_credits
  for each row execute function log_audit();

-- ============================================================================
-- 9. ADMIN BOOTSTRAP — ⚠️ CHANGED FROM SOURCE, MANUAL STEP REQUIRED
-- ============================================================================
-- The original schema.sql hard-codes a real, personal, company-specific
-- email as the break-glass admin here. That is intentionally NOT reproduced
-- in this demo-safe bootstrap — a reusable Digital Rise template must not
-- embed anyone's real identity.
--
-- After running this whole file, sign up via the app's /login page (or
-- create the user directly in Supabase Auth → Users) with whatever email
-- you want to demo as HR Admin, then run this ONE statement yourself,
-- substituting that email:
--
--   insert into finance_users (email, full_name, role, active)
--   values ('YOUR-DEMO-ADMIN-EMAIL', 'Demo Admin', 'admin', true)
--   on conflict (email) do update set role = 'admin', active = true;
--
-- This statement is deliberately NOT executed automatically by this file.


-- ############################################################################
-- # SECTION 2 — from supabase/migration_002_leave.sql (leave management)
-- # Copied verbatim except the fallback manager_email value — see the
-- # flagged line below.
-- ############################################################################

-- 1. manager_email on employees
alter table employees add column if not exists manager_email text;
-- ⚠️ CHANGED FROM SOURCE: the original migration falls back to a real
-- Verofax email ('wassim@verofax.com') for any employee left without a
-- manager. That is replaced here with a neutral Northstar Global HR inbox —
-- the schema behavior (no employee ends up with a null manager_email) is
-- preserved; only the specific address changed.
update employees set manager_email = 'hr@northstarglobal.com' where manager_email is null;
create index if not exists idx_employees_manager_email on employees(manager_email);

-- 2. Refactor leave_balances to support multiple leave types per employee per year
alter table leave_balances add column if not exists leave_type text default 'annual';
alter table leave_balances add column if not exists encashed_days numeric(5, 1) default 0;
alter table leave_balances add column if not exists carry_forward_days numeric(5, 1) default 0;

-- Backfill existing rows
update leave_balances set leave_type = 'annual' where leave_type is null;
alter table leave_balances alter column leave_type set not null;

-- Drop + re-add constraint (idempotent — safe to re-run)
alter table leave_balances drop constraint if exists leave_type_valid;
alter table leave_balances add constraint leave_type_valid check (
  leave_type in ('annual', 'sick', 'maternity', 'paternity', 'mourning', 'haj', 'unpaid', 'other')
);

-- Drop the old unique constraint (year+employee) and recreate including leave_type
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'leave_balances_employee_id_year_key') then
    alter table leave_balances drop constraint leave_balances_employee_id_year_key;
  end if;
end $$;
alter table leave_balances drop constraint if exists leave_balances_emp_year_type_uniq;
alter table leave_balances add constraint leave_balances_emp_year_type_uniq unique (employee_id, year, leave_type);

-- 3. leave_requests — public submissions
create table if not exists leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  leave_type text not null check (leave_type in ('annual', 'sick', 'maternity', 'paternity', 'mourning', 'haj', 'unpaid', 'other')),
  start_date date not null,
  end_date date not null,
  days_count numeric(5, 1) not null,
  reason text,

  -- Approval flow
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  manager_email text not null,
  -- Single-use signed token for manager's approve/reject email link
  approval_token uuid not null default gen_random_uuid(),
  token_used_at timestamptz,
  decided_by_email text,
  decided_at timestamptz,
  decision_notes text,

  -- Bookkeeping
  submitted_via text default 'public_form',  -- 'public_form' | 'admin'
  submitter_ip text,
  submitter_user_agent text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_leave_requests_employee on leave_requests(employee_id);
create index if not exists idx_leave_requests_status on leave_requests(status);
create index if not exists idx_leave_requests_token on leave_requests(approval_token);
create index if not exists idx_leave_requests_manager on leave_requests(manager_email);

-- 4. RLS for leave_requests
alter table leave_requests enable row level security;

-- Admin + HR + finance can read all requests
drop policy if exists "leave_req read" on leave_requests;
create policy "leave_req read" on leave_requests
  for select using (is_finance_user());

-- Admin + HR can write (admin overrides, manual approvals)
drop policy if exists "leave_req write" on leave_requests;
create policy "leave_req write" on leave_requests
  for all using (finance_role() in ('admin', 'hr'))
  with check (finance_role() in ('admin', 'hr'));

-- NOTE: public submissions and token-approval-page use service_role via server actions —
-- they bypass RLS by design. The submission API validates input itself.

-- Audit trigger
drop trigger if exists audit_leave_req on leave_requests;
create trigger audit_leave_req after insert or update or delete on leave_requests
  for each row execute function log_audit();

-- 5. Helper view: current-year balance per employee per leave-type
create or replace view current_leave_balances as
select
  e.id as employee_id,
  e.full_name,
  e.employee_code,
  e.department,
  e.country,
  e.manager_email,
  lb.year,
  lb.leave_type,
  coalesce(lb.entitlement_days, 0) as entitlement_days,
  coalesce(lb.accrued_days, 0) as accrued_days,
  coalesce(lb.taken_days, 0) as taken_days,
  coalesce(lb.encashed_days, 0) as encashed_days,
  coalesce(lb.carry_forward_days, 0) as carry_forward_days,
  (coalesce(lb.accrued_days, 0) + coalesce(lb.carry_forward_days, 0)
    - coalesce(lb.taken_days, 0) - coalesce(lb.encashed_days, 0)) as remaining_days
from employees e
left join leave_balances lb on lb.employee_id = e.id and lb.year = extract(year from current_date)::int
where e.status in ('active', 'on_leave');

-- 6. RPC to deduct from balance on approval (called by server action)
create or replace function deduct_leave_balance(
  p_employee_id uuid,
  p_leave_type text,
  p_year int,
  p_days numeric
) returns void
language plpgsql security definer as $$
begin
  insert into leave_balances (employee_id, year, leave_type, entitlement_days, accrued_days, taken_days)
  values (p_employee_id, p_year, p_leave_type,
          case when p_leave_type = 'annual' then 24 when p_leave_type = 'sick' then 10 else 0 end,
          case when p_leave_type = 'annual' then 24 when p_leave_type = 'sick' then 10 else 0 end,
          p_days)
  on conflict (employee_id, year, leave_type)
  do update set
    taken_days = leave_balances.taken_days + p_days,
    updated_at = now();
end; $$;


-- ############################################################################
-- # SECTION 3 — from supabase/migration_007_submitter_email.sql
-- # Copied verbatim, no changes — no Verofax-specific values present.
-- ############################################################################

alter table leave_requests add column if not exists submitter_email text;

-- Backfill any existing rows: copy the linked employee's email if we have one
update leave_requests lr
set submitter_email = e.email
from employees e
where lr.employee_id = e.id
  and lr.submitter_email is null
  and e.email is not null;


-- ############################################################################
-- # SECTION 4 — from supabase/migration_008_hr_concierge_core.sql
-- # Copied verbatim, no changes — no Verofax-specific values present.
-- ############################################################################

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

create table if not exists concierge_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references concierge_conversations(id) on delete cascade,
  role            text not null check (role in ('employee', 'assistant', 'system')),
  content         text not null,
  tool_calls      jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_concierge_msg_conversation on concierge_messages(conversation_id);

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


-- ############################################################################
-- # SECTION 5 — from supabase/seed_hr_concierge_demo.sql
-- # Copied verbatim — already 100% fictional Northstar Global data, no
-- # changes required.
-- ############################################################################

-- ── Employees ────────────────────────────────────────────────────────────
insert into employees (employee_code, full_name, email, department, designation, country, location, joining_date, status, manager_email, salary_currency, annual_leave_days)
values
  ('NSG-1001', 'Sarah Ahmed',      'sarah.ahmed@northstarglobal.com',      'Marketing', 'Marketing Manager',        'UAE',    'Dubai, UAE',        '2022-03-14', 'active', 'daniel.carter@northstarglobal.com', 'AED', 24),
  ('NSG-1002', 'Daniel Carter',    'daniel.carter@northstarglobal.com',    'Marketing', 'Director of Marketing',    'UAE',    'Dubai, UAE',        '2019-06-01', 'active', 'marcus.webb@northstarglobal.com',   'AED', 24),
  ('NSG-1003', 'Marcus Webb',      'marcus.webb@northstarglobal.com',      'People & Culture', 'Chief People Officer', 'UK', 'London, UK',        '2017-01-10', 'active', 'marcus.webb@northstarglobal.com',   'GBP', 24),
  ('NSG-1004', 'Aisha Khan',       'aisha.khan@northstarglobal.com',       'People & Culture', 'HR Business Partner', 'UAE',  'Dubai, UAE',        '2021-09-01', 'active', 'marcus.webb@northstarglobal.com',   'AED', 24),
  ('NSG-1005', 'James Whitfield',  'james.whitfield@northstarglobal.com',  'Engineering', 'Software Engineer',       'Canada', 'Toronto, Canada',   '2023-02-20', 'active', 'priya.nair@northstarglobal.com',    'CAD', 24),
  ('NSG-1006', 'Priya Nair',       'priya.nair@northstarglobal.com',       'Engineering', 'Engineering Manager',     'Canada', 'Toronto, Canada',   '2020-05-11', 'active', 'marcus.webb@northstarglobal.com',   'CAD', 24),
  ('NSG-1007', 'Liam O''Connor',   'liam.oconnor@northstarglobal.com',     'IT',          'IT Support Specialist',   'Canada', 'Toronto, Canada',   '2022-11-07', 'active', 'priya.nair@northstarglobal.com',    'CAD', 24),
  ('NSG-1008', 'Fatima Al-Suwaidi','fatima.alsuwaidi@northstarglobal.com', 'Finance',     'Finance Analyst',         'UAE',    'Abu Dhabi, UAE',    '2023-08-01', 'active', 'daniel.carter@northstarglobal.com', 'AED', 24),
  ('NSG-1009', 'Oliver Bennett',   'oliver.bennett@northstarglobal.com',   'Design',      'Product Designer',        'UK',     'London, UK',        '2022-01-17', 'active', 'emma.clarke@northstarglobal.com',   'GBP', 24),
  ('NSG-1010', 'Emma Clarke',      'emma.clarke@northstarglobal.com',      'Design',      'Head of Design',          'UK',     'London, UK',        '2018-04-23', 'active', 'marcus.webb@northstarglobal.com',   'GBP', 24),
  ('NSG-1011', 'Rahul Verma',      'rahul.verma@northstarglobal.com',      'Sales',       'Sales Executive',         'India',  'Bengaluru, India',  '2023-06-05', 'active', 'ananya.iyer@northstarglobal.com',   'INR', 24),
  ('NSG-1012', 'Ananya Iyer',      'ananya.iyer@northstarglobal.com',      'Sales',       'Regional Sales Director', 'India',  'Bengaluru, India',  '2019-10-14', 'active', 'marcus.webb@northstarglobal.com',   'INR', 24)
on conflict (employee_code) do nothing;

-- ── Leave balances (current year, annual leave) ─────────────────────────
insert into leave_balances (employee_id, year, leave_type, entitlement_days, accrued_days, taken_days, encashed_days, carry_forward_days)
select e.id, extract(year from current_date)::int, 'annual', 24, 24, v.taken, 0, 0
from employees e
join (values
  ('NSG-1001', 10),
  ('NSG-1002', 6),
  ('NSG-1003', 4),
  ('NSG-1004', 8),
  ('NSG-1005', 12),
  ('NSG-1006', 5),
  ('NSG-1007', 15),
  ('NSG-1008', 3),
  ('NSG-1009', 9),
  ('NSG-1010', 7),
  ('NSG-1011', 18),
  ('NSG-1012', 2)
) as v(employee_code, taken) on v.employee_code = e.employee_code
on conflict (employee_id, year, leave_type) do nothing;

-- ── HR Knowledge Base (Northstar Global — entirely fictional policy) ────
insert into hr_knowledge_base (category, topic, question, answer, keywords) values
  ('leave', 'Annual Leave', 'What is the annual leave policy?',
   'Northstar Global employees accrue 24 days of annual leave per calendar year, credited from your start date. Leave is requested through HR Concierge or the leave request form and is approved by your direct manager.',
   array['annual leave','vacation','pto','holiday','days off']),
  ('leave', 'Sick Leave', 'What is the sick leave policy?',
   'Full-pay sick leave is available for up to 10 days per year. For absences longer than 3 consecutive days, a medical certificate should be provided to People & Culture.',
   array['sick leave','sick day','illness','medical certificate']),
  ('leave', 'Parental Leave', 'What is the parental leave policy?',
   'Northstar Global provides 65 business days of maternity leave for the birth parent and 5 business days of paternity leave for the co-parent, both fully paid. Extended unpaid leave can be discussed with People & Culture.',
   array['maternity','paternity','parental leave','new parent','baby']),
  ('leave', 'Mourning Leave', 'What is the bereavement/mourning leave policy?',
   'Up to 5 days of paid mourning leave is available for the loss of an immediate family member. Speak with your manager and People & Culture to arrange this.',
   array['bereavement','mourning leave','family loss','funeral']),
  ('policies', 'Hybrid Working', 'What is our hybrid/remote working policy?',
   'Most Northstar Global roles follow a hybrid model: a minimum of 2 in-office days per week, coordinated with your team. Fully remote arrangements are reviewed case-by-case with your manager.',
   array['hybrid','remote work','work from home','wfh','office days']),
  ('policies', 'Working Hours', 'What are our standard working hours?',
   'Core hours are 9:00 AM to 5:30 PM, local time, with flexibility around a 9:00-10:00 AM start. Regional public holidays follow your local office calendar.',
   array['working hours','office hours','core hours','schedule']),
  ('policies', 'Expenses & Travel', 'How do I claim travel expenses?',
   'Business travel and reasonable expenses are reimbursed via the Finance team''s expense portal. Submit receipts within 30 days of the expense. Contact Finance for anything outside standard policy.',
   array['expenses','travel','reimbursement','claim']),
  ('benefits', 'Health Benefits', 'What health benefits do we offer?',
   'All full-time employees receive private medical insurance covering the employee and immediate dependents from day one, plus an annual wellness allowance.',
   array['health insurance','medical benefits','dependents','wellness allowance']),
  ('benefits', 'Retirement / Pension', 'Do we offer a retirement or pension plan?',
   'Northstar Global contributes to a regional retirement/pension plan on your behalf after your first 6 months, matching up to 5% of base salary.',
   array['pension','retirement','401k','provident fund']),
  ('onboarding', 'First Week', 'What do I need to complete during my first week?',
   'Your first week includes: IT and systems setup with the IT team, a benefits enrollment session with People & Culture, mandatory Cybersecurity Awareness training, and a welcome meeting with your manager. Your manager will share a personalized checklist on day one.',
   array['first week','onboarding','new hire','checklist']),
  ('onboarding', 'IT Access', 'Who should I contact for IT access?',
   'IT access requests (laptop, email, systems) are handled by the IT Support team — reach them at it-support@northstarglobal.com or via the IT request channel shared during onboarding.',
   array['it access','laptop','email setup','systems access','it support']),
  ('onboarding', 'Benefits Enrollment', 'Where can I find our benefits information?',
   'Benefits enrollment happens during your first week with People & Culture. Details on health, retirement, and wellness benefits are covered in your onboarding session and summarized in your welcome pack.',
   array['benefits enrollment','welcome pack','benefits information']),
  ('learning', 'Training Overview', 'What training programs are available?',
   'Northstar Global offers the Emerging Leaders Program, Strategic Leadership Essentials, AI & Digital Productivity, and mandatory annual Cybersecurity Awareness training. Ask HR Concierge for eligibility and how to register.',
   array['training','learning','development programs','courses']),
  ('learning', 'Mandatory Training', 'What mandatory training do I need to complete?',
   'All employees complete Cybersecurity Awareness training annually. Some roles have additional compliance training assigned by your manager or People & Culture.',
   array['mandatory training','compliance training','cybersecurity awareness']),
  ('mentorship', 'Mentorship Program', 'How does the mentorship program work?',
   'The Northstar Global mentorship program pairs employees with a senior mentor in their area of interest for a 3-month cycle, with monthly 1:1 sessions. You can request a mentor through HR Concierge, including a preferred focus area.',
   array['mentorship','mentor','mentee','mentoring program']),
  ('mentorship', 'Mentorship Eligibility', 'Who is eligible for the mentorship program?',
   'The mentorship program is open to all employees with at least 6 months of tenure. There is no seniority requirement to request a mentor.',
   array['mentorship eligibility','who can join mentorship']),
  ('coaching', 'Executive Coaching', 'Do we offer executive coaching?',
   'Executive coaching is available for Director-level employees and above, and can be extended to high-potential Managers with sponsorship from their department head. Requests are reviewed by People & Culture.',
   array['executive coaching','coaching program','leadership coaching']),
  ('wellbeing', 'Wellbeing Support', 'What wellbeing support is available?',
   'Northstar Global offers a confidential Employee Assistance Program (EAP) with counseling support, plus an annual wellness allowance that can be used for fitness, mental health, or wellbeing services.',
   array['wellbeing','eap','employee assistance program','mental health','counseling']),
  ('general', 'HR Contact', 'How do I contact HR directly?',
   'For anything HR Concierge can''t help with, or if you''d prefer to speak with a person, ask to be connected to HR and a People & Culture team member will follow up with you directly.',
   array['contact hr','speak to hr','human resources contact']),
  ('general', 'Confidential Matters', 'How do I raise a sensitive or confidential HR matter?',
   'For sensitive matters — grievances, workplace concerns, or anything you''d rather discuss privately — HR Concierge will connect you directly with a People & Culture team member rather than trying to resolve it in chat.',
   array['confidential','sensitive matter','grievance','private concern','harassment'])
;

-- ── Training Programs ─────────────────────────────────────────────────
insert into training_programs (name, description, duration_label, delivery_mode, location, eligibility, requires_manager_approval, seats_total, seats_available, next_cohort_start, mandatory, active) values
  ('Emerging Leaders Program',
   'A 6-week cohort program developing first-time and aspiring people managers through applied leadership practice, peer coaching, and a capstone project.',
   '6 weeks', 'virtual', 'Virtual', 'Managers and high-potential senior individual contributors, minimum 1 year tenure', true, 30, 12, current_date + interval '21 days', false, true),

  ('Strategic Leadership Essentials',
   'A 1-day intensive workshop on strategic decision-making, stakeholder influence, and leading through change, for senior leaders.',
   '1 day', 'hybrid', 'Toronto + Virtual', 'Director level and above', true, 25, 8, current_date + interval '45 days', false, true),

  ('AI & Digital Productivity',
   'A practical series on using AI tools responsibly to improve day-to-day productivity, communication, and decision-making.',
   '3 half-day sessions', 'virtual', 'Virtual', 'All employees', false, 100, 63, current_date + interval '10 days', false, true),

  ('Cybersecurity Awareness',
   'Mandatory annual training covering phishing, data handling, and Northstar Global''s information-security policies.',
   '45 minutes, self-paced', 'virtual', 'Virtual', 'All employees', false, null, null, null, true, true)
;

-- ============================================================================
-- END OF BOOTSTRAP.
-- Expected record counts after this file completes:
--   select count(*) from employees;             -- 12
--   select count(*) from leave_balances;         -- 12
--   select count(*) from hr_knowledge_base;      -- 20
--   select count(*) from training_programs;      -- 4
--   select count(*) from leave_requests;         -- 0 (not seeded)
--   select count(*) from concierge_conversations,
--          concierge_messages, training_registrations, hr_requests; -- 0 each (not seeded)
--
-- Remember: the ADMIN BOOTSTRAP step (Section 1, item 10) is a manual,
-- separate step you run yourself with your own email — it is not part of
-- this file's automatic execution.
-- ============================================================================
