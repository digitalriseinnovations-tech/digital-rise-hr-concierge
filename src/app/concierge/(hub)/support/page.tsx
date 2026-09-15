import { cookies } from "next/headers";
import Link from "next/link";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/concierge/identity";
import { getMyHrRequests } from "@/lib/concierge/hr-requests";

const TYPE_LABEL: Record<string, string> = {
  escalation: "HR escalation",
  general: "General request",
  mentorship: "Mentorship",
  coaching: "Coaching",
};

export default async function SupportPage() {
  // Layout above already guarantees a valid session — re-resolve the
  // employeeId here the same way, never trusting anything client-supplied.
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return null;

  const requests = await getMyHrRequests(session.employeeId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Support</h1>
        <p className="mt-1 text-sm text-slate-500">
          Your own requests to HR — escalations, mentorship, coaching, and general questions — and where they stand.
        </p>
      </div>

      <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5">
        <div className="text-sm font-semibold text-indigo-900 mb-1">Need to speak with HR privately?</div>
        <p className="text-sm text-indigo-800/80 mb-3">
          For anything sensitive — a grievance, a workplace concern, or anything you'd rather not put in writing to an
          AI — ask HR Concierge to connect you with a person. It will never ask you to type out sensitive details
          first.
        </p>
        <Link
          href="/concierge"
          className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Talk to HR Concierge
        </Link>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-400">
          My requests
        </div>
        {requests.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-400">
            No requests yet. Anything you ask HR Concierge to escalate, or any mentorship/coaching interest you log,
            will show up here.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-6 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-800">{TYPE_LABEL[r.requestType] ?? r.requestType}</div>
                  {r.category && <div className="text-xs text-slate-400">{r.category}</div>}
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
    open: "bg-amber-50 text-amber-700 border-amber-200",
    in_progress: "bg-sky-50 text-sky-700 border-sky-200",
    resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
    closed: "bg-slate-50 text-slate-500 border-slate-200",
  };
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${styles[status] ?? styles.closed}`}>
      {status.replace("_", " ")}
    </span>
  );
}
