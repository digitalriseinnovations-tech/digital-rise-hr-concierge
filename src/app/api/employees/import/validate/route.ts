import { NextResponse } from "next/server";
import { requireImportPermission, isAuthFailure } from "@/lib/employee-import-auth";
import { validateRows, buildExistingEmployeeIndex, type ColumnMapping, type CellValue } from "@/lib/employee-import";
import { findOrCreateOrganization } from "@/lib/concierge/organizations";

interface ValidateBody {
  rows?: Record<string, CellValue>[];
  mapping?: ColumnMapping;
  organizationId?: string;
  newOrganizationName?: string;
  duplicateStrategy?: "update" | "skip";
}

/**
 * POST /api/employees/import/validate — re-runs validation against the
 * CURRENT mapping/organization/duplicate-strategy choice. Called both by
 * the preview step (whenever the admin adjusts the column mapping) and
 * internally re-run by /commit before any write — client-reported
 * validation is never trusted for the actual write.
 */
export async function POST(request: Request) {
  const auth = await requireImportPermission();
  if (isAuthFailure(auth)) return auth;

  let body: ValidateBody;
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
  const results = validateRows(body.rows, body.mapping, existingIndex, duplicateStrategy);

  const summary = {
    toCreate: results.filter((r) => r.action === "create").length,
    toUpdate: results.filter((r) => r.action === "update").length,
    toSkip: results.filter((r) => r.action === "skip").length,
    toError: results.filter((r) => r.action === "error").length,
  };

  return NextResponse.json({ organization, results, summary });
}
