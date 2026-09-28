"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReminderButton({ registrationId, lastSentAt }: { registrationId: string; lastSentAt: string | null }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [justSent, setJustSent] = useState(false);

  async function handleClick() {
    setSending(true);
    try {
      const res = await fetch("/api/training/reminders/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationId }),
      });
      if (res.ok) {
        setJustSent(true);
        router.refresh();
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button onClick={handleClick} disabled={sending} className="btn-ghost text-xs px-2.5 py-1">
        {sending ? "Sending…" : "Send Reminder"}
      </button>
      {(justSent || lastSentAt) && (
        <span className="text-[10px] text-slate-400">
          Last: {new Date(justSent ? Date.now() : lastSentAt!).toLocaleDateString("en", { dateStyle: "short" })} (demo — not delivered)
        </span>
      )}
    </div>
  );
}
