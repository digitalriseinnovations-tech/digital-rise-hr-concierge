import { describe, expect, it, afterEach } from "vitest";
import { getOrgDisplayName } from "../../src/lib/concierge/org";

/**
 * Phase 1 — Digital Rise organization identity conversion. Verifies the
 * tenant name is genuinely config-driven (HR_CONCIERGE_ORG_DISPLAY_NAME),
 * never a hardcoded literal in reusable business logic, and that the
 * previous "Northstar Global" hardcoding is gone from the system prompt
 * and tool descriptions regardless of what org name is configured.
 */

const ORIGINAL = process.env.HR_CONCIERGE_ORG_DISPLAY_NAME;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.HR_CONCIERGE_ORG_DISPLAY_NAME;
  else process.env.HR_CONCIERGE_ORG_DISPLAY_NAME = ORIGINAL;
});

describe("getOrgDisplayName", () => {
  it("defaults to a generic, non-tenant-specific name when unset", () => {
    delete process.env.HR_CONCIERGE_ORG_DISPLAY_NAME;
    expect(getOrgDisplayName()).toBe("your organization");
  });

  it("returns the configured value when set", () => {
    process.env.HR_CONCIERGE_ORG_DISPLAY_NAME = "Digital Rise Innovations";
    expect(getOrgDisplayName()).toBe("Digital Rise Innovations");
  });

  it("falls back to the safe default on a blank/whitespace-only value", () => {
    process.env.HR_CONCIERGE_ORG_DISPLAY_NAME = "   ";
    expect(getOrgDisplayName()).toBe("your organization");
  });
});

describe("buildConciergeSystemPrompt — no hardcoded tenant name", () => {
  it("reflects the configured org name and never mentions Northstar", async () => {
    process.env.HR_CONCIERGE_ORG_DISPLAY_NAME = "Digital Rise Innovations";
    const { buildConciergeSystemPrompt } = await import("../../src/lib/concierge/prompt");
    const prompt = buildConciergeSystemPrompt("Sarah");
    expect(prompt).not.toMatch(/northstar/i);
    expect(prompt).toContain("Digital Rise Innovations");
  });
});

describe("CONCIERGE_TOOLS descriptions — no hardcoded tenant name", () => {
  it("tool descriptions use the configured org name, never 'Northstar'", async () => {
    process.env.HR_CONCIERGE_ORG_DISPLAY_NAME = "Digital Rise Innovations";
    const { CONCIERGE_TOOLS } = await import("../../src/lib/concierge/tools");
    const combined = CONCIERGE_TOOLS.map((t) => t.anthropicSchema.description ?? "").join(" ");
    expect(combined).not.toMatch(/northstar/i);
    expect(combined).toContain("Digital Rise Innovations");
  });
});
