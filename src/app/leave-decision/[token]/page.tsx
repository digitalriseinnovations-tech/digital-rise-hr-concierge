import { createServiceClient } from "@/lib/supabase/service";
import { sendLeaveDecisionToEmployee } from "@/lib/email";
import { getProductBranding } from "@/lib/product-mode";
import { DecisionUI } from "./ui";

const branding = getProductBranding();

export const metadata = {
  title: `Leave Decision — ${branding.pageTitle}`,
  // Explicit override — without this, Next.js metadata merging inherits
  // the ROOT layout's product-mode-driven description (see
  // src/app/layout.tsx / src/lib/product-mode.ts) into this page too,
  // since only `title` was overridden.
  description: `${branding.fullName}. Restricted access.`,
  robots: { index: false, follow: false },
};

// Always render fresh — no caching of decision pages
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ action?: string; notes?: string; confirmed?: string }>;
}

export default async function DecisionPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { action, confirmed, notes } = await searchParams;

  const supabase = createServiceClient();

  // Load the leave request by token
  const { data: req, error } = await supabase
    .from("leave_requests")
    .select(`
      id, approval_token, status, leave_type, start_date, end_date, days_count, reason, manager_email,
      submitter_email,
      token_used_at, decided_by_email, decided_at, decision_notes,
      employees:employee_id (id, full_name, email)
    `)
    .eq("approval_token", token)
    .maybeSingle();

  if (error || !req) {
    return (
      <CenteredCard headline="Invalid link" color="red">
        <p>This approval link is invalid or has been removed. Contact <a href={`mailto:${branding.contactEmail}`} className="underline">HR</a> if you think this is an error.</p>
      </CenteredCard>
    );
  }

  const employee = Array.isArray(req.employees) ? req.employees[0] : (req.employees as any);

  // Best email to use for sending the decision back to the requester:
  // 1. submitter_email (captured per-request, always reflects who submitted THIS request)
  // 2. employees.email (could be stale from prior tests)
  const employeeNotifyEmail: string | null = req.submitter_email || employee?.email || null;

  // Already decided
  if (req.status !== "pending") {
    return (
      <CenteredCard
        headline={req.status === "approved" ? "Already approved" : "Already actioned"}
        color={req.status === "approved" ? "green" : "slate"}
      >
        <p>This request was <strong>{req.status}</strong>{req.decided_at ? ` on ${new Date(req.decided_at).toLocaleDateString("en", { dateStyle: "medium" })}` : ""}{req.decided_by_email ? ` by ${req.decided_by_email}` : ""}.</p>
        {req.decision_notes && <p className="text-xs text-slate-500 italic mt-3">"{req.decision_notes}"</p>}
        <RequestSummary req={req} employee={employee} />
      </CenteredCard>
    );
  }

  // If action=approve|reject AND confirmed=1, process it (one-shot — token marked used)
  if (confirmed === "1" && (action === "approve" || action === "reject")) {
    const decision = action === "approve" ? "approved" : "rejected";
    const nowIso = new Date().toISOString();

    // Mark the request first to prevent double-use
    const { data: updated, error: upErr } = await supabase
      .from("leave_requests")
      .update({
        status: decision,
        token_used_at: nowIso,
        decided_by_email: req.manager_email,
        decided_at: nowIso,
        decision_notes: notes || null,
      })
      .eq("id", req.id)
      .eq("status", "pending")  // race-safe — only proceed if still pending
      .select("id")
      .maybeSingle();

    if (upErr || !updated) {
      return (
        <CenteredCard headline="Already actioned" color="slate">
          <p>This request was just actioned by another window. Refresh to see the current status.</p>
        </CenteredCard>
      );
    }

    // If approved, deduct from balance
    if (decision === "approved") {
      const year = new Date(req.start_date).getFullYear();
      await supabase.rpc("deduct_leave_balance", {
        p_employee_id: employee.id,
        p_leave_type: req.leave_type,
        p_year: year,
        p_days: Number(req.days_count),
      });
    }

    // Notify the employee
    let emailResult: { ok: boolean; error?: string } = { ok: false, error: "No email on file" };
    if (employeeNotifyEmail) {
      emailResult = await sendLeaveDecisionToEmployee({
        employeeEmail: employeeNotifyEmail,
        employeeName: employee?.full_name || "Employee",
        decision,
        leaveType: req.leave_type,
        startDate: req.start_date,
        endDate: req.end_date,
        daysCount: Number(req.days_count),
        decisionBy: req.manager_email,
        notes: notes || undefined,
      });
    }

    return (
      <CenteredCard
        headline={decision === "approved" ? "Approved ✓" : "Rejected ✕"}
        color={decision === "approved" ? "green" : "red"}
      >
        <p>{employee?.full_name}'s leave was <strong>{decision}</strong>.</p>
        {emailResult.ok ? (
          <p className="text-xs text-slate-500 mt-3">Notification email sent to <strong>{employeeNotifyEmail}</strong>.</p>
        ) : (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded p-3 mt-3">
            ⚠ Decision saved, but email failed to send: {emailResult.error || "unknown error"}
            {!employeeNotifyEmail && " (no email on file — please notify the employee manually)"}
          </p>
        )}
        {decision === "approved" && <p className="text-xs text-slate-500 mt-3">Their balance has been updated automatically.</p>}
        <RequestSummary req={req} employee={employee} />
      </CenteredCard>
    );
  }

  // Pending — show the confirmation UI
  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #f6f9ff 0%, #dbe4f3 100%)" }}>
      <div className="max-w-[560px] mx-auto px-6 py-12">
        <header className="text-center mb-8">
          <div className="text-[11px] font-bold tracking-[0.2em] uppercase text-navy-700 mb-2">{branding.name.toUpperCase()}</div>
          <h1 className="font-display text-3xl font-extrabold text-navy-700 mb-2">Confirm Leave Decision</h1>
          <p className="text-sm text-slate-500">Review the request and confirm. This cannot be undone.</p>
        </header>

        <DecisionUI
          token={token}
          initialAction={action === "reject" ? "reject" : "approve"}
          employeeName={employee?.full_name || "Employee"}
          leaveType={req.leave_type}
          startDate={req.start_date}
          endDate={req.end_date}
          daysCount={Number(req.days_count)}
          reason={req.reason}
          notifyEmail={employeeNotifyEmail}
        />

        <p className="text-xs text-slate-400 text-center mt-8">
          {branding.pageFooterLine}
        </p>
      </div>
    </div>
  );
}

function CenteredCard({ headline, color, children }: { headline: string; color: "green" | "red" | "slate"; children: React.ReactNode }) {
  const bg = color === "green" ? "#10B981" : color === "red" ? "#EF4444" : "#64748b";
  return (
    <div className="min-h-screen grid place-items-center px-6" style={{ background: "linear-gradient(135deg, #f6f9ff 0%, #dbe4f3 100%)" }}>
      <div className="max-w-[480px] w-full">
        <div className="section-card text-center py-10">
          <div className="text-4xl mb-3" style={{ color: bg }}>●</div>
          <h1 className="font-display text-2xl font-extrabold text-navy-700 mb-3">{headline}</h1>
          <div className="text-sm text-slate-600">{children}</div>
        </div>
      </div>
    </div>
  );
}

function RequestSummary({ req, employee }: { req: any; employee: any }) {
  return (
    <div className="text-left mt-5 pt-5 border-t border-slate-200 text-sm">
      <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Request</div>
      <div className="space-y-1">
        <div><strong>{employee?.full_name}</strong></div>
        <div className="capitalize text-slate-600">{req.leave_type} — {req.days_count} day{Number(req.days_count) === 1 ? "" : "s"}</div>
        <div className="text-slate-600">{req.start_date} → {req.end_date}</div>
        {req.reason && <div className="text-slate-500 text-xs mt-2 italic">"{req.reason}"</div>}
      </div>
    </div>
  );
}
