import "server-only";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { createServiceClient } from "@/lib/supabase/service";
import { provisionAnnualLeaveBalance } from "./concierge/leave";
import { CANONICAL_FIELDS, suggestColumnMapping, type ColumnMapping } from "./employee-import-fields";

export { CANONICAL_FIELDS, suggestColumnMapping, type ColumnMapping } from "./employee-import-fields";

/**
 * Employee Excel/CSV import — the core parsing/validation/commit logic for
 * HR Admin > Import Employees (/employees/import). Deliberately excludes
 * payroll/banking/government-ID fields; only the canonical HR-identity
 * fields below are ever read from an uploaded file. No row is ever written
 * without going through validateRows() first, even from the commit route —
 * client-reported validation is never trusted for the actual write.
 */

const VALID_STATUSES = ["active", "inactive", "on_leave", "terminated"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 2000;

export type CellValue = string | number | null;

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, CellValue>[];
  suggestedMapping: ColumnMapping;
  truncated: boolean;
}

function normalizeCellValue(v: ExcelJS.CellValue): CellValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    const obj = v as { text?: unknown; result?: ExcelJS.CellValue; richText?: { text: string }[] };
    if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text).join("").trim();
    if ("text" in obj) return String(obj.text ?? "").trim();
    if ("result" in obj) return normalizeCellValue(obj.result as ExcelJS.CellValue);
    return String(v).trim();
  }
  return String(v).trim();
}

export async function parseSpreadsheet(buffer: Buffer, filename: string): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  const isCsv = filename.toLowerCase().endsWith(".csv");

  let worksheet: ExcelJS.Worksheet | undefined;
  if (isCsv) {
    worksheet = await workbook.csv.read(Readable.from(buffer));
  } else {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    worksheet = workbook.worksheets[0];
  }
  if (!worksheet) throw new Error("No worksheet found in the uploaded file.");

  let headers: string[] = [];
  const rows: Record<string, CellValue>[] = [];
  let truncated = false;

  worksheet.eachRow((row, rowNumber) => {
    const values = (row.values as ExcelJS.CellValue[]).slice(1); // exceljs rows are 1-indexed; index 0 is unused
    if (rowNumber === 1) {
      headers = values.map((v) => (normalizeCellValue(v) ?? "").toString());
      return;
    }
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      return;
    }
    const record: Record<string, CellValue> = {};
    let hasAnyValue = false;
    headers.forEach((h, i) => {
      if (!h) return;
      const value = normalizeCellValue(values[i]);
      record[h] = value;
      if (value !== null && String(value).trim() !== "") hasAnyValue = true;
    });
    if (hasAnyValue) rows.push(record);
  });

  const cleanHeaders = headers.filter((h) => h.length > 0);
  return { headers: cleanHeaders, rows, suggestedMapping: suggestColumnMapping(cleanHeaders), truncated };
}

export interface EmployeeImportData {
  employee_code: string;
  full_name: string;
  email: string;
  department: string | null;
  designation: string | null;
  manager_email: string | null;
  joining_date: string | null;
  status: string;
  location: string | null;
  annual_leave_days: number | null;
}

export interface ValidationRowResult {
  rowNumber: number;
  action: "create" | "update" | "skip" | "error";
  employeeCode: string | null;
  email: string | null;
  fullName: string | null;
  errors: string[];
  data?: EmployeeImportData;
}

export interface ExistingEmployeeIndex {
  byCode: Map<string, { id: string; email: string }>;
  byEmail: Map<string, { id: string; employeeCode: string }>;
}

export async function buildExistingEmployeeIndex(organizationId: string): Promise<ExistingEmployeeIndex> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("employees").select("id, employee_code, email").eq("organization_id", organizationId);
  const byCode = new Map<string, { id: string; email: string }>();
  const byEmail = new Map<string, { id: string; employeeCode: string }>();
  for (const row of data ?? []) {
    if (row.employee_code) byCode.set(row.employee_code, { id: row.id, email: (row.email ?? "").toLowerCase() });
    if (row.email) byEmail.set(row.email.toLowerCase(), { id: row.id, employeeCode: row.employee_code });
  }
  return { byCode, byEmail };
}

function str(v: CellValue | undefined): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function toDateIso(v: CellValue | undefined): string | null {
  const s = str(v);
  if (!s) return null;
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function toNumber(v: CellValue | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function validateRows(
  rawRows: Record<string, CellValue>[],
  mapping: ColumnMapping,
  existing: ExistingEmployeeIndex,
  duplicateStrategy: "update" | "skip",
): ValidationRowResult[] {
  const results: ValidationRowResult[] = [];
  const seenCodes = new Set<string>();
  const seenEmails = new Set<string>();

  const get = (raw: Record<string, CellValue>, key: string): CellValue | undefined => {
    const header = mapping[key];
    return header ? raw[header] : undefined;
  };

  rawRows.forEach((raw, idx) => {
    const rowNumber = idx + 2; // +1 for the header row, +1 for 1-indexed display
    const errors: string[] = [];

    const employeeCode = str(get(raw, "employee_code"));
    const firstName = str(get(raw, "first_name"));
    const lastName = str(get(raw, "last_name"));
    const email = str(get(raw, "email")).toLowerCase();
    const department = str(get(raw, "department")) || null;
    const jobTitle = str(get(raw, "job_title")) || null;
    const managerEmail = str(get(raw, "manager_email")).toLowerCase() || null;
    const joiningDate = toDateIso(get(raw, "joining_date"));
    const statusRaw = str(get(raw, "employment_status")).toLowerCase();
    const location = str(get(raw, "location")) || null;
    const leaveEntitlement = toNumber(get(raw, "annual_leave_entitlement"));
    const fullName = [firstName, lastName].filter(Boolean).join(" ");

    if (!employeeCode) errors.push("Missing employee code");
    if (!firstName && !lastName) errors.push("Missing employee name (first and/or last name)");
    if (!email) errors.push("Missing work email");
    else if (!EMAIL_RE.test(email)) errors.push("Malformed work email address");
    if (managerEmail && !EMAIL_RE.test(managerEmail)) errors.push("Malformed manager email address");
    if (statusRaw && !VALID_STATUSES.includes(statusRaw)) {
      errors.push(`Unknown employment status "${statusRaw}" — expected one of: ${VALID_STATUSES.join(", ")}`);
    }

    if (employeeCode) {
      if (seenCodes.has(employeeCode)) errors.push("Duplicate employee code within this file");
      else seenCodes.add(employeeCode);
    }
    if (email) {
      if (seenEmails.has(email)) errors.push("Duplicate email within this file");
      else seenEmails.add(email);
    }

    if (errors.length > 0) {
      results.push({ rowNumber, action: "error", employeeCode: employeeCode || null, email: email || null, fullName: fullName || null, errors });
      return;
    }

    const matchByCode = existing.byCode.get(employeeCode);
    const matchByEmail = existing.byEmail.get(email);

    let action: ValidationRowResult["action"] = "create";
    if (matchByCode && matchByEmail && matchByCode.id === matchByEmail.id) {
      action = duplicateStrategy;
    } else if (matchByCode || matchByEmail) {
      results.push({
        rowNumber,
        action: "error",
        employeeCode,
        email,
        fullName,
        errors: ["Employee code and email match different existing employees in this organization — resolve manually before import"],
      });
      return;
    }

    results.push({
      rowNumber,
      action,
      employeeCode,
      email,
      fullName,
      errors: [],
      data: {
        employee_code: employeeCode,
        full_name: fullName,
        email,
        department,
        designation: jobTitle,
        manager_email: managerEmail,
        joining_date: joiningDate,
        status: statusRaw || "active",
        location,
        annual_leave_days: leaveEntitlement,
      },
    });
  });

  return results;
}

export interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  errored: number;
  errors: { rowNumber: number; employeeCode: string | null; email: string | null; errors: string[] }[];
}

export async function commitImport(
  validated: ValidationRowResult[],
  organizationId: string,
  actorFinanceUserId: string,
): Promise<ImportSummary> {
  const supabase = createServiceClient();
  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0, errored: 0, errors: [] };

  for (const row of validated) {
    if (row.action === "error" || !row.data) {
      summary.errored++;
      summary.errors.push({ rowNumber: row.rowNumber, employeeCode: row.employeeCode, email: row.email, errors: row.errors });
      continue;
    }

    if (row.action === "skip") {
      summary.skipped++;
      continue;
    }

    if (row.action === "create") {
      const { data: inserted, error } = await supabase
        .from("employees")
        .insert({
          organization_id: organizationId,
          employee_code: row.data.employee_code,
          full_name: row.data.full_name,
          email: row.data.email,
          department: row.data.department,
          designation: row.data.designation,
          manager_email: row.data.manager_email,
          joining_date: row.data.joining_date,
          status: row.data.status,
          location: row.data.location,
          ...(row.data.annual_leave_days !== null ? { annual_leave_days: row.data.annual_leave_days } : {}),
          created_by: actorFinanceUserId,
          updated_by: actorFinanceUserId,
        })
        .select("id")
        .single();
      if (error || !inserted) {
        summary.errored++;
        summary.errors.push({ rowNumber: row.rowNumber, employeeCode: row.employeeCode, email: row.email, errors: [error?.message ?? "Insert failed."] });
      } else {
        summary.created++;
        // Canonical leave balance provisioning — the same operation the
        // employee edit route performs. Only runs when the spreadsheet
        // actually provided a value; an employee with no entitlement
        // column mapped gets no leave_balances row here, same as before.
        if (row.data.annual_leave_days !== null) {
          await provisionAnnualLeaveBalance(inserted.id, row.data.annual_leave_days);
        }
      }
      continue;
    }

    // action === "update"
    const { data: updated, error } = await supabase
      .from("employees")
      .update({
        full_name: row.data.full_name,
        email: row.data.email,
        department: row.data.department,
        designation: row.data.designation,
        manager_email: row.data.manager_email,
        joining_date: row.data.joining_date,
        status: row.data.status,
        location: row.data.location,
        ...(row.data.annual_leave_days !== null ? { annual_leave_days: row.data.annual_leave_days } : {}),
        updated_by: actorFinanceUserId,
      })
      .eq("organization_id", organizationId)
      .eq("employee_code", row.data.employee_code)
      .select("id")
      .single();

    if (error || !updated) {
      summary.errored++;
      summary.errors.push({ rowNumber: row.rowNumber, employeeCode: row.employeeCode, email: row.email, errors: [error?.message ?? "Update failed."] });
    } else {
      summary.updated++;
      if (row.data.annual_leave_days !== null) {
        await provisionAnnualLeaveBalance(updated.id, row.data.annual_leave_days);
      }
    }
  }

  return summary;
}

export async function buildTemplateWorkbook(withSampleRows: boolean): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Employees");
  sheet.columns = CANONICAL_FIELDS.map((f) => ({ header: f.label, key: f.key, width: 24 }));
  sheet.getRow(1).font = { bold: true };

  if (withSampleRows) {
    sheet.addRow({
      employee_code: "EMP-1001",
      first_name: "Jane",
      last_name: "Doe",
      email: "jane.doe@example.com",
      department: "Operations",
      job_title: "Operations Analyst",
      manager_email: "manager@example.com",
      joining_date: "2024-01-15",
      employment_status: "active",
      location: "Head Office",
      annual_leave_entitlement: 24,
    });
    sheet.addRow({
      employee_code: "EMP-1002",
      first_name: "John",
      last_name: "Smith",
      email: "john.smith@example.com",
      department: "Engineering",
      job_title: "Software Engineer",
      manager_email: "manager@example.com",
      joining_date: "2024-03-01",
      employment_status: "active",
      location: "Remote",
      annual_leave_entitlement: 24,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
