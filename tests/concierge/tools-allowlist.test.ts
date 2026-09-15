import { describe, expect, it } from "vitest";
import { CONCIERGE_TOOL_NAMES, CONCIERGE_ANTHROPIC_TOOLS } from "../../src/lib/concierge/tools";

/**
 * The tool allow-list IS the permission boundary (see tool-executor.ts) —
 * this test exists purely to catch drift: if a future change accidentally
 * adds an admin-only action (approve/assign/match/set-status) to the
 * employee-facing Concierge tool set, this fails loudly instead of relying
 * on someone noticing during review.
 */

const EXPECTED_TOOL_NAMES = [
  // Slice 2 — knowledge / escalation
  "search_hr_knowledge",
  "get_onboarding_information",
  "get_mentorship_information",
  "get_coaching_information",
  "escalate_to_hr",
  // Slice 3 — leave
  "get_my_leave_balance",
  "create_leave_request",
  "get_my_leave_requests",
  "get_leave_request_status",
  // Slice 4 — training / mentorship / coaching
  "list_training_programs",
  "get_training_program",
  "get_my_training",
  "request_training_enrollment",
  "create_mentorship_request",
  "create_coaching_request",
  "get_my_hr_requests",
];

describe("CONCIERGE_TOOL_NAMES — exact allow-list, no drift, no admin actions", () => {
  it("contains exactly the expected employee-facing tools, nothing more", () => {
    expect(CONCIERGE_TOOL_NAMES.size).toBe(EXPECTED_TOOL_NAMES.length);
    for (const name of EXPECTED_TOOL_NAMES) {
      expect(CONCIERGE_TOOL_NAMES.has(name), `missing expected tool: ${name}`).toBe(true);
    }
  });

  it("contains no admin/approval/matching/status-setting tool under any name", () => {
    const dangerousPatterns = [/^approve/, /^reject/, /^assign/, /^match/, /set_.*status/, /^delete/, /^update_balance/];
    for (const name of CONCIERGE_TOOL_NAMES) {
      for (const pattern of dangerousPatterns) {
        expect(pattern.test(name), `tool name "${name}" matches dangerous pattern ${pattern}`).toBe(false);
      }
    }
  });

  it("every tool name registered for Anthropic has a matching allow-list entry (no orphaned schema)", () => {
    for (const tool of CONCIERGE_ANTHROPIC_TOOLS) {
      expect(CONCIERGE_TOOL_NAMES.has(tool.name)).toBe(true);
    }
    expect(CONCIERGE_ANTHROPIC_TOOLS.length).toBe(CONCIERGE_TOOL_NAMES.size);
  });
});
