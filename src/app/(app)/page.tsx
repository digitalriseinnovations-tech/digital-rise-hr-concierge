import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

function money(n: number, currency = "AED") {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

export default async function DashboardPage() {
  const user = await requireUser();

  // HR isolation: this dashboard's KPIs (payroll payable/paid, bonus due,
  // advances due) are Finance-only figures with no permission gate of
  // their own — never appropriate to show an HR-role user. HR's
  // equivalent "what's happening" landing view is Concierge Insights.
  // finance/admin/viewer are completely unaffected — this dashboard's own
  // logic is untouched for them.
  if (user.role === "hr") {
    redirect("/concierge-insights");
  }

  const supabase = await createClient();

  // ---- Run all KPI queries in parallel ----
  const [
    { count: totalEmployees },
    { data: salaryRecords },
    { data: benefits },
    { data: leaveBalances },
    { data: recentAudit },
  ] = await Promise.all([
    supabase.from("employees").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("salary_records").select("net_payable, paid_amount, status, currency, period_year, period_month").gte("period_year", new Date().getFullYear() - 1),
    supabase.from("benefits_credits").select("type, amount, currency, status"),
    supabase.from("leave_balances").select("remaining_days, year").eq("year", new Date().getFullYear()),
    supabase.from("audit_logs").select("user_email, action, entity_type, created_at").order("created_at", { ascending: false }).limit(8),
  ]);

  const thisMonth = new Date();
  const tm = thisMonth.getMonth() + 1;
  const ty = thisMonth.getFullYear();
  const monthlyRecords = (salaryRecords ?? []).filter((r: any) => r.period_year === ty && r.period_month === tm);

  // NOTE: Phase 1 dashboard treats values as same-currency (AED). Phase 2
  // adds proper FX conversion via the fx_rate_to_aed column on employees.
  const monthlyPayable = monthlyRecords.reduce((s: number, r: any) => s + Number(r.net_payable ?? 0), 0);
  const monthlyPaid = monthlyRecords.filter((r: any) => r.status === "paid").reduce((s: number, r: any) => s + Number(r.paid_amount ?? 0), 0);
  const monthlyPending = monthlyPayable - monthlyPaid;

  const bonusDue = (benefits ?? [])
    .filter((b: any) => b.type === "bonus" && b.status !== "paid")
    .reduce((s: number, b: any) => s + Number(b.amount ?? 0), 0);

  const advancesDue = (benefits ?? [])
    .filter((b: any) => b.type === "advance" && b.status !== "paid")
    .reduce((s: number, b: any) => s + Number(b.amount ?? 0), 0);

  const totalLeaveDays = (leaveBalances ?? []).reduce((s: number, l: any) => s + Number(l.remaining_days ?? 0), 0);
  const lowLeave = (leaveBalances ?? []).filter((l: any) => Number(l.remaining_days ?? 0) < 5).length;

  const pendingEmployees = monthlyRecords.filter((r: any) => r.status !== "paid").length;

  return (
    <div>
      <header className="mb-8">
        <div className="text-[11px] tracking-[0.18em] uppercase font-bold text-navy-500 mb-2">Executive Overview</div>
        <h1 className="font-display text-3xl font-extrabold text-navy-700">
          Welcome, {user.full_name.split(" ")[0]}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Snapshot for {thisMonth.toLocaleString("en", { month: "long", year: "numeric" })} · all amounts shown in AED equivalent
        </p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="kpi-card">
          <div className="kpi-label">Active Employees</div>
          <div className="kpi-value">{totalEmployees ?? 0}</div>
          <div className="kpi-meta">Across all departments</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Monthly Payable</div>
          <div className="kpi-value">{money(monthlyPayable)}</div>
          <div className="kpi-meta">Total net payroll this month</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Paid</div>
          <div className="kpi-value positive">{money(monthlyPaid)}</div>
          <div className="kpi-meta">{monthlyPayable > 0 ? `${Math.round((monthlyPaid / monthlyPayable) * 100)}% disbursed` : "—"}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Pending</div>
          <div className="kpi-value warning">{money(monthlyPending)}</div>
          <div className="kpi-meta">{pendingEmployees} employee{pendingEmployees === 1 ? "" : "s"} awaiting payment</div>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="kpi-card">
          <div className="kpi-label">Bonus Due</div>
          <div className="kpi-value">{money(bonusDue)}</div>
          <div className="kpi-meta">Approved &amp; pending payout</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Advances / Dues</div>
          <div className="kpi-value">{money(advancesDue)}</div>
          <div className="kpi-meta">Outstanding employee advances</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Leave Liability</div>
          <div className="kpi-value">{totalLeaveDays.toFixed(0)} <span className="text-sm font-normal text-slate-500">days</span></div>
          <div className="kpi-meta">Remaining leave across team</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Low Leave Alerts</div>
          <div className={`kpi-value ${lowLeave > 0 ? "danger" : "positive"}`}>{lowLeave}</div>
          <div className="kpi-meta">Employees with &lt; 5 days remaining</div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="section-card">
          <h2 className="font-display text-lg font-extrabold text-navy-700 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <a href="/employees" className="block p-4 border border-slate-200 rounded-xl hover:border-navy-500 transition-colors">
              <div className="text-2xl mb-1">◉</div>
              <div className="font-semibold text-navy-700">Employee List</div>
              <div className="text-xs text-slate-500 mt-0.5">View &amp; manage staff</div>
            </a>
            <a href="/payroll" className="block p-4 border border-slate-200 rounded-xl hover:border-navy-500 transition-colors">
              <div className="text-2xl mb-1">◧</div>
              <div className="font-semibold text-navy-700">Run Payroll</div>
              <div className="text-xs text-slate-500 mt-0.5">Coming in Phase 2</div>
            </a>
            <a href="/leave" className="block p-4 border border-slate-200 rounded-xl hover:border-navy-500 transition-colors">
              <div className="text-2xl mb-1">◐</div>
              <div className="font-semibold text-navy-700">Leave Balances</div>
              <div className="text-xs text-slate-500 mt-0.5">Coming in Phase 2</div>
            </a>
            <a href="/reports" className="block p-4 border border-slate-200 rounded-xl hover:border-navy-500 transition-colors">
              <div className="text-2xl mb-1">▦</div>
              <div className="font-semibold text-navy-700">Reports</div>
              <div className="text-xs text-slate-500 mt-0.5">Coming in Phase 5</div>
            </a>
          </div>
        </div>

        <div className="section-card">
          <h2 className="font-display text-lg font-extrabold text-navy-700 mb-4">Recent Activity</h2>
          {(recentAudit ?? []).length === 0 ? (
            <div className="text-sm text-slate-500 py-8 text-center">No activity yet. Audit log will populate as users make changes.</div>
          ) : (
            <ul className="space-y-2 text-sm">
              {(recentAudit ?? []).map((a: any, i: number) => (
                <li key={i} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <div>
                    <span className="font-medium text-slate-700">{a.user_email}</span>
                    <span className="text-slate-400"> · {a.action} </span>
                    <span className="text-slate-600">{a.entity_type}</span>
                  </div>
                  <div className="text-xs text-slate-400">{new Date(a.created_at).toLocaleString("en", { dateStyle: "short", timeStyle: "short" })}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
