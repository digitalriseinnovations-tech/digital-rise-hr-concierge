import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/concierge/identity";
import { getMyLeaveBalance, getMyLeaveRequests } from "@/lib/concierge/leave";
import { StatusBadge } from "@/components/concierge/StatusBadge";
import { CalendarCheck, CalendarDays } from "lucide-react";

export default async function MyHrPage() {
  // Layout above already guarantees a valid session — re-resolve the
  // employeeId here the same way, never trusting anything client-supplied.
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return null;

  const [balance, requests] = await Promise.all([
    getMyLeaveBalance(session.employeeId, "annual"),
    getMyLeaveRequests(session.employeeId, 10),
  ]);

  const usedPct = balance && balance.entitlementDays > 0 ? Math.min(100, Math.round((balance.takenDays / balance.entitlementDays) * 100)) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">My HR</h1>
        <p className="mt-1 text-sm text-slate-500">Your leave balance and recent requests, read directly from the same system HR uses.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <CalendarCheck className="h-4 w-4" />
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Annual leave balance</div>
        </div>
        {balance ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-4xl font-bold text-navy-700">{balance.remainingDays}</span>
              <span className="text-sm text-slate-500">
                days remaining of {balance.entitlementDays} ({balance.takenDays} taken)
              </span>
            </div>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-gradient transition-all" style={{ width: `${usedPct}%` }} />
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-400">No balance record found.</p>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
          <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recent leave requests</div>
        </div>
        {requests.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-400">No leave requests yet. Ask AIVA to submit one for you.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-6 py-3.5 transition-colors hover:bg-slate-50/60">
                <div>
                  <div className="text-sm font-medium text-slate-800 capitalize">
                    {r.leaveType} · {r.daysCount} day{r.daysCount === 1 ? "" : "s"}
                  </div>
                  <div className="text-xs text-slate-400">
                    {r.startDate} → {r.endDate}
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
