import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { executeTool } from "../../src/lib/concierge/tool-executor";
import { CONCIERGE_TOOL_NAMES } from "../../src/lib/concierge/tools";
import { computeEnrollmentToken } from "../../src/lib/concierge/training";

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

let liamId: string | null = null;
let rahulId: string | null = null;
let liamConversationId: string | null = null;
let cappedProgramId: string | null = null; // seats_total=1, seats_available=1, direct

beforeAll(async () => {
  if (!client) return;
  const { data } = await client.from("employees").select("id, employee_code").in("employee_code", ["NSG-1007", "NSG-1011"]);
  liamId = data?.find((e) => e.employee_code === "NSG-1007")?.id ?? null;
  rahulId = data?.find((e) => e.employee_code === "NSG-1011")?.id ?? null;

  const { data: conv } = await client
    .from("concierge_conversations")
    .insert({ employee_id: liamId, channel: "web", status: "active" })
    .select("id")
    .single();
  liamConversationId = conv!.id;

  const { data: program } = await client
    .from("training_programs")
    .insert({ name: "TEST-EXEC — Capped Direct Program", requires_manager_approval: false, seats_total: 1, seats_available: 1, active: true })
    .select("id")
    .single();
  cappedProgramId = program!.id;
});

afterAll(async () => {
  if (!client) return;
  if (cappedProgramId) {
    await client.from("training_programs").delete().eq("id", cappedProgramId); // cascades to its registration
  }
  if (liamConversationId) {
    await client.from("concierge_conversations").delete().eq("id", liamConversationId);
  }
});

function liamCtx() {
  return { employeeId: liamId!, employeeFullName: "Liam O'Connor", conversationId: liamConversationId! };
}

describe("Learning tools — no admin/approval capability exists, fail closed for anything else", () => {
  it("no approve_training, assign_mentor, approve_coaching, or set_registration_status tool is registered", () => {
    for (const forbidden of ["approve_training", "assign_mentor", "approve_coaching", "set_registration_status", "match_mentor"]) {
      expect(CONCIERGE_TOOL_NAMES.has(forbidden)).toBe(false);
    }
  });

  it.skipIf(!hasCreds)("calling one of those names is rejected, fail closed, before touching the database", async () => {
    const result = await executeTool("approve_training", { registration_id: "whatever" }, liamCtx());
    expect(result.isError).toBe(true);
    expect(result.summary).toMatch(/REJECTED/);
  });
});

describe("request_training_enrollment — preview-then-confirm, never writes on the first call", () => {
  it.skipIf(!hasCreds)("without confirmed=true, returns a preview and creates NOTHING", async () => {
    const result = await executeTool(
      "request_training_enrollment",
      { program_name: "TEST-EXEC — Capped Direct Program", confirmed: false },
      liamCtx(),
    );
    const output = result.output as any;
    expect(output.status).toBe("preview");
    expect(output.requires_manager_approval).toBe(false);
    expect(output.seats_available).toBe(1);
    expect(typeof output.confirmation_token).toBe("string");

    const { count } = await client!
      .from("training_registrations")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", liamId!)
      .eq("program_id", cappedProgramId!);
    expect(count).toBe(0);
  });

  it.skipIf(!hasCreds)("confirmed=true WITHOUT a valid token falls back to preview — never creates a registration", async () => {
    const result = await executeTool(
      "request_training_enrollment",
      { program_name: "TEST-EXEC — Capped Direct Program", confirmed: true, confirmation_token: "forged-or-missing" },
      liamCtx(),
    );
    expect((result.output as any).status).toBe("preview");

    const { count } = await client!
      .from("training_registrations")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", liamId!)
      .eq("program_id", cappedProgramId!);
    expect(count).toBe(0);
  });

  it.skipIf(!hasCreds)("a token computed for a DIFFERENT program cannot authorize this one", async () => {
    const staleToken = computeEnrollmentToken(liamId!, "some-other-program-id");
    const result = await executeTool(
      "request_training_enrollment",
      { program_name: "TEST-EXEC — Capped Direct Program", confirmed: true, confirmation_token: staleToken },
      liamCtx(),
    );
    expect((result.output as any).status).toBe("preview");
  });

  it.skipIf(!hasCreds)("confirmed=true WITH the correct token creates a real registration and decrements the seat", async () => {
    const preview = await executeTool(
      "request_training_enrollment",
      { program_name: "TEST-EXEC — Capped Direct Program", confirmed: false },
      liamCtx(),
    );
    const token = (preview.output as any).confirmation_token as string;

    const result = await executeTool(
      "request_training_enrollment",
      { program_name: "TEST-EXEC — Capped Direct Program", confirmed: true, confirmation_token: token },
      liamCtx(),
    );
    const output = result.output as any;
    expect(output.status).toBe("confirmed");
    expect(output.registration_id).toBeTruthy();

    const { data: row } = await client!.from("training_registrations").select("employee_id, status").eq("id", output.registration_id).single();
    expect(row?.employee_id).toBe(liamId);
    expect(row?.status).toBe("confirmed");

    const { data: program } = await client!.from("training_programs").select("seats_available").eq("id", cappedProgramId!).single();
    expect(program?.seats_available).toBe(0);
  });

  it.skipIf(!hasCreds)("retrying the same confirmed call does not create a duplicate registration or double-decrement seats (idempotency)", async () => {
    const preview = await executeTool(
      "request_training_enrollment",
      { program_name: "TEST-EXEC — Capped Direct Program", confirmed: false },
      liamCtx(),
    );
    const token = (preview.output as any).confirmation_token as string;
    const result = await executeTool(
      "request_training_enrollment",
      { program_name: "TEST-EXEC — Capped Direct Program", confirmed: true, confirmation_token: token },
      liamCtx(),
    );
    expect((result.output as any).status).toBe("already_registered");

    const { count } = await client!
      .from("training_registrations")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", liamId!)
      .eq("program_id", cappedProgramId!);
    expect(count).toBe(1);

    const { data: program } = await client!.from("training_programs").select("seats_available").eq("id", cappedProgramId!).single();
    expect(program?.seats_available).toBe(0); // still 0 — not decremented a second time
  });
});

describe("get_my_training / get_my_hr_requests — identity boundary via the executor", () => {
  it.skipIf(!hasCreds)("Liam's registrations never include another employee's, and tool input cannot override the session employee", async () => {
    const result = await executeTool("get_my_training", { employee_id: rahulId }, liamCtx());
    const registrations = (result.output as any).registrations as Array<{ programId: string }>;
    expect(registrations.some((r) => r.programId === cappedProgramId)).toBe(true);

    // Cross-check via a fresh executeTool call scoped to Rahul directly —
    // he must NOT see Liam's registration for this program.
    const rahulResult = await executeTool("get_my_training", {}, { employeeId: rahulId!, employeeFullName: "Rahul Verma", conversationId: liamConversationId! });
    const rahulRegistrations = (rahulResult.output as any).registrations as Array<{ programId: string }>;
    expect(rahulRegistrations.some((r) => r.programId === cappedProgramId)).toBe(false);
  });
});

describe("create_mentorship_request / create_coaching_request — validation", () => {
  it.skipIf(!hasCreds)("rejects a missing note rather than logging an empty request", async () => {
    const result = await executeTool("create_mentorship_request", {}, liamCtx());
    expect(result.isError).toBe(true);
  });
});
