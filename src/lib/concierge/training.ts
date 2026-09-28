import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { computeConfirmationToken, verifyConfirmationToken } from "./confirmation";

/**
 * Deterministic training/learning operations — Slice 4. Same shape as
 * leave.ts: read operations query existing tables directly; the one write
 * operation (enrollment) uses the exact same preview -> confirm ->
 * cryptographic-token pattern as create_leave_request, via the shared
 * confirmation.ts utility, not a second implementation.
 *
 * Eligibility is deliberately NOT auto-decided by matching free-text
 * `eligibility` against anything about the employee — there is no
 * employee seniority/level field to compare against, and inventing one
 * would mean the AI guessing at eligibility, which it must never do. The
 * one real, deterministic, enforced rule is: a program flagged
 * requires_manager_approval can NEVER be auto-confirmed — enrollment
 * always lands as a pending 'requested' row for a human to decide, no
 * matter what the AI or the employee believes about eligibility. Only
 * programs NOT requiring approval register directly.
 */

export interface TrainingProgram {
  id: string;
  name: string;
  description: string | null;
  durationLabel: string | null;
  deliveryMode: string | null;
  location: string | null;
  eligibility: string | null;
  requiresManagerApproval: boolean;
  seatsTotal: number | null;
  seatsAvailable: number | null;
  nextCohortStart: string | null;
  mandatory: boolean;
  /** Where START/CONTINUE navigates to — a demo/external course URL, not
   * content this app hosts. Null means "no link configured yet". */
  trainingUrl: string | null;
  /** "Internal", "Microsoft Learn", etc — where this training actually
   * comes from. Null means not yet configured. This is informational only:
   * completion is never auto-synced from an external provider (Microsoft
   * or otherwise) — an employee/HR action is always what marks it done. */
  provider: string | null;
}

function mapProgram(row: any): TrainingProgram {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    durationLabel: row.duration_label,
    deliveryMode: row.delivery_mode,
    location: row.location,
    eligibility: row.eligibility,
    requiresManagerApproval: row.requires_manager_approval,
    seatsTotal: row.seats_total,
    seatsAvailable: row.seats_available,
    nextCohortStart: row.next_cohort_start,
    mandatory: row.mandatory,
    trainingUrl: row.training_url ?? null,
    provider: row.provider ?? null,
  };
}

const PROGRAM_COLUMNS_BASE =
  "id, name, description, duration_label, delivery_mode, location, eligibility, requires_manager_approval, seats_total, seats_available, next_cohort_start, mandatory, active, training_url";
const PROGRAM_COLUMNS_FULL = `${PROGRAM_COLUMNS_BASE}, provider`;

/**
 * Selects training_programs, preferring the full column list (including
 * migration_013's `provider`) and transparently falling back to the base
 * columns if that migration hasn't been applied to this database yet —
 * same graceful-degradation principle as
 * src/lib/concierge/organizations.ts's lookupActiveOrganization(): this
 * code must stay safe to deploy BEFORE the migration is manually run,
 * never breaking the training feature that already works today.
 */
async function selectProgramColumns(
  supabase: ReturnType<typeof createServiceClient>,
  apply: (query: any) => PromiseLike<{ data: any; error: any }>,
): Promise<{ data: any; error: any }> {
  const full = await apply(supabase.from("training_programs").select(PROGRAM_COLUMNS_FULL));
  if (!full.error) return full;
  return apply(supabase.from("training_programs").select(PROGRAM_COLUMNS_BASE));
}

/** Active programs only — an inactive program never surfaces to employees,
 * matching how hr_knowledge_base's `active` flag already works. */
export async function listTrainingPrograms(): Promise<TrainingProgram[]> {
  const supabase = createServiceClient();
  const { data, error } = await selectProgramColumns(supabase, (q) => q.eq("active", true).order("name"));
  if (error || !data) return [];
  return data.map(mapProgram);
}

/** Looked up by name (case-insensitive) — the model and the employee refer
 * to programs by name, never by database id. Inactive programs are not
 * found here either. */
export async function getTrainingProgramByName(name: string): Promise<TrainingProgram | null> {
  const supabase = createServiceClient();
  const { data, error } = await selectProgramColumns(supabase, (q) => q.eq("active", true).ilike("name", `%${name}%`).limit(1).maybeSingle());
  if (error || !data) return null;
  return mapProgram(data);
}

export type TrainingRegistrationStatus =
  | "assigned"
  | "requested"
  | "confirmed"
  | "in_progress"
  | "waitlisted"
  | "declined"
  | "cancelled"
  | "completed";

export interface MyTrainingEntry {
  id: string;
  programId: string;
  programName: string;
  programDescription: string | null;
  status: TrainingRegistrationStatus;
  requiresManagerApproval: boolean;
  mandatory: boolean;
  durationLabel: string | null;
  deliveryMode: string | null;
  trainingUrl: string | null;
  provider: string | null;
  createdAt: string;
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** Always derived, never persisted: due_date < today AND not completed. */
  overdue: boolean;
  /** Simplified employee-facing label: Not Started / In Progress /
   * Completed / Overdue — derived from status+overdue, never a second
   * status stored anywhere. See toDisplayStatus(). */
  displayStatus: TrainingDisplayStatus;
  /** When a follow-up reminder was last sent for this assignment, if ever. */
  reminderSentAt: string | null;
}

const REGISTRATION_COLUMNS_BASE =
  "id, program_id, status, created_at, due_date, started_at, completed_at, " +
  "training_programs(name, description, requires_manager_approval, mandatory, duration_label, delivery_mode, training_url)";
const REGISTRATION_COLUMNS_FULL =
  "id, program_id, status, created_at, due_date, started_at, completed_at, reminder_sent_at, " +
  "training_programs(name, description, requires_manager_approval, mandatory, duration_label, delivery_mode, training_url, provider)";

/** Same graceful fallback as selectProgramColumns() above, for the
 * training_registrations side (reminder_sent_at + the embedded program's
 * provider — both migration_013). */
async function selectRegistrationColumns(
  supabase: ReturnType<typeof createServiceClient>,
  apply: (query: any) => PromiseLike<{ data: any; error: any }>,
): Promise<{ data: any; error: any }> {
  const full = await apply(supabase.from("training_registrations").select(REGISTRATION_COLUMNS_FULL));
  if (!full.error) return full;
  return apply(supabase.from("training_registrations").select(REGISTRATION_COLUMNS_BASE));
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export type TrainingDisplayStatus = "Not Started" | "In Progress" | "Completed" | "Overdue";

/**
 * The ONE mapping from the real DB status + derived overdue flag to the
 * four simplified labels requested for the employee-facing UI/Concierge
 * responses and Training Analytics. Never introduces a new stored status
 * value — 'assigned'/'requested'/'confirmed' all mean "Not Started" from
 * the employee's point of view; 'waitlisted'/'declined'/'cancelled' are
 * shown via their real status elsewhere, not folded into these four.
 */
export function toDisplayStatus(status: TrainingRegistrationStatus, overdue: boolean): TrainingDisplayStatus {
  if (overdue) return "Overdue";
  if (status === "completed") return "Completed";
  if (status === "in_progress") return "In Progress";
  return "Not Started";
}

function mapRegistration(row: any): MyTrainingEntry {
  const program = row.training_programs ?? {};
  const dueDate: string | null = row.due_date ?? null;
  const overdue = Boolean(dueDate) && dueDate! < todayIso() && row.status !== "completed";
  return {
    id: row.id,
    programId: row.program_id,
    programName: program.name ?? "Unknown program",
    programDescription: program.description ?? null,
    status: row.status,
    requiresManagerApproval: program.requires_manager_approval ?? false,
    mandatory: program.mandatory ?? false,
    durationLabel: program.duration_label ?? null,
    deliveryMode: program.delivery_mode ?? null,
    trainingUrl: program.training_url ?? null,
    provider: program.provider ?? null,
    createdAt: row.created_at,
    dueDate,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    overdue,
    displayStatus: toDisplayStatus(row.status, overdue),
    reminderSentAt: row.reminder_sent_at ?? null,
  };
}

/** Scoped to one employee — never any other employee's registrations. */
export async function getMyTraining(employeeId: string): Promise<MyTrainingEntry[]> {
  const supabase = createServiceClient();
  const { data, error } = await selectRegistrationColumns(supabase, (q) =>
    q.eq("employee_id", employeeId).order("created_at", { ascending: false }),
  );
  if (error || !data) return [];
  return data.map(mapRegistration);
}

export interface TrainingSummary {
  assigned: number;
  inProgress: number;
  completed: number;
  notStarted: number;
  overdue: number;
  /** Earliest upcoming due_date across everything not yet completed, or
   * null if nothing has a due date. */
  nextDue: { programName: string; dueDate: string } | null;
}

/** Aggregate counts for the Employee Profile "Learning & Compliance"
 * section — reuses getMyTraining(), no second query/shape. */
export async function getTrainingSummaryForEmployee(employeeId: string): Promise<TrainingSummary> {
  const entries = await getMyTraining(employeeId);
  const active = entries.filter((e) => !["declined", "cancelled"].includes(e.status));

  const upcoming = active
    .filter((e) => e.dueDate && e.status !== "completed")
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));

  return {
    assigned: active.length,
    inProgress: active.filter((e) => e.displayStatus === "In Progress").length,
    completed: active.filter((e) => e.displayStatus === "Completed").length,
    notStarted: active.filter((e) => e.displayStatus === "Not Started").length,
    overdue: active.filter((e) => e.displayStatus === "Overdue").length,
    nextDue: upcoming.length > 0 ? { programName: upcoming[0].programName, dueDate: upcoming[0].dueDate! } : null,
  };
}

export async function findExistingRegistration(employeeId: string, programId: string): Promise<MyTrainingEntry | null> {
  const supabase = createServiceClient();
  const { data, error } = await selectRegistrationColumns(supabase, (q) =>
    q.eq("employee_id", employeeId).eq("program_id", programId).maybeSingle(),
  );
  if (error || !data) return null;
  return mapRegistration(data);
}

export function computeEnrollmentToken(employeeId: string, programId: string): string {
  return computeConfirmationToken([employeeId, programId, "training_enrollment"]);
}

export function verifyEnrollmentToken(token: string | undefined, employeeId: string, programId: string): boolean {
  return verifyConfirmationToken(token, [employeeId, programId, "training_enrollment"]);
}

export interface EnrollmentResult {
  ok: boolean;
  status?: "requested" | "confirmed" | "waitlisted";
  registrationId?: string;
  message?: string;
}

/**
 * The one write in this module. Direct registration (no approval
 * required) atomically decrements seats_available via a single guarded
 * UPDATE (no separate RPC needed) — if that affects zero rows (seats were
 * already at 0), the employee is waitlisted instead of silently over-
 * booking. Approval-required programs are NEVER auto-confirmed — always
 * 'requested', for HR/a manager to decide later.
 */
export async function enrollInTraining(employeeId: string, program: TrainingProgram): Promise<EnrollmentResult> {
  const supabase = createServiceClient();

  if (program.requiresManagerApproval) {
    const { data, error } = await supabase
      .from("training_registrations")
      .insert({ employee_id: employeeId, program_id: program.id, status: "requested", requested_via: "concierge" })
      .select("id")
      .single();
    if (error || !data) return { ok: false, message: "Could not submit your registration. Please try again." };
    return { ok: true, status: "requested", registrationId: data.id };
  }

  // Direct registration path — only reached for programs that don't
  // require approval. Try to claim a seat atomically; if there isn't one,
  // waitlist instead of failing or over-booking.
  let status: "confirmed" | "waitlisted" = "waitlisted";
  if (program.seatsAvailable !== null) {
    const { data: claimed } = await supabase
      .from("training_programs")
      .update({ seats_available: program.seatsAvailable - 1 })
      .eq("id", program.id)
      .gt("seats_available", 0)
      .select("id")
      .maybeSingle();
    status = claimed ? "confirmed" : "waitlisted";
  } else {
    status = "confirmed"; // no seat cap configured
  }

  const { data, error } = await supabase
    .from("training_registrations")
    .insert({ employee_id: employeeId, program_id: program.id, status, requested_via: "concierge" })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: "Could not complete your registration. Please try again." };
  return { ok: true, status, registrationId: data.id };
}

export interface StartTrainingResult {
  ok: boolean;
  found: boolean;
  status?: TrainingRegistrationStatus;
  trainingUrl?: string | null;
  programName?: string;
  message?: string;
}

/**
 * Deliberately NOT a two-step preview/confirm write — opening a course
 * link and marking "I've started this" is harmless navigation, not a
 * consequential HR action, matching the sprint brief's explicit guidance.
 * Idempotent: calling this again after already starting (or completing)
 * never regresses status or re-sets started_at — it just returns the
 * link again (CONTINUE/VIEW semantics). A registration still 'requested'
 * (pending approval) or 'waitlisted' cannot be started — nothing here can
 * grant access that hasn't actually been approved.
 */
export async function startTrainingProgress(employeeId: string, programName: string): Promise<StartTrainingResult> {
  const program = await getTrainingProgramByName(programName);
  if (!program) return { ok: false, found: false, message: "No active program matches that name." };

  const registration = await findExistingRegistration(employeeId, program.id);
  if (!registration) {
    return {
      ok: false,
      found: false,
      programName: program.name,
      message: "You are not currently enrolled in or assigned this program — would you like to enroll?",
    };
  }

  if (registration.status === "requested" || registration.status === "waitlisted") {
    return {
      ok: false,
      found: true,
      status: registration.status,
      programName: program.name,
      message: `This is still ${registration.status === "waitlisted" ? "waitlisted" : "pending approval"} — it can't be started until that's resolved.`,
    };
  }
  if (registration.status === "declined" || registration.status === "cancelled") {
    return {
      ok: false,
      found: true,
      status: registration.status,
      programName: program.name,
      message: `This registration was ${registration.status} — it can't be started.`,
    };
  }

  // 'assigned' / 'confirmed' -> first start: move to in_progress and stamp
  // started_at. 'in_progress' / 'completed' -> already started; just
  // return the link again, no state change (idempotent).
  if (registration.status === "assigned" || registration.status === "confirmed") {
    const supabase = createServiceClient();
    await supabase
      .from("training_registrations")
      .update({ status: "in_progress", started_at: new Date().toISOString() })
      .eq("id", registration.id);
    return { ok: true, found: true, status: "in_progress", trainingUrl: program.trainingUrl, programName: program.name };
  }

  return { ok: true, found: true, status: registration.status, trainingUrl: program.trainingUrl, programName: program.name };
}

/**
 * Smallest safe demo-ready reminder mechanism (deliberately NOT a real
 * notification platform): records that HR followed up on a specific
 * assignment by stamping reminder_sent_at, and returns demoMode: true —
 * no email is actually sent by this function. Employee email addresses in
 * this environment resolve under organizations' own real domains (not a
 * clearly-fictional one), so sending real email from a "reminder" feature
 * built the night before a demo is exactly the kind of risk this
 * deliberately avoids; Training Analytics labels this clearly as a demo
 * action, not a delivered notification. Wiring in a real send later is a
 * small addition (reusing src/lib/email.ts's existing send() pattern),
 * not a rewrite.
 */
export interface TrainingReminderResult {
  ok: boolean;
  demoMode: true;
  reminderSentAt?: string;
  message: string;
}

export async function recordTrainingReminder(registrationId: string): Promise<TrainingReminderResult> {
  const supabase = createServiceClient();
  const sentAt = new Date().toISOString();
  const { error } = await supabase.from("training_registrations").update({ reminder_sent_at: sentAt }).eq("id", registrationId);
  if (error) {
    return { ok: false, demoMode: true, message: "Could not record the reminder. Please try again." };
  }
  return { ok: true, demoMode: true, reminderSentAt: sentAt, message: "Reminder logged for the demo — no email was actually sent." };
}
