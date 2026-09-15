import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { computeConfirmationToken as computeToken, verifyConfirmationToken as verifyToken } from "./confirmation";

/**
 * Deterministic leave operations for HR Concierge — Slice 3. This module
 * NEVER decides or changes a leave request's status. It only:
 *   (a) reads the existing current_leave_balances view (no second balance
 *       formula — the exact same view the admin Leave page and the
 *       public leave-request page already rely on),
 *   (b) reads leave_requests, scoped to one employee,
 *   (c) submits a NEW request through the EXISTING POST /api/leave-submit
 *       boundary (server-to-server call to the same route the public form
 *       already posts to) — there is no second insertion path.
 * Approval/rejection remains exclusively the existing tokenized
 * manager-email flow (src/app/leave-decision/[token]) — nothing here can
 * reach that table's status/decided_* columns.
 */

export const LEAVE_TYPES = [
  "annual", "sick", "maternity", "paternity", "mourning", "haj", "unpaid", "other",
] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

// ── Balance (read-only, existing view) ──────────────────────────────────

export interface LeaveBalanceResult {
  leaveType: LeaveType;
  entitlementDays: number;
  accruedDays: number;
  takenDays: number;
  remainingDays: number;
}

/** Reads the EXISTING current_leave_balances view — the same one the admin
 * Leave page and /api/leave-submit's balance-preview logic both use. No
 * second calculation of remaining days exists anywhere in this module. */
export async function getMyLeaveBalance(employeeId: string, leaveType: LeaveType = "annual"): Promise<LeaveBalanceResult | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("current_leave_balances")
    .select("entitlement_days, accrued_days, taken_days, remaining_days")
    .eq("employee_id", employeeId)
    .eq("leave_type", leaveType)
    .maybeSingle();

  if (error || !data) return null;
  return {
    leaveType,
    entitlementDays: Number(data.entitlement_days),
    accruedDays: Number(data.accrued_days),
    takenDays: Number(data.taken_days),
    remainingDays: Number(data.remaining_days),
  };
}

// ── Deterministic date-year resolution ──────────────────────────────────
// The model is unreliable at inferring which YEAR a bare "October 12 to
// October 15" means (observed resolving to a past year during testing).
// Rather than trust LLM arithmetic for this, the tool schema accepts
// either a full "YYYY-MM-DD" (employee gave an explicit year) or a bare
// "MM-DD" (year omitted) — and this function resolves the year with a
// fixed, deterministic, testable rule, never an LLM guess.

export interface DateResolutionSuccess {
  ok: true;
  startDate: string; // YYYY-MM-DD
  endDate: string;
}
export interface DateResolutionFailure {
  ok: false;
  reason: "invalid_format" | "invalid_calendar_date" | "end_before_start" | "in_the_past" | "range_too_long";
  message: string;
}
export type DateResolutionResult = DateResolutionSuccess | DateResolutionFailure;

const FULL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_DAY_RE = /^(\d{2})-(\d{2})$/;

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  // JS silently rolls over invalid dates (e.g. Feb 30 -> Mar 2) — catch
  // that by checking the round trip matches exactly what was asked for.
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function todayUTC(referenceDate: Date): { year: number; month: number; day: number } {
  return { year: referenceDate.getUTCFullYear(), month: referenceDate.getUTCMonth() + 1, day: referenceDate.getUTCDate() };
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Resolves one "YYYY-MM-DD" or "MM-DD" input against a reference date.
 * Returns null on unparseable/invalid-calendar input (caller turns that
 * into a clear failure) — the year-inference rule itself: if the month/day
 * hasn't happened yet this year (or is today), use the current year;
 * otherwise it's already passed, so use next year. Never silently returns
 * a past date. */
function resolveSingleDate(
  input: string,
  referenceDate: Date,
): { year: number; month: number; day: number; explicitYear: boolean } | null {
  const full = FULL_DATE_RE.exec(input.trim());
  if (full) {
    const year = Number(full[1]);
    const month = Number(full[2]);
    const day = Number(full[3]);
    if (!isValidCalendarDate(year, month, day)) return null;
    return { year, month, day, explicitYear: true };
  }

  const monthDay = MONTH_DAY_RE.exec(input.trim());
  if (monthDay) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    const today = todayUTC(referenceDate);
    if (!isValidCalendarDate(today.year, month, day)) return null;

    // "Still upcoming (or today) in the current year" -> current year;
    // "already passed" -> next year. Compare as plain YYYYMMDD integers,
    // no timezone ambiguity since both sides are UTC calendar components.
    const candidateThisYear = today.year * 10000 + month * 100 + day;
    const todayNum = today.year * 10000 + today.month * 100 + today.day;
    const year = candidateThisYear >= todayNum ? today.year : today.year + 1;
    return { year, month, day, explicitYear: false };
  }

  return null;
}

const MAX_LEAVE_RANGE_DAYS = 90;

/**
 * Resolves a start/end date pair for a leave request. Both deterministic
 * rules requested: upcoming-this-year dates keep the current year; already-
 * passed dates roll to next year; a range crossing a year boundary (e.g.
 * "Dec 30 to Jan 2", both bare MM-DD) resolves the end date into the year
 * AFTER the start date's resolved year if that's the only way end >= start.
 * Never returns a date before `referenceDate`.
 */
export function resolveLeaveDateRange(startInput: string, endInput: string, referenceDate: Date = new Date()): DateResolutionResult {
  const start = resolveSingleDate(startInput, referenceDate);
  if (!start) {
    return { ok: false, reason: "invalid_format", message: `"${startInput}" isn't a date I can resolve — please give a specific start date (e.g. "October 12" or "2026-10-12").` };
  }

  let end = resolveSingleDate(endInput, referenceDate);
  if (!end) {
    return { ok: false, reason: "invalid_format", message: `"${endInput}" isn't a date I can resolve — please give a specific end date.` };
  }

  // Year-boundary crossing (e.g. "Dec 30" -> "Jan 2", both bare MM-DD):
  // only applies when the END month is genuinely EARLIER than the START
  // month — that's the actual signature of a wraparound range. Critically
  // this must NOT fire just because end < start numerically within the
  // SAME year (e.g. start "10-15", end "10-12" — that's a plain ordering
  // error, correctly caught as end_before_start below, not a year
  // rollover). Re-resolve the end date assuming it belongs to the start's
  // year, then roll forward one year only for a true earlier-month wrap.
  if (!end.explicitYear && !start.explicitYear && end.month < start.month) {
    end = { ...end, year: start.year + 1 };
  } else if (!end.explicitYear && !start.explicitYear) {
    end = { ...end, year: start.year };
  }

  const startIso = toIso(start.year, start.month, start.day);
  const endIso = toIso(end.year, end.month, end.day);

  const startNum = start.year * 10000 + start.month * 100 + start.day;
  const endNum = end.year * 10000 + end.month * 100 + end.day;
  if (endNum < startNum) {
    return { ok: false, reason: "end_before_start", message: "The end date is before the start date — please double-check the range." };
  }

  const today = todayUTC(referenceDate);
  const todayNum = today.year * 10000 + today.month * 100 + today.day;
  if (startNum < todayNum) {
    return { ok: false, reason: "in_the_past", message: "That start date is in the past — please give an upcoming date." };
  }

  const days = calculateDaysCount(startIso, endIso);
  if (days > MAX_LEAVE_RANGE_DAYS) {
    return { ok: false, reason: "range_too_long", message: `That's a ${days}-day range, which is longer than this can handle in one request — please split it up or contact HR directly.` };
  }

  return { ok: true, startDate: startIso, endDate: endIso };
}

// ── Day-count (mirrors the existing public form's formula exactly) ─────

/**
 * Identical to src/app/leave-request/form.tsx's daysBetween(): inclusive
 * calendar-day count, NOT a working-days-excluding-weekends calculation —
 * the existing system has no such concept, so this module doesn't invent
 * one either. Kept here as one small, trivial, exactly-mirrored formula
 * rather than importing a client component into server code.
 */
export function calculateDaysCount(startDate: string, endDate: string): number {
  const s = new Date(startDate);
  const e = new Date(endDate);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 0;
  const diffMs = e.getTime() - s.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

// ── Confirmation token (binds a preview to its exact details) ──────────
// Uses the shared generic utility (confirmation.ts) — training enrollment
// uses the exact same mechanism, not a second implementation.

interface ConfirmationDetails {
  employeeId: string;
  startDate: string;
  endDate: string;
  leaveType: LeaveType;
  daysCount: number;
}

/** A short HMAC over the exact request details — NOT a generic "yes,
 * proceed" flag. Confirming a 4-day annual-leave request can never be
 * replayed to authorize a different date range, type, or day count,
 * because the token simply won't match different details. */
export function computeConfirmationToken(details: ConfirmationDetails): string {
  return computeToken([details.employeeId, details.startDate, details.endDate, details.leaveType, details.daysCount]);
}

export function verifyConfirmationToken(token: string | undefined, details: ConfirmationDetails): boolean {
  return verifyToken(token, [details.employeeId, details.startDate, details.endDate, details.leaveType, details.daysCount]);
}

// ── Requests (read, scoped to one employee) ─────────────────────────────

export interface LeaveRequestSummary {
  id: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  daysCount: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  createdAt: string;
  decidedAt: string | null;
}

export async function getMyLeaveRequests(employeeId: string, limit = 5): Promise<LeaveRequestSummary[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("leave_requests")
    .select("id, leave_type, start_date, end_date, days_count, status, created_at, decided_at")
    .eq("employee_id", employeeId) // scoped — never any other employee's rows
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id,
    leaveType: r.leave_type,
    startDate: r.start_date,
    endDate: r.end_date,
    daysCount: Number(r.days_count),
    status: r.status,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
  }));
}

/** Finds one specific request by date range if given, otherwise the most
 * recent request — still always scoped to the one employee. */
export async function getLeaveRequestStatus(
  employeeId: string,
  filter: { startDate?: string; endDate?: string } = {},
): Promise<LeaveRequestSummary | null> {
  const supabase = createServiceClient();
  let query = supabase
    .from("leave_requests")
    .select("id, leave_type, start_date, end_date, days_count, status, created_at, decided_at")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (filter.startDate) query = query.eq("start_date", filter.startDate);
  if (filter.endDate) query = query.eq("end_date", filter.endDate);

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    leaveType: data.leave_type,
    startDate: data.start_date,
    endDate: data.end_date,
    daysCount: Number(data.days_count),
    status: data.status,
    createdAt: data.created_at,
    decidedAt: data.decided_at,
  };
}

/** Idempotency guard: if an identical pending request already exists for
 * this employee (same dates + type), reuse it instead of inserting a
 * duplicate — protects against a retried/double-submitted confirmed call. */
export async function findExistingPendingRequest(
  employeeId: string,
  startDate: string,
  endDate: string,
  leaveType: LeaveType,
): Promise<LeaveRequestSummary | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("leave_requests")
    .select("id, leave_type, start_date, end_date, days_count, status, created_at, decided_at")
    .eq("employee_id", employeeId)
    .eq("start_date", startDate)
    .eq("end_date", endDate)
    .eq("leave_type", leaveType)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    leaveType: data.leave_type,
    startDate: data.start_date,
    endDate: data.end_date,
    daysCount: Number(data.days_count),
    status: data.status,
    createdAt: data.created_at,
    decidedAt: data.decided_at,
  };
}

/** Best-effort friendly display name for the employee's manager, purely
 * for phrasing ("awaiting Daniel's approval") — falls back to the email
 * itself if no employees row matches it. Read-only, no new data model. */
export async function resolveManagerDisplayName(managerEmail: string): Promise<string> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("employees").select("full_name").eq("email", managerEmail).maybeSingle();
  if (data?.full_name) return data.full_name.split(" ")[0];
  return managerEmail;
}

/** Looks up the employee's own email on file — needed as the
 * "submitter_email" the existing /api/leave-submit route expects, never
 * supplied by the model. */
async function getEmployeeEmail(employeeId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("employees").select("email").eq("id", employeeId).maybeSingle();
  return data?.email ?? null;
}

export interface SubmitLeaveRequestResult {
  ok: boolean;
  leaveRequestId?: string;
  managerEmailed?: boolean;
  managerDisplayName?: string;
  error?: string;
}

/**
 * The ONLY place this module writes anything — and even this doesn't
 * write directly. It POSTs to the EXISTING /api/leave-submit route (the
 * same endpoint the public form's client-side fetch already calls),
 * server-to-server. Same validation, same manager-email lookup, same
 * audit trigger firing, same approval-token generation — reused, not
 * duplicated.
 */
export async function submitLeaveRequest(params: {
  employeeId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  daysCount: number;
  reason?: string;
}): Promise<SubmitLeaveRequestResult> {
  const email = await getEmployeeEmail(params.employeeId);
  if (!email) {
    return { ok: false, error: "No email on file for this employee — cannot submit a request." };
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/leave-submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      employee_id: params.employeeId,
      employee_email: email,
      leave_type: params.leaveType,
      start_date: params.startDate,
      end_date: params.endDate,
      days_count: params.daysCount,
      reason: params.reason ?? null,
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    return { ok: false, error: body?.error || "Could not submit the leave request." };
  }

  // Best-effort friendly manager name for the reply — read employees
  // fresh rather than trusting anything from the request body.
  const supabase = createServiceClient();
  const { data: emp } = await supabase.from("employees").select("manager_email").eq("id", params.employeeId).maybeSingle();
  const managerDisplayName = emp?.manager_email ? await resolveManagerDisplayName(emp.manager_email) : undefined;

  return {
    ok: true,
    leaveRequestId: body.leave_request_id,
    managerEmailed: body.manager_emailed,
    managerDisplayName,
  };
}
