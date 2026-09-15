import { requireUser, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

function statusBadge(status: string) {
  switch (status) {
    case "active":     return <span className="badge badge-green">Active</span>;
    case "on_leave":   return <span className="badge badge-amber">On Leave</span>;
    case "inactive":   return <span className="badge badge-slate">Inactive</span>;
    case "terminated": return <span className="badge badge-red">Terminated</span>;
    default:           return <span className="badge badge-slate">{status}</span>;
  }
}

export default async function EmployeesPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const canEdit = can(user.role, "employee.edit");
  // Same gate the employee detail page ([id]) already uses — "hr" doesn't
  // have salary.view, only finance/admin do. Fixed here: the column is no
  // longer just CSS-hidden, it's never SELECTed for an unauthorized role,
  // so unauthorized salary data never leaves the database for this request.
  const canSeeSalary = can(user.role, "salary.view");

  const baseColumns = "id, employee_code, full_name, email, department, designation, country, status, joining_date";
  const { data: employees } = await supabase
    .from("employees")
    .select(canSeeSalary ? `${baseColumns}, salary_currency, basic_salary` : baseColumns)
    .order("full_name", { ascending: true });

  const columnCount = canSeeSalary ? 8 : 7;

  return (
    <div>
      <header className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="text-[11px] tracking-[0.18em] uppercase font-bold text-navy-500 mb-2">Workforce</div>
          <h1 className="font-display text-3xl font-extrabold text-navy-700">Employees</h1>
          <p className="text-sm text-slate-500 mt-1">{(employees ?? []).length} total · sortable by status, department, country</p>
        </div>
        {canEdit && (
          <Link href="/employees/new" className="btn-primary">+ Add Employee</Link>
        )}
      </header>

      <div className="section-card overflow-x-auto p-0">
        <table className="table-clean">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Designation</th>
              <th>Department</th>
              <th>Country</th>
              {canSeeSalary && <th>Salary</th>}
              <th>Joined</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(employees ?? []).length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="text-center py-14 text-slate-500">
                  <div className="text-3xl mb-2">◉</div>
                  <div className="font-medium mb-1">No employees yet</div>
                  <div className="text-xs">Run <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">supabase/seed.sql</code> to load dummy data, or add your first employee.</div>
                </td>
              </tr>
            ) : (
              (employees ?? []).map((e: any) => (
                <tr key={e.id}>
                  <td className="font-mono text-xs text-slate-500">{e.employee_code}</td>
                  <td>
                    <Link href={`/employees/${e.id}`} className="font-semibold text-navy-700 hover:underline">
                      {e.full_name}
                    </Link>
                    {e.email && <div className="text-xs text-slate-400">{e.email}</div>}
                  </td>
                  <td className="text-sm text-slate-600">{e.designation ?? "—"}</td>
                  <td className="text-sm text-slate-600">{e.department ?? "—"}</td>
                  <td className="text-sm text-slate-600">{e.country ?? "—"}</td>
                  {canSeeSalary && (
                    <td className="text-sm font-medium text-slate-700">
                      {e.basic_salary > 0 ? (
                        <>{new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(Number(e.basic_salary))} <span className="text-xs text-slate-400">{e.salary_currency}</span></>
                      ) : "—"}
                    </td>
                  )}
                  <td className="text-xs text-slate-500">
                    {e.joining_date ? new Date(e.joining_date).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" }) : "—"}
                  </td>
                  <td>{statusBadge(e.status)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
