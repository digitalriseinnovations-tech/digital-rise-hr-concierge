import { describe, expect, it } from "vitest";
import { searchHrKnowledge } from "../../src/lib/concierge/knowledge";

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("HR knowledge retrieval (deterministic)", () => {
  it.skipIf(!hasCreds)("a known question returns grounded knowledge", async () => {
    const result = await searchHrKnowledge({ query: "annual leave policy" });
    expect(result.found).toBe(true);
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.some((e) => e.answer.toLowerCase().includes("24 days"))).toBe(true);
  });

  it.skipIf(!hasCreds)("an unknown/unsupported question returns found:false, never a fabricated entry", async () => {
    const result = await searchHrKnowledge({ query: "dragon unicorn moonbase teleportation stipend" });
    expect(result.found).toBe(false);
    expect(result.entries).toEqual([]);
  });

  it.skipIf(!hasCreds)("category-scoped search only returns that category", async () => {
    const result = await searchHrKnowledge({ category: "mentorship", limit: 10 });
    expect(result.found).toBe(true);
    expect(result.entries.every((e) => e.category === "mentorship")).toBe(true);
  });

  it.skipIf(!hasCreds)("onboarding category returns onboarding content", async () => {
    const result = await searchHrKnowledge({ category: "onboarding", query: "first week" });
    expect(result.found).toBe(true);
    expect(result.entries.some((e) => e.category === "onboarding")).toBe(true);
  });

  it.skipIf(!hasCreds)("coaching category returns coaching content", async () => {
    const result = await searchHrKnowledge({ category: "coaching" });
    expect(result.found).toBe(true);
    expect(result.entries.every((e) => e.category === "coaching")).toBe(true);
  });

  it.skipIf(!hasCreds)("respects the limit parameter", async () => {
    const result = await searchHrKnowledge({ category: "leave", limit: 2 });
    expect(result.entries.length).toBeLessThanOrEqual(2);
  });
});
