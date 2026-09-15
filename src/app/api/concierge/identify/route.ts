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

  const employee = await identifyEmployee(employeeCode, email);
  if (!employee) {
    // Deliberately generic — does not reveal whether the code or the email
    // was the mismatch, to avoid helping an enumeration attempt.
    return NextResponse.json({ error: "We couldn't verify those details. Please check and try again." }, { status: 401 });
  }

  const { token, maxAgeSeconds } = issueSessionToken(employee.id);
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
