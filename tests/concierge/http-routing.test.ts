import { describe, expect, it } from "vitest";

/**
 * Real HTTP-level regression test against the running dev server —
 * deliberately NOT calling the underlying functions directly (every other
 * test file does that). This exists because a real bug slipped past the
 * entire rest of the suite during Slice 3 development: the existing
 * src/proxy.ts middleware's PUBLIC_PREFIXES allow-list didn't include
 * /concierge or /api/concierge, so every Concierge route was silently
 * redirected to /login — invisible to any test that calls
 * runConciergeTurn()/identifyEmployee() etc. directly, since those never
 * go through Next.js routing/middleware at all. This test would have
 * caught that immediately.
 *
 * Requires a running server at NEXT_PUBLIC_SITE_URL (same requirement
 * create_leave_request already has for reaching /api/leave-submit).
 */

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
// SAFETY: a locally running `npm run dev` server is a SEPARATE OS process
// from Vitest — it does NOT have process.env.VITEST set, so the guard in
// src/lib/concierge/anthropic-client.ts does not see it as a test runtime
// and would NOT block a real Anthropic call made from inside that server
// process. The one test below that POSTs to /api/concierge/message (a real
// chat turn) is therefore gated on the same explicit live-model opt-in as
// every other live-model test, so default `npx vitest run` can never
// accidentally cause a running dev server to spend real Anthropic credits.
const liveModelTestsEnabled = process.env.CONCIERGE_ALLOW_LIVE_MODEL_TESTS === "1";

async function serverIsUp(): Promise<boolean> {
  try {
    const res = await fetch(baseUrl, { method: "GET" });
    return res.status < 500;
  } catch {
    return false;
  }
}

describe("Concierge HTTP routes are actually reachable (not middleware-blocked)", () => {
  it.skipIf(!hasCreds)("the dev server is reachable at NEXT_PUBLIC_SITE_URL (precondition for this file's other tests)", async () => {
    expect(await serverIsUp()).toBe(true);
  });

  it("/api/concierge/identify is NOT redirected to /login by the auth middleware", async () => {
    if (!(await serverIsUp())) return; // covered by the precondition test above
    const res = await fetch(`${baseUrl}/api/concierge/identify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_code: "does-not-exist", email: "nobody@example.com" }),
      redirect: "manual",
    });
    // A bad identity should get a real 401 JSON error from the route
    // itself, never a 307 redirect to /login (that would mean the
    // middleware intercepted it before the route ever ran).
    expect(res.status).not.toBe(307);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });

  it.skipIf(!hasCreds || !liveModelTestsEnabled)("a fully valid identify -> message round trip reaches the real route and returns a grounded reply", async () => {
    if (!(await serverIsUp())) return;
    const idRes = await fetch(`${baseUrl}/api/concierge/identify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_code: "NSG-1001", email: "sarah.ahmed@northstarglobal.com" }),
    });
    expect(idRes.status).toBe(200);
    const setCookie = idRes.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    const cookieHeader = setCookie!.split(";")[0];

    const msgRes = await fetch(`${baseUrl}/api/concierge/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ message: "What is our annual leave policy?" }),
    });
    expect(msgRes.status).toBe(200);
    const body = await msgRes.json();
    expect(typeof body.reply).toBe("string");
    expect(body.reply.length).toBeGreaterThan(0);
  }, 30000);

  it("/api/concierge/message without a session cookie is rejected by the ROUTE (401), not silently redirected", async () => {
    if (!(await serverIsUp())) return;
    const res = await fetch(`${baseUrl}/api/concierge/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
      redirect: "manual",
    });
    expect(res.status).toBe(401);
  });

  // Slice 5 regression: /concierge-insights shares the literal string
  // prefix "/concierge" with the genuinely public employee-facing
  // /concierge routes. proxy.ts's PUBLIC_PREFIXES matcher used to do a
  // bare pathname.startsWith(p) check, which meant "/concierge-insights"
  // matched the "/concierge" public prefix too — a staff-only admin route
  // would have been reachable with NO authentication at all. Fixed by
  // requiring an exact match or a "/"-segment boundary. This test exists
  // specifically so that regression can never silently return.
  for (const staffRoute of ["/concierge-insights", "/employee-requests", "/hr-learning", "/hr-knowledge"]) {
    it(`${staffRoute} (staff-only admin route) IS redirected to /login without a staff session — never publicly reachable`, async () => {
      if (!(await serverIsUp())) return;
      const res = await fetch(`${baseUrl}${staffRoute}`, { method: "GET", redirect: "manual" });
      expect([307, 302]).toContain(res.status);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("/login");
    });
  }

  it("/concierge (employee-facing) is NOT redirected to /login — confirms the fix didn't over-correct", async () => {
    if (!(await serverIsUp())) return;
    const res = await fetch(`${baseUrl}/concierge`, { method: "GET", redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    expect(location).not.toContain("/login");
  });
});
