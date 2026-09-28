import "server-only";

/**
 * The current tenant's display name — data/config-driven, never hardcoded
 * into reusable Concierge business logic (system prompt, tool descriptions,
 * UI copy). This deployment serves ONE organization at a time (see
 * src/lib/product-mode.ts for the analogous HR-vs-Finance product boundary);
 * HR_CONCIERGE_ORG_DISPLAY_NAME is the equivalent switch for "which
 * organization's employees am I serving", read once per deployment.
 *
 * Defaults to a generic placeholder — not a real company name — so a
 * deployment that forgets to set this doesn't silently claim to speak for
 * a specific organization it was never configured for.
 */
export function getOrgDisplayName(): string {
  return process.env.HR_CONCIERGE_ORG_DISPLAY_NAME?.trim() || "your organization";
}
