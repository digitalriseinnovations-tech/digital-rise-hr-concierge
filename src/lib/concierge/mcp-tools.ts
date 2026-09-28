import "server-only";
import { identifyCopilotEmployee } from "./copilot-auth";
import { getMyLeaveBalance, getMyLeaveRequests, LEAVE_TYPES, type LeaveType } from "./leave";
import { getMyTraining } from "./training";
import { searchHrKnowledge, HR_KNOWLEDGE_CATEGORIES, type HrKnowledgeCategory } from "./knowledge";

/**
 * Read-only MCP tool set — an ADAPTER over the exact same deterministic HR
 * service functions the employee chat UI and the REST Copilot endpoints
 * already call (getMyLeaveBalance, getMyLeaveRequests, getMyTraining,
 * searchHrKnowledge). No HR logic is duplicated here; this module only
 * maps an MCP tool name + args to one of those existing functions.
 *
 * Every tool requires employee_code + email (the same two-factor check
 * /api/concierge/identify and the REST Copilot endpoints already use) —
 * there is no tool here that accepts a raw employee_id, so a caller can
 * never target another employee's data by supplying an internal ID
 * directly. See src/app/api/mcp/route.ts for the transport that calls
 * these, and docs/MICROSOFT_COPILOT_INTEGRATION.md for the full identity
 * write-up.
 *
 * Transactional actions (leave submission, training enrollment,
 * mentorship/coaching requests, escalation) are deliberately NOT exposed
 * here yet — read-only first, per the Phase 3 brief.
 */

function isValidLeaveType(value: unknown): value is LeaveType {
  return typeof value === "string" && (LEAVE_TYPES as readonly string[]).includes(value);
}

function isValidCategory(value: unknown): value is HrKnowledgeCategory {
  return typeof value === "string" && (HR_KNOWLEDGE_CATEGORIES as readonly string[]).includes(value);
}

const EMPLOYEE_IDENTITY_PROPS = {
  employee_code: { type: "string", description: "The employee's employee code, e.g. NSG-1001." },
  email: { type: "string", description: "The employee's work email — matched two-factor against employee_code. Both fields are required on every tool call; there is no session." },
};

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "get_employee_profile",
    description: "Resolve an employee's first/full name from their employee_code + email.",
    inputSchema: {
      type: "object",
      properties: { ...EMPLOYEE_IDENTITY_PROPS },
      required: ["employee_code", "email"],
    },
  },
  {
    name: "get_leave_balance",
    description: "Get the employee's own leave balance (entitlement, accrued, taken, remaining) for one leave type. Defaults to 'annual'.",
    inputSchema: {
      type: "object",
      properties: {
        ...EMPLOYEE_IDENTITY_PROPS,
        leave_type: { type: "string", enum: [...LEAVE_TYPES], description: "Defaults to 'annual' if not specified." },
      },
      required: ["employee_code", "email"],
    },
  },
  {
    name: "get_leave_requests",
    description: "List the employee's own recent leave requests with their status.",
    inputSchema: {
      type: "object",
      properties: {
        ...EMPLOYEE_IDENTITY_PROPS,
        limit: { type: "number", description: "Max requests to return, default 5, max 20." },
      },
      required: ["employee_code", "email"],
    },
  },
  {
    name: "get_hr_policy",
    description: "Search the organization's configured HR knowledge base for policy, benefits, and general HR information.",
    inputSchema: {
      type: "object",
      properties: {
        ...EMPLOYEE_IDENTITY_PROPS,
        query: { type: "string", description: "Free-text question, in the employee's own words." },
        category: { type: "string", enum: [...HR_KNOWLEDGE_CATEGORIES], description: "Optional — narrow to one knowledge category." },
      },
      required: ["employee_code", "email"],
    },
  },
  {
    name: "get_my_training",
    description: "List the employee's own training registrations/assignments, including status, due date, and whether each is overdue.",
    inputSchema: {
      type: "object",
      properties: { ...EMPLOYEE_IDENTITY_PROPS },
      required: ["employee_code", "email"],
    },
  },
  {
    name: "get_training_status",
    description: "Get the status of one specific named training program for the employee — a filtered view of get_my_training. Omit program_name for the same result as get_my_training.",
    inputSchema: {
      type: "object",
      properties: {
        ...EMPLOYEE_IDENTITY_PROPS,
        program_name: { type: "string", description: "Optional — the exact program name, or a close match." },
      },
      required: ["employee_code", "email"],
    },
  },
];

export const MCP_TOOL_NAMES = new Set(MCP_TOOLS.map((t) => t.name));

export interface McpToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export async function executeMcpTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  const employeeCode = typeof args.employee_code === "string" ? args.employee_code : null;
  const email = typeof args.email === "string" ? args.email : null;
  const employee = await identifyCopilotEmployee(employeeCode, email);
  if (!employee) {
    return { ok: false, error: "We couldn't verify those employee details." };
  }

  switch (name) {
    case "get_employee_profile":
      return { ok: true, data: { firstName: employee.firstName, fullName: employee.fullName } };

    case "get_leave_balance": {
      const leaveType: LeaveType = isValidLeaveType(args.leave_type) ? args.leave_type : "annual";
      const balance = await getMyLeaveBalance(employee.id, leaveType);
      return { ok: true, data: balance ? { found: true, ...balance } : { found: false } };
    }

    case "get_leave_requests": {
      const limitRaw = Number(args.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 20) : 5;
      const requests = await getMyLeaveRequests(employee.id, limit);
      return { ok: true, data: { requests } };
    }

    case "get_hr_policy": {
      const query = typeof args.query === "string" ? args.query : undefined;
      const category = isValidCategory(args.category) ? args.category : undefined;
      const result = await searchHrKnowledge({ query, category });
      return { ok: true, data: result };
    }

    case "get_my_training": {
      const registrations = await getMyTraining(employee.id);
      return { ok: true, data: { registrations } };
    }

    case "get_training_status": {
      const registrations = await getMyTraining(employee.id);
      const programName = typeof args.program_name === "string" ? args.program_name.trim().toLowerCase() : null;
      const filtered = programName
        ? registrations.filter((r) => r.programName.toLowerCase().includes(programName))
        : registrations;
      return { ok: true, data: { registrations: filtered } };
    }

    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}
