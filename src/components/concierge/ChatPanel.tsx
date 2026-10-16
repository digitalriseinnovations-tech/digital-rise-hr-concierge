"use client";

import { useRef, useState } from "react";
import { ConciergeMarkdown } from "./conciergeMarkdown";
import { Sparkles, Send, ShieldCheck, ArrowRight, AlertCircle, MessageCircleHeart } from "lucide-react";

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
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <div className="flex items-center gap-2.5 border-b border-slate-100 bg-slate-50/60 px-6 py-3.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-gradient text-white">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-800">HR Concierge</div>
          <div className="text-[11px] text-slate-400">AI Employee · grounded in your HR data</div>
        </div>
      </div>

      {messages.length === 0 ? (
        <div className="p-6">
          <div className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Try asking</div>
          <div className="flex flex-wrap gap-2">
            {suggestedPrompts.map((prompt) => (
              <button
                key={prompt}
                onClick={() => send(prompt)}
                className="rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-sm text-slate-700 transition hover:-translate-y-0.5 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 hover:shadow-card"
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
          {loading && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>
      )}

      {error && (
        <div className="mx-6 mb-2 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-center gap-2.5 border-t border-slate-200 p-4">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask HR anything…"
          className="flex-1 rounded-full border border-slate-200 bg-slate-50/60 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white shadow-card transition hover:shadow-card-hover disabled:opacity-40"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>

      <div className="border-t border-slate-100 px-4 py-3 text-center">
        <button
          onClick={() => send("I'd like to speak with HR directly.")}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition hover:text-indigo-600"
        >
          <MessageCircleHeart className="h-3.5 w-3.5" />
          Talk to a human in HR instead
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 animate-fade-in">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-white">
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <div className="flex items-center gap-1 rounded-2xl bg-slate-100 px-4 py-3">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isEmployee = message.role === "employee";
  return (
    <div className={`flex items-end gap-2 animate-fade-up ${isEmployee ? "justify-end" : "justify-start"}`}>
      {!isEmployee && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-white">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
      )}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
          isEmployee ? "bg-brand-gradient text-white shadow-card" : "bg-slate-100 text-slate-800"
        }`}
      >
        {isEmployee ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <ConciergeMarkdown content={message.content} />
        )}
        {!isEmployee && message.usedKnowledge && (
          <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600">
            <ShieldCheck className="h-3 w-3" />
            Grounded in verified HR knowledge
          </div>
        )}
        {!isEmployee && message.escalated && (
          <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600">
            <AlertCircle className="h-3 w-3" />
            HR has been notified and will follow up
          </div>
        )}
      </div>
    </div>
  );
}
