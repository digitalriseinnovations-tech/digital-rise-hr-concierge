import { NextResponse } from "next/server";
import { isValidCopilotApiKey, identifyCopilotEmployee } from "@/lib/concierge/copilot-auth";
import { getMyLeaveRequests } from "@/lib/concierge/leave";

/**
 * GET /api/integrations/copilot/leave-requests?employee_code=X&email=Y&limit=N
 * Header: X-Copilot-Api-Key: <COPILOT_INTEGRATION_API_KEY>
 *
 * Reuses getMyLeaveRequests() — the exact same read the Concierge chat's
 * get_my_leave_requests tool uses. Read-only, no write path exposed here.
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

  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 20) : 5;

  const requests = await getMyLeaveRequests(employee.id, limit);
  return NextResponse.json({ requests });
}
