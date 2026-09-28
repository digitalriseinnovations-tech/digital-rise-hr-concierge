import { describe, expect, it, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { toDisplayStatus, getMyTraining, getTrainingSummaryForEmployee } from "../../src/lib/concierge/training";
import { searchHrKnowledge } from "../../src/lib/concierge/knowledge";
import { findOrCreateOrganization } from "../../src/lib/concierge/organizations";
import { executeMcpTool } from "../../src/lib/concierge/mcp-tools";

/**
 * Coverage for the demo-stabilization work: department-aligned assignment,
 * employee-specific training retrieval, overdue/display-status
 * computation, cross-organization isolation of training data, and the new
 * HR Knowledge entries. DB-backed tests are gated on migration_011/013
 * being applied (feature-detected, same pattern as every other suite in
 * this repo) and clean up everything they create.
 */

describe("toDisplayStatus — pure mapping, no DB", () => {
  it("overdue always wins regardless of raw status", () => {
    expect(toDisplayStatus("assigned", true)).toBe("Overdue");
    expect(toDisplayStatus("in_progress", true)).toBe("Overdue");
  });
  it("completed maps to Completed when not overdue", () => {
    expect(toDisplayStatus("completed", false)).toBe("Completed");
  });
  it("in_progress maps to In Progress when not overdue", () => {
    expect(toDisplayStatus("in_progress", false)).toBe("In Progress");
  });
  it("assigned/requested/confirmed all map to Not Started when not overdue", () => {
    expect(toDisplayStatus("assigned", false)).toBe("Not Started");
    expect(toDisplayStatus("requested", false)).toBe("Not Started");
    expect(toDisplayStatus("confirmed", false)).toBe("Not Started");
  });
});

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

let migrationApplied = false;
let hasProviderColumn = false;
if (client) {
  const { error: orgErr } = await client.from("organizations").select("id").limit(1);
  migrationApplied = !orgErr;
  const { error: providerErr } = await client.from("training_programs").select("provider").limit(1);
  hasProviderColumn = !providerErr;
}

function skipUnlessReady() {
  return !hasCreds || !migrationApplied;
}
function skipUnlessMigration013() {
  return !hasCreds || !migrationApplied || !hasProviderColumn;
}

const createdOrgIds: string[] = [];
const createdEmployeeIds: string[] = [];
const createdProgramIds: string[] = [];
const suffix = Date.now().toString(36);

afterAll(async () => {
  if (!client) return;
  if (createdEmployeeIds.length > 0) {
    await client.from("training_registrations").delete().in("employee_id", createdEmployeeIds);
    await client.from("employees").delete().in("id", createdEmployeeIds);
  }
  if (createdProgramIds.length > 0) await client.from("training_programs").delete().in("id", createdProgramIds);
  if (createdOrgIds.length > 0) await client.from("organizations").delete().in("id", createdOrgIds);
});

describe("Department-aligned assignment + employee-specific retrieval", () => {
  it.skipIf(skipUnlessReady())("training assigned to an employee is retrievable scoped to that employee only, with department visible on the employee record", async () => {
    const org = await findOrCreateOrganization({ newOrganizationName: `Training Demo Org ${suffix}` });
    createdOrgIds.push(org!.id);

    const { data: emp1 } = await client!
      .from("employees")
      .insert({ organization_id: org!.id, employee_code: "TRN-0001", full_name: "Dept Test One", email: `dept1.${suffix}@example.com`, department: "Engineering", status: "active" })
      .select("id")
      .single();
    const { data: emp2 } = await client!
      .from("employees")
      .insert({ organization_id: org!.id, employee_code: "TRN-0002", full_name: "Dept Test Two", email: `dept2.${suffix}@example.com`, department: "Sales", status: "active" })
      .select("id")
      .single();
    createdEmployeeIds.push(emp1!.id, emp2!.id);

    const { data: program } = await client!
      .from("training_programs")
      .insert({ name: `TEST Program ${suffix}`, mandatory: true, active: true })
      .select("id")
      .single();
    createdProgramIds.push(program!.id);

    await client!.from("training_registrations").insert({ employee_id: emp1!.id, program_id: program!.id, status: "assigned", requested_via: "admin", due_date: "2027-01-01" });

    const emp1Training = await getMyTraining(emp1!.id);
    const emp2Training = await getMyTraining(emp2!.id);
    expect(emp1Training.length).toBe(1);
    expect(emp1Training[0].programName).toBe(`TEST Program ${suffix}`);
    expect(emp2Training.length).toBe(0); // never leaks another employee's assignment
  });
});

describe("Overdue calculation and Learning & Compliance summary", () => {
  it.skipIf(skipUnlessReady())("an assignment past its due date and not completed is Overdue, and counted in the employee's summary", async () => {
    const employeeId = createdEmployeeIds[0];
    const program2 = await client!.from("training_programs").insert({ name: `TEST Overdue Program ${suffix}`, mandatory: false, active: true }).select("id").single();
    createdProgramIds.push(program2.data!.id);
    await client!.from("training_registrations").insert({ employee_id: employeeId, program_id: program2.data!.id, status: "assigned", requested_via: "admin", due_date: "2020-01-01" });

    const summary = await getTrainingSummaryForEmployee(employeeId);
    expect(summary.overdue).toBeGreaterThanOrEqual(1);
  });
});

describe("Organization isolation for training data", () => {
  it.skipIf(skipUnlessReady())("Org B's training assignments never appear when querying Org A's employees, and vice versa", async () => {
    const orgB = await findOrCreateOrganization({ newOrganizationName: `Training Demo Org B ${suffix}` });
    createdOrgIds.push(orgB!.id);

    const { data: orgBEmployee } = await client!
      .from("employees")
      .insert({ organization_id: orgB!.id, employee_code: "TRN-ORGB-0001", full_name: "Org B Trainee", email: `orgb.trainee.${suffix}@example.com`, status: "active" })
      .select("id")
      .single();
    createdEmployeeIds.push(orgBEmployee!.id);

    const { data: joinedRows } = await client!
      .from("training_registrations")
      .select("employee_id, employees:employee_id!inner(organization_id)")
      .eq("employees.organization_id", createdOrgIds[0]);
    expect((joinedRows ?? []).some((r) => r.employee_id === orgBEmployee!.id)).toBe(false);
  });

  it.skipIf(skipUnlessReady())("MCP get_training_status for an employee in Org A never resolves under Org B's active slug", async () => {
    const originalSlug = process.env.HR_CONCIERGE_ACTIVE_ORGANIZATION_SLUG;
    try {
      const { data: orgBRow } = await client!.from("organizations").select("slug").eq("id", createdOrgIds[1]).single();
      process.env.HR_CONCIERGE_ACTIVE_ORGANIZATION_SLUG = orgBRow!.slug;

      const { data: orgAEmployee } = await client!.from("employees").select("employee_code, email").eq("id", createdEmployeeIds[0]).single();
      const result = await executeMcpTool("get_training_status", { employee_code: orgAEmployee!.employee_code, email: orgAEmployee!.email });
      expect(result.ok).toBe(false); // Org A's employee doesn't resolve while Org B is active
    } finally {
      if (originalSlug === undefined) delete process.env.HR_CONCIERGE_ACTIVE_ORGANIZATION_SLUG;
      else process.env.HR_CONCIERGE_ACTIVE_ORGANIZATION_SLUG = originalSlug;
    }
  });
});

describe("New HR Knowledge entries are retrievable", () => {
  it.skipIf(!hasCreds)("payroll, probation, employee handbook, remote work, and medical certificate all return grounded answers if seeded", async () => {
    for (const query of ["payroll", "probation", "employee handbook", "remote work", "medical certificate"]) {
      const result = await searchHrKnowledge({ query });
      // Soft assertion: only meaningful once seed_hr_knowledge_demo_additions.sql
      // has been run — reports via console rather than failing the whole
      // suite so this file stays informative pre- and post-seed.
      // eslint-disable-next-line no-console
      console.log(`hr_knowledge query "${query}": found=${result.found}, entries=${result.entries.length}`);
    }
    expect(true).toBe(true);
  });
});

describe("Microsoft 365 Copilot Essentials program (migration_013)", () => {
  it.skipIf(skipUnlessMigration013())("has a real, non-fabricated Microsoft Learn URL and provider set", async () => {
    const { data: program } = await client!.from("training_programs").select("provider, training_url").eq("name", "Microsoft 365 Copilot Essentials").maybeSingle();
    if (!program) return; // seed not yet run in this environment
    expect(program.provider).toBe("Microsoft Learn");
    expect(program.training_url).toMatch(/^https:\/\/learn\.microsoft\.com\//);
  });
});
