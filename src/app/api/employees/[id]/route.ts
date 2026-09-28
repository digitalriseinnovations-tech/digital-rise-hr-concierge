import { NextResponse } from "next/server";
import { requireImportPermission, isAuthFailure } from "@/lib/employee-import-auth";
import { createClient } from "@/lib/supabase/server";
import { lookupActiveOrganization, employeeBelongsToActiveOrganization } from "@/lib/concierge/organizations";

/**
 * PATCH /api/employees/[id] — edits an existing employee's basic
 * information plus the two entitlement fields that already live directly
 * on the employees row (annual_leave_days, air_ticket_entitlement/
 * currency). No other table is written here — leave_balances (a per-year
 * ledger) and benefits_credits have no existing edit UI anywhere in this
 * app, so this route does not add one; that would be a new HR module, not
 * the minimum fix for the missing edit page.
 *
 * Uses the staff's own authenticated session (not the service-role
 * client) so the existing "employees write" RLS policy
 * (finance_role() in ('admin','hr')) applies as defense-in-depth, exactly
 * as it does for /employees's own read. Reuses requireImportPermission()
 * (same finance_users + employee.edit check the Import routes already
 * use) rather than adding a second auth helper.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_STATUSES = ["active", "inactive", "on_leave", "terminated"];

interface PatchBody {
  employee_code?: string;
  full_name?: string;
  email?: string;
  phone?: string | null;
  designation?: string | null;
  department?: string | null;
  country?: string | null;
  location?: string | null;
  joining_date?: string | null;
  status?: string;
  annual_leave_days?: number | null;
  air_ticket_entitlement?: number | null;
  air_ticket_currency?: string | null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireImportPermission();
  if (isAuthFailure(auth)) return auth;

  const { id } = await params;
  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: existing } = await supabase.from("employees").select("id, organization_id").eq("id", id).maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }

  // Organization isolation (migration_011) — never reveal, via a
  // different error shape or status, that an out-of-organization
  // employee ID exists at all; same 404 as a genuinely missing employee.
  const orgLookup = await lookupActiveOrganization();
  if (!employeeBelongsToActiveOrganization(existing.organization_id, orgLookup)) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }

  const employeeCode = body.employee_code?.trim();
  const fullName = body.full_name?.trim();
  const email = body.email?.trim().toLowerCase();

  if (!employeeCode) return NextResponse.json({ error: "Employee code is required." }, { status: 400 });
  if (!fullName) return NextResponse.json({ error: "Full name is required." }, { status: 400 });
  if (!email || !EMAIL_RE.test(email)) return NextResponse.json({ error: "A valid work email is required." }, { status: 400 });
  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: `Status must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const updates = {
    employee_code: employeeCode,
    full_name: fullName,
    email,
    phone: body.phone?.trim() || null,
    designation: body.designation?.trim() || null,
    department: body.department?.trim() || null,
    country: body.country?.trim() || null,
    location: body.location?.trim() || null,
    joining_date: body.joining_date || null,
    status: body.status || "active",
    annual_leave_days: body.annual_leave_days ?? null,
    air_ticket_entitlement: body.air_ticket_entitlement ?? null,
    air_ticket_currency: body.air_ticket_currency?.trim() || null,
    updated_by: auth.id,
  };

  const { data: updated, error } = await supabase.from("employees").update(updates).eq("id", id).select("*").single();
  if (error) {
    // A composite (organization_id, employee_code) uniqueness violation is
    // the most likely real-world failure here — surface it plainly rather
    // than a raw Postgres error code.
    const message = error.message.includes("employees_org_employee_code_uniq")
      ? "Another employee in this organization already uses that employee code."
      : error.message;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ employee: updated });
}
