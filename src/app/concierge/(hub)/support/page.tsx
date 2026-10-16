import { cookies } from "next/headers";
import Link from "next/link";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/concierge/identity";
import { getMyHrRequests } from "@/lib/concierge/hr-requests";
import { StatusBadge } from "@/components/concierge/StatusBadge";
import { LifeBuoy, ShieldCheck, ArrowRight, ClipboardList } from "lucide-react";

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

      <div className="relative overflow-hidden rounded-2xl bg-brand-gradient p-6 text-white shadow-glow">
        <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/10" />
        <div className="relative">
          <div className="mb-2 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-white/80" />
            <div className="text-sm font-semibold">Need to speak with HR privately?</div>
          </div>
          <p className="mb-4 max-w-xl text-sm text-white/75">
            For anything sensitive — a grievance, a workplace concern, or anything you&apos;d rather not put in
            writing to an AI — ask HR Concierge to connect you with a person. It will never ask you to type out
            sensitive details first.
          </p>
          <Link
            href="/concierge"
            className="group inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-navy-700 shadow-card transition hover:shadow-card-hover"
          >
            <LifeBuoy className="h-4 w-4" />
            Talk to HR Concierge
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
          <ClipboardList className="h-3.5 w-3.5 text-slate-400" />
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">My requests</div>
        </div>
        {requests.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-400">
            No requests yet. Anything you ask HR Concierge to escalate, or any mentorship/coaching interest you log,
            will show up here.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-6 py-3.5 transition-colors hover:bg-slate-50/60">
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
