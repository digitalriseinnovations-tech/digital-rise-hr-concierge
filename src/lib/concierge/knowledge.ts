import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * The deterministic HR knowledge retrieval service — the "deterministic
 * knowledge service" box in the approved architecture diagram:
 *
 *   Employee Request → HR Concierge Reasoning → permission-controlled Tool
 *     → deterministic knowledge service → grounded response / escalation
 *
 * This is the ONE retrieval implementation. search_hr_knowledge and the
 * three category-scoped tools (onboarding/mentorship/coaching) all call
 * THIS function with different arguments — there is no second knowledge
 * architecture. V0.1 does keyword/category matching against
 * hr_knowledge_base; a future version can replace the query inside
 * searchHrKnowledge() with semantic/hybrid retrieval without changing this
 * function's signature or any caller (the orchestrator, the tools, the
 * admin UI) — that's the swappable boundary.
 */

export const HR_KNOWLEDGE_CATEGORIES = [
  "leave", "benefits", "onboarding", "policies", "learning",
  "mentorship", "coaching", "wellbeing", "general",
] as const;

export type HrKnowledgeCategory = (typeof HR_KNOWLEDGE_CATEGORIES)[number];

export interface KnowledgeEntry {
  id: string;
  category: HrKnowledgeCategory;
  topic: string | null;
  question: string | null;
  answer: string;
}

export interface KnowledgeSearchParams {
  /** Free-text query — matched against question/answer/keywords. Optional
   * when a category alone is enough (e.g. "show me onboarding info"). */
  query?: string;
  category?: HrKnowledgeCategory;
  limit?: number;
}

export interface KnowledgeSearchResult {
  entries: KnowledgeEntry[];
  /** True if at least one entry was found — the orchestrator/prompt use
   * this to decide whether grounded content exists at all. */
  found: boolean;
}

const DEFAULT_LIMIT = 5;

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

/**
 * Keyword/category retrieval over hr_knowledge_base (active entries only).
 * Uses the service-role client the same way the rest of this app's public
 * flows already do (e.g. /api/leave-submit) — this is organization-wide HR
 * policy content, not per-employee data, so there is nothing employee-
 * specific to scope here.
 */
export async function searchHrKnowledge(params: KnowledgeSearchParams): Promise<KnowledgeSearchResult> {
  const supabase = createServiceClient();
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, 10);

  let builder = supabase
    .from("hr_knowledge_base")
    .select("id, category, topic, question, answer, keywords")
    .eq("active", true)
    .limit(limit);

  if (params.category) {
    builder = builder.eq("category", params.category);
  }

  const words = params.query ? tokenize(params.query) : [];
  if (words.length > 0) {
    // Match if ANY significant query word appears in the question, the
    // answer, or the keywords array — deliberately broad recall for a
    // keyword-stage retriever; precision is handled by the LLM choosing
    // what's actually relevant to state, grounded only in what's returned.
    const orClauses = words
      .flatMap((word) => [
        `question.ilike.%${word}%`,
        `answer.ilike.%${word}%`,
        `keywords.cs.{${word}}`,
      ])
      .join(",");
    builder = builder.or(orClauses);
  }

  const { data, error } = await builder;
  if (error) {
    // Fail closed — treat a query error as "nothing found", never throw a
    // raw DB error up to the model or the employee.
    return { entries: [], found: false };
  }

  const entries: KnowledgeEntry[] = (data ?? []).map((row) => ({
    id: row.id,
    category: row.category as HrKnowledgeCategory,
    topic: row.topic,
    question: row.question,
    answer: row.answer,
  }));

  return { entries, found: entries.length > 0 };
}
