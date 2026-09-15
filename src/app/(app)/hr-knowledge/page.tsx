import { requireUser, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { HR_KNOWLEDGE_CATEGORIES } from "@/lib/concierge/knowledge";
import { KnowledgeEntryRow } from "./entry-row";
import { KnowledgeEntryForm } from "./entry-form";

export const metadata = { title: "HR Knowledge — Digital Rise HR", description: "Digital Rise HR Concierge — HR knowledge base." };

export const dynamic = "force-dynamic";

export default async function HrKnowledgePage() {
  const user = await requireUser();
  const canEdit = can(user.role, "hr_knowledge.edit");
  const supabase = await createClient();

  const { data: entries } = await supabase
    .from("hr_knowledge_base")
    .select("id, category, topic, question, answer, keywords, active, updated_at")
    .order("category", { ascending: true })
    .order("updated_at", { ascending: false });

  return (
    <div>
      <header className="mb-6">
        <div className="text-[11px] tracking-[0.18em] uppercase font-bold text-navy-500 mb-2">HR Concierge</div>
        <h1 className="font-display text-3xl font-extrabold text-navy-700">HR Knowledge</h1>
        <p className="text-sm text-slate-500 mt-1">
          {(entries ?? []).length} entries · this is exactly what HR Concierge is allowed to tell employees —
          nothing else. It cannot invent policy beyond what's active here.
        </p>
      </header>

      {canEdit && (
        <div className="section-card mb-6">
          <h2 className="text-sm font-bold text-navy-700 mb-3">Add knowledge entry</h2>
          <KnowledgeEntryForm categories={HR_KNOWLEDGE_CATEGORIES} />
        </div>
      )}

      <div className="section-card overflow-x-auto p-0">
        <table className="table-clean">
          <thead>
            <tr>
              <th>Category</th>
              <th>Topic / Question</th>
              <th>Answer</th>
              <th>Status</th>
              <th>Updated</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {(entries ?? []).map((entry) => (
              <KnowledgeEntryRow key={entry.id} entry={entry} canEdit={canEdit} categories={HR_KNOWLEDGE_CATEGORIES} />
            ))}
            {(entries ?? []).length === 0 && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="text-center text-sm text-slate-400 py-8">
                  No knowledge entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
