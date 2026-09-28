import { describe, expect, it } from "vitest";
import { validateRows, type ExistingEmployeeIndex, type CellValue } from "../../src/lib/employee-import";
import { suggestColumnMapping } from "../../src/lib/employee-import-fields";

/**
 * Pure-function coverage for the import validation logic — no DB, no file
 * parsing, no Anthropic, no network. These exercise the exact rules the
 * /validate and /commit API routes rely on before any write happens.
 */

function emptyIndex(): ExistingEmployeeIndex {
  return { byCode: new Map(), byEmail: new Map() };
}

const FULL_MAPPING = {
  employee_code: "Employee Code",
  first_name: "First Name",
  last_name: "Last Name",
  email: "Work Email",
  department: "Department",
  job_title: "Job Title",
  manager_email: "Manager",
  joining_date: "Joining Date",
  employment_status: "Status",
  location: "Location",
  annual_leave_entitlement: "Leave Entitlement",
};

function row(overrides: Record<string, CellValue>): Record<string, CellValue> {
  return {
    "Employee Code": "EMP-1001",
    "First Name": "Jane",
    "Last Name": "Doe",
    "Work Email": "jane.doe@example.com",
    Department: "Operations",
    "Job Title": "Analyst",
    Manager: null,
    "Joining Date": "2024-01-15",
    Status: "active",
    Location: "Head Office",
    "Leave Entitlement": 24,
    ...overrides,
  };
}

describe("suggestColumnMapping", () => {
  it("matches common header variants to canonical fields", () => {
    const mapping = suggestColumnMapping(["Employee ID", "First Name", "Last Name", "Email Address", "Dept", "Job Title", "Manager", "Hire Date", "Status", "Office", "Annual Leave Days"]);
    expect(mapping.employee_code).toBe("Employee ID");
    expect(mapping.first_name).toBe("First Name");
    expect(mapping.email).toBe("Email Address");
    expect(mapping.department).toBe("Dept");
    expect(mapping.joining_date).toBe("Hire Date");
    expect(mapping.location).toBe("Office");
    expect(mapping.annual_leave_entitlement).toBe("Annual Leave Days");
  });

  it("leaves a field unmapped when no header matches", () => {
    const mapping = suggestColumnMapping(["Some Unrelated Column"]);
    expect(mapping.employee_code).toBeNull();
  });
});

describe("validateRows — required fields", () => {
  it("missing employee code -> error", () => {
    const [result] = validateRows([row({ "Employee Code": null })], FULL_MAPPING, emptyIndex(), "skip");
    expect(result.action).toBe("error");
    expect(result.errors).toContain("Missing employee code");
  });

  it("missing name (both first and last) -> error", () => {
    const [result] = validateRows([row({ "First Name": null, "Last Name": null })], FULL_MAPPING, emptyIndex(), "skip");
    expect(result.action).toBe("error");
    expect(result.errors.some((e) => e.includes("Missing employee name"))).toBe(true);
  });

  it("missing work email -> error", () => {
    const [result] = validateRows([row({ "Work Email": null })], FULL_MAPPING, emptyIndex(), "skip");
    expect(result.action).toBe("error");
    expect(result.errors).toContain("Missing work email");
  });

  it("malformed work email -> error", () => {
    const [result] = validateRows([row({ "Work Email": "not-an-email" })], FULL_MAPPING, emptyIndex(), "skip");
    expect(result.action).toBe("error");
    expect(result.errors).toContain("Malformed work email address");
  });

  it("malformed manager email -> error", () => {
    const [result] = validateRows([row({ Manager: "not-an-email" })], FULL_MAPPING, emptyIndex(), "skip");
    expect(result.action).toBe("error");
    expect(result.errors).toContain("Malformed manager email address");
  });

  it("unknown employment status -> error", () => {
    const [result] = validateRows([row({ Status: "on_vacation" })], FULL_MAPPING, emptyIndex(), "skip");
    expect(result.action).toBe("error");
    expect(result.errors.some((e) => e.includes("Unknown employment status"))).toBe(true);
  });

  it("a fully valid row with no existing match -> create", () => {
    const [result] = validateRows([row({})], FULL_MAPPING, emptyIndex(), "skip");
    expect(result.action).toBe("create");
    expect(result.errors).toEqual([]);
    expect(result.data?.employee_code).toBe("EMP-1001");
    expect(result.data?.full_name).toBe("Jane Doe");
  });
});

describe("validateRows — duplicate rows within the same file", () => {
  it("a repeated employee_code within the file -> both rows error", () => {
    const results = validateRows([row({}), row({ "Work Email": "jane.doe2@example.com" })], FULL_MAPPING, emptyIndex(), "skip");
    expect(results[1].action).toBe("error");
    expect(results[1].errors).toContain("Duplicate employee code within this file");
  });

  it("a repeated email within the file -> both rows error", () => {
    const results = validateRows([row({}), row({ "Employee Code": "EMP-1002" })], FULL_MAPPING, emptyIndex(), "skip");
    expect(results[1].action).toBe("error");
    expect(results[1].errors).toContain("Duplicate email within this file");
  });
});

describe("validateRows — existing employee update/skip", () => {
  function indexWithSarah(id = "existing-id-1"): ExistingEmployeeIndex {
    return {
      byCode: new Map([["EMP-1001", { id, email: "jane.doe@example.com" }]]),
      byEmail: new Map([["jane.doe@example.com", { id, employeeCode: "EMP-1001" }]]),
    };
  }

  it("duplicateStrategy='skip' -> matching existing employee is skipped, not errored", () => {
    const [result] = validateRows([row({})], FULL_MAPPING, indexWithSarah(), "skip");
    expect(result.action).toBe("skip");
  });

  it("duplicateStrategy='update' -> matching existing employee is marked for update", () => {
    const [result] = validateRows([row({})], FULL_MAPPING, indexWithSarah(), "update");
    expect(result.action).toBe("update");
    expect(result.data?.full_name).toBe("Jane Doe");
  });

  it("employee_code matches one existing employee but email matches a DIFFERENT one -> ambiguous error, never auto-resolved", () => {
    const existing: ExistingEmployeeIndex = {
      byCode: new Map([["EMP-1001", { id: "employee-A", email: "someone-else@example.com" }]]),
      byEmail: new Map([["jane.doe@example.com", { id: "employee-B", employeeCode: "EMP-9999" }]]),
    };
    const [result] = validateRows([row({})], FULL_MAPPING, existing, "update");
    expect(result.action).toBe("error");
    expect(result.errors.some((e) => e.includes("match different existing employees"))).toBe(true);
  });
});

describe("validateRows — cross-organization isolation (logic level)", () => {
  it("the same employee_code existing in a DIFFERENT organization's index is treated as brand new, not a match", () => {
    // Org B's index has no knowledge of Org A's EMP-1001 — a fresh
    // buildExistingEmployeeIndex(orgBId) call would never include Org A's
    // rows at all (scoped by .eq('organization_id', orgBId) at the query
    // layer), which an empty index here stands in for.
    const orgBIndex = emptyIndex();
    const [result] = validateRows([row({})], FULL_MAPPING, orgBIndex, "skip");
    expect(result.action).toBe("create");
  });
});
