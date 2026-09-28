import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth";

/**
 * The Employee Import API routes are the first staff-authenticated JSON
 * endpoints in this app — requireUser()/requirePermission() (src/lib/
 * auth.ts) redirect() on failure, which is right for page Server
 * Components but wrong for a fetch()-consumed JSON API (a client-side
 * fetch would just follow the redirect and get HTML back, not a usable
 * error). This mirrors their exact same finance_users + role check, but
 * returns a JSON 401/403 instead.
 */
export async function requireImportPermission(): Promise<{ id: string } | NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: financeUser } = await supabase
    .from("finance_users")
    .select("id, role, active")
    .eq("email", user.email)
    .maybeSingle();

  if (!financeUser || !financeUser.active) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  if (!can(financeUser.role, "employee.edit")) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  return { id: financeUser.id };
}

export function isAuthFailure(result: unknown): result is NextResponse {
  return result instanceof NextResponse;
}
