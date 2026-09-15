// HR Concierge environment validation.
//
// Mirrors the existing fail-closed pattern already established in this repo
// (src/lib/supabase/service.ts, src/lib/email.ts): check presence explicitly,
// throw a clear error naming the missing variable, never silently proceed
// with an undefined credential. This module never logs a variable's value —
// only its name and whether it is present.

export const REQUIRED_CONCIERGE_ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GMAIL_USER",
  "GMAIL_APP_PASSWORD",
  "GMAIL_FROM_NAME",
  "NEXT_PUBLIC_SITE_URL",
  "ANTHROPIC_API_KEY",
  "HR_CONCIERGE_SESSION_SECRET",
  "HR_CONCIERGE_ESCALATION_EMAIL",
] as const;

export const OPTIONAL_CONCIERGE_ENV_VARS = ["HR_CONCIERGE_AI_MODEL"] as const;

export type ConciergeEnvVarName =
  | (typeof REQUIRED_CONCIERGE_ENV_VARS)[number]
  | (typeof OPTIONAL_CONCIERGE_ENV_VARS)[number];

export interface EnvCheckResult {
  name: ConciergeEnvVarName;
  status: "PRESENT" | "MISSING";
  required: boolean;
}

function isSet(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Returns PRESENT/MISSING per variable name. Never returns, logs, or
 * otherwise exposes the value itself.
 */
export function checkConciergeEnv(): EnvCheckResult[] {
  const results: EnvCheckResult[] = [];
  for (const name of REQUIRED_CONCIERGE_ENV_VARS) {
    results.push({ name, status: isSet(name) ? "PRESENT" : "MISSING", required: true });
  }
  for (const name of OPTIONAL_CONCIERGE_ENV_VARS) {
    results.push({ name, status: isSet(name) ? "PRESENT" : "MISSING", required: false });
  }
  return results;
}

/**
 * Throws with a clear, value-free message if any required variable is
 * missing. Call this at the start of any Concierge server entry point
 * (API route, orchestrator) so misconfiguration fails closed and loud,
 * exactly like createServiceClient() and getTransport() already do
 * elsewhere in this repo.
 */
export function assertConciergeEnv(): void {
  const missing = checkConciergeEnv().filter((r) => r.required && r.status === "MISSING");
  if (missing.length > 0) {
    const names = missing.map((r) => r.name).join(", ");
    throw new Error(
      `HR Concierge is misconfigured — missing required environment variable(s): ${names}. ` +
        "Set them in .env.local (see .env.example for the full list). No value is shown or required in this error by design.",
    );
  }
}
