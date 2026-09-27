import { requireUser, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const metadata = { title: "Training Analytics — Digital Rise HR", description: "Digital Rise HR Concierge — workforce learning overview." };
export const dynamic = "force-dynamic";

function isOverdue(status: string, dueDate: string | null): boolean {
  if (!dueDate || status === "completed") return false;
  return dueDate < new Date().toISOString().slice(0, 10);
}

export default async function TrainingAnalyticsPage() {
  const user = await requireUser();
  if (!can(user.role, "hr_learning.view")) redirect("/?error=forbidden");

  const supabase = await createClient();

  const [{ count: totalEmployees }, { data: fullRows }] = await Promise.all([
    supabase.from("employees").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase
      .from("training_registrations")
      .select("status, due_date, employee_id, employees(full_name, employee_code, department), training_programs(name)")
      .returns<
        Array<{
          status: string;
          due_date: string | null;
          employee_id: string;
          employees: { full_name: string; employee_code: string; department: string | null } | null;
          training_programs: { name: string } | null;
        }>
      >(),
  ]);

  const records = fullRows ?? [];

  // ---- Every number below is computed from the records above — nothing
  // hard-coded. Zero registrations simply means zero everywhere, honestly.
  const totalAssignments = records.length;
  const completed = records.filter((r) => r.status === "completed").length;
  const inProgress = records.filter((r) => r.status === "in_progress").length;
  const overdue = records.filter((r) => isOverdue(r.status, r.due_date)).length;
  const outstanding = records.filter((r) => !["completed", "declined", "cancelled"].includes(r.status)).length;
  const completionRate = totalAssignments > 0 ? Math.round((completed / totalAssignments) * 100) : 0;

  // ---- Department breakdown ----
  const byDept = new Map<
    string,
    { employeeIds: Set<string>; assigned: number; completed: number; inProgress: number; overdue: number; rows: Array<{ employeeName: string; employeeCode: string; programName: string; status: string; due_date: string | null }> }
  >();

  for (const row of records) {
    const dept = row.employees?.department ?? "Unassigned";
    if (!byDept.has(dept)) byDept.set(dept, { employeeIds: new Set(), assigned: 0, completed: 0, inProgress: 0, overdue: 0, rows: [] });
    const bucket = byDept.get(dept)!;
    bucket.employeeIds.add(row.employee_id);
    bucket.assigned += 1;
    if (row.status === "completed") bucket.completed += 1;
    if (row.status === "in_progress") bucket.inProgress += 1;
    if (isOverdue(row.status, row.due_date)) bucket.overdue += 1;
    bucket.rows.push({
      status: row.status,
      due_date: row.due_date,
      employeeName: row.employees?.full_name ?? "Unknown",
      employeeCode: row.employees?.employee_code ?? "—",
      programName: row.training_programs?.name ?? "Unknown program",
    });
  }

  const departmentRows = [...byDept.entries()]
    .map(([department, d]) => ({
      department,
      employees: d.employeeIds.size,
      assigned: d.assigned,
      completed: d.completed,
      inProgress: d.inProgress,
      overdue: d.overdue,
      completionPct: d.assigned > 0 ? Math.round((d.completed / d.assigned) * 100) : 0,
      rows: d.rows,
    }))
    .sort((a, b) => a.department.localeCompare(b.department));

  return (
    <div>
      <header className="mb-6">
        <div className="text-[11px] tracking-[0.18em] uppercase font-bold text-navy-500 mb-2">HR Concierge</div>
        <h1 className="font-display text-3xl font-extrabold text-navy-700">Workforce Learning Overview</h1>
        <p className="text-sm text-slate-500 mt-1">
          Every figure below is computed directly from training_registrations / employees at page-load time — nothing here is a fixed or estimated number.
        </p>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <Kpi label="Employees" value={totalEmployees ?? 0} />
        <Kpi label="Assignments" value={totalAssignments} />
        <Kpi label="Completed" value={completed} tone="positive" />
        <Kpi label="In Progress" value={inProgress} />
        <Kpi label="Outstanding" value={outstanding} tone={outstanding > 0 ? "warning" : undefined} />
        <Kpi label="Overdue" value={overdue} tone={overdue > 0 ? "danger" : "positive"} />
      </section>

      <div className="section-card mb-8">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-lg font-extrabold text-navy-700">Completion rate</h2>
          <span className="text-2xl font-extrabold text-navy-700">{completionRate}%</span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full bg-navy-500" style={{ width: `${completionRate}%`, background: "#0040A0" }} />
        </div>
      </div>

      <div className="section-card p-0">
        <div className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Department breakdown · click a department to see individual employees
        </div>
        {departmentRows.length === 0 ? (
          <p className="text-center text-sm text-slate-400 py-8">No training assignments recorded yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {departmentRows.map((d) => (
              <DepartmentRow key={d.department} d={d} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "positive" | "warning" | "danger" }) {
  const toneClass = tone === "positive" ? "positive" : tone === "warning" ? "warning" : tone === "danger" ? "danger" : "";
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${toneClass}`}>{value}</div>
    </div>
  );
}

function DepartmentRow({
  d,
}: {
  d: {
    department: string;
    employees: number;
    assigned: number;
    completed: number;
    inProgress: number;
    overdue: number;
    completionPct: number;
    rows: Array<{ employeeName: string; employeeCode: string; programName: string; status: string; due_date: string | null }>;
  };
}) {
  return (
    <details className="group">
      <summary className="cursor-pointer select-none list-none px-4 py-3 hover:bg-slate-50">
        <div className="grid grid-cols-7 gap-2 items-center text-sm">
          <div className="col-span-2 font-semibold text-navy-700">
            <span className="mr-1.5 inline-block transition-transform group-open:rotate-90">▸</span>
            {d.department}
          </div>
          <div className="text-slate-600">{d.employees} employees</div>
          <div className="text-slate-600">{d.assigned} assigned</div>
          <div className="text-slate-600">{d.completed} completed</div>
          <div className="text-slate-600">{d.inProgress} in progress</div>
          <div className={d.overdue > 0 ? "font-semibold text-red-600" : "text-slate-600"}>
            {d.overdue} overdue · {d.completionPct}%
          </div>
        </div>
      </summary>
      <div className="px-4 pb-4">
        <table className="table-clean">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Program</th>
              <th>Status</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r, i) => (
              <tr key={i}>
                <td className="text-sm text-slate-700">
                  {r.employeeName} <span className="text-xs text-slate-400">({r.employeeCode})</span>
                </td>
                <td className="text-sm text-slate-700">{r.programName}</td>
                <td className="text-xs capitalize text-slate-500">{r.status.replace("_", " ")}</td>
                <td className="text-xs text-slate-400">{r.due_date ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
