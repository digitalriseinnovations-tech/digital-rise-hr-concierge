import { requireUser, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { lookupActiveOrganization, employeeBelongsToActiveOrganization } from "@/lib/concierge/organizations";
import { getTrainingSummaryForEmployee } from "@/lib/concierge/training";
import { notFound } from "next/navigation";
import Link from "next/link";

function money(n: number, currency: string) {
  if (!n) return "—";
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(Number(n))} ${currency}`;
}

function field(label: string, value: React.ReactNode) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 mb-1">{label}</div>
      <div className="text-sm text-slate-800">{value ?? "—"}</div>
    </div>
  );
}

export default async function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();

  const [
    { data: employee, error: empError },
    { data: salary },
    { data: leave },
    { data: benefits },
    trainingSummary,
  ] = await Promise.all([
    supabase.from("employees").select("*").eq("id", id).maybeSingle(),
    supabase.from("salary_records").select("*").eq("employee_id", id).order("period_year", { ascending: false }).order("period_month", { ascending: false }).limit(12),
    supabase.from("leave_balances").select("*").eq("employee_id", id).order("year", { ascending: false }),
    supabase.from("benefits_credits").select("*").eq("employee_id", id).order("created_at", { ascending: false }).limit(20),
    getTrainingSummaryForEmployee(id),
  ]);

  if (empError || !employee) {
    notFound();
  }

  // Organization isolation (migration_011): once organization scoping is
  // applied, an employee belonging to a DIFFERENT organization than the
  // one currently active for this deployment must be treated exactly like
  // a nonexistent employee — never revealed by ID, regardless of role.
  // Falls back to no-op pre-migration, same as every other org-scoping
  // check in this codebase (see src/lib/concierge/organizations.ts).
  const orgLookup = await lookupActiveOrganization();
  if (!employeeBelongsToActiveOrganization(employee.organization_id, orgLookup)) {
    notFound();
  }

  const canSeeSalary = can(user.role, "salary.view");
  const canEditEmp = can(user.role, "employee.edit");

  return (
    <div>
      <header className="mb-6">
        <Link href="/employees" className="text-xs text-slate-500 hover:text-navy-700">← Back to all employees</Link>
        <div className="flex items-end justify-between mt-3 flex-wrap gap-4">
          <div>
            <div className="text-[11px] tracking-[0.18em] uppercase font-bold text-navy-500 mb-1">Employee Profile</div>
            <h1 className="font-display text-3xl font-extrabold text-navy-700">{employee.full_name}</h1>
            <p className="text-sm text-slate-500 mt-1">
              {employee.designation ?? "—"} · {employee.department ?? "—"} · <span className="font-mono">{employee.employee_code}</span>
            </p>
          </div>
          {canEditEmp && <Link href={`/employees/${id}/edit`} className="btn-ghost">Edit Profile</Link>}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Info */}
          <div className="section-card">
            <h2 className="font-display text-lg font-extrabold text-navy-700 mb-4">Basic Information</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
              {field("Email", employee.email)}
              {field("Phone", employee.phone)}
              {field("Country", employee.country)}
              {field("Location", employee.location)}
              {field("Joining Date", employee.joining_date ? new Date(employee.joining_date).toLocaleDateString("en", { dateStyle: "medium" }) : null)}
              {field("Status", <span className={`badge ${employee.status === "active" ? "badge-green" : "badge-slate"}`}>{employee.status}</span>)}
            </div>
          </div>

          {/* Compensation — gated by role */}
          {canSeeSalary && (
            <div className="section-card">
              <h2 className="font-display text-lg font-extrabold text-navy-700 mb-4">Compensation</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
                {field("Basic Salary", money(employee.basic_salary, employee.salary_currency))}
                {field("Allowances", money(employee.allowances, employee.salary_currency))}
                {field("AED Equivalent", money(employee.basic_salary_aed, "AED"))}
                {field("FX Rate to AED", employee.fx_rate_to_aed ?? "1.000000")}
                {field("Bank", employee.bank_name)}
                {field("IBAN", employee.iban ? <span className="font-mono text-xs">{employee.iban}</span> : null)}
              </div>
            </div>
          )}

          {/* Recent Salary History */}
          {canSeeSalary && (
            <div className="section-card">
              <h2 className="font-display text-lg font-extrabold text-navy-700 mb-4">Recent Salary History</h2>
              {(salary ?? []).length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">No salary records yet. Phase 2 enables payroll entry.</p>
              ) : (
                <div className="overflow-x-auto -mx-2">
                  <table className="table-clean">
                    <thead>
                      <tr><th>Period</th><th>Net Payable</th><th>Paid</th><th>Status</th><th>Date</th></tr>
                    </thead>
                    <tbody>
                      {(salary ?? []).map((s: any) => (
                        <tr key={s.id}>
                          <td className="font-medium">{s.period_year}-{String(s.period_month).padStart(2, "0")}</td>
                          <td>{money(s.net_payable, s.currency)}</td>
                          <td>{money(s.paid_amount, s.currency)}</td>
                          <td>
                            <span className={`badge ${s.status === "paid" ? "badge-green" : s.status === "partial" ? "badge-amber" : "badge-slate"}`}>
                              {s.status}
                            </span>
                          </td>
                          <td className="text-xs text-slate-500">{s.payment_date ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          {/* Leave Balance */}
          <div className="section-card">
            <h2 className="font-display text-lg font-extrabold text-navy-700 mb-4">Leave Balance</h2>
            {(leave ?? []).length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">No leave records yet.</p>
            ) : (
              (leave ?? []).slice(0, 3).map((l: any) => (
                <div key={l.id} className="mb-4 last:mb-0">
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-xs uppercase tracking-wider font-semibold text-slate-500">{l.year}</span>
                    <span className="font-display text-2xl font-extrabold text-navy-700">{Number(l.remaining_days).toFixed(1)}</span>
                  </div>
                  <div className="text-xs text-slate-400">
                    Entitlement: {l.entitlement_days} · Taken: {l.taken_days}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Air Ticket */}
          <div className="section-card">
            <h2 className="font-display text-lg font-extrabold text-navy-700 mb-2">Air Ticket Entitlement</h2>
            <div className="font-display text-3xl font-extrabold text-navy-700">
              {money(employee.air_ticket_entitlement, employee.air_ticket_currency)}
            </div>
            <p className="text-xs text-slate-400 mt-1">Per cycle</p>
          </div>

          {/* Learning & Compliance */}
          <div className="section-card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-extrabold text-navy-700">Learning &amp; Compliance</h2>
              <Link href="/hr-learning" className="text-xs text-indigo-600 hover:underline">Training details →</Link>
            </div>
            <div className="grid grid-cols-2 gap-3 text-center mb-3">
              <div className="rounded-lg bg-slate-50 py-2">
                <div className="text-lg font-extrabold text-navy-700">{trainingSummary.assigned}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Assigned</div>
              </div>
              <div className="rounded-lg bg-slate-50 py-2">
                <div className="text-lg font-extrabold text-green-600">{trainingSummary.completed}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Completed</div>
              </div>
              <div className="rounded-lg bg-slate-50 py-2">
                <div className="text-lg font-extrabold text-navy-700">{trainingSummary.inProgress}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-400">In Progress</div>
              </div>
              <div className="rounded-lg bg-slate-50 py-2">
                <div className="text-lg font-extrabold text-slate-500">{trainingSummary.notStarted}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Not Started</div>
              </div>
            </div>
            {trainingSummary.overdue > 0 && (
              <div className="text-xs font-semibold text-red-600 mb-2">{trainingSummary.overdue} overdue</div>
            )}
            {trainingSummary.nextDue ? (
              <div className="text-xs text-slate-500">
                Next due: <span className="font-medium text-slate-700">{trainingSummary.nextDue.programName}</span> · {trainingSummary.nextDue.dueDate}
              </div>
            ) : (
              <div className="text-xs text-slate-400">Nothing currently due.</div>
            )}
          </div>

          {/* Recent Benefits / Credits */}
          <div className="section-card">
            <h2 className="font-display text-lg font-extrabold text-navy-700 mb-4">Recent Credits</h2>
            {(benefits ?? []).length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">None yet.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {(benefits ?? []).slice(0, 6).map((b: any) => (
                  <li key={b.id} className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-700 capitalize">{b.type.replace(/_/g, " ")}</div>
                      <div className="text-xs text-slate-400 truncate">{b.description || "—"}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold text-slate-800">{money(b.amount, b.currency)}</div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-400">{b.status}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {employee.notes && (
            <div className="section-card">
              <h2 className="font-display text-lg font-extrabold text-navy-700 mb-2">Notes</h2>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{employee.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
