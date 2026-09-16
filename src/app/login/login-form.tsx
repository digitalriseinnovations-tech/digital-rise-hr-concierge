"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ProductBranding } from "@/lib/product-mode";

function LoginFormInner({ branding }: { branding: ProductBranding }) {
  const router = useRouter();
  const params = useSearchParams();
  const errorParam = params.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    errorParam === "no_access" ? branding.noAccessMessage : null,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="min-h-screen grid place-items-center px-6" style={{ background: "linear-gradient(135deg, #f6f9ff 0%, #dbe4f3 100%)" }}>
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-8">
          <div className="text-[11px] font-bold tracking-[0.2em] uppercase text-navy-700 mb-2">{branding.name.toUpperCase()}</div>
          <h1 className="font-display text-3xl font-extrabold text-navy-700 mb-2">{branding.loginHeading}</h1>
          {branding.loginSupportingCopy && (
            <p className="text-sm text-slate-600 mb-1">{branding.loginSupportingCopy}</p>
          )}
          <p className="text-sm text-slate-500">{branding.loginAccessCopy}</p>
        </div>

        <form onSubmit={submit} className="section-card space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              placeholder={branding.emailPlaceholder}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Password</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-xs text-slate-400 text-center mt-6">
          {branding.loginFooterNote}
        </p>
      </div>
    </div>
  );
}

export function LoginForm({ branding }: { branding: ProductBranding }) {
  return (
    <Suspense fallback={<div className="min-h-screen grid place-items-center text-slate-500">Loading…</div>}>
      <LoginFormInner branding={branding} />
    </Suspense>
  );
}
