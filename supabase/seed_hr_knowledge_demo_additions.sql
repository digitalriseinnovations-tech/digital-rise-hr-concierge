-- ============================================================================
-- Seed additions — HR Knowledge (Digital Rise Innovations demo)
-- ============================================================================
-- Additive only — never touches the 20 existing hr_knowledge_base entries.
-- Fills topic gaps explicitly requested for tomorrow's demo (payroll,
-- probation, employee handbook, remote work, medical certificate) that
-- either had no entry at all, or existed under a name the demo script
-- doesn't literally ask about. All content is illustrative demo policy —
-- consistent in tone/specificity with the existing seeded entries, not
-- claimed as any real company's actual policy.
--
-- Safe to re-run: on conflict (id) never fires naturally here since this
-- always generates new ids, so instead each insert is guarded by a
-- not-exists check on the exact topic, making re-running a no-op.
-- ============================================================================

insert into hr_knowledge_base (category, topic, question, answer, keywords)
select 'general', 'Payroll', 'When and how am I paid?',
  'Salaries are paid monthly, processed by the last business day of each month, directly to your registered bank account. Payslips are available through HR — ask HR Concierge to connect you with People & Culture if you need a copy or have a payroll query specific to your pay.',
  array['payroll','payslip','salary date','pay date','when do i get paid']
where not exists (select 1 from hr_knowledge_base where topic = 'Payroll');

insert into hr_knowledge_base (category, topic, question, answer, keywords)
select 'policies', 'Probation Period', 'What is the probation period for new employees?',
  'New employees complete a 3-month probation period from their joining date, with a review at the end of that period together with their manager. Full benefits and leave entitlements apply from day one during probation.',
  array['probation','probationary period','new hire review','trial period']
where not exists (select 1 from hr_knowledge_base where topic = 'Probation Period');

insert into hr_knowledge_base (category, topic, question, answer, keywords)
select 'general', 'Employee Handbook', 'Where can I find the employee handbook?',
  'The employee handbook covering full company policies is shared during onboarding and available from People & Culture on request — ask HR Concierge to connect you with HR if you need a fresh copy.',
  array['employee handbook','policy handbook','company handbook','staff handbook']
where not exists (select 1 from hr_knowledge_base where topic = 'Employee Handbook');

insert into hr_knowledge_base (category, topic, question, answer, keywords)
select 'policies', 'Remote Work', 'Can I work remotely / fully from home?',
  'Most roles follow a hybrid model (minimum 2 in-office days per week). Fully remote arrangements are considered case-by-case with your manager''s approval, based on role requirements — there is no blanket fully-remote policy.',
  array['remote work','work from home','fully remote','wfh policy']
where not exists (select 1 from hr_knowledge_base where topic = 'Remote Work');

insert into hr_knowledge_base (category, topic, question, answer, keywords)
select 'leave', 'Medical Certificate', 'Do I need a medical certificate for sick leave?',
  'A medical certificate is required for sick leave absences longer than 3 consecutive days — submit it to People & Culture as soon as you''re able. For shorter absences, simply let your manager know.',
  array['medical certificate','sick note','doctor note','sickness certificate']
where not exists (select 1 from hr_knowledge_base where topic = 'Medical Certificate');
