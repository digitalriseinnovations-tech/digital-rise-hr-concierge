import Link from "next/link";
import { searchHrKnowledge } from "@/lib/concierge/knowledge";
import { listTrainingPrograms } from "@/lib/concierge/training";
import { getOrgDisplayName } from "@/lib/concierge/org";
import { Compass, AlertTriangle, MessageCircle, ArrowRight } from "lucide-react";

export default async function GettingStartedPage() {
  const [onboarding, programs] = await Promise.all([
    searchHrKnowledge({ category: "onboarding", limit: 10 }),
    listTrainingPrograms(),
  ]);
  const mandatoryPrograms = programs.filter((p) => p.mandatory);
  const orgName = getOrgDisplayName();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Getting Started</h1>
        <p className="mt-1 text-sm text-slate-500">
          Onboarding guidance for your first weeks at {orgName}, grounded in the real HR knowledge base — ask
          AIVA anything below for more detail.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
          <Compass className="h-3.5 w-3.5 text-slate-400" />
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">First-week guidance</div>
        </div>
        {onboarding.entries.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-400">
            No onboarding guidance configured yet — ask AIVA and it will connect you with HR.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {onboarding.entries.map((entry) => (
              <li key={entry.id} className="px-6 py-4 transition-colors hover:bg-slate-50/60">
                <div className="text-sm font-semibold text-slate-800">{entry.topic || entry.question}</div>
                <p className="mt-1 text-sm text-slate-600">{entry.answer}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {mandatoryPrograms.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Mandatory training</div>
          </div>
          <ul className="space-y-0.5 pl-1 text-sm text-amber-800">
            {mandatoryPrograms.map((p) => (
              <li key={p.id} className="list-disc pl-4 marker:text-amber-400">
                {p.name}
                {p.durationLabel ? ` — ${p.durationLabel}` : ""}
              </li>
            ))}
          </ul>
          <Link
            href="/concierge/my-learning"
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:underline"
          >
            View in My Learning <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Need something else?</div>
        <p className="text-sm text-slate-600 mb-4">
          For IT/system access, benefits enrollment, or anything not covered here, ask AIVA directly — it can
          answer from {orgName}&apos;s HR policies or connect you with a real person.
        </p>
        <Link
          href="/concierge"
          className="group inline-flex items-center gap-1.5 rounded-xl bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-card transition hover:shadow-card-hover"
        >
          <MessageCircle className="h-4 w-4" />
          Ask AIVA
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
