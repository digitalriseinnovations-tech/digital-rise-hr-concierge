import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Adapted from digital-rise-ai-employees/lib/ai/anthropic-client.ts — same
 * pattern (official SDK direct, no multi-provider abstraction, cached
 * singleton client), same model-choice rationale: this employee's task
 * (answer from a small knowledge base, pick from a 5-tool allow-list) is
 * narrow and structured, not open-ended reasoning, so Haiku is the right
 * default — not Sonnet.
 */

// Test-runtime safety boundary — NOT a product/deployment setting (do not
// base this on APP_PRODUCT_MODE), mirroring the equivalent guard in
// src/lib/email.ts. Vitest sets process.env.VITEST for every test process
// automatically, with no per-file opt-in required; NODE_ENV "test" is
// checked too as a second, independent signal.
export function isTestRuntime(): boolean {
  return Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";
}

// The ONLY way a real, network-capable Anthropic client can be constructed
// under test — must be set deliberately per invocation, never left on, and
// is meaningless (ignored) outside a test runtime. This must stay false for
// every ordinary `npx vitest run`, regardless of what real-looking
// ANTHROPIC_API_KEY happens to be present in .env.local, since that same
// file is loaded by both `npm run dev` and every test run (see
// tests/setup/load-env.ts).
export function liveModelTestsExplicitlyAllowed(): boolean {
  return process.env.CONCIERGE_ALLOW_LIVE_MODEL_TESTS === "1";
}

let cachedClient: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (isTestRuntime() && !liveModelTestsExplicitlyAllowed()) {
    throw new Error(
      "[concierge] getAnthropicClient() blocked under test — real Anthropic client construction requires " +
        "CONCIERGE_ALLOW_LIVE_MODEL_TESTS=1 for this invocation. Default `npx vitest run` must never call the " +
        "real Anthropic API, even when a real ANTHROPIC_API_KEY is present in .env.local.",
    );
  }
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — HR Concierge cannot reason without it.");
  }
  // Force Node's native fetch instead of the SDK's bundled node-fetch@2.
  // Confirmed by direct testing: node-fetch@2's gzip/stream handling
  // throws "Premature close" (ERR_STREAM_PREMATURE_CLOSE) against the
  // Anthropic API's response in this Node runtime, on every call, 100%
  // reproducible — native fetch (stable in Node 18+) does not have this
  // problem. Without this override, every Concierge call would silently
  // fail into the orchestrator's generic error fallback.
  cachedClient = new Anthropic({ apiKey, fetch: globalThis.fetch as unknown as typeof fetch });
  return cachedClient;
}

export const CONCIERGE_AI_MODEL = process.env.HR_CONCIERGE_AI_MODEL || "claude-haiku-4-5-20251001";
