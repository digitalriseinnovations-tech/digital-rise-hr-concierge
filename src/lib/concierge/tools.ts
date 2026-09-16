import type Anthropic from "@anthropic-ai/sdk";
import { HR_KNOWLEDGE_CATEGORIES } from "./knowledge";
import { LEAVE_TYPES } from "./leave";

/**
 * Slice 2 tool set — knowledge-oriented only, per the sprint brief. No
 * leave-write or training-write tools exist here (those are later slices).
 * Every tool is one of these fixed permission classes:
 *
 *   READ-ONLY EMPLOYEE — reads organization-wide HR knowledge, no
 *     employee-specific data involved at all.
 *   EMPLOYEE WRITE — creates a record on the employee's own behalf; never
 *     modifies another employee's data, never touches leave/training state.
 *
 * There is no HR ADMIN, MANAGER, or HUMAN APPROVAL REQUIRED tool in this
 * slice's set — those classes exist for future slices (e.g. a real
 * leave-approval tool would never be given to this Employee at all).
 */
export type ToolPermissionClass = "READ-ONLY EMPLOYEE" | "EMPLOYEE WRITE";

export interface ConciergeToolDefinition {
  name: string;
  permissionClass: ToolPermissionClass;
  anthropicSchema: Anthropic.Tool;
}

const searchHrKnowledgeTool: ConciergeToolDefinition = {
  name: "search_hr_knowledge",
  permissionClass: "READ-ONLY EMPLOYEE",
  anthropicSchema: {
    name: "search_hr_knowledge",
    description:
      "Search Northstar Global's configured HR knowledge base for policy, benefits, and general HR information. " +
      "You MUST call this (or one of the category-scoped tools) before answering ANY question about company policy, " +
      "benefits, working hours, or similar factual HR topics — never answer from general knowledge. If this returns " +
      "no results, say the information could not be confirmed from company HR knowledge and offer to escalate to HR.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The employee's question, in their own words." },
        category: {
          type: "string",
          enum: [...HR_KNOWLEDGE_CATEGORIES],
          description: "Optional — narrow the search to one knowledge category if the topic is obvious.",
        },
      },
      required: ["query"],
    },
  },
};

const getOnboardingInformationTool: ConciergeToolDefinition = {
  name: "get_onboarding_information",
  permissionClass: "READ-ONLY EMPLOYEE",
  anthropicSchema: {
    name: "get_onboarding_information",
    description:
      "Get Northstar Global's configured onboarding guidance (first week, IT access, benefits enrollment, etc). " +
      "Call this for any onboarding/new-hire question instead of guessing.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Optional — a specific onboarding topic, e.g. 'IT access' or 'first week'." },
      },
    },
  },
};

const getMentorshipInformationTool: ConciergeToolDefinition = {
  name: "get_mentorship_information",
  permissionClass: "READ-ONLY EMPLOYEE",
  anthropicSchema: {
    name: "get_mentorship_information",
    description: "Get Northstar Global's configured mentorship program information and eligibility.",
    input_schema: { type: "object", properties: {} },
  },
};

const getCoachingInformationTool: ConciergeToolDefinition = {
  name: "get_coaching_information",
  permissionClass: "READ-ONLY EMPLOYEE",
  anthropicSchema: {
    name: "get_coaching_information",
    description: "Get Northstar Global's configured executive coaching program information and eligibility.",
    input_schema: { type: "object", properties: {} },
  },
};

const escalateToHrTool: ConciergeToolDefinition = {
  name: "escalate_to_hr",
  permissionClass: "EMPLOYEE WRITE",
  anthropicSchema: {
    name: "escalate_to_hr",
    description:
      "Route the employee to a human HR team member instead of answering yourself. Use this when: the question is " +
      "sensitive (employee relations, harassment, grievance, a private/personal matter), the knowledge base has no " +
      "answer, the question is outside what you're able to help with, or the employee explicitly asks for a human. " +
      "Do NOT ask the employee to explain sensitive details first — capture only a short, non-sensitive category/" +
      "reason so a person can follow up directly. TWO-STEP, exactly like create_leave_request/" +
      "create_mentorship_request: (1) call WITHOUT confirmed=true first — returns a preview and a " +
      "confirmation_token, creates NOTHING and notifies NO ONE yet. Acknowledge the request and ask the employee " +
      "to explicitly confirm before you escalate. (2) only after explicit confirmation, call again with " +
      "confirmed=true and the same confirmation_token, and the EXACT same category/reason as step 1 (changing " +
      "them invalidates the token). Only step 2 creates the HR request and notifies HR.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["mentorship", "coaching", "general", "sensitive"],
          description: "Short category for HR's queue. Use 'sensitive' for employee-relations/private matters.",
        },
        reason: {
          type: "string",
          description:
            "One short, non-sensitive sentence HR can see in their queue (e.g. 'Wants to discuss a private matter' " +
            "— never the sensitive details themselves).",
        },
        confirmed: { type: "boolean" },
        confirmation_token: { type: "string", description: "Required when confirmed=true — from the step-1 preview." },
      },
      required: ["category", "reason", "confirmed"],
    },
  },
};

// ── Slice 3 — leave tools ────────────────────────────────────────────────
// Every input schema below deliberately has NO employee_id/employee_code/
// email field. There is nothing for the model to pass that could target
// another employee — "whose data" is always the verified session, applied
// server-side in the tool-executor, never taken from model input. None of
// these tools can approve, reject, or otherwise change a request's status,
// or write to leave_balances directly — see tool-executor.ts.

const getMyLeaveBalanceTool: ConciergeToolDefinition = {
  name: "get_my_leave_balance",
  permissionClass: "READ-ONLY EMPLOYEE",
  anthropicSchema: {
    name: "get_my_leave_balance",
    description:
      "Get the CURRENT employee's own leave balance (entitlement, accrued, taken, remaining) for one leave type. " +
      "Always call this before stating any specific balance number — never guess or recall a number from earlier " +
      "in the conversation without re-checking, since it can change.",
    input_schema: {
      type: "object",
      properties: {
        leave_type: { type: "string", enum: [...LEAVE_TYPES], description: "Defaults to 'annual' if not specified." },
      },
    },
  },
};

const createLeaveRequestTool: ConciergeToolDefinition = {
  name: "create_leave_request",
  permissionClass: "EMPLOYEE WRITE",
  anthropicSchema: {
    name: "create_leave_request",
    description:
      "Prepare or submit a leave request for the CURRENT employee. This is a TWO-STEP tool: " +
      "(1) Call it WITHOUT confirmed=true first — it returns a preview (day count, current balance, balance after) " +
      "and a confirmation_token, but creates NOTHING. Present that preview to the employee and ask them to explicitly " +
      "confirm before proceeding — never skip this step. " +
      "(2) Only after the employee explicitly says yes/confirms, call it AGAIN with the exact same dates/type, " +
      "confirmed=true, and the confirmation_token from step 1. Only then is a real request created — through the " +
      "existing leave workflow, awaiting the employee's manager's approval. You can never approve it yourself.",
    input_schema: {
      type: "object",
      properties: {
        start_date: {
          type: "string",
          description:
            "The date exactly as the employee specified it: 'YYYY-MM-DD' if they gave a year, or bare 'MM-DD' if they did NOT " +
            "give a year (e.g. employee says 'October 12' -> pass '10-12', NOT a year you compute yourself). " +
            "Never invent or calculate a year — the system resolves the correct year deterministically.",
        },
        end_date: {
          type: "string",
          description: "Same format rule as start_date — 'YYYY-MM-DD' only if the employee stated a year, otherwise bare 'MM-DD'.",
        },
        leave_type: { type: "string", enum: [...LEAVE_TYPES] },
        reason: { type: "string", description: "Optional short reason the employee gave." },
        confirmed: { type: "boolean", description: "true only on the second call, after explicit employee confirmation." },
        confirmation_token: { type: "string", description: "The token returned by the step-1 preview call. Required when confirmed=true." },
      },
      required: ["start_date", "end_date", "leave_type", "confirmed"],
    },
  },
};

const getMyLeaveRequestsTool: ConciergeToolDefinition = {
  name: "get_my_leave_requests",
  permissionClass: "READ-ONLY EMPLOYEE",
  anthropicSchema: {
    name: "get_my_leave_requests",
    description: "List the CURRENT employee's own recent leave requests with their status. Use for 'show my leave requests' style questions.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max requests to return, default 5." },
      },
    },
  },
};

const getLeaveRequestStatusTool: ConciergeToolDefinition = {
  name: "get_leave_request_status",
  permissionClass: "READ-ONLY EMPLOYEE",
  anthropicSchema: {
    name: "get_leave_request_status",
    description:
      "Check the status of one specific leave request for the CURRENT employee (optionally by date range), or the " +
      "most recent one if no dates are given. Use for 'was my October leave approved?' style questions. Report the " +
      "status exactly as returned (pending/approved/rejected/cancelled) — never say 'approved' unless the tool result " +
      "says so.",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Optional — YYYY-MM-DD, to find a specific request." },
        end_date: { type: "string", description: "Optional — YYYY-MM-DD, to find a specific request." },
      },
    },
  },
};

// ── Slice 4 — training / learning tools ─────────────────────────────────
// Same identity discipline as the leave tools: no schema below accepts an
// employee_id — "my training" is always the verified session's employee.

const listTrainingProgramsTool: ConciergeToolDefinition = {
  name: "list_training_programs",
  permissionClass: "READ-ONLY EMPLOYEE",
  anthropicSchema: {
    name: "list_training_programs",
    description:
      "List Northstar Global's active/configured training and learning programs. Call this for any 'what training is " +
      "available' or 'what leadership programs can I join' style question — never list programs from memory.",
    input_schema: { type: "object", properties: {} },
  },
};

const getTrainingProgramTool: ConciergeToolDefinition = {
  name: "get_training_program",
  permissionClass: "READ-ONLY EMPLOYEE",
  anthropicSchema: {
    name: "get_training_program",
    description: "Get full configured details (duration, delivery mode, eligibility, seats, next cohort) for one named training program.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "The program name, or a close match to it, as the employee said it." } },
      required: ["name"],
    },
  },
};

const getMyTrainingTool: ConciergeToolDefinition = {
  name: "get_my_training",
  permissionClass: "READ-ONLY EMPLOYEE",
  anthropicSchema: {
    name: "get_my_training",
    description: "List the CURRENT employee's own training registrations/requests and their status. Use for 'My Learning' style questions.",
    input_schema: { type: "object", properties: {} },
  },
};

const requestTrainingEnrollmentTool: ConciergeToolDefinition = {
  name: "request_training_enrollment",
  permissionClass: "EMPLOYEE WRITE",
  anthropicSchema: {
    name: "request_training_enrollment",
    description:
      "Register the CURRENT employee's interest in a training program. TWO-STEP, exactly like create_leave_request: " +
      "(1) call WITHOUT confirmed=true first — returns a preview (whether this needs manager/HR approval or registers " +
      "directly, seat availability) and a confirmation_token, creates nothing. Present that to the employee and ask them " +
      "to confirm. (2) only after explicit confirmation, call again with confirmed=true and the same confirmation_token. " +
      "If the program requires manager/HR approval, it is NEVER auto-confirmed by you — it always becomes a pending " +
      "request for a human to decide, regardless of what you or the employee believe about their eligibility.",
    input_schema: {
      type: "object",
      properties: {
        program_name: { type: "string", description: "The exact program name (from list_training_programs/get_training_program)." },
        confirmed: { type: "boolean" },
        confirmation_token: { type: "string", description: "Required when confirmed=true — from the step-1 preview." },
      },
      required: ["program_name", "confirmed"],
    },
  },
};

// ── Slice 4 — mentorship / coaching write tools ─────────────────────────
// get_mentorship_information / get_coaching_information already exist
// (Slice 2) — these two are the new write half of that pair, both reusing
// the same hr_requests table escalate_to_hr already writes to.

const createMentorshipRequestTool: ConciergeToolDefinition = {
  name: "create_mentorship_request",
  permissionClass: "EMPLOYEE WRITE",
  anthropicSchema: {
    name: "create_mentorship_request",
    description:
      "Capture the CURRENT employee's interest in the mentorship program for HR/the program owner to follow up on — " +
      "NOT automatic mentor matching or assignment. TWO-STEP, exactly like create_leave_request/" +
      "request_training_enrollment: (1) call WITHOUT confirmed=true first — returns a preview and a " +
      "confirmation_token, creates nothing. Present that to the employee and ask them to confirm. (2) only after " +
      "explicit confirmation, call again with confirmed=true and the same confirmation_token, and the EXACT same " +
      "focus_area/note as step 1 (changing them invalidates the token).",
    input_schema: {
      type: "object",
      properties: {
        focus_area: { type: "string", description: "Optional — what they're looking for a mentor in, e.g. 'product leadership'." },
        note: { type: "string", description: "One short sentence summarizing the request." },
        confirmed: { type: "boolean" },
        confirmation_token: { type: "string", description: "Required when confirmed=true — from the step-1 preview." },
      },
      required: ["note", "confirmed"],
    },
  },
};

const createCoachingRequestTool: ConciergeToolDefinition = {
  name: "create_coaching_request",
  permissionClass: "EMPLOYEE WRITE",
  anthropicSchema: {
    name: "create_coaching_request",
    description:
      "Capture the CURRENT employee's interest in executive coaching for HR to follow up on and confirm eligibility — " +
      "you never decide or state eligibility yourself, and this tool never grants or approves coaching. TWO-STEP, " +
      "exactly like create_leave_request/request_training_enrollment: (1) call WITHOUT confirmed=true first — " +
      "returns a preview and a confirmation_token, creates nothing. Present that to the employee and ask them to " +
      "confirm. (2) only after explicit confirmation, call again with confirmed=true and the same " +
      "confirmation_token, and the EXACT same note as step 1 (changing it invalidates the token).",
    input_schema: {
      type: "object",
      properties: {
        note: { type: "string", description: "One short sentence summarizing the request." },
        confirmed: { type: "boolean" },
        confirmation_token: { type: "string", description: "Required when confirmed=true — from the step-1 preview." },
      },
      required: ["note", "confirmed"],
    },
  },
};

const getMyHrRequestsTool: ConciergeToolDefinition = {
  name: "get_my_hr_requests",
  permissionClass: "READ-ONLY EMPLOYEE",
  anthropicSchema: {
    name: "get_my_hr_requests",
    description: "List the CURRENT employee's own mentorship/coaching/general HR requests and their status.",
    input_schema: {
      type: "object",
      properties: {
        request_type: { type: "string", enum: ["mentorship", "coaching", "general", "escalation"], description: "Optional filter." },
      },
    },
  },
};

export const CONCIERGE_TOOLS: ConciergeToolDefinition[] = [
  searchHrKnowledgeTool,
  getOnboardingInformationTool,
  getMentorshipInformationTool,
  getCoachingInformationTool,
  escalateToHrTool,
  getMyLeaveBalanceTool,
  createLeaveRequestTool,
  getMyLeaveRequestsTool,
  getLeaveRequestStatusTool,
  listTrainingProgramsTool,
  getTrainingProgramTool,
  getMyTrainingTool,
  requestTrainingEnrollmentTool,
  createMentorshipRequestTool,
  createCoachingRequestTool,
  getMyHrRequestsTool,
];

/** The hard allow-list the tool-executor checks against. Server-side
 * constant — never influenced by model output. */
export const CONCIERGE_TOOL_NAMES = new Set(CONCIERGE_TOOLS.map((t) => t.name));

export const CONCIERGE_ANTHROPIC_TOOLS: Anthropic.Tool[] = CONCIERGE_TOOLS.map((t) => t.anthropicSchema);
