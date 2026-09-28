import { NextResponse } from "next/server";
import { isValidCopilotApiKey, identifyCopilotEmployee } from "@/lib/concierge/copilot-auth";
import { getMyTraining } from "@/lib/concierge/training";

/**
 * GET /api/integrations/copilot/my-training?employee_code=X&email=Y
 * Header: X-Copilot-Api-Key: <COPILOT_INTEGRATION_API_KEY>
 *
 * Reuses getMyTraining() — the exact same read the Concierge chat's
 * get_my_training tool uses. Read-only, no write path exposed here.
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

  const registrations = await getMyTraining(employee.id);
  return NextResponse.json({ registrations });
}
