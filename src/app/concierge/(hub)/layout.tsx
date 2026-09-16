import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySessionToken, getEmployeeById, SESSION_COOKIE_NAME } from "@/lib/concierge/identity";
import { HubNav } from "@/components/concierge/HubNav";

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

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600">Digital Rise</div>
            <div className="text-lg font-extrabold text-slate-900">HR Concierge</div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">AI Employee</div>
          </div>
          <div className="text-sm text-slate-500">
            Signed in as <span className="font-semibold text-slate-700">{employee.firstName}</span>
          </div>
        </div>
        <HubNav />
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </div>
  );
}
