"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/concierge", label: "Ask HR" },
  { href: "/concierge/my-hr", label: "My HR" },
  { href: "/concierge/my-learning", label: "My Learning" },
  { href: "/concierge/getting-started", label: "Getting Started" },
  { href: "/concierge/support", label: "Support" },
];

export function HubNav() {
  const pathname = usePathname();
  return (
    <div className="mx-auto max-w-3xl px-6 flex gap-4 border-t border-slate-100 pt-2 -mt-1 overflow-x-auto">
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
  );
}
