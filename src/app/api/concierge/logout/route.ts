import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/concierge/identity";

/**
 * Clears the employee's concierge_session cookie — HR-product-scoped only,
 * entirely independent of Supabase Auth staff sessions (sidebar.tsx's own
 * signOut() is the separate staff-side equivalent). Deliberately a POST,
 * not a GET, so it can't be triggered by prefetching/crawling a link.
 *
 * Clearing options here MUST mirror exactly how the cookie was set in
 * /api/concierge/identify (httpOnly, secure in production, sameSite=lax,
 * path=/) — a mismatched path/attribute would silently fail to clear it in
 * some browsers.
 */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
