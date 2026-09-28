import { describe, expect, it, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { commitImport, buildExistingEmployeeIndex, validateRows, type CellValue } from "../../src/lib/employee-import";
import { findOrCreateOrganization } from "../../src/lib/concierge/organizations";
import { executeMcpTool } from "../../src/lib/concierge/mcp-tools";

/**
 * DB-backed coverage for the Employee Import feature (migration_011 +
 * commitImport + cross-organization isolation + the existing MCP identity
 * lookup). Every test here is gated on migration_011 actually being
 * applied — see the top-level probe below — so this suite reports as
 * skipped, not failed, until that manual SQL step is run (same pattern as
 * prior migration_009/010 gating in this repo). All writes here are to
 * newly-created test organizations/employees this suite creates and
 * deletes itself — never touching the real seeded Digital Rise Innovations
 * roster.
 *
 * The migration-applied probe MUST run as a top-level await, not inside
 * beforeAll: it.skipIf(condition) evaluates `condition` synchronously
 * during test COLLECTION, which happens before any beforeAll hook runs —
 * a value only set inside beforeAll is always read at its initial value
 * by skipIf, silently skipping every test regardless of real DB state.
 */

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

let migrationApplied = false;
// A real finance_users.id, not a fabricated UUID — employees.created_by/
// updated_by is a genuine FK to finance_users(id), so an arbitrary UUID
// silently fails every insert/update with a foreign-key violation
// (caught as `errored`, not thrown), which is exactly what happened the
// first time this suite ran with a hardcoded all-zero UUID here.
let actorFinanceUserId: string | null = null;
if (client) {
  const { error } = await client.from("organizations").select("id").limit(1);
  migrationApplied = !error;
  const { data: financeUser } = await client.from("finance_users").select("id").limit(1).maybeSingle();
  actorFinanceUserId = financeUser?.id ?? null;
}

const createdOrgIds: string[] = [];
const createdEmployeeIds: string[] = [];
const ORIGINAL_ACTIVE_SLUG = process.env.HR_CONCIERGE_ACTIVE_ORGANIZATION_SLUG;

const suffix = Date.now().toString(36);
const ORG_A_NAME = `Test Import Org A ${suffix}`;
const ORG_B_NAME = `Test Import Org B ${suffix}`;

const MAPPING = {
  employee_code: "Employee Code",
  first_name: "First Name",
  last_name: "Last Name",
  email: "Work Email",
  department: "Department",
  job_title: null,
  manager_email: null,
  joining_date: null,
  employment_status: null,
  location: null,
  annual_leave_entitlement: null,
};

function makeRow(overrides: Record<string, CellValue>): Record<string, CellValue> {
  return {
    "Employee Code": "IMP-0001",
    "First Name": "Imported",
    "Last Name": "Employee",
    "Work Email": `imported.employee.${suffix}@example.com`,
    Department: "Operations",
    ...overrides,
  };
}

afterAll(async () => {
  if (!client) return;
  if (createdEmployeeIds.length > 0) {
    await client.from("employees").delete().in("id", createdEmployeeIds);
  }
  if (createdOrgIds.length > 0) {
    await client.from("organizations").delete().in("id", createdOrgIds);
  }
  if (ORIGINAL_ACTIVE_SLUG === undefined) delete process.env.HR_CONCIERGE_ACTIVE_ORGANIZATION_SLUG;
  else process.env.HR_CONCIERGE_ACTIVE_ORGANIZATION_SLUG = ORIGINAL_ACTIVE_SLUG;
});

function skipUnlessReady() {
  return !hasCreds || !migrationApplied || !actorFinanceUserId;
}

describe("commitImport — new organization import", () => {
  it.skipIf(skipUnlessReady())("creates a brand-new organization and imports an employee into it", async () => {
    const org = await findOrCreateOrganization({ newOrganizationName: ORG_A_NAME });
    expect(org).not.toBeNull();
    createdOrgIds.push(org!.id);

    const rows = [makeRow({})];
    const existingIndex = await buildExistingEmployeeIndex(org!.id);
    const validated = validateRows(rows, MAPPING, existingIndex, "skip");
    expect(validated[0].action).toBe("create");

    const summary = await commitImport(validated, org!.id, actorFinanceUserId!);
    expect(summary.created).toBe(1);
    expect(summary.errored).toBe(0);

    const { data: inserted } = await client!
      .from("employees")
      .select("id, organization_id, employee_code, email")
      .eq("organization_id", org!.id)
      .eq("employee_code", "IMP-0001")
      .single();
    expect(inserted?.organization_id).toBe(org!.id);
    createdEmployeeIds.push(inserted!.id);
  });
});

describe("commitImport — existing employee update/skip", () => {
  it.skipIf(skipUnlessReady())("re-importing the same employee_code+email with duplicateStrategy='skip' leaves the record unchanged", async () => {
    const org = createdOrgIds[0];
    const existingIndex = await buildExistingEmployeeIndex(org);
    const validated = validateRows([makeRow({ Department: "Changed Department" })], MAPPING, existingIndex, "skip");
    expect(validated[0].action).toBe("skip");

    const summary = await commitImport(validated, org, actorFinanceUserId!);
    expect(summary.skipped).toBe(1);

    const { data } = await client!.from("employees").select("department").eq("organization_id", org).eq("employee_code", "IMP-0001").single();
    expect(data?.department).toBe("Operations"); // unchanged from the original import
  });

  it.skipIf(skipUnlessReady())("re-importing with duplicateStrategy='update' updates the existing record", async () => {
    const org = createdOrgIds[0];
    const existingIndex = await buildExistingEmployeeIndex(org);
    const validated = validateRows([makeRow({ Department: "Changed Department" })], MAPPING, existingIndex, "update");
    expect(validated[0].action).toBe("update");

    const summary = await commitImport(validated, org, actorFinanceUserId!);
    expect(summary.updated).toBe(1);

    const { data } = await client!.from("employees").select("department").eq("organization_id", org).eq("employee_code", "IMP-0001").single();
    expect(data?.department).toBe("Changed Department");
  });
});

describe("commitImport — cross-organization isolation", () => {
  it.skipIf(skipUnlessReady())("the SAME employee_code in a different organization is imported as a distinct, unrelated row", async () => {
    const orgB = await findOrCreateOrganization({ newOrganizationName: ORG_B_NAME });
    expect(orgB).not.toBeNull();
    createdOrgIds.push(orgB!.id);

    const rows = [makeRow({ "Work Email": `orgb.employee.${suffix}@example.com` })]; // same "IMP-0001" code, different email
    const existingIndex = await buildExistingEmployeeIndex(orgB!.id); // scoped to org B only — never sees org A's row
    const validated = validateRows(rows, MAPPING, existingIndex, "skip");
    expect(validated[0].action).toBe("create"); // not treated as a duplicate of org A's employee

    const summary = await commitImport(validated, orgB!.id, actorFinanceUserId!);
    expect(summary.created).toBe(1);

    const { data: orgBEmployee } = await client!
      .from("employees")
      .select("id, organization_id")
      .eq("organization_id", orgB!.id)
      .eq("employee_code", "IMP-0001")
      .single();
    createdEmployeeIds.push(orgBEmployee!.id);

    const { data: orgAEmployee } = await client!
      .from("employees")
      .select("id")
      .eq("organization_id", createdOrgIds[0])
      .eq("employee_code", "IMP-0001")
      .single();
    expect(orgBEmployee!.id).not.toBe(orgAEmployee!.id); // two genuinely distinct rows, not one shared record
  });
});

function slugFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

describe("HR Concierge / MCP lookup of an imported employee", () => {
  it.skipIf(skipUnlessReady())("get_employee_profile resolves the imported employee once its organization is active", async () => {
    process.env.HR_CONCIERGE_ACTIVE_ORGANIZATION_SLUG = slugFor(ORG_A_NAME);

    const result = await executeMcpTool("get_employee_profile", {
      employee_code: "IMP-0001",
      email: `imported.employee.${suffix}@example.com`,
    });

    expect(result.ok).toBe(true);
    expect((result.data as { firstName: string }).firstName).toBe("Imported");
  });

  it.skipIf(skipUnlessReady())("cross-organization isolation: the SAME employee_code under a DIFFERENT organization's active slug does not resolve", async () => {
    // Org A is active, but IMP-0001 + org A's own email combination should
    // still resolve fine — the isolation property under test is that Org
    // B's employee (same code, different email) must NOT resolve while
    // Org A is active, proving organization scoping is genuinely enforced
    // at the identity layer, not just at import time.
    process.env.HR_CONCIERGE_ACTIVE_ORGANIZATION_SLUG = slugFor(ORG_A_NAME);

    const result = await executeMcpTool("get_employee_profile", {
      employee_code: "IMP-0001",
      email: `orgb.employee.${suffix}@example.com`, // this is Org B's employee's email
    });

    expect(result.ok).toBe(false);
  });
});
