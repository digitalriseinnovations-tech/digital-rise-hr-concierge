import { NextResponse } from "next/server";
import { requireImportPermission, isAuthFailure } from "@/lib/employee-import-auth";
import { buildTemplateWorkbook } from "@/lib/employee-import";

/**
 * GET /api/employees/import/template?sample=1 — downloadable .xlsx
 * template: blank (canonical headers only) by default, or with two
 * illustrative sample rows when ?sample=1 is passed.
 */
export async function GET(request: Request) {
  const auth = await requireImportPermission();
  if (isAuthFailure(auth)) return auth;

  const url = new URL(request.url);
  const withSample = url.searchParams.get("sample") === "1";
  const buffer = await buildTemplateWorkbook(withSample);
  const filename = withSample ? "employee-import-sample.xlsx" : "employee-import-template.xlsx";

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
