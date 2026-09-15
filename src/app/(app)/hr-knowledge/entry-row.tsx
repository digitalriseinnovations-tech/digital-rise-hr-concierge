"use client";

import { useState, useTransition } from "react";
import { setKnowledgeEntryActive } from "./actions";
import { KnowledgeEntryForm } from "./entry-form";
import type { HrKnowledgeCategory } from "@/lib/concierge/knowledge";

interface Entry {
  id: string;
  category: HrKnowledgeCategory;
  topic: string | null;
  question: string | null;
  answer: string;
  keywords: string[] | null;
  active: boolean;
  updated_at: string;
}

export function KnowledgeEntryRow({
  entry,
  canEdit,
  categories,
}: {
  entry: Entry;
  canEdit: boolean;
  categories: readonly HrKnowledgeCategory[];
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  if (editing) {
    return (
      <tr>
        <td colSpan={canEdit ? 6 : 5} className="p-4 bg-slate-50">
          <KnowledgeEntryForm categories={categories} existing={entry} onDone={() => setEditing(false)} />
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td><span className="badge badge-slate capitalize">{entry.category}</span></td>
      <td>
        <div className="font-medium text-slate-800">{entry.topic || "—"}</div>
        {entry.question && <div className="text-xs text-slate-400">{entry.question}</div>}
      </td>
      <td className="max-w-md text-sm text-slate-600">{entry.answer}</td>
      <td>
        {entry.active ? (
          <span className="badge badge-green">Active</span>
        ) : (
          <span className="badge badge-slate">Inactive</span>
        )}
      </td>
      <td className="text-xs text-slate-400">{new Date(entry.updated_at).toLocaleDateString("en", { dateStyle: "medium" })}</td>
      {canEdit && (
        <td className="whitespace-nowrap">
          <button onClick={() => setEditing(true)} className="text-xs text-indigo-600 hover:underline mr-3">
            Edit
          </button>
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await setKnowledgeEntryActive(entry.id, !entry.active);
              })
            }
            className="text-xs text-slate-500 hover:underline"
          >
            {entry.active ? "Deactivate" : "Activate"}
          </button>
        </td>
      )}
    </tr>
  );
}
