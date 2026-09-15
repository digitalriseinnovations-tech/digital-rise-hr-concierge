import { describe, expect, it } from "vitest";
import { resolveLeaveDateRange } from "../../src/lib/concierge/leave";

// A fixed reference "today" for full determinism — never depends on the
// actual wall-clock date, so these tests are reproducible forever.
const REFERENCE = new Date("2026-09-15T12:00:00Z"); // a Tuesday

describe("resolveLeaveDateRange — deterministic date-year resolution", () => {
  it("upcoming month/day in the current year resolves to the current year", () => {
    // Oct 12 hasn't happened yet relative to Sep 15, 2026.
    const result = resolveLeaveDateRange("10-12", "10-15", REFERENCE);
    expect(result).toEqual({ ok: true, startDate: "2026-10-12", endDate: "2026-10-15" });
  });

  it("a month/day that has already passed this year resolves to next year", () => {
    // Jan 5 has already happened relative to Sep 15, 2026.
    const result = resolveLeaveDateRange("01-05", "01-06", REFERENCE);
    expect(result).toEqual({ ok: true, startDate: "2027-01-05", endDate: "2027-01-06" });
  });

  it("today's own month/day counts as still upcoming (uses current year, not next)", () => {
    const result = resolveLeaveDateRange("09-15", "09-16", REFERENCE);
    expect(result).toEqual({ ok: true, startDate: "2026-09-15", endDate: "2026-09-16" });
  });

  it("an explicit year is used exactly as given, never re-inferred", () => {
    const result = resolveLeaveDateRange("2028-03-01", "2028-03-02", REFERENCE);
    expect(result).toEqual({ ok: true, startDate: "2028-03-01", endDate: "2028-03-02" });
  });

  it("an invalid calendar date (Feb 30) is rejected, never silently normalized", () => {
    const result = resolveLeaveDateRange("02-30", "03-01", REFERENCE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_format");
  });

  it("an unparseable/garbage date string is rejected as ambiguous, asking to clarify", () => {
    const result = resolveLeaveDateRange("sometime in October", "later", REFERENCE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_format");
      expect(result.message.toLowerCase()).toMatch(/specific/);
    }
  });

  it("end date before start date is rejected", () => {
    const result = resolveLeaveDateRange("10-15", "10-12", REFERENCE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("end_before_start");
  });

  it("an explicit past year is rejected — never silently infers a date in the past", () => {
    const result = resolveLeaveDateRange("2024-10-12", "2024-10-15", REFERENCE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("in_the_past");
  });

  it("a range spanning a year boundary (both bare MM-DD) resolves the end date into the following year", () => {
    // Dec 30 -> Jan 2, no year given by the employee for either date.
    const result = resolveLeaveDateRange("12-30", "01-02", REFERENCE);
    expect(result).toEqual({ ok: true, startDate: "2026-12-30", endDate: "2027-01-02" });
  });

  it("an excessively long range is rejected", () => {
    const result = resolveLeaveDateRange("10-01", "12-31", REFERENCE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("range_too_long");
  });
});
