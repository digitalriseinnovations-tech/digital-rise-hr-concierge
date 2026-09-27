import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/concierge/identity";
import { listTrainingPrograms, getMyTraining, type MyTrainingEntry, type TrainingProgram } from "@/lib/concierge/training";
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
  const required = myTraining.filter((t) => t.mandatory && t.status !== "completed");
  const inProgress = myTraining.filter((t) => t.status === "in_progress" && !t.mandatory);
  const completed = myTraining.filter((t) => t.status === "completed");
  const recommended = programs.filter((p) => !p.mandatory && !registeredProgramIds.has(p.id));
  const overdueCount = myTraining.filter((t) => t.overdue).length;

  const mentorshipRequests = hrRequests.filter((r) => r.requestType === "mentorship");
  const coachingRequests = hrRequests.filter((r) => r.requestType === "coaching");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">My Learning &amp; Growth</h1>
        <p className="mt-1 text-sm text-slate-500">
          Training, mentorship, and coaching — ask HR Concierge in Ask HR to enroll, start, or continue any of these.
        </p>
      </div>

      {overdueCount > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-red-700">
            {overdueCount} overdue training {overdueCount === 1 ? "item" : "items"}
          </div>
          <p className="mt-1 text-sm text-red-800">Ask HR Concierge: &quot;What mandatory training do I still need to complete?&quot;</p>
        </div>
      )}

      <TrainingSection
        title="Required"
        emptyText="No required training outstanding right now."
        entries={required}
        hint='Ask: "What mandatory training do I still need to complete?"'
      />

      <TrainingSection
        title="In Progress"
        emptyText="Nothing in progress right now."
        entries={inProgress}
        hint='Ask: "What training am I enrolled in?"'
      />

      <TrainingSection
        title="Completed"
        emptyText="No completed training yet."
        entries={completed}
        hint={undefined}
      />

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recommended / Optional</div>
          <div className="text-xs text-slate-400">Ask: &quot;What training is available?&quot;</div>
        </div>
        {recommended.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-400">No additional active programs configured right now.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recommended.map((p) => (
              <ProgramCard key={p.id} program={p} />
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
            No requests yet. Ask HR Concierge if you&apos;re interested in a mentor or executive coaching.
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

function TrainingSection({
  title,
  emptyText,
  entries,
  hint,
}: {
  title: string;
  emptyText: string;
  entries: MyTrainingEntry[];
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
        {hint && <div className="text-xs text-slate-400">{hint}</div>}
      </div>
      {entries.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-slate-400">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {entries.map((t) => (
            <TrainingCard key={t.id} entry={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TrainingCard({ entry }: { entry: MyTrainingEntry }) {
  const action =
    entry.status === "in_progress"
      ? `Ask: "Continue ${entry.programName}"`
      : entry.status === "assigned" || entry.status === "confirmed"
        ? `Ask: "Start ${entry.programName}"`
        : null;

  return (
    <li className={`px-6 py-3 ${entry.overdue ? "bg-red-50/50" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-800">
            {entry.programName}
            {entry.mandatory && (
              <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                Required
              </span>
            )}
          </div>
          {entry.programDescription && <p className="mt-0.5 text-xs text-slate-500">{entry.programDescription}</p>}
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-400">
            {entry.durationLabel && <span>{entry.durationLabel}</span>}
            {entry.deliveryMode && <span>{entry.deliveryMode}</span>}
            {entry.dueDate && (
              <span className={entry.overdue ? "font-semibold text-red-600" : ""}>
                Due {entry.dueDate}
                {entry.overdue ? " · overdue" : ""}
              </span>
            )}
          </div>
          {action && <div className="mt-1 text-xs text-indigo-600">{action}</div>}
        </div>
        <TrainingStatusBadge status={entry.status} />
      </div>
    </li>
  );
}

function ProgramCard({ program }: { program: TrainingProgram }) {
  return (
    <li className="px-6 py-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-slate-800">{program.name}</div>
        {program.nextCohortStart && <div className="text-xs text-slate-400">Next cohort {program.nextCohortStart}</div>}
      </div>
      {program.description && <p className="mt-1 text-xs text-slate-500">{program.description}</p>}
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-400">
        {program.durationLabel && <span>{program.durationLabel}</span>}
        {program.deliveryMode && <span>{program.deliveryMode}</span>}
        {program.requiresManagerApproval && <span>Manager/HR approval required</span>}
      </div>
      <div className="mt-1 text-xs text-indigo-600">Ask: &quot;I want to enroll in {program.name}&quot;</div>
    </li>
  );
}

function TrainingStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    assigned: "bg-amber-50 text-amber-700 border-amber-200",
    requested: "bg-amber-50 text-amber-700 border-amber-200",
    confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    in_progress: "bg-sky-50 text-sky-700 border-sky-200",
    waitlisted: "bg-sky-50 text-sky-700 border-sky-200",
    declined: "bg-red-50 text-red-700 border-red-200",
    cancelled: "bg-slate-50 text-slate-500 border-slate-200",
    completed: "bg-indigo-50 text-indigo-700 border-indigo-200",
  };
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize whitespace-nowrap ${styles[status] ?? styles.cancelled}`}>
      {status.replace("_", " ")}
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
