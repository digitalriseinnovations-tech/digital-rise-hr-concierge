import { describe, expect, it } from "vitest";

/**
 * TAQA Demo Sprint — Phase 0 safety gate finding.
 *
 * submitLeaveRequest() (src/lib/concierge/leave.ts) makes a REAL fetch()
 * to NEXT_PUBLIC_SITE_URL + /api/leave-submit — a genuine network hop, not
 * an in-process call. Unlike code that runs inside the Vitest worker
 * itself, a request handled by a separately running `next dev` server
 * executes in THAT process, which never has process.env.VITEST set and
 * has NODE_ENV=development (Next.js sets this itself), not "test". The
 * email test-runtime guard (isTestRuntime() in src/lib/email.ts) is
 * therefore blind to this case — a leave-request confirmation test could
 * silently send a real email to a real manager address whenever a
 * developer happened to have `npm run dev` running locally, completely
 * independent of Vitest's own env and NOT gated behind
 * CONCIERGE_ALLOW_LIVE_MODEL_TESTS.
 *
 * Fixed by gating every test that completes a real confirmed leave
 * submission (leave-tool-executor.test.ts x2, manager-approval-flow.test.ts
 * x3, leave-confirmation-transaction.test.ts x2) behind the same explicit
 * opt-in already used for live-model tests — the underlying risk (an
 * uncontrolled real external side effect) is the same class, even though
 * the specific mechanism here is a real HTTP hop rather than a real
 * Anthropic call.
 *
 * This file is a standing regression guard: it fails loudly if the opt-in
 * is ever accidentally left on in a default run, which is the one
 * condition that would re-open this exact gap.
 */
describe("Live-server test safety — CONCIERGE_ALLOW_LIVE_MODEL_TESTS gates real /api/leave-submit hops too", () => {
  it("the opt-in is not set in a default test run", () => {
    expect(process.env.CONCIERGE_ALLOW_LIVE_MODEL_TESTS).not.toBe("1");
  });

  it("a dev server, if running, is a genuinely separate process without test-runtime env — documented, not simulated", () => {
    // This assertion is about THIS process (the Vitest worker), which
    // DOES correctly report itself as a test runtime — proving the guard
    // works correctly for code that runs here. The actual gap this file
    // documents is about a DIFFERENT process (a separately running dev
    // server) that this test process has no visibility into and cannot
    // safely probe without risking a real request — that's exactly why
    // the fix is at the test-gating level (skip unless explicitly opted
    // in), not something provable by asserting on this process's own env.
    expect(Boolean(process.env.VITEST)).toBe(true);
  });
});
