import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { computeConfirmationToken, verifyConfirmationToken } from "./confirmation";

/**
 * Mentorship and coaching requests both reuse the SAME hr_requests table
 * escalate_to_hr already writes to (Slice 2) — request_type='mentorship'
 * or 'coaching' instead of 'escalation'. No new table, no duplicate
 * request-tracking architecture. No automatic mentor/coach matching or
 * approval happens here — every request lands as status='open' for HR /
 * the program owner to action, exactly like an escalation does.
 *
 * Slice 5 hardening: the one write here (submitting a request) now follows
 * the exact same preview -> confirm -> cryptographic-token pattern as
 * leave/training, via the shared confirmation.ts utility — not a second
 * implementation, and not "prompt compliance is the only guarantee"
 * anymore. Merely discussing mentorship/coaching (get_mentorship_information
 * / get_coaching_information) remains read-only and untouched by this.
 */

export type HrRequestType = "mentorship" | "coaching" | "general" | "escalation";

export interface HrRequestSummary {
  id: string;
  requestType: HrRequestType;
  category: string | null;
  note: string | null;
  status: "open" | "in_progress" | "resolved" | "closed";
  createdAt: string;
}

const MAX_NOTE_LENGTH = 500;

function truncateNote(note: string): string {
  return note.slice(0, MAX_NOTE_LENGTH);
}

/**
 * The token binds the exact request the employee is being asked to
 * confirm: which employee, which type (mentorship/coaching), the specific
 * focus/category, and the specific note text — a token computed for one
 * request (or one employee) can never authorize a different one. Category
 * is normalized to "" for coaching (which has none) so the two token
 * functions below produce a shape callers don't need to special-case.
 */
export function computeHrRequestToken(employeeId: string, requestType: HrRequestType, category: string | null, note: string): string {
  return computeConfirmationToken([employeeId, requestType, category ?? "", truncateNote(note)]);
}

export function verifyHrRequestToken(
  token: string | undefined,
  employeeId: string,
  requestType: HrRequestType,
  category: string | null,
  note: string,
): boolean {
  return verifyConfirmationToken(token, [employeeId, requestType, category ?? "", truncateNote(note)]);
}

/**
 * Idempotency guard — a retried confirmed call for the exact same request
 * (same employee, type, category, and note) reuses the existing open
 * request rather than creating a duplicate, mirroring
 * findExistingPendingRequest (leave) / findExistingRegistration (training).
 * Deliberately scoped to an exact match, not "any open request of this
 * type" — a genuinely different follow-up request (different focus area,
 * different note) is still allowed through.
 */
export async function findExistingOpenRequest(
  employeeId: string,
  requestType: HrRequestType,
  category: string | null,
  note: string,
): Promise<HrRequestSummary | null> {
  const supabase = createServiceClient();
  let query = supabase
    .from("hr_requests")
    .select("id, request_type, category, note, status, created_at")
    .eq("employee_id", employeeId)
    .eq("request_type", requestType)
    .eq("status", "open")
    .eq("note", truncateNote(note));

  query = category === null ? query.is("category", null) : query.eq("category", category);

  const { data, error } = await query.limit(1).maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    requestType: data.request_type,
    category: data.category,
    note: data.note,
    status: data.status,
    createdAt: data.created_at,
  };
}

async function createHrRequest(
  employeeId: string,
  requestType: HrRequestType,
  category: string | null,
  note: string,
  conversationId: string,
  urgent = false,
): Promise<{ ok: boolean; requestId?: string; message?: string }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("hr_requests")
    .insert({
      employee_id: employeeId,
      request_type: requestType,
      category,
      note: truncateNote(note),
      conversation_id: conversationId,
      status: "open",
      urgent,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, message: "Could not submit your request. Please try again." };
  return { ok: true, requestId: data.id };
}

/** The one write for mentorship — call only after the token has been
 * verified by the caller (tool-executor.ts owns that check, exactly like
 * submitLeaveRequest / enrollInTraining). */
export function createMentorshipRequest(employeeId: string, focusArea: string | null, note: string, conversationId: string) {
  return createHrRequest(employeeId, "mentorship", focusArea, note, conversationId);
}

/** The one write for coaching — same caveat as above. */
export function createCoachingRequest(employeeId: string, note: string, conversationId: string) {
  return createHrRequest(employeeId, "coaching", null, note, conversationId);
}

/** The one write for escalation — same caveat as above. Marks the row
 * urgent when category is "sensitive", mirroring escalate_to_hr's original
 * unconditional behavior exactly (Showcase Hardening: escalation is now
 * preview -> confirm gated like every other write here, but the DB row it
 * eventually creates is unchanged). */
export function createEscalation(employeeId: string, category: string, reason: string, conversationId: string) {
  return createHrRequest(employeeId, "escalation", category, reason, conversationId, category === "sensitive");
}

/** Scoped to one employee only — used for "what's the status of my
 * mentorship/coaching/HR request" style questions. */
export async function getMyHrRequests(employeeId: string, requestType?: HrRequestType): Promise<HrRequestSummary[]> {
  const supabase = createServiceClient();
  let query = supabase
    .from("hr_requests")
    .select("id, request_type, category, note, status, created_at")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (requestType) query = query.eq("request_type", requestType);

  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    requestType: row.request_type,
    category: row.category,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
  }));
}
