import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export interface ConversationHistoryMessage {
  role: "employee" | "assistant";
  content: string;
}

export interface ConversationHistoryResult {
  conversationId: string | null;
  messages: ConversationHistoryMessage[];
}

// Generous cap for a resumed conversation VIEW — deliberately independent
// of the orchestrator's own MAX_HISTORY_MESSAGES (20), which bounds how
// much history is replayed into the model's context, not how much an
// employee can scroll back through.
const MAX_HISTORY_MESSAGES = 50;

/**
 * Returns the given employee's own most recent conversation and its
 * messages — safe fields ONLY (role, content), never tool_calls or any
 * other column. Deliberately takes ONLY an employeeId (already verified
 * server-side from the signed session token by the caller) — never a
 * conversationId from the client — so there is no id-guessing / IDOR
 * surface for this read at all: an employee can only ever see their own
 * latest conversation, full stop. Organization isolation is inherited
 * from employee identification itself (see identity.ts) — a session can
 * only ever exist for one employeeId, which belongs to exactly one
 * organization.
 */
export async function getMyLatestConversation(employeeId: string): Promise<ConversationHistoryResult> {
  const supabase = createServiceClient();

  const { data: conversation, error: convErr } = await supabase
    .from("concierge_conversations")
    .select("id")
    .eq("employee_id", employeeId)
    .order("last_activity_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // No conversation yet, or a transient read error — both fail closed to
  // "nothing to resume" rather than surfacing any error detail. A brand
  // new conversation is created the normal way on the employee's next
  // message (see /api/concierge/message), so this is never a dead end.
  if (convErr || !conversation) return { conversationId: null, messages: [] };

  const { data: rows, error: msgErr } = await supabase
    .from("concierge_messages")
    .select("role, content")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true })
    .limit(MAX_HISTORY_MESSAGES);

  if (msgErr || !rows || rows.length === 0) return { conversationId: null, messages: [] };

  const messages: ConversationHistoryMessage[] = rows
    .filter((r): r is { role: "employee" | "assistant"; content: string } => r.role === "employee" || r.role === "assistant")
    .map((r) => ({ role: r.role, content: r.content }));

  // A conversation row with no employee/assistant messages (e.g. an
  // interrupted first turn) has nothing useful to resume — same graceful
  // fallback as "no conversation at all".
  if (messages.length === 0) return { conversationId: null, messages: [] };

  return { conversationId: conversation.id, messages };
}
