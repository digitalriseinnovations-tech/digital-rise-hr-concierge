import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/concierge/identity";
import { getMyLeaveBalance, getMyLeaveRequests } from "@/lib/concierge/leave";

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">My HR</h1>
        <p className="mt-1 text-sm text-slate-500">Your leave balance and recent requests, read directly from the same system HR uses.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Annual leave balance</div>
        {balance ? (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-indigo-600">{balance.remainingDays}</span>
            <span className="text-sm text-slate-500">days remaining of {balance.entitlementDays} ({balance.takenDays} taken)</span>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No balance record found.</p>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Recent leave requests
        </div>
        {requests.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-400">No leave requests yet. Ask HR Concierge to submit one for you.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-6 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-800 capitalize">{r.leaveType} · {r.daysCount} day{r.daysCount === 1 ? "" : "s"}</div>
                  <div className="text-xs text-slate-400">{r.startDate} → {r.endDate}</div>
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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
    rejected: "bg-red-50 text-red-700 border-red-200",
    cancelled: "bg-slate-50 text-slate-500 border-slate-200",
  };
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${styles[status] ?? styles.cancelled}`}>
      {status}
    </span>
  );
}
