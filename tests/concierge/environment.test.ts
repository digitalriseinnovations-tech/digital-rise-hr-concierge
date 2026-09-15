import { describe, expect, it } from "vitest";
import { checkConciergeEnv, REQUIRED_CONCIERGE_ENV_VARS } from "../../src/lib/concierge/env";

// This suite reports PRESENCE only. It must never assert on, print, or
// embed an actual variable value anywhere — not in test names, not in
// expect() messages, not in console output.
describe("HR Concierge environment configuration", () => {
  it("reports PRESENT/MISSING for every required variable (values never inspected)", () => {
    const results = checkConciergeEnv();
    // Print a value-free PRESENT/MISSING table to the test report only.
    for (const r of results) {
      // eslint-disable-next-line no-console
      console.log(`${r.status.padEnd(7)} ${r.required ? "(required)" : "(optional)"}  ${r.name}`);
    }
    expect(results.length).toBe(REQUIRED_CONCIERGE_ENV_VARS.length + 1);
  });

  it.each(REQUIRED_CONCIERGE_ENV_VARS)("required variable %s is PRESENT", (name) => {
    const result = checkConciergeEnv().find((r) => r.name === name);
    expect(result?.status, `${name} should be PRESENT in .env.local`).toBe("PRESENT");
  });
});
