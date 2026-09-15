import { requireUser, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EmployeeRequestsTable, type EmployeeRequestRow } from "./requests-table";

export const metadata = { title: "Employee Requests — Digital Rise HR", description: "Digital Rise HR Concierge — employee request queue." };
export const dynamic = "force-dynamic";

export default async function EmployeeRequestsPage() {
  const user = await requireUser();
  const canEdit = can(user.role, "employee_requests.edit");
  const supabase = await createClient();

  const { data: requests } = await supabase
    .from("hr_requests")
    .select("id, request_type, category, note, status, urgent, created_at, employees(full_name, employee_code)")
    .order("created_at", { ascending: false })
    .limit(200);

  const rows: EmployeeRequestRow[] = (requests ?? []).map((r: any) => ({
    id: r.id,
    requestType: r.request_type,
    category: r.category,
    note: r.note,
    status: r.status,
    urgent: r.urgent ?? false,
    created_at: r.created_at,
    employeeName: r.employees?.full_name ?? "Unknown",
    employeeCode: r.employees?.employee_code ?? "—",
  }));

  const openCount = rows.filter((r) => r.status === "open").length;

  return (
    <div>
      <header className="mb-6">
        <div className="text-[11px] tracking-[0.18em] uppercase font-bold text-navy-500 mb-2">HR Concierge</div>
        <h1 className="font-display text-3xl font-extrabold text-navy-700">Employee Requests</h1>
        <p className="text-sm text-slate-500 mt-1">
          Every escalation, general question, mentorship, and coaching request HR Concierge has routed to a human —
          {" "}{openCount} currently open. HR Concierge never resolves these itself; every status change here is a
          human decision. (Training-specific registrations live on the HR Learning screen.)
        </p>
      </header>

      <div className="section-card overflow-x-auto p-0">
        <EmployeeRequestsTable rows={rows} canEdit={canEdit} />
      </div>
    </div>
  );
}
