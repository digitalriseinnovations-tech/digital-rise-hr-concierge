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

let cachedClient: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
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
