-- ============================================================================
-- Seed expansion — TAQA Demo Sprint (still Northstar Global, fictional)
-- ============================================================================
-- !! DEMO DATA ONLY. Every employee, department, and figure below is
-- !! entirely fictional — NOT real TAQA data. Do not run against the
-- !! production Verofax Supabase project. Requires migration_008 AND
-- !! migration_009_training_tracking.sql to have already been applied
-- !! (this file uses due_date/started_at/completed_at/training_url and
-- !! the 'assigned'/'in_progress' statuses those migrations add).
--
-- Adds ~15 more employees across Operations, Maintenance, HSE, and
-- Corporate — departments an energy/utilities company demo audience will
-- recognize — bringing the seeded org to ~27 people, plus realistic
-- interconnected training assignments, a couple of leave requests, and a
-- couple of mentorship/coaching requests. Existing 12 employees, their
-- leave balances, and existing training programs are untouched (all
-- inserts below are additive and idempotent via ON CONFLICT DO NOTHING).
--
-- SAFETY: every new employee's manager_email is an @northstarglobal.com
-- address, exactly like the existing 12 — the SAME real, externally-
-- registered domain already covered by the HR_CONCIERGE_DEMO_MANAGER_EMAIL
-- override (src/lib/email.ts). No new, different real domain is
-- introduced. The logical manager relationship (who the UI shows as
-- "Approver") is completely independent of that override, exactly as
-- before this seed.
-- ============================================================================

-- ── New employees ────────────────────────────────────────────────────────

insert into employees (employee_code, full_name, email, department, designation, country, location, joining_date, status, manager_email, salary_currency, annual_leave_days)
values
  -- Corporate / Management
  ('NSG-1013', 'Khalid Al-Marzooqi', 'khalid.almarzooqi@northstarglobal.com', 'Corporate',   'Chief Operating Officer',      'UAE', 'Abu Dhabi, UAE', '2016-02-01', 'active', 'khalid.almarzooqi@northstarglobal.com', 'AED', 24),
  ('NSG-1014', 'Noura Al-Suwaidi',   'noura.alsuwaidi@northstarglobal.com',   'Corporate',   'Executive Assistant',          'UAE', 'Abu Dhabi, UAE', '2021-04-12', 'active', 'khalid.almarzooqi@northstarglobal.com', 'AED', 24),

  -- Operations
  ('NSG-1015', 'Faisal Rahman',      'faisal.rahman@northstarglobal.com',     'Operations',  'Director of Operations',       'UAE', 'Abu Dhabi, UAE', '2015-09-20', 'active', 'khalid.almarzooqi@northstarglobal.com', 'AED', 24),
  ('NSG-1016', 'Meera Krishnan',     'meera.krishnan@northstarglobal.com',    'Operations',  'Operations Supervisor',        'UAE', 'Abu Dhabi, UAE', '2019-11-03', 'active', 'faisal.rahman@northstarglobal.com',     'AED', 24),
  ('NSG-1017', 'Omar Haddad',        'omar.haddad@northstarglobal.com',       'Operations',  'Operations Analyst',           'UAE', 'Dubai, UAE',     '2022-06-15', 'active', 'faisal.rahman@northstarglobal.com',     'AED', 24),
  ('NSG-1018', 'Sara Al-Blooshi',    'sara.alblooshi@northstarglobal.com',    'Operations',  'Operations Coordinator',       'UAE', 'Abu Dhabi, UAE', '2023-01-09', 'active', 'faisal.rahman@northstarglobal.com',     'AED', 24),
  ('NSG-1019', 'Tariq Mansour',      'tariq.mansour@northstarglobal.com',     'Operations',  'Field Operations Lead',        'UAE', 'Ruwais, UAE',    '2020-03-22', 'active', 'faisal.rahman@northstarglobal.com',     'AED', 24),

  -- Maintenance
  ('NSG-1020', 'Grace Mwangi',       'grace.mwangi@northstarglobal.com',      'Maintenance', 'Maintenance Manager',          'UAE', 'Ruwais, UAE',    '2017-07-11', 'active', 'khalid.almarzooqi@northstarglobal.com', 'AED', 24),
  ('NSG-1021', 'Youssef El-Sayed',   'youssef.elsayed@northstarglobal.com',   'Maintenance', 'Senior Maintenance Technician','UAE', 'Ruwais, UAE',    '2021-05-18', 'active', 'grace.mwangi@northstarglobal.com',      'AED', 24),
  ('NSG-1022', 'Anjali Deshpande',   'anjali.deshpande@northstarglobal.com',  'Maintenance', 'Maintenance Technician',       'UAE', 'Ruwais, UAE',    '2023-09-04', 'active', 'grace.mwangi@northstarglobal.com',      'AED', 24),

  -- HSE (Health, Safety & Environment)
  ('NSG-1023', 'Hassan Ibrahim',     'hassan.ibrahim@northstarglobal.com',    'HSE',         'HSE Manager',                  'UAE', 'Abu Dhabi, UAE', '2018-08-27', 'active', 'khalid.almarzooqi@northstarglobal.com', 'AED', 24),
  ('NSG-1024', 'Lubna Qureshi',      'lubna.qureshi@northstarglobal.com',     'HSE',         'HSE Officer',                  'UAE', 'Ruwais, UAE',    '2022-02-14', 'active', 'hassan.ibrahim@northstarglobal.com',    'AED', 24),
  ('NSG-1025', 'Daniel Osei',        'daniel.osei@northstarglobal.com',       'HSE',         'HSE Officer',                  'UAE', 'Abu Dhabi, UAE', '2023-04-30', 'active', 'hassan.ibrahim@northstarglobal.com',    'AED', 24),

  -- Additional Engineering (a slightly larger, more demo-realistic team)
  ('NSG-1026', 'Zainab Malik',       'zainab.malik@northstarglobal.com',      'Engineering', 'Senior Software Engineer',     'Canada', 'Toronto, Canada', '2020-10-05', 'active', 'priya.nair@northstarglobal.com',       'CAD', 24),
  ('NSG-1027', 'Ahmed Farouk',       'ahmed.farouk@northstarglobal.com',      'Engineering', 'DevOps Engineer',              'UAE',    'Dubai, UAE',       '2022-08-19', 'active', 'priya.nair@northstarglobal.com',       'AED', 24)
on conflict (employee_code) do nothing;

-- ── Leave balances (current year, annual leave) for the new employees ──

insert into leave_balances (employee_id, year, leave_type, entitlement_days, accrued_days, taken_days, encashed_days, carry_forward_days)
select e.id, extract(year from current_date)::int, 'annual', 24, 24, v.taken, 0, 0
from employees e
join (values
  ('NSG-1013', 6), ('NSG-1014', 11), ('NSG-1015', 4), ('NSG-1016', 9),
  ('NSG-1017', 14), ('NSG-1018', 3), ('NSG-1019', 8), ('NSG-1020', 5),
  ('NSG-1021', 12), ('NSG-1022', 17), ('NSG-1023', 7), ('NSG-1024', 10),
  ('NSG-1025', 2), ('NSG-1026', 13), ('NSG-1027', 6)
) as v(employee_code, taken) on v.employee_code = e.employee_code
on conflict (employee_id, year, leave_type) do nothing;

-- ── Two more active training programs (energy-company-relevant), plus
--    a training_url on every program so Start/Continue has somewhere to
--    send the employee (a placeholder demo URL — not real course content).

insert into training_programs (name, description, duration_label, delivery_mode, eligibility, requires_manager_approval, seats_total, seats_available, mandatory, active, training_url)
values
  ('HSE Safety Fundamentals', 'Core health, safety, and environment fundamentals required for all operational and site-based staff.', '3 hours', 'virtual', 'All Operations, Maintenance, and HSE staff', false, null, null, true, true, 'https://learning.example.com/courses/hse-safety-fundamentals'),
  ('Advanced Data Analytics', 'Practical data analytics techniques for operational decision-making.', '6 weeks', 'hybrid', 'Open to all employees', false, 20, 20, false, true, 'https://learning.example.com/courses/advanced-data-analytics')
on conflict do nothing;

update training_programs set training_url = 'https://learning.example.com/courses/emerging-leaders' where name = 'Emerging Leaders Program' and training_url is null;
update training_programs set training_url = 'https://learning.example.com/courses/strategic-leadership' where name = 'Strategic Leadership Essentials' and training_url is null;
update training_programs set training_url = 'https://learning.example.com/courses/cybersecurity-awareness' where name = 'Cybersecurity Awareness' and training_url is null;
update training_programs set training_url = 'https://learning.example.com/courses/ai-digital-productivity' where name = 'AI & Digital Productivity' and training_url is null;

-- ── Training assignments — a realistic, varied spread across the WHOLE
--    seeded org (all 27 employees), covering every status this sprint's
--    "overdue" derivation and analytics need to demonstrate:
--      overdue      = due_date in the past AND status != 'completed'
--      on track     = due_date in the future, status = 'assigned'
--      in progress  = status = 'in_progress' (started_at set)
--      completed    = status = 'completed' (completed_at set)

-- Mandatory: Cybersecurity Awareness -> assigned to everyone, mixed progress.
insert into training_registrations (employee_id, program_id, status, requested_via, due_date, started_at, completed_at)
select e.employee_id, p.id, e.status, 'admin', e.due_date::date,
  case when e.status in ('in_progress','completed') then (current_date - (e.days_ago || ' days')::interval)::timestamptz else null end,
  case when e.status = 'completed' then (current_date - (e.days_ago - 5 || ' days')::interval)::timestamptz else null end
from training_programs p
join (
  select emp.id as employee_id, v.employee_code, v.status, v.due_date, v.days_ago
  from (values
    ('NSG-1001', 'completed',  current_date - 20, 25),
    ('NSG-1002', 'completed',  current_date - 40, 45),
    ('NSG-1003', 'assigned',   current_date + 10, 0),
    ('NSG-1004', 'in_progress',current_date + 5,  3),
    ('NSG-1005', 'assigned',   current_date - 5,  0),   -- overdue
    ('NSG-1006', 'completed',  current_date - 15, 20),
    ('NSG-1007', 'in_progress',current_date + 8,  2),
    ('NSG-1008', 'assigned',   current_date - 10, 0),   -- overdue
    ('NSG-1009', 'assigned',   current_date + 20, 0),
    ('NSG-1010', 'completed',  current_date - 30, 35),
    ('NSG-1011', 'assigned',   current_date - 2,  0),   -- overdue
    ('NSG-1012', 'in_progress',current_date + 12, 4),
    ('NSG-1013', 'completed',  current_date - 60, 65),
    ('NSG-1014', 'assigned',   current_date + 15, 0),
    ('NSG-1015', 'completed',  current_date - 25, 30),
    ('NSG-1016', 'in_progress',current_date + 6,  2),
    ('NSG-1017', 'assigned',   current_date - 3,  0),   -- overdue
    ('NSG-1018', 'assigned',   current_date + 18, 0),
    ('NSG-1019', 'completed',  current_date - 10, 15),
    ('NSG-1020', 'assigned',   current_date - 7,  0),   -- overdue
    ('NSG-1021', 'in_progress',current_date + 9,  1),
    ('NSG-1022', 'assigned',   current_date + 25, 0),
    ('NSG-1023', 'completed',  current_date - 5,  10),
    ('NSG-1024', 'assigned',   current_date - 1,  0),   -- overdue
    ('NSG-1025', 'assigned',   current_date + 22, 0),
    ('NSG-1026', 'completed',  current_date - 45, 50),
    ('NSG-1027', 'in_progress',current_date + 7,  3)
  ) as v(employee_code, status, due_date, days_ago)
  join employees emp on emp.employee_code = v.employee_code
) e on true
where p.name = 'Cybersecurity Awareness'
on conflict (employee_id, program_id) do nothing;

-- Mandatory: HSE Safety Fundamentals -> assigned only to Operations,
-- Maintenance, and HSE staff (a realistic targeted mandatory assignment,
-- not a blanket company-wide one).
insert into training_registrations (employee_id, program_id, status, requested_via, due_date, started_at, completed_at)
select e.employee_id, p.id, e.status, 'admin', e.due_date::date,
  case when e.status in ('in_progress','completed') then (current_date - (e.days_ago || ' days')::interval)::timestamptz else null end,
  case when e.status = 'completed' then (current_date - (e.days_ago - 3 || ' days')::interval)::timestamptz else null end
from training_programs p
join (
  select emp.id as employee_id, v.employee_code, v.status, v.due_date, v.days_ago
  from (values
    ('NSG-1015', 'completed',   current_date - 15, 20),
    ('NSG-1016', 'assigned',    current_date - 4,  0),   -- overdue
    ('NSG-1017', 'in_progress', current_date + 6,  2),
    ('NSG-1018', 'assigned',    current_date + 14, 0),
    ('NSG-1019', 'completed',   current_date - 8,  12),
    ('NSG-1020', 'completed',   current_date - 20, 25),
    ('NSG-1021', 'assigned',    current_date - 6,  0),   -- overdue
    ('NSG-1022', 'in_progress', current_date + 4,  1),
    ('NSG-1023', 'completed',   current_date - 30, 35),
    ('NSG-1024', 'assigned',    current_date + 9,  0),
    ('NSG-1025', 'in_progress', current_date + 2,  1)
  ) as v(employee_code, status, due_date, days_ago)
  join employees emp on emp.employee_code = v.employee_code
) e on true
where p.name = 'HSE Safety Fundamentals'
on conflict (employee_id, program_id) do nothing;

-- Optional enrollments (self-service via Concierge, requested_via
-- deliberately 'concierge' here to also demonstrate that path alongside
-- the admin-assigned mandatory ones above).
insert into training_registrations (employee_id, program_id, status, requested_via)
select emp.id, p.id, v.status, 'concierge'
from (values
  ('NSG-1006', 'Emerging Leaders Program', 'requested'),
  ('NSG-1010', 'Emerging Leaders Program', 'confirmed'),
  ('NSG-1012', 'Strategic Leadership Essentials', 'requested'),
  ('NSG-1017', 'Advanced Data Analytics', 'confirmed'),
  ('NSG-1026', 'AI & Digital Productivity', 'completed')
) as v(employee_code, program_name, status)
join employees emp on emp.employee_code = v.employee_code
join training_programs p on p.name = v.program_name
on conflict (employee_id, program_id) do nothing;

-- ── A couple of real pending leave requests among the new employees ────

insert into leave_requests (employee_id, leave_type, start_date, end_date, days_count, status, manager_email, submitter_email, submitted_via)
select emp.id, 'annual', v.start_date::date, v.end_date::date, v.days, 'pending', emp.manager_email, emp.email, 'admin'
from (values
  ('NSG-1017', '2026-11-10', '2026-11-12', 3),
  ('NSG-1024', '2026-12-05', '2026-12-05', 1)
) as v(employee_code, start_date, end_date, days)
join employees emp on emp.employee_code = v.employee_code
where not exists (
  select 1 from leave_requests lr where lr.employee_id = emp.id and lr.start_date = v.start_date::date and lr.end_date = v.end_date::date
);

-- ── A couple of mentorship/coaching requests among the new employees ───

insert into hr_requests (employee_id, request_type, category, note, status)
select emp.id, v.request_type, v.category, v.note, 'open'
from (values
  ('NSG-1018', 'mentorship', 'operations leadership', 'Interested in a mentor within Operations leadership.'),
  ('NSG-1022', 'coaching',   null,                     'Interested in executive coaching to grow into a lead role.')
) as v(employee_code, request_type, category, note)
join employees emp on emp.employee_code = v.employee_code
where not exists (
  select 1 from hr_requests r where r.employee_id = emp.id and r.request_type = v.request_type and r.note = v.note
);

-- ============================================================================
-- Done. All fictional demo data for the TAQA showcase — no real TAQA
-- employee data anywhere in this file.
-- ============================================================================
