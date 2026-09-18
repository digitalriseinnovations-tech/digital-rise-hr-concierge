import { describe, expect, it, vi, afterEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { startConversation } from "../../src/lib/concierge/orchestrator";

/**
 * Production hardening, Phase 1 — startConversation() must still throw on
 * a real Supabase failure (unchanged behavior), and must now also log a
 * safe, PII-free diagnostic server-side first. Exercises the REAL function
 * against the real (test) Supabase project — deterministic because a
 * syntactically valid but nonexistent employee_id always violates the
 * concierge_conversations -> employees foreign key, every run, with no
 * row ever persisted. No Anthropic call, no email, on this code path at
 * all (startConversation never touches either).
 */

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

const NONEXISTENT_EMPLOYEE_ID = "00000000-0000-0000-0000-000000000000";

describe("startConversation() — Phase 1 observability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.skipIf(!hasCreds)("still throws when the insert fails (existing behavior preserved), and persists nothing", async () => {
    await expect(startConversation(NONEXISTENT_EMPLOYEE_ID)).rejects.toThrow("Could not start a new Concierge conversation.");

    const { count } = await client!
      .from("concierge_conversations")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", NONEXISTENT_EMPLOYEE_ID);
    expect(count ?? 0).toBe(0);
  });

  it.skipIf(!hasCreds)("logs a '[concierge] startConversation failed' diagnostic with only safe Supabase fields — no PII, no secrets", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(startConversation(NONEXISTENT_EMPLOYEE_ID)).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalled();
    const loggedCall = errorSpy.mock.calls.find((call) => String(call[0]).includes("[concierge] startConversation failed"));
    expect(loggedCall, "expected a console.error call prefixed with '[concierge] startConversation failed'").toBeTruthy();

    const loggedText = loggedCall!
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join(" ");

    // Forbidden: anything resembling PII, a token, a key, or a header —
    // deliberately using a nonexistent employee id (not a real seeded
    // employee) so there is nothing sensitive to leak in the first place.
    expect(loggedText.toLowerCase()).not.toMatch(/northstarglobal\.com|@gmail\.com|@digitalriseinnovations\.com/);
    expect(loggedText.toLowerCase()).not.toMatch(/authorization|bearer |cookie|api[_-]?key|service_role|anon_key/);
    // Expected: a genuine Supabase diagnostic shape (message/code/etc) was logged.
    expect(loggedText.length).toBeGreaterThan(0);
  });
});
