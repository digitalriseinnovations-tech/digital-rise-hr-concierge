import { NextResponse } from "next/server";
import { identifyEmployee, issueSessionToken, SESSION_COOKIE_NAME } from "@/lib/concierge/identity";
import { isRateLimited } from "@/lib/concierge/rate-limit";

interface IdentifyBody {
  employee_code?: string;
  email?: string;
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
  if (isRateLimited(`identify:${ip}`)) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }

  let body: IdentifyBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const employeeCode = (body.employee_code ?? "").trim();
  const email = (body.email ?? "").trim();

  if (!employeeCode || !email || !email.includes("@")) {
    return NextResponse.json({ error: "Please enter your employee code and email." }, { status: 400 });
  }

  // Both identifyEmployee() (Supabase lookup) and issueSessionToken()
  // (HMAC signing) can throw on a real misconfiguration — e.g. a missing
  // SUPABASE_SERVICE_ROLE_KEY or HR_CONCIERGE_SESSION_SECRET in this
  // deployment's environment. Previously that exception reached Next.js's
  // own generic error handler, which returns a non-JSON body; the
  // frontend's res.json() then throws and every such failure is
  // misreported to the employee as "Network error", indistinguishable
  // from them simply being offline. Returning real JSON here (same
  // pattern already used by /api/concierge/message's startConversation
  // guard) is what makes a misconfiguration diagnosable from the actual
  // server logs instead of invisible.
  let employee;
  try {
    employee = await identifyEmployee(employeeCode, email);
  } catch (err) {
    console.error("[concierge] identify failed", err);
    return NextResponse.json({ error: "Unable to verify your identity right now. Please try again shortly." }, { status: 500 });
  }

  if (!employee) {
    // Deliberately generic — does not reveal whether the code or the email
    // was the mismatch, to avoid helping an enumeration attempt.
    return NextResponse.json({ error: "We couldn't verify those details. Please check and try again." }, { status: 401 });
  }

  let token: string;
  let maxAgeSeconds: number;
  try {
    ({ token, maxAgeSeconds } = issueSessionToken(employee.id));
  } catch (err) {
    console.error("[concierge] session issuance failed", err);
    return NextResponse.json({ error: "Unable to start your session right now. Please try again shortly." }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true, firstName: employee.firstName });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
  return response;
}
