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
  };
}

const PROGRAM_COLUMNS =
  "id, name, description, duration_label, delivery_mode, location, eligibility, requires_manager_approval, seats_total, seats_available, next_cohort_start, mandatory, active, training_url";

/** Active programs only — an inactive program never surfaces to employees,
 * matching how hr_knowledge_base's `active` flag already works. */
export async function listTrainingPrograms(): Promise<TrainingProgram[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("training_programs").select(PROGRAM_COLUMNS).eq("active", true).order("name");
  if (error || !data) return [];
  return data.map(mapProgram);
}

/** Looked up by name (case-insensitive) — the model and the employee refer
 * to programs by name, never by database id. Inactive programs are not
 * found here either. */
export async function getTrainingProgramByName(name: string): Promise<TrainingProgram | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("training_programs").select(PROGRAM_COLUMNS).eq("active", true).ilike("name", `%${name}%`).limit(1).maybeSingle();
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
  createdAt: string;
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** Always derived, never persisted: due_date < today AND not completed. */
  overdue: boolean;
}

const REGISTRATION_COLUMNS =
  "id, program_id, status, created_at, due_date, started_at, completed_at, " +
  "training_programs(name, description, requires_manager_approval, mandatory, duration_label, delivery_mode, training_url)";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function mapRegistration(row: any): MyTrainingEntry {
  const program = row.training_programs ?? {};
  const dueDate: string | null = row.due_date ?? null;
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
    createdAt: row.created_at,
    dueDate,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    overdue: Boolean(dueDate) && dueDate! < todayIso() && row.status !== "completed",
  };
}

/** Scoped to one employee — never any other employee's registrations. */
export async function getMyTraining(employeeId: string): Promise<MyTrainingEntry[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("training_registrations")
    .select(REGISTRATION_COLUMNS)
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data.map(mapRegistration);
}

export async function findExistingRegistration(employeeId: string, programId: string): Promise<MyTrainingEntry | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("training_registrations")
    .select(REGISTRATION_COLUMNS)
    .eq("employee_id", employeeId)
    .eq("program_id", programId)
    .maybeSingle();
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
