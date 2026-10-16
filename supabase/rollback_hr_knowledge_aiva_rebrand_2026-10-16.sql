-- ============================================================
-- ROLLBACK: hr_knowledge_base AIVA rebrand (2026-10-16)
-- ============================================================
-- Context: 5 active hr_knowledge_base rows had their `answer` text
-- literally named the product "HR Concierge" (the AI would quote this
-- verbatim to employees). Updated to "AIVA" as part of the AIVA
-- rebrand so the AI's own name is consistent with what it says about
-- itself. ONLY the brand-name substring was changed — every policy
-- fact, process, number, and approval step is byte-identical to the
-- original.
--
-- This file restores the EXACT original `answer` text for each row,
-- by id, if the AIVA rebrand needs to be reverted. Safe to run as-is;
-- idempotent (plain UPDATE ... WHERE id = ...).
-- ============================================================

update hr_knowledge_base set answer = 'Northstar Global employees accrue 24 days of annual leave per calendar year, credited from your start date. Leave is requested through HR Concierge or the leave request form and is approved by your direct manager.'
where id = '797fca0b-4a58-4b41-9d30-6e5135acbe9f';

update hr_knowledge_base set answer = 'Northstar Global offers the Emerging Leaders Program, Strategic Leadership Essentials, AI & Digital Productivity, and mandatory annual Cybersecurity Awareness training. Ask HR Concierge for eligibility and how to register.'
where id = '2649c63b-0058-44cf-9105-24793d78250c';

update hr_knowledge_base set answer = 'The Northstar Global mentorship program pairs employees with a senior mentor in their area of interest for a 3-month cycle, with monthly 1:1 sessions. You can request a mentor through HR Concierge, including a preferred focus area.'
where id = 'daa43dd5-1a47-4729-a4d4-61087cb0da0f';

update hr_knowledge_base set answer = 'For anything HR Concierge can''t help with, or if you''d prefer to speak with a person, ask to be connected to HR and a People & Culture team member will follow up with you directly.'
where id = 'fe42c351-7a0e-4916-8242-0151f38e7555';

update hr_knowledge_base set answer = 'For sensitive matters — grievances, workplace concerns, or anything you''d rather discuss privately — HR Concierge will connect you directly with a People & Culture team member rather than trying to resolve it in chat.'
where id = '4d3361eb-b5e0-41df-8ba6-38e3b867f4e2';
