import { describe, expect, it, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

// Verifies the Northstar Global synthetic seed (supabase/seed_hr_concierge_demo.sql).
// Reports counts and known-safe, already-disclosed demo identifiers
// (Sarah Ahmed / NSG-1001, employee_code values, category names, program
// names) — these are synthetic fixture data named directly in the sprint
// brief, not secrets. Never reads/reports compensation, bank, or any other
// sensitive employee field.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasCreds = Boolean(url && serviceKey);
const client = hasCreds
  ? createClient(url as string, serviceKey as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

describe("HR Concierge demo seed data (Northstar Global)", () => {
  beforeAll(() => {
    if (!hasCreds) {
      // eslint-disable-next-line no-console
      console.log("SKIPPED — Supabase credentials MISSING.");
    }
  });

  it.skipIf(!hasCreds)("seeds exactly the 12 expected Northstar Global employees (count only)", async () => {
    if (!client) return;
    const { count, error } = await client
      .from("employees")
      .select("id", { count: "exact", head: true });
    expect(error).toBeNull();
    // eslint-disable-next-line no-console
    console.log(`employees total count: ${count}`);
    expect(count).toBe(12);
  });

  it.skipIf(!hasCreds)("all seeded employees use the fictional @northstarglobal.com domain (count match)", async () => {
    if (!client) return;
    const { count: total } = await client.from("employees").select("id", { count: "exact", head: true });
    const { count: northstar, error } = await client
      .from("employees")
      .select("id", { count: "exact", head: true })
      .ilike("email", "%@northstarglobal.com");
    expect(error).toBeNull();
    // eslint-disable-next-line no-console
    console.log(`employees @northstarglobal.com: ${northstar} / ${total}`);
    expect(northstar).toBe(total);
  });

  it.skipIf(!hasCreds)("Sarah Ahmed's demo persona exists (NSG-1001, name/department/manager only — no sensitive fields read)", async () => {
    if (!client) return;
    const { data, error } = await client
      .from("employees")
      .select("employee_code, full_name, department, designation, country, manager_email, status")
      .eq("employee_code", "NSG-1001")
      .maybeSingle();
    expect(error).toBeNull();
    // eslint-disable-next-line no-console
    console.log(`NSG-1001: ${JSON.stringify(data)}`);
    expect(data?.full_name).toBe("Sarah Ahmed");
    expect(data?.designation).toBe("Marketing Manager");
    expect(data?.manager_email).toBe("daniel.carter@northstarglobal.com");
    expect(data?.status).toBe("active");
  });

  it.skipIf(!hasCreds)("Sarah Ahmed's leave balance computes to 14 remaining days via the existing current_leave_balances view", async () => {
    if (!client) return;
    const { data, error } = await client
      .from("current_leave_balances")
      .select("remaining_days, accrued_days, taken_days")
      .eq("employee_code", "NSG-1001")
      .eq("leave_type", "annual")
      .maybeSingle();
    expect(error).toBeNull();
    // eslint-disable-next-line no-console
    console.log(`NSG-1001 annual leave: ${JSON.stringify(data)}`);
    expect(data?.remaining_days).toBe(14);
  });

  it.skipIf(!hasCreds)("leave_balances has exactly one row per seeded employee (count only)", async () => {
    if (!client) return;
    const { count, error } = await client.from("leave_balances").select("id", { count: "exact", head: true });
    expect(error).toBeNull();
    // eslint-disable-next-line no-console
    console.log(`leave_balances count: ${count}`);
    expect(count).toBe(12);
  });

  it.skipIf(!hasCreds)("hr_knowledge_base has the expected 20 seeded entries, covering all 9 categories (counts only)", async () => {
    if (!client) return;
    const { count, error } = await client.from("hr_knowledge_base").select("id", { count: "exact", head: true });
    expect(error).toBeNull();
    // eslint-disable-next-line no-console
    console.log(`hr_knowledge_base count: ${count}`);
    expect(count).toBe(20);

    const expectedCategories = [
      "leave", "benefits", "onboarding", "policies", "learning",
      "mentorship", "coaching", "wellbeing", "general",
    ];
    for (const category of expectedCategories) {
      const { count: catCount, error: catErr } = await client
        .from("hr_knowledge_base")
        .select("id", { count: "exact", head: true })
        .eq("category", category)
        .eq("active", true);
      expect(catErr).toBeNull();
      // eslint-disable-next-line no-console
      console.log(`hr_knowledge_base category=${category}: ${catCount}`);
      expect(catCount ?? 0).toBeGreaterThan(0);
    }
  });

  it.skipIf(!hasCreds)("the four originally seeded training programs are present and active", async () => {
    if (!client) return;
    const { data, error } = await client
      .from("training_programs")
      .select("name, active, mandatory")
      .order("name");
    expect(error).toBeNull();
    const names = (data ?? []).map((p) => p.name);
    // eslint-disable-next-line no-console
    console.log(`training_programs: ${JSON.stringify(names)}`);
    // Contains-check, not exact-equality: Slice 4's own tests legitimately
    // insert (and clean up) ephemeral "TEST..." programs of their own, and
    // this suite runs its files in parallel, so a brief overlap where both
    // the seeded catalogue AND another file's still-live ephemeral rows are
    // visible here is expected, not a bug — see the analogous fix for
    // concierge_conversations/hr_requests below.
    for (const expected of ["AI & Digital Productivity", "Cybersecurity Awareness", "Emerging Leaders Program", "Strategic Leadership Essentials"]) {
      expect(names).toContain(expected);
    }
    const seeded = (data ?? []).filter((p) =>
      ["AI & Digital Productivity", "Cybersecurity Awareness", "Emerging Leaders Program", "Strategic Leadership Essentials"].includes(p.name),
    );
    expect(seeded.every((p) => p.active)).toBe(true);
    expect(seeded.find((p) => p.name === "Cybersecurity Awareness")?.mandatory).toBe(true);
  });

  it.skipIf(!hasCreds)("training_registrations table is reachable (Slice 4's own tests legitimately create/clean up rows here)", async () => {
    if (!client) return;
    const { count, error } = await client.from("training_registrations").select("id", { count: "exact", head: true });
    expect(error).toBeNull();
    // eslint-disable-next-line no-console
    console.log(`training_registrations: ${count}`);
    expect(typeof count).toBe("number");
  });

  it.skipIf(!hasCreds)("Concierge conversation/message/request tables are reachable (no longer asserted empty as of Slice 2 — Ask HR legitimately populates them)", async () => {
    if (!client) return;
    for (const table of ["concierge_conversations", "concierge_messages", "hr_requests"]) {
      const { count, error } = await client.from(table).select("id", { count: "exact", head: true });
      expect(error).toBeNull();
      // eslint-disable-next-line no-console
      console.log(`${table}: ${count} (Slice 2 Ask HR / escalation may have created real rows here — that's expected now)`);
      expect(typeof count).toBe("number");
    }
  });

  it.skipIf(!hasCreds)("no @verofax.com email domain is present (count only)", async () => {
    if (!client) return;
    const { count, error } = await client
      .from("employees")
      .select("id", { count: "exact", head: true })
      .ilike("email", "%@verofax.com");
    expect(error).toBeNull();
    expect(count ?? 0).toBe(0);
  });

  it.skipIf(!hasCreds)("no employee has real compensation/bank data populated (production-data signal, booleans only)", async () => {
    if (!client) return;
    const { count: withSalary, error: e1 } = await client
      .from("employees")
      .select("id", { count: "exact", head: true })
      .gt("basic_salary", 0);
    expect(e1).toBeNull();
    // eslint-disable-next-line no-console
    console.log(`employees with basic_salary > 0: ${withSalary} (expected 0 in this demo seed)`);
    expect(withSalary ?? 0).toBe(0);

    const { count: withBank, error: e2 } = await client
      .from("employees")
      .select("id", { count: "exact", head: true })
      .not("bank_account", "is", null);
    expect(e2).toBeNull();
    // eslint-disable-next-line no-console
    console.log(`employees with bank_account set: ${withBank} (expected 0 in this demo seed)`);
    expect(withBank ?? 0).toBe(0);
  });
});
