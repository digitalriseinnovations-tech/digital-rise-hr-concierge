"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { HR_KNOWLEDGE_CATEGORIES, type HrKnowledgeCategory } from "@/lib/concierge/knowledge";

interface EntryInput {
  category: HrKnowledgeCategory;
  topic: string;
  question: string;
  answer: string;
  keywords: string;
}

function parseKeywords(raw: string): string[] {
  return raw
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
}

function validate(input: EntryInput) {
  if (!HR_KNOWLEDGE_CATEGORIES.includes(input.category)) {
    throw new Error("Invalid category.");
  }
  if (!input.answer || input.answer.trim().length < 5) {
    throw new Error("Answer is required.");
  }
}

export async function createKnowledgeEntry(input: EntryInput) {
  await requirePermission("hr_knowledge.edit");
  validate(input);

  const supabase = await createClient();
  const { error } = await supabase.from("hr_knowledge_base").insert({
    category: input.category,
    topic: input.topic || null,
    question: input.question || null,
    answer: input.answer.trim(),
    keywords: parseKeywords(input.keywords),
    active: true,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/hr-knowledge");
}

export async function updateKnowledgeEntry(id: string, input: EntryInput) {
  await requirePermission("hr_knowledge.edit");
  validate(input);

  const supabase = await createClient();
  const { error } = await supabase
    .from("hr_knowledge_base")
    .update({
      category: input.category,
      topic: input.topic || null,
      question: input.question || null,
      answer: input.answer.trim(),
      keywords: parseKeywords(input.keywords),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/hr-knowledge");
}

export async function setKnowledgeEntryActive(id: string, active: boolean) {
  await requirePermission("hr_knowledge.edit");

  const supabase = await createClient();
  const { error } = await supabase
    .from("hr_knowledge_base")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/hr-knowledge");
}
