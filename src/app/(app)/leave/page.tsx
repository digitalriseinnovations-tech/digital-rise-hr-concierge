import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { lookupActiveOrganization } from "@/lib/concierge/organizations";
import Link from "next/link";
import { MonthFilter } from "./month-filter";

interface SearchParams { year?: string; month?: string }

function statusBadge(status: string) {
  switch (status) {
    case "pending":   return <span className="badge badge-amber">Pending</span>;
    case "approved":  return <span className="badge badge-green">Approved</span>;
    case "rejected":  return <span className="badge badge-red">Rejected</span>;
    case "cancelled": return <span className="badge badge-slate">Cancelled</span>;
    default:          return <span className="badge badge-slate">{status}</span>;
  }
}

function typeBadge(type: string) {
  const colors: Record<string, string> = {
    annual: "badge-navy", sick: "badge-amber", maternity: "badge-green",
    paternity: "badge-green", mourning: "badge-slate", haj: "badge-slate",
    unpaid: "badge-red", other: "badge-slate",
  };
  return <span className={`badge ${colors[type] || "badge-slate"} capitalize`}>{type}</span>;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function LeaveAdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("leave.view");
  const supabase = await createClient();

  const params = await searchParams;
  const now = new Date();
  const year = params.year ? Number(params.year) : now.getFullYear();
  const month = params.month ? Number(params.month) : (now.getMonth() + 1);

  // Date range for the selected month
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  // Organization isolation (migration_011/012) — every query below that
  // returns employee-linked data is explicitly scoped to the active
  // organization, not left to the UI to filter. Falls back to unscoped
  // (today's behavior) if organization scoping isn't applied yet — same
  // graceful pattern as src/lib/concierge/organizations.ts everywhere else.
  const orgLookup = await lookupActiveOrganization();
  const activeOrgId = orgLookup.supported && orgLookup.organization ? orgLookup.organization.id : null;

  let pendingQuery = supabase
    .from("leave_requests")
    .select("id, leave_type, start_date, end_date, days_count, reason, status, manager_email, created_at, employees:employee_id!inner (id, full_name, employee_code, country, organization_id)")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  let monthLeavesQuery = supabase
    .from("leave_requests")
    .select("id, leave_type, start_date, end_date, days_count, status, reason, decided_by_email, decided_at, employees:employee_id!inner (id, full_name, employee_code, country, organization_id)")
    .gte("start_date", monthStart)
    .lt("start_date", nextMonth)
    .eq("status", "approved")
    .order("start_date", { ascending: true });
  // Balances — current year (year filter on the picker is for HISTORY context, but balances always show current state)
  let balancesQuery = supabase.from("current_leave_balances").select("*").eq("year", year).order("full_name", { ascending: true });

  let yearOptionsQuery = supabase
    .from("leave_requests")
    .select("start_date, employees:employee_id!inner (organization_id)")
    .order("start_date", { ascending: false })
    .limit(500);

  if (activeOrgId) {
    pendingQuery = pendingQuery.eq("employees.organization_id", activeOrgId);
    monthLeavesQuery = monthLeavesQuery.eq("employees.organization_id", activeOrgId);
    balancesQuery = balancesQuery.eq("organization_id", activeOrgId);
    yearOptionsQuery = yearOptionsQuery.eq("employees.organization_id", activeOrgId);
  }

  const [
    { data: pending },
    { data: monthLeaves },
    { data: balances },
    { data: yearOptions },
  ] = await Promise.all([
    pendingQuery,
    monthLeavesQuery,
    balancesQuery,
    // For year picker — get all distinct years that have leave_requests
    yearOptionsQuery,
  ]);

  // Years that have history
  const availableYears = Array.from(new Set((yearOptions ?? []).map((r: any) => Number(r.start_date.slice(0, 4)))));
  if (!availableYears.includes(now.getFullYear())) availableYears.unshift(now.getFullYear());
  availableYears.sort((a, b) => b - a);

  // Pivot balances per employee for the balance table
  const balanceMap = new Map<string, any>();
  for (const b of balances ?? []) {
    if (!balanceMap.has(b.employee_id)) {
      balanceMap.set(b.employee_id, {
        employee_id: b.employee_id,
        full_name: b.full_name,
        employee_code: b.employee_code,
        country: b.country,
        manager_email: b.manager_email,
        annual: null, sick: null,
      });
    }
    const row = balanceMap.get(b.employee_id);
    if (b.leave_type === "annual") row.annual = b;
    if (b.leave_type === "sick") row.sick = b;
  }
  const balanceRows = Array.from(balanceMap.values());

  // Monthly totals by employee + type
  const monthTotals = new Map<string, { name: string; annual: number; sick: number; maternity: number; other: number; total: number }>();
  for (const l of monthLeaves ?? []) {
    const emp = Array.isArray(l.employees) ? l.employees[0] : (l.employees as any);
    if (!emp) continue;
    if (!monthTotals.has(emp.id)) {
      monthTotals.set(emp.id, { name: emp.full_name, annual: 0, sick: 0, maternity: 0, other: 0, total: 0 });
    }
    const t = monthTotals.get(emp.id)!;
    const days = Number(l.days_count ?? 0);
    t.total += days;
    if (l.leave_type === "annual") t.annual += days;
    else if (l.leave_type === "sick") t.sick += days;
    else if (l.leave_type === "maternity" || l.leave_type === "paternity") t.maternity += days;
    else t.other += days;
  }
  const monthlyTotalRows = Array.from(monthTotals.values()).sort((a, b) => b.total - a.total);

  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const totalDaysThisMonth = (monthLeaves ?? []).reduce((s, l: any) => s + Number(l.days_count ?? 0), 0);

  return (
    <div>
      <header className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <div className="text-[11px] tracking-[0.18em] uppercase font-bold text-navy-500 mb-2">Leave Management</div>
          <h1 className="font-display text-3xl font-extrabold text-navy-700">Leave</h1>
          <p className="text-sm text-slate-500 mt-1">Balances + pending requests + per-month history</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <MonthFilter availableYears={availableYears} year={year} month={month} />
          <Link href="/leave-request" target="_blank" className="btn-ghost">↗ Open public form</Link>
        </div>
      </header>

      {/* KPI strip */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="kpi-card">
          <div className="kpi-label">Pending Requests</div>
          <div className={`kpi-value ${(pending?.length ?? 0) > 0 ? "warning" : ""}`}>{pending?.length ?? 0}</div>
          <div className="kpi-meta">Awaiting manager approval</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">{monthLabel} — Leaves Taken</div>
          <div className="kpi-value">{totalDaysThisMonth}<span className="text-sm font-normal text-slate-500"> days</span></div>
          <div className="kpi-meta">{monthLeaves?.length ?? 0} records · {monthlyTotalRows.length} employees</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Annual Remaining (total)</div>
          <div className="kpi-value positive">
            {balanceRows.reduce((s, r) => s + Number(r.annual?.remaining_days ?? 0), 0).toFixed(0)}
            <span className="text-sm font-normal text-slate-500"> days</span>
          </div>
          <div className="kpi-meta">{year}, across all staff</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Sick Remaining (total)</div>
          <div className="kpi-value positive">
            {balanceRows.reduce((s, r) => s + Number(r.sick?.remaining_days ?? 0), 0).toFixed(0)}
            <span className="text-sm font-normal text-slate-500"> days</span>
          </div>
          <div className="kpi-meta">{year}, across all staff</div>
        </div>
      </section>

      {/* Pending requests */}
      {(pending ?? []).length > 0 && (
        <div className="section-card mb-6 p-0 overflow-x-auto">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-display text-lg font-extrabold text-navy-700">Pending Requests</h2>
            <span className="text-xs text-slate-500">{pending?.length} waiting on manager</span>
          </div>
          <table className="table-clean">
            <thead>
              <tr><th>Submitted</th><th>Employee</th><th>Type</th><th>From → To</th><th>Days</th><th>Manager</th><th></th></tr>
            </thead>
            <tbody>
              {(pending ?? []).map((r: any) => {
                const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees;
                return (
                  <tr key={r.id}>
                    <td className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString("en", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="font-medium text-navy-700">{emp?.full_name}</td>
                    <td>{typeBadge(r.leave_type)}</td>
                    <td className="text-sm text-slate-700">{r.start_date} → {r.end_date}</td>
                    <td className="font-semibold">{r.days_count}</td>
                    <td className="text-xs text-slate-500">{r.manager_email}</td>
                    <td>{statusBadge(r.status)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Month-filtered: per-employee totals for selected month */}
      <div className="section-card mb-6 p-0 overflow-x-auto">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="font-display text-lg font-extrabold text-navy-700">{monthLabel} · Leaves Taken — Per Employee</h2>
          <p className="text-xs text-slate-500 mt-0.5">Annual / Sick / Maternity-Paternity / Other breakdown for the selected month</p>
        </div>
        {monthlyTotalRows.length === 0 ? (
          <div className="text-center py-10 text-slate-500 text-sm">No leaves taken in {monthLabel}.</div>
        ) : (
          <table className="table-clean">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="text-right">Annual</th>
                <th className="text-right">Sick</th>
                <th className="text-right">Maternity / Paternity</th>
                <th className="text-right">Other</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {monthlyTotalRows.map((r) => (
                <tr key={r.name}>
                  <td className="font-semibold text-navy-700">{r.name}</td>
                  <td className="text-right">{r.annual > 0 ? r.annual : "—"}</td>
                  <td className="text-right">{r.sick > 0 ? r.sick : "—"}</td>
                  <td className="text-right">{r.maternity > 0 ? r.maternity : "—"}</td>
                  <td className="text-right">{r.other > 0 ? r.other : "—"}</td>
                  <td className="text-right font-bold">{r.total}</td>
                </tr>
              ))}
              <tr style={{ background: "#f6f9ff" }}>
                <td className="font-bold text-navy-700">Total</td>
                <td className="text-right font-semibold">{monthlyTotalRows.reduce((s, r) => s + r.annual, 0)}</td>
                <td className="text-right font-semibold">{monthlyTotalRows.reduce((s, r) => s + r.sick, 0)}</td>
                <td className="text-right font-semibold">{monthlyTotalRows.reduce((s, r) => s + r.maternity, 0)}</td>
                <td className="text-right font-semibold">{monthlyTotalRows.reduce((s, r) => s + r.other, 0)}</td>
                <td className="text-right font-bold text-navy-700">{totalDaysThisMonth}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Month-filtered: individual records */}
      <div className="section-card mb-6 p-0 overflow-x-auto">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="font-display text-lg font-extrabold text-navy-700">{monthLabel} · Detailed Records</h2>
          <p className="text-xs text-slate-500 mt-0.5">Every approved leave with start in {monthLabel}</p>
        </div>
        {(monthLeaves ?? []).length === 0 ? (
          <div className="text-center py-10 text-slate-500 text-sm">No records for {monthLabel}.</div>
        ) : (
          <table className="table-clean">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th>From → To</th>
                <th className="text-right">Days</th>
                <th>Reason / Notes</th>
              </tr>
            </thead>
            <tbody>
              {(monthLeaves ?? []).map((r: any) => {
                const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees;
                return (
                  <tr key={r.id}>
                    <td className="font-medium text-navy-700">{emp?.full_name}</td>
                    <td>{typeBadge(r.leave_type)}</td>
                    <td className="text-sm text-slate-700">
                      {r.start_date === r.end_date ? r.start_date : `${r.start_date} → ${r.end_date}`}
                    </td>
                    <td className="text-right font-semibold">{r.days_count}</td>
                    <td className="text-xs text-slate-500 italic max-w-md truncate">{r.reason ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Balances — always current */}
      <div className="section-card mb-6 p-0 overflow-x-auto">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="font-display text-lg font-extrabold text-navy-700">Balances · {year}</h2>
          <p className="text-xs text-slate-500 mt-0.5">Carry-forward + accrued − taken = remaining</p>
        </div>
        <table className="table-clean">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Country</th>
              <th colSpan={4} className="text-center">Annual (24)</th>
              <th colSpan={3} className="text-center">Sick (10)</th>
              <th>Manager</th>
            </tr>
            <tr style={{ background: "#f6f9ff" }}>
              <th></th>
              <th></th>
              <th className="text-right">Carry</th>
              <th className="text-right">Accrued</th>
              <th className="text-right">Taken</th>
              <th className="text-right">Remaining</th>
              <th className="text-right">Accrued</th>
              <th className="text-right">Taken</th>
              <th className="text-right">Remaining</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {balanceRows.map((r) => (
              <tr key={r.employee_id}>
                <td>
                  <Link href={`/employees/${r.employee_id}`} className="font-semibold text-navy-700 hover:underline">{r.full_name}</Link>
                  <div className="text-xs text-slate-400 font-mono">{r.employee_code}</div>
                </td>
                <td className="text-xs text-slate-500">{r.country ?? "—"}</td>
                <td className="text-right text-sm">{Number(r.annual?.carry_forward_days ?? 0).toFixed(1)}</td>
                <td className="text-right text-sm">{Number(r.annual?.accrued_days ?? 0).toFixed(1)}</td>
                <td className="text-right text-sm text-slate-500">{Number(r.annual?.taken_days ?? 0).toFixed(1)}</td>
                <td className="text-right font-semibold text-navy-700">{Number(r.annual?.remaining_days ?? 0).toFixed(1)}</td>
                <td className="text-right text-sm">{Number(r.sick?.accrued_days ?? 0).toFixed(1)}</td>
                <td className="text-right text-sm text-slate-500">{Number(r.sick?.taken_days ?? 0).toFixed(1)}</td>
                <td className="text-right font-semibold text-navy-700">{Number(r.sick?.remaining_days ?? 0).toFixed(1)}</td>
                <td className="text-xs text-slate-500">{r.manager_email}</td>
              </tr>
            ))}
            {balanceRows.length === 0 && (
              <tr><td colSpan={10} className="text-center py-12 text-slate-500 text-sm">No balances yet — run seed_staff.sql in Supabase.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
