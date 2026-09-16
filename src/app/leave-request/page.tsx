import { createServiceClient } from "@/lib/supabase/service";
import { getProductBranding } from "@/lib/product-mode";
import { LeaveRequestForm } from "./form";

const branding = getProductBranding();

export const metadata = {
  title: `Submit Leave Request — ${branding.pageTitle}`,
  robots: { index: false, follow: false },
};

// Always fetch the latest employee list + manager_email on every request.
// Without this, Next.js caches the page at build time so manager updates in
// the DB don't show up until the next deploy.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LeaveRequestPage() {
  let employees: any[] = [];
  let setupError: string | null = null;

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("employees")
      .select("id, full_name, employee_code, country, manager_email")
      .eq("status", "active")
      .order("full_name", { ascending: true });
    if (error) {
      setupError = `Database query failed: ${error.message}`;
    } else if (!data || data.length === 0) {
      setupError = "No employees found. Run supabase/seed_staff.sql in your Supabase SQL Editor to import the 18 staff.";
    } else {
      employees = data;
    }
  } catch (e: any) {
    setupError = e?.message || "Server configuration error.";
  }

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #f6f9ff 0%, #dbe4f3 100%)" }}>
      <div className="max-w-[640px] mx-auto px-6 py-12">
        <header className="text-center mb-8">
          <div className="text-[11px] font-bold tracking-[0.2em] uppercase text-navy-700 mb-2">{branding.name.toUpperCase()}</div>
          <h1 className="font-display text-3xl font-extrabold text-navy-700 mb-2">Submit Leave Request</h1>
          <p className="text-sm text-slate-500">Your manager will receive an email and decide. You'll be notified once approved or rejected.</p>
        </header>

        {setupError ? (
          <div className="section-card">
            <h2 className="font-display text-xl font-extrabold text-red-700 mb-3">⚠ Setup not complete</h2>
            <p className="text-sm text-slate-700 mb-3">{setupError}</p>
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer font-semibold mb-2">Setup checklist</summary>
              <ol className="list-decimal pl-5 space-y-1 mt-2">
                <li>In Supabase dashboard → <strong>Settings → API</strong>, copy the <strong>service_role secret</strong> (long key starting with <code>eyJ...</code>)</li>
                <li>Paste it into <code>D:\verofax-finance-app\.env.local</code> as <code>SUPABASE_SERVICE_ROLE_KEY=...</code></li>
                <li>In Supabase <strong>SQL Editor</strong> run, in order:
                  <ul className="list-disc pl-5 mt-1">
                    <li><code>supabase/migration_002_leave.sql</code></li>
                    <li><code>supabase/migration_003_commission.sql</code></li>
                    <li><code>supabase/seed_staff.sql</code> ← imports the 18 real staff</li>
                    <li><code>supabase/seed_commissions.sql</code></li>
                  </ul>
                </li>
                <li>Restart dev server (Ctrl+C then <code>npm run dev</code>)</li>
              </ol>
            </details>
          </div>
        ) : (
          <LeaveRequestForm employees={employees} emailPlaceholder={branding.emailPlaceholder} />
        )}

        <p className="text-xs text-slate-400 text-center mt-8">
          {branding.pageFooterLine}
        </p>
      </div>
    </div>
  );
}
