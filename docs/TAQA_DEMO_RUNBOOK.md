# TAQA Demo Runbook — Digital Rise HR AI Employee

Practical, step-by-step. No secrets included — where a real credential is needed, this says so and leaves it to you.

## Before you start

- **Org identity**: this deployment now presents itself as **Digital Rise Innovations** (via `HR_CONCIERGE_ORG_DISPLAY_NAME=Digital Rise Innovations`, set in Vercel) — the Concierge system prompt, tool descriptions, and the identify screen no longer say "Northstar Global." The underlying seeded employee/knowledge-base rows are still the original Northstar Global demo data (see §"Remaining Northstar references" in the conversion report) — the identify-screen placeholder domain below is illustrative, not literal.
- **Manager_email safety**: seeded employees' managers use `@northstarglobal.com` addresses, which is a real, externally-registered domain. If `HR_CONCIERGE_DEMO_MANAGER_EMAIL` is **not** set in Vercel, a real confirmed leave request in the demo will email that real domain. **Set `HR_CONCIERGE_DEMO_MANAGER_EMAIL` in Vercel before the demo** if you plan to run step 4/5 for real (see the final report for the exact value to use).
- **Run the two pending SQL files first** (Supabase SQL Editor, in order): `supabase/migration_009_training_tracking.sql`, then `supabase/seed_taqa_demo_expansion.sql`. Steps 7–8 and 14 depend on this data existing.
- **HR login**: confirmed working — you already have a Supabase Auth account linked to an active `hr`-role `finance_users` row. Use that account for steps 11–15; no further setup needed.
- Every step below that says 💰 spends a small amount of real Anthropic credit (Haiku — cheap). Every 📧 sends a real email. Every 🗄️ writes a real database row. Steps with none of these are free and safe to repeat as many times as you like.

## Demo sequence

| # | Step | Account | Prompt / action | Expected result | Page | 🗄️ | 📧 | 💰 | Fallback |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Employee opens HR AI Employee | Employee code `NSG-1001`, email `sarah.ahmed@northstarglobal.com` | Go to the production URL → `/concierge/identify` | Redirects to `/concierge`, greets "Sarah" | `/concierge/identify` | | | | If identify fails, re-check `HR_CONCIERGE_SESSION_SECRET` is set in Vercel (previously confirmed working). |
| 2 | Policy question | Sarah (logged in) | "What is our annual leave policy?" | Grounded answer citing 24 days/year, from real `hr_knowledge_base` | `/concierge` | | | 💰 | If it can't find it, ask "What is our leave policy?" instead — phrasing matters less than the topic. |
| 3 | Leave balance | Sarah | "How many annual leave days do I have?" | "14 days remaining" (real, current balance) | `/concierge` | | | 💰 | — |
| 4 | Leave preview | Sarah | "I want annual leave from October 15 to October 16." | A preview: dates, 2 days, current/after balance, real approver name (Daniel), asks to confirm | `/concierge` | | | 💰 | Use any future date — avoid re-using a date you've already confirmed earlier in rehearsal (idempotency will just reuse the same pending request, which is still a valid thing to show). |
| 5 | Leave confirmation | Sarah | "Yes" | "Submitted... pending approval" — **no extra Anthropic call for this step** (deterministic fast path) | `/concierge` | 🗄️ | 📧 | | If it says the manager email failed but was still submitted, that's the correct, intended honest behavior (DB success ≠ email success) — point this out as a feature, not a bug. |
| 6 | Show My HR | Sarah | Open My HR | Shows the new pending request | `/concierge/my-hr` | | | | — |
| 7 | Mandatory training | Sarah | "What mandatory training do I still need to complete?" | Lists Sarah's real outstanding required training with due dates (from seeded data) | `/concierge` | | | 💰 | Only works after the seed files (see "Before you start") are run — otherwise Sarah has no seeded assignments and the honest answer is "none outstanding." |
| 8 | Start/open training | Sarah | "Start [program name from step 7]" | Confirms it's now in progress and gives the training link — **single call, no confirmation needed** | `/concierge` | 🗄️ | | 💰 | — |
| 9 | Mentorship | Sarah | "How does the mentorship program work?" | Grounded answer from real knowledge base | `/concierge` | | | 💰 | — |
| 10 | Executive coaching | Sarah | "What executive coaching is available?" | Grounded answer from real knowledge base | `/concierge` | | | 💰 | — |
| 11 | Switch to HR side | Your HR admin account | Sign in | Redirects to `/concierge-insights` | `/login` | | | | — |
| 12 | Employee requests | HR admin | Open Employee Requests | Shows real escalation/mentorship/coaching requests, including any seeded ones | `/employee-requests` | | | | — |
| 13 | Leave management | HR admin | Open Leave | Shows the request created in step 5 as pending | `/leave` | | | | — |
| 14 | Workforce training analytics | HR admin | Open Training Analytics | Real KPI totals + department breakdown, computed live — click a department to drill into individual employees | `/training-analytics` | | | | If numbers look sparse, the seed expansion file hasn't been run yet — see "Before you start." |
| 15 | Concierge operational insights | HR admin | Open Concierge Insights | Real conversation/action counts from steps 1–10 of this exact demo session | `/concierge-insights` | | | | — |
| 16 | Microsoft Copilot integration | — | Talk through `docs/MICROSOFT_COPILOT_INTEGRATION.md` | Explains the architecture, what's real today (3 working endpoints), and what needs TAQA's tenant access | (no page — narrated) | | | | — |

## Minimum-cost variant

If you want to demo with as little real spend as possible: steps 1, 6, 11–14, 16 cost nothing at all. Steps 2, 3, 9, 10 are one cheap Haiku call each. Steps 4–5 and 7–8 are the only steps that write real data and (4-5 only) can send a real email — do those once, deliberately, not repeatedly during rehearsal.

## If something breaks live

- A raw "Network error" banner instead of a normal reply: check Vercel's function logs for `/api/concierge/message` — this codebase now logs the real underlying error server-side (never shown to the employee) for exactly this situation.
- HR side won't load: confirm you're signed in with the account from "Before you start," not a different one.
- Training question comes back empty: the seed expansion likely hasn't been run yet — falls back gracefully to "no training configured," which is still an honest, non-broken answer, just not the richest demo.
