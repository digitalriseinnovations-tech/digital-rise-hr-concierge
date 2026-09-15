import Link from "next/link";
import { searchHrKnowledge } from "@/lib/concierge/knowledge";
import { listTrainingPrograms } from "@/lib/concierge/training";

export default async function GettingStartedPage() {
  const [onboarding, programs] = await Promise.all([
    searchHrKnowledge({ category: "onboarding", limit: 10 }),
    listTrainingPrograms(),
  ]);
  const mandatoryPrograms = programs.filter((p) => p.mandatory);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Getting Started</h1>
        <p className="mt-1 text-sm text-slate-500">
          Onboarding guidance for your first weeks at Northstar Global, grounded in the real HR knowledge base — ask
          HR Concierge anything below for more detail.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-400">
          First-week guidance
        </div>
        {onboarding.entries.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-400">
            No onboarding guidance configured yet — ask HR Concierge and it will connect you with HR.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {onboarding.entries.map((entry) => (
              <li key={entry.id} className="px-6 py-4">
                <div className="text-sm font-semibold text-slate-800">{entry.topic || entry.question}</div>
                <p className="mt-1 text-sm text-slate-600">{entry.answer}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {mandatoryPrograms.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1">Mandatory training</div>
          <ul className="text-sm text-amber-800 list-disc pl-5 space-y-0.5">
            {mandatoryPrograms.map((p) => (
              <li key={p.id}>
                {p.name}
                {p.durationLabel ? ` — ${p.durationLabel}` : ""}
              </li>
            ))}
          </ul>
          <Link href="/concierge/my-learning" className="mt-2 inline-block text-xs font-semibold text-amber-700 hover:underline">
            View in My Learning →
          </Link>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Need something else?</div>
        <p className="text-sm text-slate-600 mb-3">
          For IT/system access, benefits enrollment, or anything not covered here, ask HR Concierge directly — it can
          answer from Northstar Global's HR policies or connect you with a real person.
        </p>
        <Link
          href="/concierge"
          className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Ask HR Concierge
        </Link>
      </div>
    </div>
  );
}
