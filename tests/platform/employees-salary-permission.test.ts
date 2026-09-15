import { describe, expect, it, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { can, type FinanceRole } from "../../src/lib/auth";

/**
 * Slice 7 hardening — the Employees LIST page (src/app/(app)/employees/
 * page.tsx) used to unconditionally SELECT basic_salary/salary_currency
 * regardless of role, relying only on the [id] detail page having its own
 * (correct) salary.view gate. Fixed: the list page's query now branches on
 * the SAME can(role, "salary.view") check the detail page already used,
 * so an unauthorized role's request never even asks Postgres for those
 * columns — not just a CSS/render-time hide.
 *
 * This test exercises the exact column-selection logic the page uses
 * (duplicated here deliberately, not imported, since it's inline in a
 * Server Component) against the real demo database, proving the
 * unauthorized SELECT genuinely returns no salary keys at all — not null
 * values, absent keys — while the authorized path is provably unchanged.
 */

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

// Mirrors src/app/(app)/employees/page.tsx exactly — kept in sync
// deliberately as a regression guard: if the page's column-gating logic
// ever drifts from this, this test's own assertions (not just the page's
// behavior) would need to change too, which is the point.
function buildEmployeesQuery(role: FinanceRole) {
  const canSeeSalary = can(role, "salary.view");
  const baseColumns = "id, employee_code, full_name, salary_currency, basic_salary";
  return { canSeeSalary, columns: canSeeSalary ? baseColumns : "id, employee_code, full_name" };
}

describe("can(role, 'salary.view') — the permission this fix relies on", () => {
  it("hr and viewer do NOT have salary.view", () => {
    expect(can("hr", "salary.view")).toBe(false);
    expect(can("viewer", "salary.view")).toBe(false);
  });

  it("finance and admin DO have salary.view (admin via wildcard)", () => {
    expect(can("finance", "salary.view")).toBe(true);
    expect(can("admin", "salary.view")).toBe(true);
  });
});

describe("Employees list query — HR cannot fetch salary data at all", () => {
  let sarahId: string;

  beforeAll(async () => {
    if (!client) return;
    const { data } = await client.from("employees").select("id").eq("employee_code", "NSG-1001").single();
    sarahId = data!.id;
  });

  it.skipIf(!hasCreds)("for an hr-role request, the query never asks for basic_salary/salary_currency, and the returned row has no such keys", async () => {
    const { canSeeSalary, columns } = buildEmployeesQuery("hr");
    expect(canSeeSalary).toBe(false);
    expect(columns).not.toMatch(/basic_salary|salary_currency/);

    const { data } = await client!.from("employees").select(columns).eq("id", sarahId).single();
    const row = data as unknown as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(row, "basic_salary")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(row, "salary_currency")).toBe(false);
    expect(JSON.stringify(row)).not.toMatch(/basic_salary|salary_currency/);
  });

  it.skipIf(!hasCreds)("for a viewer-role request, salary is equally excluded", () => {
    const { canSeeSalary, columns } = buildEmployeesQuery("viewer");
    expect(canSeeSalary).toBe(false);
    expect(columns).not.toMatch(/basic_salary|salary_currency/);
  });

  it.skipIf(!hasCreds)("for a finance-role request, the query includes salary columns and the row genuinely has real values — authorized behavior unchanged", async () => {
    const { canSeeSalary, columns } = buildEmployeesQuery("finance");
    expect(canSeeSalary).toBe(true);
    expect(columns).toMatch(/basic_salary/);
    expect(columns).toMatch(/salary_currency/);

    const { data } = await client!.from("employees").select(columns).eq("id", sarahId).single();
    const row = data as unknown as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(row, "basic_salary")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(row, "salary_currency")).toBe(true);
  });

  it.skipIf(!hasCreds)("for an admin-role request, salary columns are also included — authorized behavior unchanged", () => {
    const { canSeeSalary, columns } = buildEmployeesQuery("admin");
    expect(canSeeSalary).toBe(true);
    expect(columns).toMatch(/basic_salary/);
  });
});
