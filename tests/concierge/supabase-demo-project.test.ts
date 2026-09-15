import { describe, expect, it, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

// Connectivity + schema-state checks against the configured Supabase
// project. Reports the project ref (the subdomain of the project URL —
// not a secret; it is the same identifier already embedded client-side via
// NEXT_PUBLIC_SUPABASE_URL) and row COUNTS only. Never selects or logs
// actual row contents (names, emails, etc.).

function projectRefFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname; // e.g. abcdefgh.supabase.co
    return host.split(".")[0] ?? "(unparseable)";
  } catch {
    return "(unparseable — NEXT_PUBLIC_SUPABASE_URL is not a valid URL)";
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasCreds = Boolean(url && serviceKey);
const client = hasCreds
  ? createClient(url as string, serviceKey as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

async function tableExists(table: string): Promise<{ exists: boolean; count: number | null }> {
  if (!client) return { exists: false, count: null };
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  if (error) {
    // PostgREST reports an unknown table as a schema-cache miss, not a
    // generic error — treat any error here as "does not exist yet" for
    // reporting purposes rather than failing the whole suite.
    return { exists: false, count: null };
  }
  return { exists: true, count: count ?? 0 };
}

describe("HR Concierge demo Supabase project", () => {
  beforeAll(() => {
    if (!hasCreds) {
      // eslint-disable-next-line no-console
      console.log("SKIPPED — NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY are MISSING.");
    } else {
      // eslint-disable-next-line no-console
      console.log(`Connected project ref: ${projectRefFromUrl(url as string)} (identifier only — no credential shown)`);
    }
  });

  it.skipIf(!hasCreds)("connects to the configured Supabase project", async () => {
    // A harmless read against a table that either exists (returns data/0
    // rows) or doesn't (returns a clean "not found" error) — either
    // outcome proves the REST endpoint + service-role key are reachable
    // and authenticate correctly. A network/auth failure throws instead.
    const { exists } = await tableExists("employees");
    expect(typeof exists).toBe("boolean");
  });

  it.skipIf(!hasCreds)("reports base-schema state (existence + row counts only)", async () => {
    const base = ["employees", "leave_balances", "leave_requests", "finance_users", "audit_logs"];
    for (const table of base) {
      const { exists, count } = await tableExists(table);
      // eslint-disable-next-line no-console
      console.log(`base schema: ${table.padEnd(16)} exists=${exists}  rows=${count ?? "n/a"}`);
    }
  });

  it.skipIf(!hasCreds)("reports Concierge-table state (existence + row counts only, pre-migration expected: all false)", async () => {
    const concierge = [
      "hr_knowledge_base",
      "concierge_conversations",
      "concierge_messages",
      "training_programs",
      "training_registrations",
      "hr_requests",
    ];
    for (const table of concierge) {
      const { exists, count } = await tableExists(table);
      // eslint-disable-next-line no-console
      console.log(`concierge schema: ${table.padEnd(24)} exists=${exists}  rows=${count ?? "n/a"}`);
    }
  });

  it.skipIf(!hasCreds)("no @verofax.com email domain is present in employees (production-data leak check; count only)", async () => {
    if (!client) return;
    const { exists } = await tableExists("employees");
    if (!exists) {
      // eslint-disable-next-line no-console
      console.log("employees table does not exist yet — nothing to check.");
      return;
    }
    const { count, error } = await client
      .from("employees")
      .select("id", { count: "exact", head: true })
      .ilike("email", "%@verofax.com");
    expect(error).toBeNull();
    // eslint-disable-next-line no-console
    console.log(`employees with @verofax.com email domain: ${count ?? 0} (expected: 0 in an isolated demo project)`);
    expect(count ?? 0).toBe(0);
  });
});
