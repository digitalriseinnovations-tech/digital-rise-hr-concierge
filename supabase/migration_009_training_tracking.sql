-- ============================================================================
-- Migration 009 — Training tracking (TAQA Demo Sprint, Phase 2)
-- ============================================================================
-- Extends the EXISTING training_programs / training_registrations tables
-- (migration_008) rather than introducing a parallel model. Purely
-- additive: new nullable columns, and two new allowed status values —
-- every existing row, query, and piece of application code that only ever
-- used 'requested'/'confirmed'/'waitlisted'/'declined'/'cancelled'/
-- 'completed' keeps working unchanged.
--
-- New capability this unlocks:
--   - training_programs.training_url: where START/CONTINUE navigates to.
--   - training_registrations.due_date / started_at / completed_at: the
--     three timestamps needed to show Required/In Progress/Completed and
--     to derive "overdue" (due_date < today AND status != 'completed') —
--     overdue is NEVER a stored column, always computed at read time.
--   - status 'assigned': HR/admin pushed this training onto the employee
--     (requested_via='admin'), not yet started — distinct from the
--     existing 'confirmed' (employee self-enrolled via Concierge and got
--     a seat) and 'requested' (self-enrolled, pending approval).
--   - status 'in_progress': employee has started but not finished,
--     regardless of how the registration began.
--
-- Safe to run multiple times (every statement is idempotent).
-- ============================================================================

alter table training_programs
  add column if not exists training_url text;

alter table training_registrations
  add column if not exists due_date date,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;

-- Widen the status check constraint to also allow 'assigned' and
-- 'in_progress', without assuming Postgres's auto-generated constraint
-- name — looked up from pg_constraint instead of hardcoded, so this
-- migration can't fail if the name differs from the default convention.
do $$
declare
  existing_constraint_name text;
begin
  select con.conname into existing_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'training_registrations'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%status%';

  if existing_constraint_name is not null then
    execute format('alter table training_registrations drop constraint %I', existing_constraint_name);
  end if;

  alter table training_registrations
    add constraint training_registrations_status_check
    check (status in ('assigned', 'requested', 'confirmed', 'in_progress', 'waitlisted', 'declined', 'cancelled', 'completed'));
end $$;

-- ============================================================================
-- Done. Existing rows are unaffected (their status values are still valid
-- under the widened constraint; the three new columns default to NULL).
-- ============================================================================
