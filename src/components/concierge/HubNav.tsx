"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const TABS = [
  { href: "/concierge", label: "Ask HR" },
  { href: "/concierge/my-hr", label: "My HR" },
  { href: "/concierge/my-learning", label: "My Learning" },
  { href: "/concierge/getting-started", label: "Getting Started" },
  { href: "/concierge/support", label: "Support" },
];

export function HubNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  // HR-product-scoped only — clears the concierge_session cookie via the
  // dedicated /api/concierge/logout route, entirely independent of
  // Supabase Auth staff sessions (see sidebar.tsx's own signOut() for the
  // separate staff-side equivalent). Redirects to /concierge/identify,
  // which the hub layout's own session check would redirect to anyway on
  // the next protected-route visit — doing it explicitly here just skips
  // the extra round trip.
  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/concierge/logout", { method: "POST" });
    } finally {
      router.push("/concierge/identify");
      router.refresh();
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 flex items-center justify-between gap-4 border-t border-slate-100 pt-2 -mt-1">
      <div className="flex gap-4 overflow-x-auto">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`text-sm font-medium pb-2 border-b-2 whitespace-nowrap transition-colors ${
                active ? "text-indigo-600 border-indigo-600" : "text-slate-500 border-transparent hover:text-indigo-600"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      <button
        onClick={signOut}
        disabled={signingOut}
        className="text-xs font-medium text-slate-400 hover:text-red-600 transition-colors pb-2 whitespace-nowrap"
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
