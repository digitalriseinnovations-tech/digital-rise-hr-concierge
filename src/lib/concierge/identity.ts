import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Minimal employee identity for the Concierge demo — NOT a second auth
 * system. This is a small, purpose-built, HMAC-signed session token
 * (independent of Supabase Auth, which gates the HR/admin `(app)` area via
 * finance_users) that exists only to answer one question: "which employee
 * is this /concierge session for", so escalate_to_hr can attach a real
 * employee_id and conversations can be tagged. It carries no role/
 * permission semantics and grants no access to `(app)`.
 *
 * Deliberately minimal by design (per the sprint brief): the token payload
 * is just {employeeId, exp} — no name, no department, nothing else. The
 * employee's first name (for UI personalization) is looked up fresh from
 * `employees` on each request, never embedded in the token.
 *
 * This is the one intended future swap point for real SSO — see
 * HR_CONCIERGE_SHOWCASE_PLAN.md.
 */

const SESSION_COOKIE_NAME = "concierge_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

interface SessionPayload {
  employeeId: string;
  exp: number; // unix seconds
}

function getSecret(): string {
  const secret = process.env.HR_CONCIERGE_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "HR_CONCIERGE_SESSION_SECRET is not set — cannot issue or verify Concierge sessions.",
    );
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function issueSessionToken(employeeId: string): { token: string; maxAgeSeconds: number } {
  const payload: SessionPayload = {
    employeeId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadEncoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(payloadEncoded);
  return { token: `${payloadEncoded}.${signature}`, maxAgeSeconds: SESSION_TTL_SECONDS };
}

/**
 * Verifies a session token's signature and expiry. Never throws on a bad
 * token — returns null so callers fail closed (redirect to /concierge/
 * identify) rather than crash.
 */
export function verifySessionToken(token: string | undefined | null): { employeeId: string } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadEncoded, signature] = parts;

  let expectedSignature: string;
  try {
    expectedSignature = sign(payloadEncoded);
  } catch {
    return null;
  }

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadEncoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof payload.employeeId !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;

  return { employeeId: payload.employeeId };
}

export { SESSION_COOKIE_NAME };

export interface ConciergeEmployee {
  id: string;
  firstName: string;
  fullName: string;
}

function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/**
 * Two-factor identification: employee_code AND email must both match the
 * same row. A single-factor lookup (code OR email alone) would let anyone
 * enumerate employees by guessing codes — see HR_CONCIERGE_SHOWCASE_PLAN.md
 * security section. Returns null on any mismatch without distinguishing
 * "wrong code" from "wrong email" in the response, so a caller can't use
 * the error to narrow down a guess.
 */
export async function identifyEmployee(employeeCode: string, email: string): Promise<ConciergeEmployee | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("employees")
    .select("id, full_name, employee_code, email, status")
    .eq("employee_code", employeeCode.trim())
    .eq("email", email.trim().toLowerCase())
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) return null;
  return { id: data.id, firstName: firstNameOf(data.full_name), fullName: data.full_name };
}

/** Looks up minimal, display-only identity for an already-verified session. */
export async function getEmployeeById(employeeId: string): Promise<ConciergeEmployee | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("employees")
    .select("id, full_name")
    .eq("id", employeeId)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) return null;
  return { id: data.id, firstName: firstNameOf(data.full_name), fullName: data.full_name };
}
