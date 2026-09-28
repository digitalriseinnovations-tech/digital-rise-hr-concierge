-- ============================================================================
-- Migration 011 — Organizations (real per-organization employee scoping)
-- ============================================================================
-- Adds genuine tenant scoping for employee records, so this deployment can
-- host more than one organization's employee roster (imported via the new
-- HR Admin > Import Employees flow at /employees/import) while exactly ONE
-- organization is "active" for Concierge/Copilot/MCP identity purposes at a
-- time (HR_CONCIERGE_ACTIVE_ORGANIZATION_SLUG — see
-- src/lib/concierge/organizations.ts).
--
-- Additive + backward compatible: every existing employee is backfilled
-- into a default "Digital Rise Innovations" organization, so the current
-- deployment's behavior is unchanged once this is applied. The application
-- code (src/lib/concierge/organizations.ts + identity.ts) also
-- feature-detects whether this migration has been applied yet and falls
-- back to the pre-migration (unscoped) behavior if not — so deploying the
-- updated code ahead of running this migration is safe; nothing breaks
-- either way, and behavior only changes for the better once this is run.
-- ============================================================================

create table if not exists organizations (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into organizations (slug, name)
values ('digital-rise-innovations', 'Digital Rise Innovations')
on conflict (slug) do nothing;

alter table employees add column if not exists organization_id uuid references organizations(id);

update employees
set organization_id = (select id from organizations where slug = 'digital-rise-innovations')
where organization_id is null;

alter table employees alter column organization_id set not null;

create index if not exists idx_employees_organization_id on employees(organization_id);

-- Replace the previous GLOBAL unique constraint on employee_code with one
-- scoped per organization — two different organizations may now legitimately
-- reuse the same employee code (e.g. both use "EMP-1001").
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'employees_employee_code_key') then
    alter table employees drop constraint employees_employee_code_key;
  end if;
end $$;

alter table employees drop constraint if exists employees_org_employee_code_uniq;
alter table employees add constraint employees_org_employee_code_uniq unique (organization_id, employee_code);

-- RLS: left unchanged deliberately. Existing policies on `employees` are
-- role-based (finance_users.role via is_finance_user()/finance_role()), not
-- tenant-based — there is no per-staff-user organization mapping in this
-- app, and building one is a separate, larger feature. Organization
-- isolation for employee identity/import/duplicate-detection is enforced
-- at the application query layer (explicit .eq('organization_id', ...)
-- filters), the same pattern already used throughout this codebase for
-- employee_id-scoping (see src/lib/concierge/leave.ts, training.ts). The
-- import commit path uses the service-role client (bypasses RLS by
-- design), matching the existing public leave-submission pattern.
alter table organizations enable row level security;
drop policy if exists "organizations read" on organizations;
create policy "organizations read" on organizations
  for select using (is_finance_user());
