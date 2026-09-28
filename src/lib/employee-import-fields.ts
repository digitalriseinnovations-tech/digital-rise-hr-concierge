/**
 * Canonical employee import field metadata — pure data/logic, no server-only
 * dependency, so it can be imported by both the server-side parsing/
 * validation code (src/lib/employee-import.ts) and the client-side import
 * wizard UI (src/app/(app)/employees/import/ImportWizard.tsx) without
 * duplicating the field list in two places.
 */

export interface CanonicalField {
  key: string;
  label: string;
  required: boolean;
  aliases: string[];
}

export const CANONICAL_FIELDS: CanonicalField[] = [
  { key: "employee_code", label: "Employee Code", required: true, aliases: ["employee code", "employee id", "emp code", "emp id", "code", "id"] },
  { key: "first_name", label: "First Name", required: true, aliases: ["first name", "firstname", "given name"] },
  { key: "last_name", label: "Last Name", required: false, aliases: ["last name", "lastname", "surname", "family name"] },
  { key: "email", label: "Work Email", required: true, aliases: ["work email", "email", "email address", "e-mail"] },
  { key: "department", label: "Department", required: false, aliases: ["department", "dept"] },
  { key: "job_title", label: "Job Title", required: false, aliases: ["job title", "title", "designation", "position"] },
  { key: "manager_email", label: "Manager Email", required: false, aliases: ["manager email", "manager", "manager e-mail", "reports to"] },
  { key: "joining_date", label: "Joining Date", required: false, aliases: ["joining date", "start date", "hire date", "date of joining"] },
  { key: "employment_status", label: "Employment Status", required: false, aliases: ["employment status", "status"] },
  { key: "location", label: "Location", required: false, aliases: ["location", "office", "site"] },
  { key: "annual_leave_entitlement", label: "Annual Leave Entitlement", required: false, aliases: ["annual leave entitlement", "annual leave days", "leave entitlement", "opening leave balance"] },
];

export type ColumnMapping = Record<string, string | null>;

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

export function suggestColumnMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map((h) => ({ original: h, normalized: normalizeHeader(h) }));
  const mapping: ColumnMapping = {};
  for (const field of CANONICAL_FIELDS) {
    const match = normalized.find((h) => h.normalized === field.key.replace(/_/g, " ") || field.aliases.includes(h.normalized));
    mapping[field.key] = match ? match.original : null;
  }
  return mapping;
}
