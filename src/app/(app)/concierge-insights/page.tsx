import { requirePermission } from "@/lib/auth";
import { computeConciergeInsights, computeKnowledgeGaps } from "@/lib/concierge/insights";

export const metadata = { title: "Concierge Insights — Digital Rise HR", description: "Digital Rise HR Concierge — admin insights." };
export const dynamic = "force-dynamic";

export default async function ConciergeInsightsPage() {
  await requirePermission("concierge_insights.view");

  const [insights, gaps] = await Promise.all([computeConciergeInsights(), computeKnowledgeGaps()]);
  const categoryEntries = Object.entries(insights.knowledgeCategoryQueryCounts).sort((a, b) => b[1] - a[1]);
  const maxCategoryCount = categoryEntries.length > 0 ? Math.max(...categoryEntries.map(([, c]) => c)) : 0;

  return (
    <div>
      <header className="mb-6">
        <div className="text-[11px] tracking-[0.18em] uppercase font-bold text-navy-500 mb-2">HR Concierge</div>
        <h1 className="font-display text-3xl font-extrabold text-navy-700">Concierge Insights</h1>
        <p className="text-sm text-slate-500 mt-1">
          What HR Concierge is actually handling, computed directly from real conversation and request data —
          nothing here is a static or invented figure.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Conversations" value={insights.totalConversations} />
        <StatCard label="Employee messages" value={insights.totalEmployeeMessages} />
        <StatCard label="Tool actions completed" value={insights.totalToolActionsCompleted} />
        <StatCard label="Escalated to HR" value={insights.escalatedConversations} sub={`${insights.hrEscalations} escalation(s) logged`} />
        <StatCard label="Leave requests via Concierge" value={insights.leaveRequestsViaConcierge} />
        <StatCard
          label="Training enrollments"
          value={insights.trainingEnrollments.total}
          sub={`${insights.trainingEnrollments.confirmed} confirmed · ${insights.trainingEnrollments.requested} pending approval · ${insights.trainingEnrollments.waitlisted} waitlisted`}
        />
        <StatCard label="Mentorship requests" value={insights.mentorshipRequests} />
        <StatCard label="Coaching requests" value={insights.coachingRequests} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="section-card">
          <h2 className="text-sm font-bold text-navy-700 mb-1">Estimated time saved</h2>
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 inline-block mb-3 font-semibold uppercase tracking-wide">
            Estimate, not measured
          </p>
          <div className="text-3xl font-extrabold text-indigo-600 mb-1">
            {insights.estimate.estimatedMinutesSaved.toLocaleString()} minutes
          </div>
          <p className="text-xs text-slate-500">
            {insights.estimate.resolvedSelfServiceInteractions} self-service answer(s) resolved without escalation ×{" "}
            {insights.estimate.minutesPerQueryAssumption} min/query assumption.
          </p>
          <p className="text-[11px] text-slate-400 mt-2 font-mono">{insights.estimate.formula}</p>
        </div>

        <div className="section-card">
          <h2 className="text-sm font-bold text-navy-700 mb-3">Knowledge base coverage</h2>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-extrabold text-slate-800">{insights.activeKnowledgeEntries}</span>
            <span className="text-sm text-slate-500">active of {insights.totalKnowledgeEntries} entries</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-slate-800">{insights.activeTrainingPrograms}</span>
            <span className="text-sm text-slate-500">active training programs</span>
          </div>
        </div>
      </div>

      <div className="section-card mb-6">
        <h2 className="text-sm font-bold text-navy-700 mb-3">Most common knowledge categories</h2>
        {categoryEntries.length === 0 ? (
          <p className="text-sm text-slate-400">No grounded knowledge answers recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {categoryEntries.map(([category, count]) => (
              <div key={category} className="flex items-center gap-3">
                <div className="w-32 text-xs font-medium text-slate-600 capitalize shrink-0">{category}</div>
                <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden">
                  <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${maxCategoryCount ? (count / maxCategoryCount) * 100 : 0}%` }} />
                </div>
                <div className="w-8 text-right text-xs font-semibold text-slate-500">{count}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section-card overflow-x-auto p-0">
        <div className="px-4 pt-4">
          <h2 className="text-sm font-bold text-navy-700">Knowledge gaps</h2>
          <p className="text-xs text-slate-500 mt-1 mb-2">
            What employees keep asking that couldn't be grounded, or had to be escalated to a person. Questions are
            shown; full conversation transcripts are not.
          </p>
        </div>
        <table className="table-clean">
          <thead>
            <tr>
              <th>Employee question</th>
              <th>Outcome</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {gaps.map((gap, i) => (
              <tr key={i}>
                <td className="text-sm text-slate-700 max-w-lg">{gap.query}</td>
                <td>
                  <span className={`badge ${gap.status === "escalated" ? "badge-amber" : "badge-slate"} capitalize`}>{gap.status}</span>
                </td>
                <td className="text-xs text-slate-400">{new Date(gap.occurredAt).toLocaleDateString("en", { dateStyle: "medium" })}</td>
              </tr>
            ))}
            {gaps.length === 0 && (
              <tr>
                <td colSpan={3} className="text-center text-sm text-slate-400 py-8">
                  No knowledge gaps recorded yet — every grounded query so far has been answered or escalated cleanly.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="section-card">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">{label}</div>
      <div className="text-2xl font-extrabold text-navy-700">{value.toLocaleString()}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}
