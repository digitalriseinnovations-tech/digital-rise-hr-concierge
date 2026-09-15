"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { FinanceRole } from "@/lib/auth";

interface NavItem {
  label: string;
  href: string;
  icon: string;
  // Which roles can SEE this nav item. Server still re-checks on the page.
  roles: FinanceRole[];
}

// Grouped so the HR Concierge product surfaces as one coherent block
// (Insights -> Knowledge -> Learning -> Requests -> Leave -> Employees) for
// the "hr" role, ahead of legacy Finance-only screens in the shared admin
// shell. Finance/Payroll items are unchanged and already role-gated away
// from "hr" — see the Slice 5 report's LEGACY UI / FUTURE EXTRACTION note
// for why this shell isn't being physically split in this sprint.
//
// HR product isolation (this task): "Dashboard" (Finance KPIs, no
// permission gate), "Reports", and "Import / Export" (both unbuilt
// Finance-flavored "coming soon" stubs) are deliberately NOT in the "hr"
// role's list — Concierge Insights is HR's equivalent landing view, and
// neither stub has any HR-relevant content yet. finance/admin/viewer see
// all three completely unchanged.
const NAV: NavItem[] = [
  { label: "Dashboard",          href: "/",                   icon: "▣", roles: ["admin", "finance", "viewer"] },
  { label: "Concierge Insights", href: "/concierge-insights", icon: "◆", roles: ["admin", "hr"] },
  { label: "HR Knowledge",       href: "/hr-knowledge",       icon: "❋", roles: ["admin", "hr"] },
  { label: "HR Learning",        href: "/hr-learning",        icon: "◈", roles: ["admin", "hr"] },
  { label: "Employee Requests",  href: "/employee-requests",  icon: "✉", roles: ["admin", "hr"] },
  { label: "Leave",              href: "/leave",              icon: "◐", roles: ["admin", "hr", "finance"] },
  { label: "Employees",          href: "/employees",          icon: "◉", roles: ["admin", "finance", "hr", "viewer"] },
  { label: "Benefits",           href: "/benefits",           icon: "✦", roles: ["admin", "finance", "hr"] },
  { label: "Payroll",            href: "/payroll",            icon: "◧", roles: ["admin", "finance"] },
  { label: "Payslips",           href: "/payslips",           icon: "◊", roles: ["admin", "finance"] },
  { label: "Sales Bonus",        href: "/bonus",              icon: "▲", roles: ["admin", "finance"] },
  { label: "Reports",            href: "/reports",            icon: "▦", roles: ["admin", "finance", "viewer"] },
  { label: "Import / Export",    href: "/io",                 icon: "⇄", roles: ["admin", "finance"] },
  { label: "Audit Logs",         href: "/audit",              icon: "⚐", roles: ["admin"] },
  { label: "Settings",           href: "/settings",           icon: "⚙", roles: ["admin"] },
];

export function Sidebar({ userName, role }: { userName: string; role: FinanceRole }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const visible = NAV.filter((n) => n.roles.includes(role));

  async function signOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside
      className="border-r border-slate-200 bg-white flex flex-col h-screen sticky top-0 transition-all duration-200"
      style={{ width: collapsed ? 72 : 240 }}
    >
      <div className="px-5 py-5 border-b border-slate-200 flex items-center justify-between">
        {!collapsed && (
          <div>
            {role === "hr" ? (
              <>
                <div className="text-[10px] tracking-[0.18em] font-bold text-navy-700 uppercase">Digital Rise</div>
                <div className="font-display text-lg font-extrabold text-navy-700 leading-none">HR Concierge</div>
              </>
            ) : (
              <>
                <div className="text-[10px] tracking-[0.18em] font-bold text-navy-700 uppercase">Verofax</div>
                <div className="font-display text-lg font-extrabold text-navy-700 leading-none">Finance</div>
              </>
            )}
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-slate-400 hover:text-navy-700 text-sm"
          aria-label="Collapse sidebar"
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-3">
        {visible.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mb-0.5 ${
                active
                  ? "bg-navy-50 text-navy-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-navy-700"
              }`}
              style={active ? { background: "rgba(0,64,160,0.08)", color: "#002060" } : undefined}
            >
              <span className="text-base w-5 text-center" style={{ color: active ? "#0040A0" : undefined }}>{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 px-3 py-3">
        {!collapsed ? (
          <div className="px-2 py-2">
            <div className="text-sm font-semibold text-slate-700 truncate">{userName}</div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mt-0.5">{role}</div>
            <button
              onClick={signOut}
              disabled={signingOut}
              className="mt-3 text-xs text-slate-500 hover:text-red-600 transition-colors"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        ) : (
          <button
            onClick={signOut}
            disabled={signingOut}
            className="w-full text-slate-400 hover:text-red-600 text-lg py-2"
            title="Sign out"
          >
            ⏻
          </button>
        )}
      </div>
    </aside>
  );
}
