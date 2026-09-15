# HR Concierge — Deployment Checklist

Digital Rise **HR Concierge AI Employee**, deployed independently from the
Verofax Finance product identity, on the same codebase (see the isolation
audit in the Slice 6 report for why a physical repo split isn't needed yet).

This checklist covers exactly what's required to stand up a new HR
Concierge deployment safely. No secret values are included — presence/
absence only.

## 1. Supabase project

- [ ] A dedicated Supabase project for this HR deployment — **never** the
      Verofax Finance production project, and never real Verofax employee
      data. For the showcase this is the existing isolated "HR Concierge
      Demo" project (Northstar Global synthetic data).
- [ ] Schema applied, in order: `supabase/schema.sql` →
      `supabase/migration_002_leave.sql` →
      `supabase/migration_007_submitter_email.sql` →
      `supabase/migration_008_hr_concierge_core.sql`
      (or `supabase/HR_CONCIERGE_DEMO_BOOTSTRAP.sql`, which bundles exactly
      those in one file — see its header comment for what it deliberately
      excludes).
- [ ] Seed data applied for a demo/showcase deployment:
      `supabase/seed_hr_concierge_demo.sql` (12 fictional Northstar Global
      employees, 20 HR knowledge entries, 4 training programs). Skip for a
      real customer deployment — seed their own data instead.
- [ ] At least one row in `finance_users` with `role = 'hr'` (or `'admin'`)
      and `active = true`, for the HR admin screens' staff login. (Table
      name is legacy-only — see the audit's Type C note; it is the
      general staff-auth table, not Finance-specific data.)

## 2. Environment variables

All required variables are enumerated in code at
`src/lib/concierge/env.ts` (`REQUIRED_CONCIERGE_ENV_VARS`) — that file is
the source of truth; this checklist mirrors it. `.env.example` has been
updated to include every one of them with guidance.

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | This deployment's Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only secret — never expose client-side |
| `GMAIL_USER` | Yes | Sends leave-approval + HR escalation emails |
| `GMAIL_APP_PASSWORD` | Yes | Gmail App Password, not the account password |
| `GMAIL_FROM_NAME` | Yes | Shown as the email sender name — see §5 known limitation |
| `NEXT_PUBLIC_SITE_URL` | Yes | **This** deployment's own URL — see §3 |
| `ANTHROPIC_API_KEY` | Yes | Powers the Concierge's reasoning/tool-use loop |
| `HR_CONCIERGE_SESSION_SECRET` | Yes | Signs employee session cookies — generate with `openssl rand -base64 32`, unique per deployment |
| `HR_CONCIERGE_ESCALATION_EMAIL` | Yes | Inbox that receives "escalate to HR" notifications |
| `HR_CONCIERGE_AI_MODEL` | No | Defaults to `claude-haiku-4-5-20251001` if unset |
| `APP_PRODUCT_MODE` | **Yes, for HR** | Set to `hr` — see §5a. Defaults to Finance branding if unset. |

Verify at runtime with the existing check: `checkConciergeEnv()` /
`assertConciergeEnv()` in `src/lib/concierge/env.ts` — already exercised
by `tests/concierge/environment.test.ts`, which reports PRESENT/MISSING
per variable without ever printing a value.

## 3. `NEXT_PUBLIC_SITE_URL`

Already fully decoupled from both the Finance app's own identity and the
Supabase URL (confirmed in the isolation audit — only 2 call sites in the
whole codebase: `src/lib/email.ts` for building leave-approval links, and
`src/lib/concierge/leave.ts` for the server-to-server call to this same
app's own `/api/leave-submit`). No code change was needed here — just set
it correctly per environment:

- Local dev: `http://localhost:3000`
- HR Concierge production: this deployment's own URL, e.g.
  `https://hr.digitalriseinnovations.com` (see the URL-strategy
  recommendation in the Slice 6 report) — **never** the Finance app's URL,
  **never** the Supabase project URL.

## 4. Build & deploy

- [ ] `npm run build` completes cleanly (Next.js 16 / Turbopack).
- [ ] `npx tsc --noEmit` completes cleanly.
- [ ] Deploy target serves the whole Next.js app (this is one codebase,
      not two) — the HR/Finance separation is by role-based navigation and
      route access, not by separate builds, so standard Next.js hosting
      (e.g. Vercel) works unchanged.
- [ ] Confirm `src/proxy.ts`'s `PUBLIC_PREFIXES` allow-list still contains
      exactly `/concierge` and `/api/concierge` for the employee-facing
      surface, and that no HR-admin route (`/concierge-insights`,
      `/hr-knowledge`, `/hr-learning`, `/employee-requests`) accidentally
      matches a public prefix — this exact class of bug (a route name
      collision with the `/concierge` prefix) was caught and fixed in
      Slice 5; `tests/concierge/http-routing.test.ts` guards against it
      recurring.

## 5a. Shared leave-approval branding (`APP_PRODUCT_MODE`) — fixed in Slice 7

The manager-approval email (`sendLeaveRequestToManager` /
`sendLeaveDecisionToEmployee` in `src/lib/email.ts`) and the
`/leave-decision/[token]` page are genuinely **shared** with the legacy
Finance leave-request flow — same token security, same approve/reject
logic, same race protection, same balance deduction, same audit trail; only
branding text changed. Controlled by `src/lib/product-mode.ts`
(`getProductBranding()`), driven by one deployment-level env var:

- [ ] `APP_PRODUCT_MODE=hr` is set for this deployment — managers approving
      an HR-originated leave request see "Digital Rise HR Concierge" in the
      email and on the decision page, never "Verofax Finance".
- [ ] Left unset (or any other value): behaves exactly as before this task
      — "Verofax Finance" branding, unchanged. This is the default, so a
      Finance deployment needs zero changes.
- [ ] No tenant name (e.g. "Northstar Global") is hardcoded into this
      config or the templates — verified by
      `tests/platform/product-branding.test.ts`.
- [ ] `GMAIL_FROM_NAME`, if set, still wins over the branding default —
      unchanged behavior, just documented here for clarity.

## 5b. Employees list salary-column fix — fixed in Slice 7

`/employees` (list page) previously SELECTed `basic_salary`/
`salary_currency` for every role, relying only on the detail page's own
gate. Now matches the detail page exactly: the list query itself omits
those columns unless `can(role, "salary.view")` — `hr`/`viewer` never
receive the data from Postgres at all, not just a CSS-hidden column.
Verified by `tests/platform/employees-salary-permission.test.ts`. No
migration needed; no salary data was modified.

## 6. Other known limitations at this deployment boundary

- The root `Dashboard` (`/`) redirect (hr role → `/concierge-insights`) and
  nav filtering are role-based, not deployment-based — an `hr`-role user
  gets the isolated HR experience on ANY deployment of this codebase,
  including the existing Finance one. A dedicated HR deployment doesn't
  need to seed any `finance`/`admin` staff at all, but if it does, those
  roles still see the full legacy Finance surface (by design — not deleted,
  not hidden from them, per instruction).
- The shared `/login` staff-sign-in page itself still shows "Verofax
  Finance" branding regardless of `APP_PRODUCT_MODE` — deliberately out of
  scope (it's genuinely shared staff-login infrastructure, not an
  HR-exclusive route the isolation task's route list named).
