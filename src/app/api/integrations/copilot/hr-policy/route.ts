import { NextResponse } from "next/server";
import { isValidCopilotApiKey, identifyCopilotEmployee } from "@/lib/concierge/copilot-auth";
import { searchHrKnowledge, HR_KNOWLEDGE_CATEGORIES, type HrKnowledgeCategory } from "@/lib/concierge/knowledge";

function isValidCategory(value: unknown): value is HrKnowledgeCategory {
  return typeof value === "string" && (HR_KNOWLEDGE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * GET /api/integrations/copilot/hr-policy?employee_code=X&email=Y&query=...&category=...
 * Header: X-Copilot-Api-Key: <COPILOT_INTEGRATION_API_KEY>
 *
 * Reuses searchHrKnowledge() — the exact same read the Concierge chat's
 * search_hr_knowledge tool uses. Read-only, organization-wide HR content
 * (not employee-specific), but still requires the same two-factor identity
 * check as every other endpoint on this boundary — no anonymous access.
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

  const query = url.searchParams.get("query") ?? undefined;
  const categoryParam = url.searchParams.get("category");
  const category = isValidCategory(categoryParam) ? categoryParam : undefined;

  const result = await searchHrKnowledge({ query, category });
  return NextResponse.json(result);
}
