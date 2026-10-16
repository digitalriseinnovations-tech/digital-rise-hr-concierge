import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySessionToken, getEmployeeById, SESSION_COOKIE_NAME } from "@/lib/concierge/identity";
import { HubNav } from "@/components/concierge/HubNav";
import { Sparkles } from "lucide-react";

export const metadata = {
  title: "HR Concierge — Digital Rise",
  // Explicit override — without this, Next.js metadata merging inherits
  // the ROOT layout's product-mode-driven description (see
  // src/app/layout.tsx / src/lib/product-mode.ts).
  description: "Digital Rise HR Concierge — your AI Employee for HR questions, leave, learning, and support.",
  robots: { index: false, follow: false },
};

// This route group ((hub)) is the session-gated part of /concierge.
// /concierge/identify lives OUTSIDE this group deliberately — it has its
// own layout with no session check, so verifying identity there can never
// trigger this redirect back to itself.
export default async function ConciergeHubLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  if (!session) {
    redirect("/concierge/identify");
  }

  const employee = await getEmployeeById(session.employeeId);
  if (!employee) {
    redirect("/concierge/identify");
  }

  const initial = employee.firstName.charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-[#f6f9ff]">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-card">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-600">Digital Rise</div>
              <div className="text-sm font-extrabold leading-tight text-slate-900">HR Concierge</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="hidden text-sm text-slate-500 sm:inline">
              Hi, <span className="font-semibold text-slate-700">{employee.firstName}</span>
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
              {initial}
            </div>
          </div>
        </div>
        <HubNav />
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
    </div>
  );
}
