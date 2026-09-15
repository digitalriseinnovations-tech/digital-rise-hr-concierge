import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { searchHrKnowledge, type HrKnowledgeCategory } from "./knowledge";
import { CONCIERGE_TOOL_NAMES } from "./tools";
import { sendHrEscalationNotification } from "@/lib/email";
import {
  LEAVE_TYPES,
  type LeaveType,
  getMyLeaveBalance,
  resolveLeaveDateRange,
  calculateDaysCount,
  computeConfirmationToken,
  verifyConfirmationToken,
  getMyLeaveRequests,
  getLeaveRequestStatus,
  findExistingPendingRequest,
  submitLeaveRequest,
} from "./leave";
import {
  listTrainingPrograms,
  getTrainingProgramByName,
  getMyTraining,
  findExistingRegistration,
  computeEnrollmentToken,
  verifyEnrollmentToken,
  enrollInTraining,
} from "./training";
import {
  createMentorshipRequest,
  createCoachingRequest,
  getMyHrRequests,
  computeHrRequestToken,
  verifyHrRequestToken,
  findExistingOpenRequest,
  type HrRequestType,
} from "./hr-requests";

/**
 * The tool-executor is the permission boundary: it validates the tool name
 * against the fixed CONCIERGE_TOOL_NAMES allow-list BEFORE doing anything
 * else, validates input, and delegates to exactly one deterministic
 * operation per tool. It never contains business logic itself — the
 * knowledge search logic lives in knowledge.ts, the escalation write is a
 * single insert. If the model asks for a tool name outside the allow-list
 * (e.g. an injected/hallucinated "approve_leave"), this fails closed with
 * a structured error the model sees as a normal tool result — it is never
 * silently ignored or, worse, guessed at.
 */

export interface ToolExecutionContext {
  employeeId: string;
  employeeFullName: string;
  conversationId: string;
}

export interface ToolExecutionResult {
  toolName: string;
  /** Compact, non-sensitive summary for the Concierge Insights admin view
   * (Slice 6) — never raw employee PII beyond what the tool itself needed. */
  summary: string;
  /** The structured content returned to the model as the tool_result. */
  output: unknown;
  isError: boolean;
}

function knowledgeResultOutput(result: Awaited<ReturnType<typeof searchHrKnowledge>>) {
  if (!result.found) {
    return {
      found: false,
      message: "No matching entries in the Northstar Global HR knowledge base.",
    };
  }
  return {
    found: true,
    entries: result.entries.map((e) => ({
      category: e.category,
      topic: e.topic,
      question: e.question,
      answer: e.answer,
    })),
  };
}

async function executeSearchHrKnowledge(input: unknown): Promise<ToolExecutionResult> {
  const args = input as { query?: string; category?: HrKnowledgeCategory };
  const result = await searchHrKnowledge({ query: args.query, category: args.category });
  return {
    toolName: "search_hr_knowledge",
    summary: `search_hr_knowledge("${args.query ?? ""}") → ${result.entries.length} result(s)`,
    output: knowledgeResultOutput(result),
    isError: false,
  };
}

async function executeCategoryLookup(
  toolName: "get_onboarding_information" | "get_mentorship_information" | "get_coaching_information",
  category: HrKnowledgeCategory,
  input: unknown,
): Promise<ToolExecutionResult> {
  const args = input as { topic?: string };
  const result = await searchHrKnowledge({ query: args?.topic, category, limit: 10 });
  return {
    toolName,
    summary: `${toolName}() → ${result.entries.length} result(s)`,
    output: knowledgeResultOutput(result),
    isError: false,
  };
}

async function executeEscalateToHr(
  input: unknown,
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const args = input as { category?: string; reason?: string };
  const category = args.category ?? "general";
  const reason = (args.reason ?? "").slice(0, 500); // short, non-sensitive note only

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("hr_requests")
    .insert({
      employee_id: ctx.employeeId,
      request_type: "escalation",
      category,
      note: reason,
      conversation_id: ctx.conversationId,
      status: "open",
      urgent: category === "sensitive",
    })
    .select("id")
    .single();

  if (error || !data) {
    return {
      toolName: "escalate_to_hr",
      summary: "escalate_to_hr failed — could not create HR request",
      output: { ok: false, message: "Could not reach HR right now. Please try again or contact HR directly." },
      isError: true,
    };
  }

  const emailResult = await sendHrEscalationNotification({
    employeeName: ctx.employeeFullName,
    category,
    reason,
    conversationId: ctx.conversationId,
  });

  return {
    toolName: "escalate_to_hr",
    summary: `escalate_to_hr(${category}) → hr_requests ${data.id}${emailResult.ok ? "" : " (email failed)"}`,
    output: {
      ok: true,
      requestId: data.id,
      // The model should tell the employee HR has been notified — but only
      // claim the email part if it actually succeeded.
      notified: emailResult.ok,
    },
    isError: false,
  };
}

// ── Slice 3 — leave tool executors ──────────────────────────────────────
// ctx.employeeId (resolved server-side from the verified session by the
// orchestrator — see orchestrator.ts / identity.ts) is the ONLY source of
// "which employee" for every function below. Tool input is never used for
// that purpose — the schemas in tools.ts don't even expose the field.

function isValidLeaveType(value: unknown): value is LeaveType {
  return typeof value === "string" && (LEAVE_TYPES as readonly string[]).includes(value);
}

async function executeGetMyLeaveBalance(input: unknown, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const args = input as { leave_type?: string };
  const leaveType: LeaveType = isValidLeaveType(args.leave_type) ? args.leave_type : "annual";

  const balance = await getMyLeaveBalance(ctx.employeeId, leaveType);
  if (!balance) {
    return {
      toolName: "get_my_leave_balance",
      summary: `get_my_leave_balance(${leaveType}) → no balance record`,
      output: { found: false, message: "No balance record found for this leave type." },
      isError: false,
    };
  }
  return {
    toolName: "get_my_leave_balance",
    summary: `get_my_leave_balance(${leaveType}) → ${balance.remainingDays} remaining`,
    output: { found: true, ...balance },
    isError: false,
  };
}

async function executeGetMyLeaveRequests(input: unknown, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const args = input as { limit?: number };
  const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);
  const requests = await getMyLeaveRequests(ctx.employeeId, limit);
  return {
    toolName: "get_my_leave_requests",
    summary: `get_my_leave_requests() → ${requests.length} request(s)`,
    output: { requests },
    isError: false,
  };
}

async function executeGetLeaveRequestStatus(input: unknown, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const args = input as { start_date?: string; end_date?: string };
  const request = await getLeaveRequestStatus(ctx.employeeId, { startDate: args.start_date, endDate: args.end_date });
  if (!request) {
    return {
      toolName: "get_leave_request_status",
      summary: "get_leave_request_status() → no matching request",
      output: { found: false, message: "No matching leave request found." },
      isError: false,
    };
  }
  return {
    toolName: "get_leave_request_status",
    summary: `get_leave_request_status() → ${request.status}`,
    output: { found: true, ...request },
    isError: false,
  };
}

async function executeCreateLeaveRequest(input: unknown, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const args = input as {
    start_date?: string;
    end_date?: string;
    leave_type?: string;
    reason?: string;
    confirmed?: boolean;
    confirmation_token?: string;
  };

  if (!args.start_date || !args.end_date || !isValidLeaveType(args.leave_type)) {
    return {
      toolName: "create_leave_request",
      summary: "create_leave_request → rejected, invalid input",
      output: { ok: false, message: "Missing or invalid start_date/end_date/leave_type." },
      isError: true,
    };
  }

  // Deterministic date-year resolution — NOT left to the model. Accepts
  // either "YYYY-MM-DD" (employee gave a year) or bare "MM-DD" (employee
  // didn't); resolves an omitted year using the fixed rule (upcoming this
  // year -> this year, already passed -> next year) and never returns a
  // past date. See leave.ts for the full rule and its own unit tests.
  const resolved = resolveLeaveDateRange(args.start_date, args.end_date);
  if (!resolved.ok) {
    return {
      toolName: "create_leave_request",
      summary: `create_leave_request → rejected, ${resolved.reason}`,
      output: { ok: false, status: "invalid_dates", reason: resolved.reason, message: resolved.message },
      isError: true,
    };
  }
  const { startDate, endDate } = resolved;
  const daysCount = calculateDaysCount(startDate, endDate);

  const details = {
    employeeId: ctx.employeeId,
    startDate,
    endDate,
    leaveType: args.leave_type,
    daysCount,
  };

  const balance = await getMyLeaveBalance(ctx.employeeId, args.leave_type);
  const remainingBefore = balance?.remainingDays ?? 0;

  // Step 1: no valid confirmation yet -> return a preview only. Nothing is
  // written. This is the ONLY path when confirmed is not true, or when a
  // stale/mismatched token is presented (e.g. from a different date range
  // — the token simply won't verify, so it silently falls back to preview
  // rather than either erroring or, worse, proceeding anyway).
  if (!args.confirmed || !verifyConfirmationToken(args.confirmation_token, details)) {
    const token = computeConfirmationToken(details);
    return {
      toolName: "create_leave_request",
      summary: `create_leave_request(preview) → ${daysCount}d ${args.leave_type}, ${remainingBefore} remaining before`,
      output: {
        status: "preview",
        days_count: daysCount,
        leave_type: args.leave_type,
        start_date: startDate,
        end_date: endDate,
        current_remaining_days: remainingBefore,
        remaining_after_this_request: remainingBefore - daysCount,
        confirmation_token: token,
        message: "This is a PREVIEW only — nothing has been submitted. Ask the employee to explicitly confirm, then call this tool again with confirmed=true and this exact confirmation_token.",
      },
      isError: false,
    };
  }

  // Step 2: confirmed, token verified against these exact details.
  // Idempotency guard — a retried/duplicate confirmed call for the same
  // exact request reuses the existing pending request rather than
  // creating a second one.
  const existing = await findExistingPendingRequest(ctx.employeeId, startDate, endDate, args.leave_type);
  if (existing) {
    return {
      toolName: "create_leave_request",
      summary: `create_leave_request(confirmed) → reused existing pending request ${existing.id}`,
      output: {
        status: "already_pending",
        leave_request_id: existing.id,
        message: "You already have a pending request for these exact dates — no need to submit it again.",
      },
      isError: false,
    };
  }

  const result = await submitLeaveRequest({
    employeeId: ctx.employeeId,
    leaveType: args.leave_type,
    startDate,
    endDate,
    daysCount,
    reason: args.reason,
  });

  if (!result.ok) {
    return {
      toolName: "create_leave_request",
      summary: `create_leave_request(confirmed) → failed: ${result.error}`,
      output: { status: "failed", message: result.error },
      isError: true,
    };
  }

  return {
    toolName: "create_leave_request",
    summary: `create_leave_request(confirmed) → submitted ${result.leaveRequestId}`,
    output: {
      status: "submitted",
      leave_request_id: result.leaveRequestId,
      manager_notified: result.managerEmailed,
      manager_display_name: result.managerDisplayName,
      message: "Submitted through the existing leave workflow — status is PENDING, awaiting manager approval. This is not an approval.",
    },
    isError: false,
  };
}

// ── Slice 4 — training / learning tool executors ────────────────────────
// Same identity discipline as leave: ctx.employeeId only, never trusting
// anything model-supplied for "which employee". The enrollment write
// follows the exact preview -> confirm -> token pattern as leave, reusing
// confirmation.ts rather than a second implementation.

async function executeListTrainingPrograms(): Promise<ToolExecutionResult> {
  const programs = await listTrainingPrograms();
  return {
    toolName: "list_training_programs",
    summary: `list_training_programs() → ${programs.length} program(s)`,
    output: { programs },
    isError: false,
  };
}

async function executeGetTrainingProgram(input: unknown): Promise<ToolExecutionResult> {
  const args = input as { name?: string };
  if (!args.name) {
    return {
      toolName: "get_training_program",
      summary: "get_training_program → rejected, missing name",
      output: { found: false, message: "Missing program name." },
      isError: true,
    };
  }
  const program = await getTrainingProgramByName(args.name);
  if (!program) {
    return {
      toolName: "get_training_program",
      summary: `get_training_program("${args.name}") → not found`,
      output: { found: false, message: "No active program matches that name." },
      isError: false,
    };
  }
  return {
    toolName: "get_training_program",
    summary: `get_training_program("${args.name}") → ${program.name}`,
    output: { found: true, program },
    isError: false,
  };
}

async function executeGetMyTraining(input: unknown, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const entries = await getMyTraining(ctx.employeeId);
  return {
    toolName: "get_my_training",
    summary: `get_my_training() → ${entries.length} entry(ies)`,
    output: { registrations: entries },
    isError: false,
  };
}

async function executeRequestTrainingEnrollment(input: unknown, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const args = input as { program_name?: string; confirmed?: boolean; confirmation_token?: string };

  if (!args.program_name) {
    return {
      toolName: "request_training_enrollment",
      summary: "request_training_enrollment → rejected, missing program_name",
      output: { ok: false, message: "Missing program_name." },
      isError: true,
    };
  }

  const program = await getTrainingProgramByName(args.program_name);
  if (!program) {
    return {
      toolName: "request_training_enrollment",
      summary: `request_training_enrollment("${args.program_name}") → program not found`,
      output: { ok: false, message: "No active program matches that name." },
      isError: true,
    };
  }

  // Step 1: preview only, nothing written. Same fallback-to-preview rule as
  // leave — a stale/mismatched token (e.g. from a different program) simply
  // fails verification and re-previews rather than proceeding.
  if (!args.confirmed || !verifyEnrollmentToken(args.confirmation_token, ctx.employeeId, program.id)) {
    const token = computeEnrollmentToken(ctx.employeeId, program.id);
    return {
      toolName: "request_training_enrollment",
      summary: `request_training_enrollment(preview) → ${program.name}`,
      output: {
        status: "preview",
        program_name: program.name,
        requires_manager_approval: program.requiresManagerApproval,
        seats_available: program.seatsAvailable,
        next_cohort_start: program.nextCohortStart,
        confirmation_token: token,
        message: program.requiresManagerApproval
          ? "This program requires manager/HR approval — confirming will submit a pending request, not an enrollment. Ask the employee to explicitly confirm, then call again with confirmed=true and this exact confirmation_token."
          : "Confirming will register the employee directly (or waitlist them if seats are full). Ask the employee to explicitly confirm, then call again with confirmed=true and this exact confirmation_token.",
      },
      isError: false,
    };
  }

  // Step 2: confirmed, token verified against this exact program+employee.
  // Idempotency guard — a retried confirmed call reuses the existing
  // registration rather than creating a duplicate.
  const existing = await findExistingRegistration(ctx.employeeId, program.id);
  if (existing) {
    return {
      toolName: "request_training_enrollment",
      summary: `request_training_enrollment(confirmed) → reused existing registration ${existing.id}`,
      output: {
        status: "already_registered",
        registration_id: existing.id,
        registration_status: existing.status,
        message: "You already have a registration for this program — no need to submit it again.",
      },
      isError: false,
    };
  }

  const result = await enrollInTraining(ctx.employeeId, program);
  if (!result.ok) {
    return {
      toolName: "request_training_enrollment",
      summary: `request_training_enrollment(confirmed) → failed: ${result.message}`,
      output: { status: "failed", message: result.message },
      isError: true,
    };
  }

  return {
    toolName: "request_training_enrollment",
    summary: `request_training_enrollment(confirmed) → ${result.status} ${result.registrationId}`,
    output: {
      status: result.status,
      registration_id: result.registrationId,
      program_name: program.name,
      message:
        result.status === "requested"
          ? "Submitted as a pending request — awaiting manager/HR approval. This is not an enrollment confirmation."
          : result.status === "waitlisted"
            ? "Seats were full — the employee has been waitlisted."
            : "Registered directly for this program.",
    },
    isError: false,
  };
}

// ── Slice 4 — mentorship / coaching write executors ─────────────────────
// Both reuse the existing hr_requests table (same one escalate_to_hr
// writes to). No automated matching, no AI-granted approval/eligibility —
// every request simply lands as status='open' for HR/the program owner.

// Slice 5: both follow the exact same preview -> confirm -> cryptographic-
// token pattern as create_leave_request / request_training_enrollment, via
// the shared confirmation.ts utility. Merely discussing mentorship/coaching
// (get_mentorship_information / get_coaching_information) is unaffected —
// those remain plain reads.

async function executeCreateMentorshipRequest(input: unknown, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const args = input as { focus_area?: string; note?: string; confirmed?: boolean; confirmation_token?: string };
  const note = (args.note ?? "").slice(0, 500);
  const focusArea = args.focus_area ?? null;

  if (!note) {
    return {
      toolName: "create_mentorship_request",
      summary: "create_mentorship_request → rejected, missing note",
      output: { ok: false, message: "Missing note." },
      isError: true,
    };
  }

  // Step 1: no valid confirmation yet -> preview only, nothing written. A
  // stale/mismatched token (e.g. from a different focus area or note)
  // simply fails verification and falls back to preview here too.
  if (!args.confirmed || !verifyHrRequestToken(args.confirmation_token, ctx.employeeId, "mentorship", focusArea, note)) {
    const token = computeHrRequestToken(ctx.employeeId, "mentorship", focusArea, note);
    return {
      toolName: "create_mentorship_request",
      summary: "create_mentorship_request(preview) → not yet submitted",
      output: {
        status: "preview",
        request_type: "mentorship",
        focus_area: focusArea,
        note,
        confirmation_token: token,
        message:
          "This is a PREVIEW only — nothing has been submitted. Ask the employee to explicitly confirm, then call this " +
          "tool again with confirmed=true and this exact confirmation_token (and the exact same focus_area/note).",
      },
      isError: false,
    };
  }

  // Step 2: confirmed, token verified against these exact details.
  // Idempotency guard — a retried confirmed call for the exact same
  // request reuses the existing open request rather than creating a
  // second one.
  const existing = await findExistingOpenRequest(ctx.employeeId, "mentorship", focusArea, note);
  if (existing) {
    return {
      toolName: "create_mentorship_request",
      summary: `create_mentorship_request(confirmed) → reused existing open request ${existing.id}`,
      output: {
        status: "already_open",
        request_id: existing.id,
        message: "You already have an open mentorship request with these exact details — no need to submit it again.",
      },
      isError: false,
    };
  }

  const result = await createMentorshipRequest(ctx.employeeId, focusArea, note, ctx.conversationId);
  return {
    toolName: "create_mentorship_request",
    summary: result.ok ? `create_mentorship_request(confirmed) → hr_requests ${result.requestId}` : `create_mentorship_request(confirmed) → failed: ${result.message}`,
    output: result.ok
      ? {
          status: "submitted",
          request_id: result.requestId,
          message: "Your interest in the mentorship program has been logged for HR to follow up on — this is not a mentor assignment.",
        }
      : { status: "failed", message: result.message },
    isError: !result.ok,
  };
}

async function executeCreateCoachingRequest(input: unknown, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const args = input as { note?: string; confirmed?: boolean; confirmation_token?: string };
  const note = (args.note ?? "").slice(0, 500);

  if (!note) {
    return {
      toolName: "create_coaching_request",
      summary: "create_coaching_request → rejected, missing note",
      output: { ok: false, message: "Missing note." },
      isError: true,
    };
  }

  if (!args.confirmed || !verifyHrRequestToken(args.confirmation_token, ctx.employeeId, "coaching", null, note)) {
    const token = computeHrRequestToken(ctx.employeeId, "coaching", null, note);
    return {
      toolName: "create_coaching_request",
      summary: "create_coaching_request(preview) → not yet submitted",
      output: {
        status: "preview",
        request_type: "coaching",
        note,
        confirmation_token: token,
        message:
          "This is a PREVIEW only — nothing has been submitted. Ask the employee to explicitly confirm, then call this " +
          "tool again with confirmed=true and this exact confirmation_token (and the exact same note).",
      },
      isError: false,
    };
  }

  const existing = await findExistingOpenRequest(ctx.employeeId, "coaching", null, note);
  if (existing) {
    return {
      toolName: "create_coaching_request",
      summary: `create_coaching_request(confirmed) → reused existing open request ${existing.id}`,
      output: {
        status: "already_open",
        request_id: existing.id,
        message: "You already have an open coaching request with these exact details — no need to submit it again.",
      },
      isError: false,
    };
  }

  const result = await createCoachingRequest(ctx.employeeId, note, ctx.conversationId);
  return {
    toolName: "create_coaching_request",
    summary: result.ok ? `create_coaching_request(confirmed) → hr_requests ${result.requestId}` : `create_coaching_request(confirmed) → failed: ${result.message}`,
    output: result.ok
      ? {
          status: "submitted",
          request_id: result.requestId,
          message: "Your interest in executive coaching has been logged for HR to review and confirm eligibility — this is not a coaching approval.",
        }
      : { status: "failed", message: result.message },
    isError: !result.ok,
  };
}

function isValidHrRequestType(value: unknown): value is HrRequestType {
  return typeof value === "string" && ["mentorship", "coaching", "general", "escalation"].includes(value);
}

async function executeGetMyHrRequests(input: unknown, ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const args = input as { request_type?: string };
  const requestType = isValidHrRequestType(args.request_type) ? args.request_type : undefined;
  const requests = await getMyHrRequests(ctx.employeeId, requestType);
  return {
    toolName: "get_my_hr_requests",
    summary: `get_my_hr_requests(${requestType ?? "all"}) → ${requests.length} request(s)`,
    output: { requests },
    isError: false,
  };
}

/**
 * The single entry point the orchestrator calls for every tool_use block
 * the model produces. Unknown tool names are rejected here, before any
 * database or email operation — this is the fail-closed boundary.
 */
export async function executeTool(
  toolName: string,
  input: unknown,
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  if (!CONCIERGE_TOOL_NAMES.has(toolName)) {
    return {
      toolName,
      summary: `REJECTED — "${toolName}" is not an allowed tool`,
      output: { ok: false, message: "This action is not available." },
      isError: true,
    };
  }

  switch (toolName) {
    case "search_hr_knowledge":
      return executeSearchHrKnowledge(input);
    case "get_onboarding_information":
      return executeCategoryLookup("get_onboarding_information", "onboarding", input);
    case "get_mentorship_information":
      return executeCategoryLookup("get_mentorship_information", "mentorship", input);
    case "get_coaching_information":
      return executeCategoryLookup("get_coaching_information", "coaching", input);
    case "escalate_to_hr":
      return executeEscalateToHr(input, ctx);
    case "get_my_leave_balance":
      return executeGetMyLeaveBalance(input, ctx);
    case "create_leave_request":
      return executeCreateLeaveRequest(input, ctx);
    case "get_my_leave_requests":
      return executeGetMyLeaveRequests(input, ctx);
    case "get_leave_request_status":
      return executeGetLeaveRequestStatus(input, ctx);
    case "list_training_programs":
      return executeListTrainingPrograms();
    case "get_training_program":
      return executeGetTrainingProgram(input);
    case "get_my_training":
      return executeGetMyTraining(input, ctx);
    case "request_training_enrollment":
      return executeRequestTrainingEnrollment(input, ctx);
    case "create_mentorship_request":
      return executeCreateMentorshipRequest(input, ctx);
    case "create_coaching_request":
      return executeCreateCoachingRequest(input, ctx);
    case "get_my_hr_requests":
      return executeGetMyHrRequests(input, ctx);
    default:
      // Unreachable given the allow-list check above, but fail closed
      // rather than fall through if the switch and the allow-list ever
      // drift out of sync.
      return {
        toolName,
        summary: `REJECTED — "${toolName}" has no executor implementation`,
        output: { ok: false, message: "This action is not available." },
        isError: true,
      };
  }
}
