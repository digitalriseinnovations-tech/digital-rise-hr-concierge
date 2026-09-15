import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type FinanceRole = "admin" | "finance" | "hr" | "viewer";

export interface FinanceUser {
  id: string;
  email: string;
  full_name: string;
  role: FinanceRole;
  active: boolean;
}

// Capability matrix — single source of truth for "who can do what".
// Used by both server components and server actions.
const PERMISSIONS: Record<FinanceRole, Set<string>> = {
  admin:   new Set(["*"]),
  finance: new Set(["salary.view", "salary.edit", "bonus.view", "bonus.edit", "dues.view", "dues.edit", "payslip.generate", "report.view", "employee.view"]),
  hr:      new Set(["employee.view", "employee.edit", "leave.view", "leave.edit", "benefits.view", "benefits.edit", "report.view", "hr_knowledge.view", "hr_knowledge.edit", "hr_learning.view", "hr_learning.edit", "concierge_insights.view", "employee_requests.view", "employee_requests.edit"]),
  viewer:  new Set(["dashboard.view", "report.view"]),
};

export function can(role: FinanceRole, action: string): boolean {
  const perms = PERMISSIONS[role];
  if (!perms) return false;
  if (perms.has("*")) return true;
  return perms.has(action);
}

export async function requireUser(): Promise<FinanceUser> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) redirect("/login");

  const { data: financeUser } = await supabase
    .from("finance_users")
    .select("id, email, full_name, role, active")
    .eq("email", user.email)
    .maybeSingle();

  if (!financeUser || !financeUser.active) {
    redirect("/login?error=no_access");
  }

  return financeUser as FinanceUser;
}

export async function requirePermission(action: string): Promise<FinanceUser> {
  const user = await requireUser();
  if (!can(user.role, action)) {
    redirect("/?error=forbidden");
  }
  return user;
}
