import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PREFIXES = [
  "/login",
  "/auth",
  "/_next",
  "/favicon.ico",
  // Public leave-request flow — employees submit + managers approve without login
  "/leave-request",
  "/leave-decision",
  "/api/leave-submit",
  // HR Concierge — employees verify their own identity (code + email) and
  // chat, entirely separate from Supabase Auth/finance_users staff login.
  "/concierge",
  "/api/concierge",
];

// Exact match, or match followed by a path separator, ONLY — never a bare
// startsWith(p). A bare startsWith would (and, until this fix, actually
// did) treat "/concierge-insights" — a staff-only admin route — as public
// just because it shares the "/concierge" string prefix with the genuinely
// public employee-facing "/concierge" routes. Every PUBLIC_PREFIXES entry
// must be exact-or-segment-matched, including "/favicon.ico" (a file, not
// a directory) — this is the staff-auth gate; get it precise.
function isPublic(pathname: string): boolean {
  for (const p of PUBLIC_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return true;
  }
  return false;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Additional gate: user must exist in finance_users table.
  // Done here as a hard short-circuit BEFORE the page renders so unauthorized
  // users can never even reach Server Components that touch payroll data.
  const { data: financeUser } = await supabase
    .from("finance_users")
    .select("role, active")
    .eq("email", user.email)
    .maybeSingle();

  if (!financeUser || !financeUser.active) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "no_access");
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
