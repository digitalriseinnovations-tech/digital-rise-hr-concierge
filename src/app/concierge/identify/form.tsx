"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function IdentifyForm() {
  const router = useRouter();
  const [employeeCode, setEmployeeCode] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/concierge/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_code: employeeCode, email }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Could not verify your details.");
        setLoading(false);
        return;
      }
      router.push("/concierge");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
          Employee code
        </label>
        <input
          type="text"
          value={employeeCode}
          onChange={(e) => setEmployeeCode(e.target.value)}
          placeholder="NSG-1001"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          autoComplete="off"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
          Work email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@northstarglobal.com"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          autoComplete="off"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading ? "Verifying…" : "Continue"}
      </button>
      <p className="text-center text-xs text-slate-400">Demo environment · Northstar Global (fictional)</p>
    </form>
  );
}
