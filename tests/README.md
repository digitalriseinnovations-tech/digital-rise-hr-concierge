# Running tests

## Normal tests (default — always safe)

```
npx vitest run
```

- **$0 Anthropic usage.** Every live-model test is skipped by default,
  regardless of whether a real `ANTHROPIC_API_KEY` is present in
  `.env.local` — presence of the key alone is deliberately NOT enough to
  run them.
- Also **$0 email usage** — `src/lib/email.ts` never touches real SMTP
  under test (see `tests/platform/email-test-safety.test.ts`).
- Deterministic, safe to run repeatedly, locally or in CI.

## Live-model evaluation (explicit opt-in — may be billable)

```
CONCIERGE_ALLOW_LIVE_MODEL_TESTS=1 npx vitest run tests/concierge/orchestrator.test.ts \
  tests/concierge/leave-orchestrator.test.ts \
  tests/concierge/learning-orchestrator.test.ts \
  tests/concierge/confirmation-reliability.test.ts \
  tests/concierge/http-routing.test.ts
```

- These tests validate genuine, non-deterministic Claude behavior
  (grounding, escalation, prompt-injection resistance, confirmation
  reliability under real sampling) that a mocked model cannot verify.
- **May consume real Anthropic API credits** — every call uses Haiku
  (cheap), but this is still real, billable usage. Run deliberately, not by
  habit.
- Requires both `CONCIERGE_ALLOW_LIVE_MODEL_TESTS=1` for that invocation
  AND a real `ANTHROPIC_API_KEY` in `.env.local` — neither alone is
  sufficient. Unset the variable (or just omit it) to go back to $0 default
  testing.
- `tests/concierge/http-routing.test.ts` additionally requires a locally
  running `npm run dev` server for its HTTP-mediated tests — a running dev
  server is a *separate process* from Vitest and is not itself gated by
  `CONCIERGE_ALLOW_LIVE_MODEL_TESTS`, so the test file gates itself instead.

See `src/lib/concierge/anthropic-client.ts` and
`tests/platform/anthropic-test-safety.test.ts` for how this boundary is
enforced structurally, not just by test-file convention.
