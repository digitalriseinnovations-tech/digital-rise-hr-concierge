import "server-only";

/**
 * In-memory, per-process rate limiter for the identify endpoint (guards
 * against employee_code/email enumeration). Deliberately simple for a demo
 * — same acceptable tradeoff already documented elsewhere in this
 * workspace (growth-os-app's /api/tts limiter): resets on redeploy/
 * multi-instance, which is fine at demo scale and not a correctness issue
 * for a single-process deployment. Not intended to be the production
 * answer for a real multi-instance deployment.
 */

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 8;

const attempts = new Map<string, number[]>();

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const existing = (attempts.get(key) ?? []).filter((t) => t > windowStart);

  if (existing.length >= MAX_ATTEMPTS_PER_WINDOW) {
    attempts.set(key, existing);
    return true;
  }

  existing.push(now);
  attempts.set(key, existing);
  return false;
}
