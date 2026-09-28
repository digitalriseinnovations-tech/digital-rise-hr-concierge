import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Real per-organization employee scoping (migration_011_organizations.sql).
 * Exactly one organization is "active" per deployment for Concierge/Copilot/
 * MCP identity purposes — selected via HR_CONCIERGE_ACTIVE_ORGANIZATION_SLUG,
 * kept deliberately separate from HR_CONCIERGE_ORG_DISPLAY_NAME (org.ts),
 * which remains pure cosmetic text. Multiple organizations' employee rosters
 * can coexist in the same database (imported independently via
 * /employees/import) without one leaking into another.
 */

export interface Organization {
  id: string;
  slug: string;
  name: string;
}

export type ActiveOrganizationLookup =
  /** migration_011 has not been applied yet (organizations table/column
   * missing) — every caller must behave exactly as it did before
   * organization scoping existed. This makes deploying this code safe
   * ahead of running the migration; nothing breaks either way. */
  | { supported: false }
  /** migration_011 is applied. `organization` is null if
   * HR_CONCIERGE_ACTIVE_ORGANIZATION_SLUG doesn't match any active row —
   * a real misconfiguration callers should fail closed on. */
  | { supported: true; organization: Organization | null };

const DEFAULT_ACTIVE_SLUG = "digital-rise-innovations";

function activeOrganizationSlug(): string {
  return process.env.HR_CONCIERGE_ACTIVE_ORGANIZATION_SLUG?.trim() || DEFAULT_ACTIVE_SLUG;
}

/**
 * The single org-isolation decision used everywhere an employee record is
 * read or written by ID (employee profile, employee edit, the edit API
 * route): true only if the employee genuinely belongs to the currently
 * active organization. Pre-migration (not supported yet), every employee
 * is treated as accessible — identical to today's behavior. Once
 * migration_011 is applied, a real cross-organization employee ID must
 * resolve to false here, the same as a nonexistent one — callers should
 * respond with a plain 404/notFound(), never a distinguishable error.
 */
export function employeeBelongsToActiveOrganization(employeeOrganizationId: string | null | undefined, lookup: ActiveOrganizationLookup): boolean {
  if (!lookup.supported) return true;
  if (!lookup.organization) return false;
  return employeeOrganizationId === lookup.organization.id;
}

export async function lookupActiveOrganization(): Promise<ActiveOrganizationLookup> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, slug, name")
    .eq("slug", activeOrganizationSlug())
    .eq("active", true)
    .maybeSingle();

  if (error) {
    // Most likely "relation organizations does not exist" — migration_011
    // not yet applied. Never distinguish further here; any query error on
    // this lookup means "act as if organization scoping doesn't exist yet".
    return { supported: false };
  }
  return { supported: true, organization: data ?? null };
}

export async function listOrganizations(): Promise<Organization[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("organizations").select("id, slug, name").order("name", { ascending: true });
  if (error || !data) return [];
  return data;
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Finds an existing organization by slug, or creates one from a display
 * name (used by the Import Employees flow's organization picker). */
export async function findOrCreateOrganization(input: { organizationId?: string; newOrganizationName?: string }): Promise<Organization | null> {
  const supabase = createServiceClient();

  if (input.organizationId) {
    const { data, error } = await supabase.from("organizations").select("id, slug, name").eq("id", input.organizationId).maybeSingle();
    return error ? null : data ?? null;
  }

  const name = input.newOrganizationName?.trim();
  if (!name) return null;
  const slug = slugify(name);
  if (!slug) return null;

  const { data: existing } = await supabase.from("organizations").select("id, slug, name").eq("slug", slug).maybeSingle();
  if (existing) return existing;

  const { data: created, error } = await supabase.from("organizations").insert({ slug, name }).select("id, slug, name").single();
  if (error || !created) return null;
  return created;
}
