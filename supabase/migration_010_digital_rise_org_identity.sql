-- ============================================================================
-- Migration 010 — Digital Rise organization identity conversion (data only)
-- ============================================================================
-- OPTIONAL, MANUAL. Not executed automatically by the application — review
-- and run this yourself in the Supabase SQL Editor when ready.
--
-- Context: this deployment's CODE no longer hardcodes "Northstar Global"
-- (system prompt, tool descriptions, identify screen now read the tenant
-- name from HR_CONCIERGE_ORG_DISPLAY_NAME — see src/lib/concierge/org.ts).
-- This migration is the separate, optional step to update the underlying
-- SEEDED DATA to match, so the HR knowledge base Concierge reads back to
-- employees no longer names the old fictional company either.
--
-- Deliberately preserves every policy VALUE (24 days annual leave, 65/5
-- days parental leave, 5% pension match, etc.) — only the company-name
-- mentions inside the existing text are replaced. No new policy claims are
-- introduced; these remain the same demo/placeholder values as before,
-- now attributed to "Digital Rise Innovations" instead of "Northstar
-- Global". Idempotent — safe to run more than once.
--
-- Deliberately NOT included: changing employees.email /
-- employees.manager_email off the @northstarglobal.com domain. That
-- domain's delivery risk is already handled by the existing
-- HR_CONCIERGE_DEMO_MANAGER_EMAIL redirect (src/lib/email.ts), and
-- changing it would break every existing test/fixture that looks up a
-- seeded employee by their exact current email (identity.test.ts,
-- seed-data.test.ts, manager-approval-flow.test.ts, and others) for no
-- safety benefit. Revisit only as part of a deliberate, separately-planned
-- re-seed, not bundled into this identity-copy conversion.
-- ============================================================================

update hr_knowledge_base
set answer = replace(answer, 'Northstar Global', 'Digital Rise Innovations'),
    updated_at = now()
where answer like '%Northstar Global%';

update hr_knowledge_base
set answer = replace(answer, 'it-support@northstarglobal.com', 'it-support@digitalriseinnovations.example'),
    updated_at = now()
where answer like '%it-support@northstarglobal.com%';

update training_programs
set description = replace(description, 'Northstar Global', 'Digital Rise Innovations'),
    updated_at = now()
where description like '%Northstar Global%';

-- Verify afterward: this should return 0 rows.
-- select id, topic from hr_knowledge_base where answer like '%Northstar Global%';
-- select id, name from training_programs where description like '%Northstar Global%';
