"use client";

import { useRef, useState } from "react";

interface ChatMessage {
  role: "employee" | "assistant";
  content: string;
  usedKnowledge?: boolean;
  escalated?: boolean;
}

export function ChatPanel({ suggestedPrompts }: { suggestedPrompts: string[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setError(null);
    setMessages((prev) => [...prev, { role: "employee", content: trimmed }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/concierge/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: trimmed }),
      });

      // The response arrived (this is not a network failure), but its body
      // might not be valid JSON — e.g. an unhandled server error that
      // reached Next.js's own generic error page instead of our route's
      // own JSON response. Parsing that separately from the fetch() itself
      // means a server-side bug shows an accurate message here instead of
      // being misreported as "Network error".
      let body: { error?: string; conversationId?: string; reply?: string; usedKnowledge?: boolean; escalated?: boolean } | null = null;
      try {
        body = await res.json();
      } catch {
        setError("Something went wrong on our side. Please try again.");
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setError(body?.error || "Something went wrong.");
        setLoading(false);
        return;
      }

      setConversationId(body!.conversationId!);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: body!.reply!, usedKnowledge: body!.usedKnowledge, escalated: body!.escalated },
      ]);
    } catch {
      // fetch() itself threw — a genuine network-level failure (offline,
      // DNS, CORS, etc), distinct from the response-arrived-but-bad-body
      // case handled above.
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      {messages.length === 0 ? (
        <div className="p-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Try asking</div>
          <div className="flex flex-wrap gap-2">
            {suggestedPrompts.map((prompt) => (
              <button
                key={prompt}
                onClick={() => send(prompt)}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="max-h-[60vh] space-y-4 overflow-y-auto p-6">
          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}
          {loading && (
            <div className="text-sm text-slate-400">HR Concierge is thinking…</div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {error && <div className="px-6 pb-2 text-sm text-red-600">{error}</div>}

      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-slate-200 p-4">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask HR anything…"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          disabled={loading}
        />
        <button
          type="button"
          title="Voice input — coming soon"
          disabled
          className="rounded-lg border border-slate-200 px-3 py-2 text-slate-300"
        >
          🎤
        </button>
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          Send
        </button>
      </form>

      <div className="border-t border-slate-100 px-4 py-3 text-center">
        <button
          onClick={() => send("I'd like to speak with HR directly.")}
          disabled={loading}
          className="text-xs font-semibold text-slate-500 underline decoration-dotted underline-offset-2 hover:text-indigo-600"
        >
          Talk to a human in HR instead
        </button>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isEmployee = message.role === "employee";
  return (
    <div className={`flex ${isEmployee ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
        isEmployee ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-800"
      }`}>
        <div className="whitespace-pre-wrap">{message.content}</div>
        {!isEmployee && message.usedKnowledge && (
          <div className="mt-1.5 text-[11px] font-medium text-indigo-600">✓ Grounded in Northstar Global HR knowledge</div>
        )}
        {!isEmployee && message.escalated && (
          <div className="mt-1.5 text-[11px] font-medium text-amber-600">→ HR has been notified and will follow up</div>
        )}
      </div>
    </div>
  );
}
