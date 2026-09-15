import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/concierge/identity";
import { listTrainingPrograms, getMyTraining } from "@/lib/concierge/training";
import { getMyHrRequests } from "@/lib/concierge/hr-requests";

export default async function MyLearningPage() {
  // Layout above already guarantees a valid session — re-resolve the
  // employeeId here the same way, never trusting anything client-supplied.
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return null;

  const [programs, myTraining, hrRequests] = await Promise.all([
    listTrainingPrograms(),
    getMyTraining(session.employeeId),
    getMyHrRequests(session.employeeId),
  ]);

  const registeredProgramIds = new Set(myTraining.map((t) => t.programId));
  const mandatoryUnregistered = programs.filter((p) => p.mandatory && !registeredProgramIds.has(p.id));
  const mentorshipRequests = hrRequests.filter((r) => r.requestType === "mentorship");
  const coachingRequests = hrRequests.filter((r) => r.requestType === "coaching");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">My Learning &amp; Growth</h1>
        <p className="mt-1 text-sm text-slate-500">
          Training programs, mentorship, and coaching — ask HR Concierge in Ask HR to enroll or request any of these.
        </p>
      </div>

      {mandatoryUnregistered.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1">Mandatory — not yet started</div>
          <ul className="text-sm text-amber-800 list-disc pl-5 space-y-0.5">
            {mandatoryUnregistered.map((p) => (
              <li key={p.id}>{p.name}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-400">
          My training
        </div>
        {myTraining.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-400">
            No registrations yet. Ask HR Concierge to enroll you in a program from the list below.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {myTraining.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-6 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-800">{t.programName}</div>
                  {t.requiresManagerApproval && <div className="text-xs text-slate-400">Requires manager/HR approval</div>}
                </div>
                <TrainingStatusBadge status={t.status} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Available programs
        </div>
        {programs.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-400">No active programs configured right now.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {programs.map((p) => (
              <li key={p.id} className="px-6 py-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-slate-800">
                    {p.name}
                    {p.mandatory && (
                      <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                        Mandatory
                      </span>
                    )}
                  </div>
                  {p.nextCohortStart && <div className="text-xs text-slate-400">Next cohort {p.nextCohortStart}</div>}
                </div>
                {p.description && <p className="mt-1 text-xs text-slate-500">{p.description}</p>}
                <div className="mt-1 flex gap-3 text-xs text-slate-400">
                  {p.durationLabel && <span>{p.durationLabel}</span>}
                  {p.deliveryMode && <span>{p.deliveryMode}</span>}
                  {p.requiresManagerApproval && <span>Manager/HR approval required</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Mentorship &amp; coaching requests
        </div>
        {mentorshipRequests.length === 0 && coachingRequests.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-400">
            No requests yet. Ask HR Concierge if you're interested in a mentor or executive coaching.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {[...mentorshipRequests, ...coachingRequests].map((r) => (
              <li key={r.id} className="flex items-center justify-between px-6 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-800 capitalize">{r.requestType}</div>
                  {r.category && <div className="text-xs text-slate-400">{r.category}</div>}
                </div>
                <RequestStatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TrainingStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    requested: "bg-amber-50 text-amber-700 border-amber-200",
    confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    waitlisted: "bg-sky-50 text-sky-700 border-sky-200",
    declined: "bg-red-50 text-red-700 border-red-200",
    cancelled: "bg-slate-50 text-slate-500 border-slate-200",
    completed: "bg-indigo-50 text-indigo-700 border-indigo-200",
  };
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${styles[status] ?? styles.cancelled}`}>
      {status}
    </span>
  );
}

function RequestStatusBadge({ status }: { status: string }) {
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
