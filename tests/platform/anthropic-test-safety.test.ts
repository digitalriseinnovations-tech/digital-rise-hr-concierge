import { describe, expect, it, vi } from "vitest";

/**
 * Regression coverage for the test-runtime Anthropic safety guard.
 *
 * Root cause this guards against: `.env.local` supplies a real
 * ANTHROPIC_API_KEY, and that SAME file is loaded by both `npm run dev` and
 * `npx vitest run` (tests/setup/load-env.ts makes no dev/test distinction —
 * see the identical root cause behind tests/platform/email-test-safety.test.ts).
 * Before this fix, src/lib/concierge/anthropic-client.ts's
 * getAnthropicClient() had no test-environment guard, and several
 * orchestrator test files gated their live-model tests on ANTHROPIC_API_KEY
 * merely being *present* rather than on an explicit opt-in — so a normal
 * `npx vitest run` made an estimated 25-45 real, paid Anthropic API calls.
 *
 * This file proves the guard is structural: even with a real-looking
 * ANTHROPIC_API_KEY present (as it is for this entire suite, via
 * .env.local) and no explicit opt-in set, no real Anthropic client is ever
 * constructed and no network request is ever attempted while running under
 * Vitest. This test itself makes ZERO real Anthropic calls.
 */

describe("Anthropic test-runtime safety guard", () => {
  it("isTestRuntime() is true under this actual Vitest process", async () => {
    const { isTestRuntime } = await import("../../src/lib/concierge/anthropic-client");
    expect(isTestRuntime()).toBe(true);
    expect(Boolean(process.env.VITEST)).toBe(true);
  });

  it("liveModelTestsExplicitlyAllowed() is false in this verification run (CONCIERGE_ALLOW_LIVE_MODEL_TESTS is not set)", async () => {
    const { liveModelTestsExplicitlyAllowed } = await import("../../src/lib/concierge/anthropic-client");
    expect(process.env.CONCIERGE_ALLOW_LIVE_MODEL_TESTS).not.toBe("1");
    expect(liveModelTestsExplicitlyAllowed()).toBe(false);
  });

  it("getAnthropicClient() throws under test even though a real-looking ANTHROPIC_API_KEY IS present, and never touches fetch", async () => {
    // Confirms the guard fires for the right reason: a present, valid-looking
    // key that would otherwise let a real client be constructed.
    expect(process.env.ANTHROPIC_API_KEY).toBeTruthy();

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { getAnthropicClient } = await import("../../src/lib/concierge/anthropic-client");

    expect(() => getAnthropicClient()).toThrow(/blocked under test/i);
    expect(() => getAnthropicClient()).toThrow(/CONCIERGE_ALLOW_LIVE_MODEL_TESTS/);

    // No SDK call reached the network layer — the throw happens before the
    // Anthropic client (and therefore any request) is ever constructed.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("the module does not expose a way to bypass the guard and reach a cached/real client directly", async () => {
    const anthropicClientModule = await import("../../src/lib/concierge/anthropic-client");
    // cachedClient is module-private — the only export capable of returning
    // a client is getAnthropicClient() itself, which is already proven above
    // to refuse under test.
    expect((anthropicClientModule as Record<string, unknown>).cachedClient).toBeUndefined();
  });
});
