-- ============================================================================
-- Migration 013 — Training enrichment (provider field + reminder tracking)
-- ============================================================================
-- Additive only, same pattern as migration_009. Adds:
--   1. training_programs.provider — "source/provider" (e.g. "Microsoft
--      Learn", "Internal"), requested for the demo but never previously
--      captured.
--   2. training_registrations.reminder_sent_at — when a follow-up reminder
--      was last sent for this assignment, so Training Analytics can show
--      "Last reminder: <date>" and avoid re-sending redundantly. Tracks
--      state only; it does not by itself send anything.
--
-- Then enriches the 4 EXISTING training programs with a provider +
-- training_url (both were previously null — filling in a null field is not
-- "overwriting valid existing data", and zero training_registrations exist
-- yet in this database at the time this migration was written, so there is
-- no registration history to disturb), and adds ONE new program: a real,
-- stable Microsoft Learn path for Microsoft 365 Copilot (not a fabricated
-- URL — see the deployment report for why this specific page was chosen).
--
-- Safe to re-run: the program UPDATEs are idempotent (same values), and
-- the new program INSERT is guarded by a name match.
-- ============================================================================

alter table training_programs
  add column if not exists provider text;

alter table training_registrations
  add column if not exists reminder_sent_at timestamptz;

update training_programs set
  provider = 'Internal',
  training_url = 'https://learn.microsoft.com/en-us/training/paths/develop-security-champions/'
where name = 'Cybersecurity Awareness' and provider is null;

update training_programs set
  provider = 'Internal'
where name in ('Emerging Leaders Program', 'Strategic Leadership Essentials') and provider is null;

update training_programs set
  provider = 'Internal',
  training_url = 'https://learn.microsoft.com/en-us/training/paths/microsoft-copilot-for-microsoft-365/'
where name = 'AI & Digital Productivity' and provider is null;

insert into training_programs (name, description, duration_label, delivery_mode, location, eligibility, provider, training_url, requires_manager_approval, seats_total, seats_available, mandatory, active)
select
  'Microsoft 365 Copilot Essentials',
  'Self-paced Microsoft Learn path covering Microsoft 365 Copilot fundamentals — Copilot in Word, Excel, Outlook, Teams, and effective prompt-writing.',
  'Self-paced', 'virtual', 'Virtual',
  'All employees',
  'Microsoft Learn',
  'https://learn.microsoft.com/en-us/training/paths/microsoft-copilot-for-microsoft-365/',
  false, 200, 200, false, true
where not exists (select 1 from training_programs where name = 'Microsoft 365 Copilot Essentials');
