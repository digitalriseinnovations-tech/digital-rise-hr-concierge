import { NextResponse } from "next/server";
import { isValidCopilotApiKey, identifyCopilotEmployee } from "@/lib/concierge/copilot-auth";
import { getMyLeaveBalance, LEAVE_TYPES, type LeaveType } from "@/lib/concierge/leave";

function isValidLeaveType(value: unknown): value is LeaveType {
  return typeof value === "string" && (LEAVE_TYPES as readonly string[]).includes(value);
}

/**
 * GET /api/integrations/copilot/leave-balance?employee_code=X&email=Y&leave_type=annual
 * Header: X-Copilot-Api-Key: <COPILOT_INTEGRATION_API_KEY>
 *
 * Reuses getMyLeaveBalance() — the exact same read the Concierge chat's
 * get_my_leave_balance tool uses. Read-only, no write path exposed here.
 */
export async function GET(request: Request) {
  if (!isValidCopilotApiKey(request)) {
    return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });
  }

  const url = new URL(request.url);
  const employee = await identifyCopilotEmployee(url.searchParams.get("employee_code"), url.searchParams.get("email"));
  if (!employee) {
    return NextResponse.json({ error: "We couldn't verify those details." }, { status: 401 });
  }

  const requestedType = url.searchParams.get("leave_type") ?? "annual";
  const leaveType: LeaveType = isValidLeaveType(requestedType) ? requestedType : "annual";
  const balance = await getMyLeaveBalance(employee.id, leaveType);
  if (!balance) {
    return NextResponse.json({ found: false });
  }
  return NextResponse.json({ found: true, ...balance });
}
