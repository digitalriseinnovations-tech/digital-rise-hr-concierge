-- ============================================================================
-- Migration 012 — current_leave_balances organization scoping
-- ============================================================================
-- Additive, backward compatible: adds organization_id to the existing
-- current_leave_balances view (migration_002_leave.sql), derived from the
-- same employees join the view already does — no new column, no table
-- change, no data migration. Every existing consumer that SELECTs specific
-- columns (src/lib/concierge/leave.ts's getMyLeaveBalance) is unaffected;
-- src/app/(app)/leave/page.tsx (the only "select *" consumer) picks up the
-- new column and is updated in the same change to filter by it, closing a
-- real gap: this view previously had no organization scoping at all, so a
-- second organization's balances would have appeared mixed into the admin
-- /leave page's results with no separation.
--
-- Safe to re-run (CREATE OR REPLACE VIEW). Requires migration_011
-- (organizations table + employees.organization_id) to already be applied.
-- ============================================================================

create or replace view current_leave_balances as
select
  e.id as employee_id,
  e.organization_id,
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
