"use client";

import { useState, useTransition } from "react";
import { createKnowledgeEntry, updateKnowledgeEntry } from "./actions";
import type { HrKnowledgeCategory } from "@/lib/concierge/knowledge";

interface ExistingEntry {
  id: string;
  category: HrKnowledgeCategory;
  topic: string | null;
  question: string | null;
  answer: string;
  keywords: string[] | null;
}

export function KnowledgeEntryForm({
  categories,
  existing,
  onDone,
}: {
  categories: readonly HrKnowledgeCategory[];
  existing?: ExistingEntry;
  onDone?: () => void;
}) {
  const [category, setCategory] = useState<HrKnowledgeCategory>(existing?.category ?? categories[0]);
  const [topic, setTopic] = useState(existing?.topic ?? "");
  const [question, setQuestion] = useState(existing?.question ?? "");
  const [answer, setAnswer] = useState(existing?.answer ?? "");
  const [keywords, setKeywords] = useState((existing?.keywords ?? []).join(", "));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const input = { category, topic, question, answer, keywords };
        if (existing) {
          await updateKnowledgeEntry(existing.id, input);
        } else {
          await createKnowledgeEntry(input);
          setTopic("");
          setQuestion("");
          setAnswer("");
          setKeywords("");
        }
        onDone?.();
      } catch (err: any) {
        setError(err?.message || "Could not save.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as HrKnowledgeCategory)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Topic</label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Annual Leave"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Question (as an employee might ask it)</label>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What is our annual leave policy?"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Answer</label>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={3}
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Keywords (comma-separated)</label>
        <input
          type="text"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="annual leave, vacation, pto"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving…" : existing ? "Save changes" : "Add entry"}
        </button>
        {existing && onDone && (
          <button type="button" onClick={onDone} className="text-sm text-slate-500 hover:text-slate-700">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
