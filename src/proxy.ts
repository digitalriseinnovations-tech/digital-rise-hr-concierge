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

  // Next.js statically inlines any `process.env.NEXT_PUBLIC_X` DOT-ACCESS
  // at BUILD TIME, replacing it with a literal — see Next.js's own
  // environment-variables guide: "Note that dynamic lookups will NOT be
  // inlined... const env = process.env; setupAnalyticsService(env.X)".
  // Proxy's own docs separately note it "is meant to be invoked separately
  // of your render code... you should not attempt relying on shared
  // modules or globals" and "in optimized cases [is] deployed to your
  // CDN" — i.e. it can be compiled through a genuinely separate pipeline
  // from the rest of the app. If THAT specific compilation step didn't
  // see these vars, the inlined value is frozen as `undefined` forever,
  // regardless of what's configured in the Production environment now —
  // which matches this bug surviving a full rebuild with correctly-scoped
  // vars already saved. Proxy defaults to the Node.js runtime (Next.js
  // 16), which normally receives the FULL runtime environment Vercel
  // injects — so reading through a variable (the documented way to defeat
  // inlining) makes Proxy check the real, live runtime value instead of
  // whatever got baked into this specific bundle at build time.
  const env = process.env;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Fail-fast, safe configuration check — logs ONLY booleans, never the
  // actual URL/key, so Vercel's runtime logs can show exactly which named
  // variable this execution is missing without exposing any secret. Fails
  // CLOSED (a generic 500, not the raw Supabase SDK error) rather than
  // silently proceeding — this middleware is the staff-auth gate for
  // every payroll/HR-admin route, so a misconfiguration must never be
  // allowed to fail open.
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      `[proxy] Supabase configuration missing in this execution context — ` +
        `hasSupabaseUrl=${Boolean(supabaseUrl)} hasSupabaseAnonKey=${Boolean(supabaseAnonKey)}. ` +
        "Verify NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set for this environment on the deployment platform.",
    );
    return new NextResponse("Service temporarily unavailable.", { status: 500 });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
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
