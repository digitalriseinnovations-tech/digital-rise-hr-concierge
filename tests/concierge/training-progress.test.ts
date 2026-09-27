import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { executeTool } from "../../src/lib/concierge/tool-executor";

/**
 * TAQA Demo Sprint, Phase 4 — start_training_program: a single-call,
 * no-confirmation action (harmless navigation, not a consequential write)
 * that transitions assigned/confirmed -> in_progress and returns the
 * program's training_url. Deliberately NOT going through runConciergeTurn
 * here — this is a direct executeTool() test, the same pattern every other
 * deterministic tool test in this suite uses, so it makes zero Anthropic
 * calls by construction (there is no code path here that could reach
 * getAnthropicClient() at all).
 *
 * Uses an ephemeral test-only program (not the real seeded catalogue) and
 * Oliver Bennett (NSG-1009), an employee not mutated by any other training
 * test file in this suite.
 */

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

let oliverId: string | null = null;
let programId: string | null = null;
let programName: string | null = null;
const createdRegistrationIds: string[] = [];

beforeAll(async () => {
  if (!client) return;
  const { data: emp } = await client.from("employees").select("id").eq("employee_code", "NSG-1009").single();
  oliverId = emp!.id;

  const { data: program } = await client
    .from("training_programs")
    .insert({ name: "TEST-PROGRESS — Start/Continue Program", requires_manager_approval: false, active: true, training_url: "https://learning.example.com/test-progress" })
    .select("id, name")
    .single();
  programId = program!.id;
  programName = program!.name;
});

afterAll(async () => {
  if (!client) return;
  if (createdRegistrationIds.length > 0) {
    await client.from("training_registrations").delete().in("id", createdRegistrationIds);
  }
  if (programId) {
    await client.from("training_programs").delete().eq("id", programId);
  }
});

function ctx() {
  return { employeeId: oliverId!, employeeFullName: "Oliver Bennett", conversationId: "00000000-0000-0000-0000-000000000000" };
}

describe("start_training_program — single-call, no confirmation, no Anthropic call possible", () => {
  it.skipIf(!hasCreds)("not enrolled/assigned -> tells the employee, does not create a registration", async () => {
    const result = await executeTool("start_training_program", { program_name: programName }, ctx());
    const output = result.output as { ok: boolean; found: boolean; message?: string };
    expect(output.ok).toBe(false);
    expect(output.found).toBe(false);
    expect(output.message?.toLowerCase()).toContain("not currently enrolled");
  });

  it.skipIf(!hasCreds)("status 'assigned' -> starting transitions to in_progress and returns the training_url", async () => {
    const { data: reg } = await client!
      .from("training_registrations")
      .insert({ employee_id: oliverId, program_id: programId, status: "assigned", requested_via: "admin", due_date: "2027-01-01" })
      .select("id")
      .single();
    createdRegistrationIds.push(reg!.id);

    const result = await executeTool("start_training_program", { program_name: programName }, ctx());
    const output = result.output as { ok: boolean; status: string; training_url: string };
    expect(result.isError).toBe(false);
    expect(output.status).toBe("in_progress");
    expect(output.training_url).toBe("https://learning.example.com/test-progress");

    const { data: row } = await client!.from("training_registrations").select("status, started_at").eq("id", reg!.id).single();
    expect(row?.status).toBe("in_progress");
    expect(row?.started_at).toBeTruthy();
  });

  it.skipIf(!hasCreds)("already in_progress -> idempotent, returns the same status and link again, does not error", async () => {
    const result = await executeTool("start_training_program", { program_name: programName }, ctx());
    const output = result.output as { ok: boolean; status: string; training_url: string };
    expect(result.isError).toBe(false);
    expect(output.status).toBe("in_progress");
    expect(output.training_url).toBe("https://learning.example.com/test-progress");

    // Still exactly one registration row — no duplicate created.
    const { count } = await client!
      .from("training_registrations")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", oliverId!)
      .eq("program_id", programId!);
    expect(count).toBe(1);
  });

  it.skipIf(!hasCreds)("a registration still pending approval ('requested') cannot be started", async () => {
    const { data: program2 } = await client!
      .from("training_programs")
      .insert({ name: "TEST-PROGRESS — Approval Required", requires_manager_approval: true, active: true, training_url: "https://learning.example.com/approval-required" })
      .select("id")
      .single();
    const { data: reg } = await client!
      .from("training_registrations")
      .insert({ employee_id: oliverId, program_id: program2!.id, status: "requested", requested_via: "concierge" })
      .select("id")
      .single();

    const result = await executeTool("start_training_program", { program_name: "TEST-PROGRESS — Approval Required" }, ctx());
    const output = result.output as { ok: boolean; found: boolean; status: string };
    expect(output.ok).toBe(false);
    expect(output.found).toBe(true);
    expect(output.status).toBe("requested");

    await client!.from("training_registrations").delete().eq("id", reg!.id);
    await client!.from("training_programs").delete().eq("id", program2!.id);
  });
});
