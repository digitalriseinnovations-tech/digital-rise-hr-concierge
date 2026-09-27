import { NextResponse } from "next/server";
import { isValidCopilotApiKey, identifyCopilotEmployee } from "@/lib/concierge/copilot-auth";

/**
 * GET /api/integrations/copilot/employee-context?employee_code=X&email=Y
 * Header: X-Copilot-Api-Key: <COPILOT_INTEGRATION_API_KEY>
 *
 * Minimal "who is this employee" lookup for a Copilot Studio action —
 * reuses the exact same two-factor identity check as
 * /api/concierge/identify. No session/cookie is issued here; the caller
 * (Copilot) is expected to re-send employee_code+email on every call,
 * matching a typical stateless connector action.
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

  return NextResponse.json({ firstName: employee.firstName, fullName: employee.fullName });
}
