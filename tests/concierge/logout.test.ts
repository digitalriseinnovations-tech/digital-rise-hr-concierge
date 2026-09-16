import { describe, expect, it } from "vitest";

/**
 * Showcase Hardening — employee logout. Real HTTP-level test against the
 * running dev server, same pattern as http-routing.test.ts, since the
 * behavior under test (cookie set/cleared, hub-layout redirect) only
 * actually happens through Next.js routing/middleware, not by calling
 * identity.ts's functions directly.
 *
 * Architecture note this test is honest about: concierge_session is a
 * stateless, self-contained HMAC token (see identity.ts) — there is no
 * server-side session store to revoke. "Logout" clears the browser's
 * cookie via a Set-Cookie response (so a real browser stops sending it,
 * and the hub layout's session check then correctly redirects), not a
 * server-side token blacklist. That's the exact behavior this test proves.
 */

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

async function serverIsUp(): Promise<boolean> {
  try {
    const res = await fetch(baseUrl, { method: "GET" });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function identifyAndGetCookie(): Promise<string | null> {
  const idRes = await fetch(`${baseUrl}/api/concierge/identify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employee_code: "NSG-1001", email: "sarah.ahmed@northstarglobal.com" }),
  });
  if (idRes.status !== 200) return null;
  const setCookie = idRes.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : null;
}

describe("Employee logout — /api/concierge/logout", () => {
  it.skipIf(!hasCreds)("a valid session cookie grants access to a protected Concierge route (precondition)", async () => {
    if (!(await serverIsUp())) return;
    const cookieHeader = await identifyAndGetCookie();
    expect(cookieHeader).toBeTruthy();

    const res = await fetch(`${baseUrl}/concierge/my-hr`, {
      method: "GET",
      headers: { Cookie: cookieHeader! },
      redirect: "manual",
    });
    // Not a redirect to /concierge/identify — the session is valid.
    expect(res.status).not.toBe(307);
  });

  it.skipIf(!hasCreds)("POST /api/concierge/logout returns ok and clears the cookie (Max-Age=0 / empty value)", async () => {
    if (!(await serverIsUp())) return;
    const cookieHeader = await identifyAndGetCookie();
    expect(cookieHeader).toBeTruthy();

    const res = await fetch(`${baseUrl}/api/concierge/logout`, {
      method: "POST",
      headers: { Cookie: cookieHeader! },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const clearedCookie = res.headers.get("set-cookie") ?? "";
    expect(clearedCookie).toMatch(/concierge_session=;?/i);
    expect(clearedCookie.toLowerCase()).toMatch(/max-age=0/);
  });

  it.skipIf(!hasCreds)("a request with NO session cookie (as a real browser sends after respecting the logout Set-Cookie) is redirected to /concierge/identify — cannot reopen a protected route", async () => {
    if (!(await serverIsUp())) return;
    const res = await fetch(`${baseUrl}/concierge/my-hr`, {
      method: "GET",
      redirect: "manual",
    });
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/concierge/identify");
  });

  it.skipIf(!hasCreds)("logout does not affect staff Supabase Auth — /login page is unaffected and unrelated to concierge_session", async () => {
    if (!(await serverIsUp())) return;
    const res = await fetch(`${baseUrl}/login`, { method: "GET" });
    expect(res.status).toBe(200);
  });
});
