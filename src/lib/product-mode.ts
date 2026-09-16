/**
 * Deployment-level product identity — server-side only, never exposed to
 * the client (no NEXT_PUBLIC_ prefix; nothing here is a secret, but it has
 * no reason to be in the client bundle either).
 *
 * ONE deployment of this codebase serves ONE product identity at a time
 * (an HR Concierge deployment never simultaneously serves Finance traffic,
 * and vice versa — see the Slice 6/7 isolation reports for why Option A,
 * a configuration boundary, is sufficient rather than a physical repo
 * split). That's what makes a single env var the right shape here: the
 * shared leave-approval workflow (src/lib/email.ts,
 * src/app/leave-decision/[token]/page.tsx) needs to know "which product am
 * I" once per deployment, not once per request.
 *
 * Deliberately does NOT encode a tenant/customer name (e.g. "Northstar
 * Global") — that's demo/customer data, not platform identity, and must
 * never be hardcoded into reusable business logic. Tenant name belongs in
 * the request's own data (employee/company fields), never here.
 */

export type ProductMode = "hr" | "finance";

export function getProductMode(): ProductMode {
  const raw = process.env.APP_PRODUCT_MODE?.trim().toLowerCase();
  // Defaults to "finance" — preserves all existing behavior for every
  // deployment that doesn't explicitly opt into APP_PRODUCT_MODE=hr.
  return raw === "hr" ? "hr" : "finance";
}

export interface ProductBranding {
  /** e.g. "Digital Rise" / "Verofax" */
  name: string;
  /** e.g. "HR Concierge" / "Finance" */
  line: string;
  /** e.g. "Digital Rise HR Concierge" / "Verofax Finance" */
  fullName: string;
  /** Shown in email footers. */
  footerLine: string;
  /** Shown in page (non-email) footers. */
  pageFooterLine: string;
  /** Browser tab title suffix. */
  pageTitle: string;
  /** Fallback "something went wrong, contact us" address — only used if
   * the request itself has no better contact on file. */
  contactEmail: string;
  /** Main heading on the shared /login staff sign-in page. */
  loginHeading: string;
  /** Optional short tagline shown under the login heading. Null = omit. */
  loginSupportingCopy: string | null;
  /** Smaller access-restriction line under the login heading/tagline. */
  loginAccessCopy: string;
  /** Small note at the very bottom of the login page. */
  loginFooterNote: string;
  /** Shown when a signed-in Supabase user has no active finance_users row. */
  noAccessMessage: string;
  /** Placeholder text for "your email" inputs on public-facing forms
   * (login, the public leave-request form). */
  emailPlaceholder: string;
}

const HR_BRANDING: ProductBranding = {
  name: "Digital Rise",
  line: "HR Concierge",
  fullName: "Digital Rise HR Concierge",
  footerLine: "Digital Rise HR Concierge · Internal use only",
  pageFooterLine: "Digital Rise HR Concierge · Confidential internal use",
  pageTitle: "Digital Rise HR Concierge",
  contactEmail: process.env.HR_CONCIERGE_ESCALATION_EMAIL || "hr@example.com",
  loginHeading: "HR Concierge",
  loginSupportingCopy: "AI-powered employee support for everyday HR requests",
  loginAccessCopy: "Secure access for employees and HR teams",
  loginFooterNote: "Digital Rise HR Concierge · Secure employee support",
  noAccessMessage: "Your account is not authorized for this application.",
  emailPlaceholder: "you@company.com",
};

const FINANCE_BRANDING: ProductBranding = {
  name: "Verofax",
  line: "Finance",
  fullName: "Verofax Finance",
  footerLine: "Verofax Finance Platform · Internal use only",
  pageFooterLine: "Verofax Finance Platform · Confidential internal use",
  pageTitle: "Verofax",
  contactEmail: "hr@verofax.com",
  loginHeading: "Finance Platform",
  loginSupportingCopy: null,
  loginAccessCopy: "Restricted access · finance & HR teams only",
  loginFooterNote: "Confidential system. Unauthorized access prohibited.",
  noAccessMessage: "Your account is not authorized for the finance platform.",
  emailPlaceholder: "you@verofax.com",
};

export function getProductBranding(): ProductBranding {
  return getProductMode() === "hr" ? HR_BRANDING : FINANCE_BRANDING;
}
