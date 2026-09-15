-- ============================================================================
-- Seed — HR Concierge Demo: Northstar Global (fictional company)
-- ============================================================================
-- !! DEMO DATA ONLY. Every employee, department, and figure below is
-- !! entirely fictional. Do not run this file against the production
-- !! Verofax Supabase project. This file assumes migration_008 (and the
-- !! base schema.sql + migrations 002-007) have already been applied to
-- !! the isolated "HR Concierge Demo" project.
--
-- Scope for this seed (Slice 1): employees, leave balances, HR knowledge
-- base, training programs. Demo conversation/request/registration
-- interaction records are deliberately NOT seeded here — those belong to
-- the slice that actually builds the Ask HR / Concierge Insights
-- experience, not the foundational-data slice.
--
-- Northstar Global — fictional international technology and
-- professional-services company. ~2,500 employees across Canada, UAE,
-- United Kingdom, and India (only a small illustrative subset is seeded
-- here — enough to demonstrate manager relationships and cross-region
-- HR administration, not a full headcount).
-- ============================================================================

-- ── Employees ────────────────────────────────────────────────────────────
-- annual_leave_days set to 24 to match the leave-request form's existing
-- displayed policy ("Annual Leave — 24 days / year", src/app/leave-request/
-- form.tsx LEAVE_TYPES) rather than the table's default of 30.

insert into employees (employee_code, full_name, email, department, designation, country, location, joining_date, status, manager_email, salary_currency, annual_leave_days)
values
  -- Primary demo persona
  ('NSG-1001', 'Sarah Ahmed',      'sarah.ahmed@northstarglobal.com',      'Marketing', 'Marketing Manager',        'UAE',    'Dubai, UAE',        '2022-03-14', 'active', 'daniel.carter@northstarglobal.com', 'AED', 24),

  -- Managers / cross-region cast
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
-- Sarah Ahmed: 24 entitled, 10 taken -> 14 remaining (matches the sprint
-- brief's story-2/story-3 example figures exactly).

insert into leave_balances (employee_id, year, leave_type, entitlement_days, accrued_days, taken_days, encashed_days, carry_forward_days)
select e.id, extract(year from current_date)::int, 'annual', 24, 24, v.taken, 0, 0
from employees e
join (values
  ('NSG-1001', 10),  -- Sarah Ahmed -> 14 remaining
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
-- End of seed. Verify record counts after running:
--   select count(*) from employees;             -- expect 12 (this seed) + any pre-existing
--   select count(*) from hr_knowledge_base;      -- expect 20
--   select count(*) from training_programs;      -- expect 4
-- ============================================================================
