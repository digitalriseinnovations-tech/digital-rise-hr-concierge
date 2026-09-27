import "server-only";
import { identifyEmployee, type ConciergeEmployee } from "./identity";

/**
 * Demo-grade auth for the Microsoft Copilot integration boundary
 * (src/app/api/integrations/copilot/*) — a single shared API key plus the
 * SAME two-factor employee_code+email check /api/concierge/identify
 * already uses. This is NOT the production answer (see
 * docs/MICROSOFT_COPILOT_INTEGRATION.md for the real Microsoft Entra
 * identity flow a production connector needs) — it exists only so the
 * demo can show a real, working end-to-end call from outside this app
 * without spending sprint time on live Entra/OBO configuration.
 *
 * Never exposes SUPABASE_SERVICE_ROLE_KEY or any other internal secret —
 * every function here delegates to the SAME lib functions the Concierge
 * chat itself uses, which already run entirely server-side.
 */

export function isValidCopilotApiKey(request: Request): boolean {
  const configured = process.env.COPILOT_INTEGRATION_API_KEY?.trim();
  if (!configured) return false; // fails closed if unset — no default/bypass
  const provided = request.headers.get("x-copilot-api-key")?.trim();
  return Boolean(provided) && provided === configured;
}

export async function identifyCopilotEmployee(employeeCode: string | null, email: string | null): Promise<ConciergeEmployee | null> {
  if (!employeeCode || !email) return null;
  return identifyEmployee(employeeCode, email);
}
