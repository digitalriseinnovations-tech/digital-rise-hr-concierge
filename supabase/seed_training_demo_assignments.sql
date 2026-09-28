-- ============================================================================
-- Seed — Demo training assignments (Digital Rise Innovations)
-- ============================================================================
-- Additive only. Requires migration_013_training_enrichment.sql to have
-- been applied first (adds training_programs.provider and the new
-- "Microsoft 365 Copilot Essentials" program this seed assigns).
--
-- Assigns realistic training_registrations across all 15 currently active
-- Digital Rise Innovations employees, aligned by department, mixing
-- Completed / In Progress / Assigned("Not Started") / Overdue records —
-- "Overdue" is never a stored status, it is due_date in the past with
-- status != 'completed', exactly as the rest of this app already computes
-- it (see src/lib/concierge/training.ts's mapRegistration()).
--
-- Every insert is `on conflict (employee_id, program_id) do nothing` —
-- never overwrites an existing registration. Safe to re-run.
-- ============================================================================

-- ── Cybersecurity Awareness (mandatory) — all 15 employees ─────────────────
insert into training_registrations (employee_id, program_id, status, requested_via, due_date, started_at, completed_at)
select e.id, p.id, v.status, 'admin',
  case v.status
    when 'completed' then current_date - interval '20 days'
    when 'in_progress' then current_date + interval '10 days'
    when 'assigned' then case when v.overdue then current_date - interval '7 days' else current_date + interval '18 days' end
  end,
  case when v.status in ('in_progress', 'completed') then current_date - interval '25 days' else null end,
  case when v.status = 'completed' then current_date - interval '22 days' else null end
from employees e
join training_programs p on p.name = 'Cybersecurity Awareness'
join (values
  ('DRI-1000', 'completed', false),
  ('DRI-1001', 'completed', false),
  ('DRI-1002', 'in_progress', false),
  ('NSG-1001', 'completed', false),
  ('NSG-1002', 'assigned', true),
  ('NSG-1003', 'completed', false),
  ('NSG-1004', 'in_progress', false),
  ('NSG-1005', 'completed', false),
  ('NSG-1006', 'assigned', true),
  ('NSG-1007', 'completed', false),
  ('NSG-1008', 'assigned', false),
  ('NSG-1009', 'completed', false),
  ('NSG-1010', 'in_progress', false),
  ('NSG-1011', 'assigned', false),
  ('NSG-1012', 'assigned', true)
) as v(employee_code, status, overdue) on v.employee_code = e.employee_code
where e.organization_id = (select id from organizations where slug = 'digital-rise-innovations')
on conflict (employee_id, program_id) do nothing;

-- ── Microsoft 365 Copilot Essentials — all 15 employees ─────────────────────
insert into training_registrations (employee_id, program_id, status, requested_via, due_date, started_at, completed_at)
select e.id, p.id, v.status, 'admin',
  case v.status
    when 'completed' then current_date - interval '15 days'
    when 'in_progress' then current_date + interval '14 days'
    when 'assigned' then case when v.overdue then current_date - interval '9 days' else current_date + interval '25 days' end
  end,
  case when v.status in ('in_progress', 'completed') then current_date - interval '9 days' else null end,
  case when v.status = 'completed' then current_date - interval '5 days' else null end
from employees e
join training_programs p on p.name = 'Microsoft 365 Copilot Essentials'
join (values
  ('DRI-1000', 'in_progress', false),
  ('DRI-1001', 'in_progress', false),
  ('DRI-1002', 'completed', false),
  ('NSG-1001', 'assigned', false),
  ('NSG-1002', 'assigned', false),
  ('NSG-1003', 'in_progress', false),
  ('NSG-1004', 'completed', false),
  ('NSG-1005', 'assigned', false),
  ('NSG-1006', 'in_progress', false),
  ('NSG-1007', 'completed', false),
  ('NSG-1008', 'assigned', true),
  ('NSG-1009', 'assigned', false),
  ('NSG-1010', 'completed', false),
  ('NSG-1011', 'in_progress', false),
  ('NSG-1012', 'assigned', false)
) as v(employee_code, status, overdue) on v.employee_code = e.employee_code
where e.organization_id = (select id from organizations where slug = 'digital-rise-innovations')
on conflict (employee_id, program_id) do nothing;

-- ── AI & Digital Productivity — Admin/Engineering/IT/Design ─────────────────
insert into training_registrations (employee_id, program_id, status, requested_via, due_date, started_at, completed_at)
select e.id, p.id, v.status, 'admin',
  case v.status
    when 'completed' then current_date - interval '18 days'
    when 'in_progress' then current_date + interval '9 days'
    when 'assigned' then case when v.overdue then current_date - interval '8 days' else current_date + interval '16 days' end
  end,
  case when v.status in ('in_progress', 'completed') then current_date - interval '14 days' else null end,
  case when v.status = 'completed' then current_date - interval '10 days' else null end
from employees e
join training_programs p on p.name = 'AI & Digital Productivity'
join (values
  ('DRI-1000', 'completed', false),
  ('NSG-1005', 'in_progress', false),
  ('NSG-1006', 'assigned', true),
  ('NSG-1007', 'completed', false),
  ('NSG-1009', 'assigned', false),
  ('NSG-1010', 'in_progress', false)
) as v(employee_code, status, overdue) on v.employee_code = e.employee_code
where e.organization_id = (select id from organizations where slug = 'digital-rise-innovations')
on conflict (employee_id, program_id) do nothing;

-- ── Emerging Leaders Program — People & Culture, Marketing lead, Sales ──────
insert into training_registrations (employee_id, program_id, status, requested_via, due_date, started_at, completed_at)
select e.id, p.id, v.status, 'admin',
  case v.status
    when 'completed' then current_date - interval '25 days'
    when 'in_progress' then current_date + interval '20 days'
    when 'assigned' then case when v.overdue then current_date - interval '6 days' else current_date + interval '30 days' end
  end,
  case when v.status in ('in_progress', 'completed') then current_date - interval '18 days' else null end,
  case when v.status = 'completed' then current_date - interval '15 days' else null end
from employees e
join training_programs p on p.name = 'Emerging Leaders Program'
join (values
  ('NSG-1003', 'in_progress', false),
  ('NSG-1004', 'assigned', false),
  ('DRI-1001', 'assigned', false),
  ('NSG-1011', 'completed', false),
  ('NSG-1012', 'assigned', true)
) as v(employee_code, status, overdue) on v.employee_code = e.employee_code
where e.organization_id = (select id from organizations where slug = 'digital-rise-innovations')
on conflict (employee_id, program_id) do nothing;

-- ── Strategic Leadership Essentials — Admin, Finance, senior Marketing ──────
insert into training_registrations (employee_id, program_id, status, requested_via, due_date, started_at, completed_at)
select e.id, p.id, v.status, 'admin',
  case v.status
    when 'completed' then current_date - interval '30 days'
    when 'in_progress' then current_date + interval '25 days'
    when 'assigned' then current_date + interval '35 days'
  end,
  case when v.status in ('in_progress', 'completed') then current_date - interval '20 days' else null end,
  case when v.status = 'completed' then current_date - interval '17 days' else null end
from employees e
join training_programs p on p.name = 'Strategic Leadership Essentials'
join (values
  ('DRI-1000', 'assigned'),
  ('NSG-1008', 'in_progress'),
  ('NSG-1001', 'completed'),
  ('NSG-1002', 'assigned')
) as v(employee_code, status) on v.employee_code = e.employee_code
where e.organization_id = (select id from organizations where slug = 'digital-rise-innovations')
on conflict (employee_id, program_id) do nothing;
