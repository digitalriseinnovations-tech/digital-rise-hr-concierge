import { NextResponse } from "next/server";
import { requireImportPermission, isAuthFailure } from "@/lib/employee-import-auth";
import { createClient } from "@/lib/supabase/server";
import { lookupActiveOrganization, employeeBelongsToActiveOrganization } from "@/lib/concierge/organizations";
import { recordTrainingReminder } from "@/lib/concierge/training";

/**
 * POST /api/training/reminders/send — { registrationId }
 *
 * Smallest safe demo-ready reminder: records reminder_sent_at on the
 * registration (see recordTrainingReminder() in training.ts) — never
 * sends a real email. Organization-scoped: verifies the registration's
 * employee belongs to the active organization before touching anything,
 * same pattern as the employee edit route.
 */
export async function POST(request: Request) {
  const auth = await requireImportPermission();
  if (isAuthFailure(auth)) return auth;

  let body: { registrationId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!body.registrationId) {
    return NextResponse.json({ error: "registrationId is required." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: registration } = await supabase
    .from("training_registrations")
    .select("id, employee_id, employees:employee_id(organization_id)")
    .eq("id", body.registrationId)
    .maybeSingle();

  if (!registration) {
    return NextResponse.json({ error: "Registration not found." }, { status: 404 });
  }

  const orgLookup = await lookupActiveOrganization();
  const employeeOrgId = Array.isArray(registration.employees) ? registration.employees[0]?.organization_id : (registration.employees as { organization_id: string } | null)?.organization_id;
  if (!employeeBelongsToActiveOrganization(employeeOrgId, orgLookup)) {
    return NextResponse.json({ error: "Registration not found." }, { status: 404 });
  }

  const result = await recordTrainingReminder(body.registrationId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
