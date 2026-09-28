import { describe, expect, it, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { employeeBelongsToActiveOrganization, findOrCreateOrganization, type ActiveOrganizationLookup } from "../../src/lib/concierge/organizations";

/**
 * Coverage for the employee edit flow (src/app/(app)/employees/[id]/edit,
 * src/app/api/employees/[id]/route.ts) and the org-isolation check they
 * both share with the profile page (employeeBelongsToActiveOrganization).
 *
 * The PATCH route itself uses src/lib/supabase/server.ts's createClient(),
 * which calls next/headers' cookies() — that requires a real Next.js
 * request-scoped context that doesn't exist under Vitest, so the route
 * handler can't be imported and invoked directly here the way the
 * Copilot/MCP routes (service-role, no cookies) were. Instead: the
 * org-isolation decision is unit-tested directly (it's the exact function
 * the route calls), and the underlying fetch/update/persist behavior is
 * verified against the real database using the same service-role
 * operations the route performs, on throwaway test data this suite
 * creates and deletes itself.
 */

function unsupported(): ActiveOrganizationLookup {
  return { supported: false };
}
function activeOrg(id: string): ActiveOrganizationLookup {
  return { supported: true, organization: { id, slug: "org", name: "Org" } };
}
function misconfigured(): ActiveOrganizationLookup {
  return { supported: true, organization: null };
}

describe("employeeBelongsToActiveOrganization", () => {
  it("pre-migration (unsupported) — every employee is treated as accessible", () => {
    expect(employeeBelongsToActiveOrganization("org-a", unsupported())).toBe(true);
    expect(employeeBelongsToActiveOrganization(null, unsupported())).toBe(true);
  });

  it("misconfigured (no active org row found) — fails closed, nothing is accessible", () => {
    expect(employeeBelongsToActiveOrganization("org-a", misconfigured())).toBe(false);
  });

  it("employee's organization matches the active one — accessible", () => {
    expect(employeeBelongsToActiveOrganization("org-a", activeOrg("org-a"))).toBe(true);
  });

  it("employee belongs to a DIFFERENT organization — not accessible (opened or updated)", () => {
    expect(employeeBelongsToActiveOrganization("org-b", activeOrg("org-a"))).toBe(false);
  });

  it("employee has no organization_id at all while scoping is active — not accessible", () => {
    expect(employeeBelongsToActiveOrganization(null, activeOrg("org-a"))).toBe(false);
  });
});

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

let migrationApplied = false;
if (client) {
  const { error } = await client.from("organizations").select("id").limit(1);
  migrationApplied = !error;
}

const createdOrgIds: string[] = [];
const createdEmployeeIds: string[] = [];
const suffix = Date.now().toString(36);

function skipUnlessReady() {
  return !hasCreds || !migrationApplied;
}

afterAll(async () => {
  if (!client) return;
  if (createdEmployeeIds.length > 0) await client.from("employees").delete().in("id", createdEmployeeIds);
  if (createdOrgIds.length > 0) await client.from("organizations").delete().in("id", createdOrgIds);
});

describe("edit-employee — real database behavior", () => {
  it.skipIf(skipUnlessReady())("an employee in the active organization loads correctly (edit-page precondition)", async () => {
    const org = await findOrCreateOrganization({ newOrganizationName: `Edit Test Org A ${suffix}` });
    expect(org).not.toBeNull();
    createdOrgIds.push(org!.id);

    const { data: employee, error } = await client!
      .from("employees")
      .insert({
        organization_id: org!.id,
        employee_code: "EDIT-0001",
        full_name: "Original Name",
        email: `edit.employee.${suffix}@example.com`,
        status: "active",
      })
      .select("id, organization_id")
      .single();
    expect(error).toBeNull();
    createdEmployeeIds.push(employee!.id);

    const lookup = activeOrg(org!.id);
    const { data: fetched } = await client!.from("employees").select("id, organization_id, full_name").eq("id", employee!.id).maybeSingle();
    expect(fetched).not.toBeNull();
    expect(employeeBelongsToActiveOrganization(fetched!.organization_id, lookup)).toBe(true);
  });

  it.skipIf(skipUnlessReady())("basic employee information can be updated and the change persists", async () => {
    const employeeId = createdEmployeeIds[0];

    const { error } = await client!
      .from("employees")
      .update({
        full_name: "Updated Name",
        department: "Engineering",
        phone: "+1-555-0100",
        annual_leave_days: 21,
        air_ticket_entitlement: 1500,
        air_ticket_currency: "USD",
      })
      .eq("id", employeeId);
    expect(error).toBeNull();

    const { data: after } = await client!
      .from("employees")
      .select("full_name, department, phone, annual_leave_days, air_ticket_entitlement, air_ticket_currency")
      .eq("id", employeeId)
      .single();
    expect(after?.full_name).toBe("Updated Name");
    expect(after?.department).toBe("Engineering");
    expect(Number(after?.annual_leave_days)).toBe(21);
    expect(Number(after?.air_ticket_entitlement)).toBe(1500);
    expect(after?.air_ticket_currency).toBe("USD");
  });

  it.skipIf(skipUnlessReady())("an employee belonging to a DIFFERENT organization cannot be opened or updated while this organization is active", async () => {
    const orgB = await findOrCreateOrganization({ newOrganizationName: `Edit Test Org B ${suffix}` });
    expect(orgB).not.toBeNull();
    createdOrgIds.push(orgB!.id);

    const { data: orgBEmployee } = await client!
      .from("employees")
      .insert({
        organization_id: orgB!.id,
        employee_code: "EDIT-0002",
        full_name: "Org B Employee",
        email: `edit.orgb.${suffix}@example.com`,
        status: "active",
      })
      .select("id, organization_id")
      .single();
    createdEmployeeIds.push(orgBEmployee!.id);

    // Org A is the active organization for this check — the same lookup
    // shape the edit page/route would have while an HR admin is scoped to
    // Org A. Org B's employee must be treated as inaccessible: not
    // "openable" (profile page) and not "updatable" (edit route) — this is
    // the exact same boolean both call sites branch on.
    const orgALookup = activeOrg(createdOrgIds[0]);
    expect(employeeBelongsToActiveOrganization(orgBEmployee!.organization_id, orgALookup)).toBe(false);
  });

  it.skipIf(skipUnlessReady())("an invalid/nonexistent employee id returns no row — the not-found path", async () => {
    const { data, error } = await client!.from("employees").select("id").eq("id", "00000000-0000-0000-0000-000000000000").maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});
