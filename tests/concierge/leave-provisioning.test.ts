import { describe, expect, it, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { provisionAnnualLeaveBalance, getMyLeaveBalance } from "../../src/lib/concierge/leave";
import { commitImport, buildExistingEmployeeIndex, validateRows, type CellValue } from "../../src/lib/employee-import";
import { findOrCreateOrganization } from "../../src/lib/concierge/organizations";
import { executeMcpTool } from "../../src/lib/concierge/mcp-tools";

/**
 * Leave consistency fix — provisionAnnualLeaveBalance() is the one place
 * that creates/syncs the canonical leave_balances row consumed by Employee
 * Profile, /leave, and getMyLeaveBalance()/MCP get_leave_balance. This
 * suite verifies: no duplicate rows, entitlement-only sync on edit (taken/
 * accrued preserved), import auto-provisioning, cross-organization
 * isolation of the /leave-equivalent balance query, the 12 originally
 * seeded employees' balances are untouched by any of this, and — as an
 * explicit validation step requested for this fix — that the real Neha
 * Sharma / DRI-1001 record agrees across Profile / leave_balances / MCP
 * once provisioned.
 */

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

let migrationApplied = false;
let actorFinanceUserId: string | null = null;
if (client) {
  const { error } = await client.from("organizations").select("id").limit(1);
  migrationApplied = !error;
  const { data: financeUser } = await client.from("finance_users").select("id").limit(1).maybeSingle();
  actorFinanceUserId = financeUser?.id ?? null;
}

function skipUnlessReady() {
  return !hasCreds || !migrationApplied || !actorFinanceUserId;
}

const createdOrgIds: string[] = [];
const createdEmployeeIds: string[] = [];
const suffix = Date.now().toString(36);
const currentYear = new Date().getFullYear();

afterAll(async () => {
  if (!client) return;
  if (createdEmployeeIds.length > 0) {
    await client.from("leave_balances").delete().in("employee_id", createdEmployeeIds);
    await client.from("employees").delete().in("id", createdEmployeeIds);
  }
  if (createdOrgIds.length > 0) await client.from("organizations").delete().in("id", createdOrgIds);
});

describe("provisionAnnualLeaveBalance — no duplicates, entitlement-only sync", () => {
  it.skipIf(skipUnlessReady())("first call creates a row with accrued = entitlement (immediately available), taken = 0", async () => {
    const org = await findOrCreateOrganization({ newOrganizationName: `Leave Test Org ${suffix}` });
    createdOrgIds.push(org!.id);

    const { data: employee } = await client!
      .from("employees")
      .insert({ organization_id: org!.id, employee_code: "LEAVE-0001", full_name: "Leave Test Employee", email: `leave.test.${suffix}@example.com`, status: "active" })
      .select("id")
      .single();
    createdEmployeeIds.push(employee!.id);

    const result = await provisionAnnualLeaveBalance(employee!.id, 19);
    expect(result).toEqual({ created: true, updated: false });

    const { data: row } = await client!
      .from("leave_balances")
      .select("entitlement_days, accrued_days, taken_days")
      .eq("employee_id", employee!.id)
      .eq("year", currentYear)
      .eq("leave_type", "annual")
      .single();
    expect(Number(row?.entitlement_days)).toBe(19);
    expect(Number(row?.accrued_days)).toBe(19); // matches existing product semantics: entitlement immediately available
    expect(Number(row?.taken_days)).toBe(0);
  });

  it.skipIf(skipUnlessReady())("calling it again with the SAME value does not create a duplicate row", async () => {
    const employeeId = createdEmployeeIds[0];
    await provisionAnnualLeaveBalance(employeeId, 19);

    const { count } = await client!
      .from("leave_balances")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", employeeId)
      .eq("year", currentYear)
      .eq("leave_type", "annual");
    expect(count).toBe(1);
  });

  it.skipIf(skipUnlessReady())("existing taken_days is preserved when entitlement is later edited — never reset or overwritten", async () => {
    const employeeId = createdEmployeeIds[0];
    // Simulate real leave history: 5 days already taken against this row.
    await client!.from("leave_balances").update({ taken_days: 5 }).eq("employee_id", employeeId).eq("year", currentYear).eq("leave_type", "annual");

    const result = await provisionAnnualLeaveBalance(employeeId, 21); // HR edits the entitlement
    expect(result).toEqual({ created: false, updated: true });

    const { data: row } = await client!
      .from("leave_balances")
      .select("entitlement_days, accrued_days, taken_days")
      .eq("employee_id", employeeId)
      .eq("year", currentYear)
      .eq("leave_type", "annual")
      .single();
    expect(Number(row?.entitlement_days)).toBe(21); // synced
    expect(Number(row?.taken_days)).toBe(5); // preserved, never reset
    expect(Number(row?.accrued_days)).toBe(19); // preserved from the original creation — not overwritten by the edit
  });

  it.skipIf(skipUnlessReady())("Employee Profile and MCP get_leave_balance now agree with the synced entitlement", async () => {
    const employeeId = createdEmployeeIds[0];
    const mcpResult = await getMyLeaveBalance(employeeId, "annual");
    expect(mcpResult?.entitlementDays).toBe(21);
    expect(mcpResult?.takenDays).toBe(5);
    expect(mcpResult?.remainingDays).toBe(mcpResult!.accruedDays - mcpResult!.takenDays);
  });
});

describe("commitImport — imported employees get a canonical leave balance automatically", () => {
  it.skipIf(skipUnlessReady())("a newly imported employee with annual_leave_days gets exactly one leave_balances row", async () => {
    const org = createdOrgIds[0];
    const mapping = {
      employee_code: "Employee Code",
      first_name: "First Name",
      last_name: "Last Name",
      email: "Work Email",
      department: null,
      job_title: null,
      manager_email: null,
      joining_date: null,
      employment_status: null,
      location: null,
      annual_leave_entitlement: "Leave Entitlement",
    };
    const rows: Record<string, CellValue>[] = [
      {
        "Employee Code": "LEAVE-IMPORT-0001",
        "First Name": "Imported",
        "Last Name": "Leave Employee",
        "Work Email": `leave.import.${suffix}@example.com`,
        "Leave Entitlement": 22,
      },
    ];
    const existingIndex = await buildExistingEmployeeIndex(org);
    const validated = validateRows(rows, mapping, existingIndex, "skip");
    expect(validated[0].action).toBe("create");

    const summary = await commitImport(validated, org, actorFinanceUserId!);
    expect(summary.created).toBe(1);

    const { data: employee } = await client!.from("employees").select("id").eq("organization_id", org).eq("employee_code", "LEAVE-IMPORT-0001").single();
    createdEmployeeIds.push(employee!.id);

    const { data: balanceRows, count } = await client!
      .from("leave_balances")
      .select("entitlement_days", { count: "exact" })
      .eq("employee_id", employee!.id)
      .eq("year", currentYear)
      .eq("leave_type", "annual");
    expect(count).toBe(1); // no duplicates
    expect(Number(balanceRows?.[0]?.entitlement_days)).toBe(22);
  });
});

describe("Organization isolation — leave balances never cross organizations", () => {
  it.skipIf(skipUnlessReady())("Org A's active-organization balance query never returns Org B's employees, and vice versa", async () => {
    const orgB = await findOrCreateOrganization({ newOrganizationName: `Leave Test Org B ${suffix}` });
    createdOrgIds.push(orgB!.id);

    const { data: orgBEmployee } = await client!
      .from("employees")
      .insert({ organization_id: orgB!.id, employee_code: "LEAVE-ORGB-0001", full_name: "Org B Leave Employee", email: `leave.orgb.${suffix}@example.com`, status: "active" })
      .select("id")
      .single();
    createdEmployeeIds.push(orgBEmployee!.id);
    await provisionAnnualLeaveBalance(orgBEmployee!.id, 15);

    // The exact query shape /leave's balances table uses, scoped to Org A.
    const { data: orgAView } = await client!.from("current_leave_balances").select("employee_id, organization_id").eq("year", currentYear).eq("organization_id", createdOrgIds[0]);
    expect((orgAView ?? []).some((r) => r.employee_id === orgBEmployee!.id)).toBe(false);

    // And scoped to Org B, Org A's employees never appear.
    const { data: orgBView } = await client!.from("current_leave_balances").select("employee_id, organization_id").eq("year", currentYear).eq("organization_id", orgB!.id);
    expect((orgBView ?? []).every((r) => r.organization_id === orgB!.id)).toBe(true);
    expect((orgBView ?? []).some((r) => r.employee_id === createdEmployeeIds[0])).toBe(false);
  });
});

describe("Existing seeded employees are unaffected", () => {
  it.skipIf(skipUnlessReady())("provisioning a balance for an unrelated employee does not change the 12 originally seeded employees' balances", async () => {
    const { data: before } = await client!.from("leave_balances").select("employee_id, entitlement_days, accrued_days, taken_days").ilike("employee_id", "%").order("employee_id");
    const seededBefore = (before ?? []).filter((r) => !createdEmployeeIds.includes(r.employee_id));

    // Provision an unrelated test employee — should not touch anything else.
    const employeeId = createdEmployeeIds[0];
    await provisionAnnualLeaveBalance(employeeId, 30);

    const { data: after } = await client!.from("leave_balances").select("employee_id, entitlement_days, accrued_days, taken_days").ilike("employee_id", "%").order("employee_id");
    const seededAfter = (after ?? []).filter((r) => !createdEmployeeIds.includes(r.employee_id));

    expect(seededAfter).toEqual(seededBefore);
  });
});

describe("Validation: Neha Sharma / DRI-1001 (real record)", () => {
  it.skipIf(!hasCreds || !migrationApplied)("if DRI-1001 exists, her canonical leave balance agrees with her employees.annual_leave_days after provisioning", async () => {
    const { data: neha } = await client!
      .from("employees")
      .select("id, annual_leave_days")
      .eq("employee_code", "DRI-1001")
      .eq("email", "nia@digitalriseinnovations.com")
      .maybeSingle();

    if (!neha) return; // not present in this environment — nothing to validate here

    if (neha.annual_leave_days !== null) {
      await provisionAnnualLeaveBalance(neha.id, Number(neha.annual_leave_days));
    }

    const balance = await getMyLeaveBalance(neha.id, "annual");
    expect(balance).not.toBeNull();
    expect(balance!.entitlementDays).toBe(Number(neha.annual_leave_days));

    process.env.HR_CONCIERGE_ACTIVE_ORGANIZATION_SLUG = "digital-rise-innovations";
    const mcpResult = await executeMcpTool("get_employee_profile", { employee_code: "DRI-1001", email: "nia@digitalriseinnovations.com" });
    expect(mcpResult.ok).toBe(true);
  });
});
