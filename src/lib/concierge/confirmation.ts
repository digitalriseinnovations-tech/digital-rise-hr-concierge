import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Generic confirmation-token utility — extracted out of leave.ts so
 * training enrollment (and any future write action) can use the exact
 * same preview-then-confirm binding without a second implementation. A
 * token is an HMAC over an ordered list of the specific action's details;
 * it can never authorize a different set of details, regardless of which
 * domain module computed it.
 */

function tokenSecret(): string {
  const secret = process.env.HR_CONCIERGE_SESSION_SECRET;
  if (!secret) throw new Error("HR_CONCIERGE_SESSION_SECRET is not set.");
  return secret;
}

export function computeConfirmationToken(parts: Array<string | number>): string {
  const payload = parts.join("|");
  return createHmac("sha256", tokenSecret()).update(payload).digest("base64url").slice(0, 16);
}

export function verifyConfirmationToken(token: string | undefined, parts: Array<string | number>): boolean {
  if (!token) return false;
  const expected = computeConfirmationToken(parts);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
