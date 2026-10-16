"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { MessageCircle, CalendarCheck, GraduationCap, Compass, LifeBuoy, LogOut, Loader2 } from "lucide-react";

const TABS = [
  { href: "/concierge", label: "Ask HR", icon: MessageCircle },
  { href: "/concierge/my-hr", label: "My HR", icon: CalendarCheck },
  { href: "/concierge/my-learning", label: "My Learning", icon: GraduationCap },
  { href: "/concierge/getting-started", label: "Getting Started", icon: Compass },
  { href: "/concierge/support", label: "Support", icon: LifeBuoy },
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
    <div className="mx-auto max-w-4xl px-6 flex items-center justify-between gap-4">
      <div className="flex gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-t-lg px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                active
                  ? "text-indigo-600 border-indigo-600 bg-indigo-50/60"
                  : "text-slate-500 border-transparent hover:text-indigo-600 hover:bg-slate-50"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </Link>
          );
        })}
      </div>
      <button
        onClick={signOut}
        disabled={signingOut}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2.5 text-xs font-medium text-slate-400 transition-colors hover:text-red-600 disabled:opacity-60"
      >
        {signingOut ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
