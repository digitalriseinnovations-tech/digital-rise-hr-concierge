# Microsoft Copilot Integration — Architecture & Readiness

TAQA's stated long-term requirement: employees should reach the HR AI Employee through their **existing Microsoft 365 Copilot / Teams experience**, not a separate app they have to learn. This document explains how that connects to what already exists in this codebase, what's realistic to show in a demo, and what genuinely requires TAQA's own Microsoft tenant/admin involvement.

## Architecture

```
Microsoft 365 Copilot / Teams
        ↓  (Copilot Studio "action" — an HTTP call the Copilot runtime makes)
Digital Rise integration / API layer
   src/app/api/integrations/copilot/*
        ↓  (reuses the SAME functions the employee chat UI already calls)
HR AI Employee
   src/lib/concierge/orchestrator.ts (runConciergeTurn)
        ↓
HR knowledge + employee data + HR actions
   Supabase: employees, leave_requests, training_registrations, hr_requests, hr_knowledge_base
```

The integration layer is deliberately thin. It does not reimplement anything — every endpoint calls the exact same library functions (`identifyEmployee`, `getMyLeaveBalance`, `runConciergeTurn`, …) that the employee-facing chat UI already uses, which is why every existing safety property (confirmation-before-write, the Anthropic/email test-runtime guards, idempotency) applies automatically rather than needing to be rebuilt for a second surface.

## What's implemented right now (demo-grade)

Three endpoints under `src/app/api/integrations/copilot/`, each requiring an `X-Copilot-Api-Key` header matched against `COPILOT_INTEGRATION_API_KEY` (a Vercel env var, unset by default — the endpoints fail closed with 401 if it's not configured, not bypassed):

| Endpoint | Method | Reuses | Purpose |
|---|---|---|---|
| `/api/integrations/copilot/employee-context` | GET | `identifyEmployee()` | Resolve `employee_code` + `email` → first name / full name. |
| `/api/integrations/copilot/leave-balance` | GET | `getMyLeaveBalance()` | Read-only leave balance for one leave type. |
| `/api/integrations/copilot/message` | POST | `startConversation()` + `runConciergeTurn()` | The core of the integration — routes a Copilot-relayed message through the real HR Concierge orchestrator and returns its reply. |

Every call re-verifies `employee_code` + `email` (the same two-factor check `/api/concierge/identify` uses) — there is no session cookie here, matching how a stateless Copilot Studio connector action actually calls out.

## Recommended showcase approach

For the TAQA demo itself, **do not attempt a live Copilot Studio connection** — there isn't tenant/admin access to build and test that reliably in two days, and a flaky live integration is worse for credibility than a clear explanation. Instead:

1. Show the architecture diagram above and the three real, working endpoints (e.g. via a `curl`/Postman call during the demo, or screen-shared).
2. Frame it explicitly: "this is the exact API surface a Copilot Studio action would call — the HR AI Employee logic itself doesn't change based on which front-end reaches it."
3. If desired, a **very small custom Teams/Copilot Studio "topic"** calling `/api/integrations/copilot/message` could be built after the demo, once TAQA commits — that's a Copilot Studio configuration task (low-code, inside Microsoft's own tooling), not a codebase task.

## Authentication approach

**For this demo:** a single shared API key (`COPILOT_INTEGRATION_API_KEY`) plus the employee's own `employee_code` + `email`, passed on every call. This proves the integration boundary works without building real Entra auth in a two-day sprint.

**For a real production connector**, this must be replaced with Microsoft Entra ID identity, specifically:
- The Copilot Studio agent/plugin authenticates to this API using an **Entra app registration** (client credentials or, better, **On-Behalf-Of (OBO)** flow so the call carries the *signed-in employee's own identity*, not a shared secret).
- This app would validate the incoming Entra-issued token (audience, issuer, signature) instead of a static API key.
- The employee's identity would come from the validated token's claims (e.g. `upn`/email), not from request-body fields the caller could otherwise forge — removing the need for a client-supplied `email` at all.
- This is a genuine Entra app-registration + consent flow that **requires TAQA's own tenant admin** to set up (registering the app, granting API permissions, configuring OBO) — it cannot be done from this codebase alone.

## Data flow

1. Employee asks a question inside Teams/Copilot.
2. Copilot Studio's configured action calls `POST /api/integrations/copilot/message` with the employee's identity (today: code+email; production: an Entra token) and the message text.
3. This API layer verifies identity, then calls `runConciergeTurn()` — identical to the employee chat UI's own call.
4. The orchestrator grounds its answer in `hr_knowledge_base`, reads/writes `leave_requests` / `training_registrations` / `hr_requests` as needed (with the same preview → confirm architecture for anything consequential), and returns a reply.
5. Copilot Studio renders that reply back to the employee inside Teams.

## Security considerations

- **No service-role credentials ever cross this boundary** — the API layer runs entirely server-side and only ever returns the same shaped responses the employee chat UI already returns; `SUPABASE_SERVICE_ROLE_KEY`/`ANTHROPIC_API_KEY` are never sent to Copilot or logged there.
- **Fails closed**: if `COPILOT_INTEGRATION_API_KEY` isn't set, every endpoint returns 401 — there's no "development bypass" mode.
- **Same confirmation architecture applies**: a leave request or escalation reached via Copilot still requires explicit confirmation before any write, exactly like the chat UI — Copilot cannot silently approve/execute anything the employee-facing product itself wouldn't allow.
- **Rate-limited** the same way `/api/concierge/message` is (in-memory, per-employee, resets per deploy — fine at demo scale, documented as not the production answer for a multi-instance deployment, same caveat as the existing Concierge rate limiter).
- The demo API key is a **shared secret across all employees** — acceptable for a controlled demo, not for production (see the Entra/OBO section above for why).

## What can realistically be connected immediately

- The three REST endpoints above, callable today from any HTTP client (Postman, a script, or a genuinely configured Copilot Studio action) once `COPILOT_INTEGRATION_API_KEY` is set in Vercel.
- Any future read (training assignments, HR knowledge search) follows the exact same pattern — a thin route under `src/app/api/integrations/copilot/` that calls an existing lib function. Adding one is a small, low-risk change, not a new subsystem.

## What requires TAQA tenant/admin access

- Registering an Entra ID application for this integration.
- Granting it the permissions/consent needed for an OBO flow (or whichever auth pattern TAQA's security team prefers).
- Building and publishing the actual Copilot Studio agent/plugin/topic that calls these endpoints.
- Any Teams app packaging/deployment to TAQA's tenant.

None of the above can be done from this codebase — they are Microsoft-tenant-side configuration and access decisions that only TAQA can grant.
