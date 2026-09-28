import { NextResponse } from "next/server";
import { requireImportPermission, isAuthFailure } from "@/lib/employee-import-auth";
import { parseSpreadsheet } from "@/lib/employee-import";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB — generous for a spreadsheet, demo-scale guard

/**
 * POST /api/employees/import/parse — multipart/form-data, field "file".
 * Parses the uploaded .xlsx/.csv into headers + rows + a suggested column
 * mapping. Read-only — never writes anything.
 */
export async function POST(request: Request) {
  const auth = await requireImportPermission();
  if (isAuthFailure(auth)) return auth;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }
  if (!/\.(xlsx|csv)$/i.test(file.name)) {
    return NextResponse.json({ error: "Only .xlsx or .csv files are supported." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File is too large (max 5MB)." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const parsed = await parseSpreadsheet(buffer, file.name);
    if (parsed.rows.length === 0) {
      return NextResponse.json({ error: "No data rows found in the uploaded file." }, { status: 400 });
    }
    return NextResponse.json(parsed);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not read the uploaded file." }, { status: 400 });
  }
}
