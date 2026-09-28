import { NextResponse } from "next/server";
import { requireImportPermission, isAuthFailure } from "@/lib/employee-import-auth";
import { validateRows, buildExistingEmployeeIndex, commitImport, type ColumnMapping, type CellValue } from "@/lib/employee-import";
import { findOrCreateOrganization } from "@/lib/concierge/organizations";

interface CommitBody {
  rows?: Record<string, CellValue>[];
  mapping?: ColumnMapping;
  organizationId?: string;
  newOrganizationName?: string;
  duplicateStrategy?: "update" | "skip";
}

/**
 * POST /api/employees/import/commit — re-validates from scratch (never
 * trusts the client's earlier /validate response) and then writes. Rows
 * are inserted/updated one at a time via the ordinary supabase-js
 * insert()/update() calls, so the existing audit_employees trigger
 * (log_audit(), schema.sql) fires exactly as it does for any other
 * employee write — no separate audit-logging code needed. created_by/
 * updated_by are set to the acting HR admin's finance_users id.
 */
export async function POST(request: Request) {
  const auth = await requireImportPermission();
  if (isAuthFailure(auth)) return auth;

  let body: CommitBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!Array.isArray(body.rows) || !body.mapping) {
    return NextResponse.json({ error: "Missing rows or column mapping." }, { status: 400 });
  }

  const organization = await findOrCreateOrganization({
    organizationId: body.organizationId,
    newOrganizationName: body.newOrganizationName,
  });
  if (!organization) {
    return NextResponse.json({ error: "Select an existing organization or provide a name for a new one." }, { status: 400 });
  }

  const duplicateStrategy = body.duplicateStrategy === "update" ? "update" : "skip";
  const existingIndex = await buildExistingEmployeeIndex(organization.id);
  const validated = validateRows(body.rows, body.mapping, existingIndex, duplicateStrategy);

  const summary = await commitImport(validated, organization.id, auth.id);
  return NextResponse.json({ organization, summary });
}
