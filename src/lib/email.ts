import nodemailer, { type Transporter } from "nodemailer";
import { getProductBranding } from "@/lib/product-mode";

// ============================================================================
// Email sender — Gmail SMTP via nodemailer
// ============================================================================
// Requires GMAIL_USER + GMAIL_APP_PASSWORD in .env.local.
// The app password is a 16-char password generated at
// https://myaccount.google.com/apppasswords (2FA must be on for the Gmail account)
// ============================================================================

// Test-runtime safety boundary — NOT a product/deployment setting (do not
// base this on APP_PRODUCT_MODE). Vitest sets process.env.VITEST for every
// test process automatically, with no per-file opt-in required; NODE_ENV
// "test" is checked too as a second, independent signal. This must stay
// true for every test run regardless of what real-looking Gmail credentials
// happen to be present in .env.local, since that same file is loaded by
// both `npm run dev` and `npx vitest run` (see tests/setup/load-env.ts).
export function isTestRuntime(): boolean {
  return Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";
}

let transporter: Transporter | null = null;
function getTransport(): Transporter {
  // Defense in depth: even if some future caller reaches getTransport()
  // directly instead of going through send()'s guard, a real SMTP
  // transport must never be constructed under test.
  if (isTestRuntime()) {
    throw new Error(
      "[email] getTransport() must not be called under test — real SMTP transport creation is blocked. Use send(), which short-circuits before reaching this function.",
    );
  }
  if (transporter) return transporter;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user) {
    throw new Error(
      "GMAIL_USER is not set. Add your Gmail address (e.g. verofax1@gmail.com) to .env.local",
    );
  }
  if (!pass || pass.includes("PASTE_") || pass.includes("your-app-password")) {
    throw new Error(
      "GMAIL_APP_PASSWORD is not set or is still the placeholder. " +
      "Generate one at https://myaccount.google.com/apppasswords " +
      "(2FA must be on for this Gmail account). Paste the 16-char password into .env.local.",
    );
  }

  transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass: pass.replace(/\s+/g, "") },  // strip spaces — Google shows the key with spaces but doesn't want them
  });
  return transporter;
}

const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

async function send({ to, subject, html, replyTo }: SendArgs) {
  if (isTestRuntime()) {
    // Never touch getTransport()/sendMail() under test — no real SMTP
    // connection is created. Deliberately no recipient/subject/body logged.
    return { ok: true, id: "test-dry-run", dryRun: true as const };
  }
  try {
    const user = process.env.GMAIL_USER!;
    const fromName = process.env.GMAIL_FROM_NAME || getProductBranding().fullName;
    const fromAddr = `${fromName} <${user}>`;

    const info = await getTransport().sendMail({
      from: fromAddr,
      to,
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
    });
    return { ok: true, id: info.messageId };
  } catch (e: any) {
    console.error("[email] send failed", e);
    return { ok: false, error: e?.message || String(e) };
  }
}

// ============================================================================
// Templates
// ============================================================================

// Exported (not just used internally) specifically so tests can assert on
// the actual rendered HTML's branding without sending a real email through
// SMTP — see tests/platform/product-branding.test.ts.
export function leaveRequestEmail(args: {
  managerName: string;
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  daysCount: number;
  reason: string | null;
  approveUrl: string;
  rejectUrl: string;
  remainingDays: number;
}) {
  const reasonBlock = args.reason
    ? `<tr><td style="padding:8px 0;font-size:13px;color:#64748b;width:140px;">Reason</td><td style="padding:8px 0;font-size:14px;color:#0f172a;">${escapeHtml(args.reason)}</td></tr>`
    : "";
  const branding = getProductBranding();
  return `
<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
      <tr><td style="background:linear-gradient(135deg,#0040A0,#002060);padding:24px 28px;">
        <div style="color:#dbe4f3;font-size:11px;letter-spacing:0.18em;font-weight:700;text-transform:uppercase;">${escapeHtml(branding.fullName)}</div>
        <div style="color:#fff;font-size:22px;font-weight:800;margin-top:4px;">New Leave Request</div>
      </td></tr>
      <tr><td style="padding:28px;">
        <p style="margin:0 0 8px;font-size:15px;color:#0f172a;">Hi ${escapeHtml(args.managerName)},</p>
        <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.55;">
          <strong>${escapeHtml(args.employeeName)}</strong> has submitted a leave request and needs your approval.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;padding:18px;background:#f6f9ff;">
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;width:140px;">Leave Type</td><td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:600;text-transform:capitalize;">${escapeHtml(args.leaveType)}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;">From</td><td style="padding:8px 0;font-size:14px;color:#0f172a;">${args.startDate}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;">To</td><td style="padding:8px 0;font-size:14px;color:#0f172a;">${args.endDate}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;">Days</td><td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:600;">${args.daysCount}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;">Remaining (${escapeHtml(args.leaveType)})</td><td style="padding:8px 0;font-size:14px;color:#0f172a;">${args.remainingDays} days after this request</td></tr>
          ${reasonBlock}
        </table>
        <div style="margin:28px 0 8px;text-align:center;">
          <a href="${args.approveUrl}" style="display:inline-block;background:#0040A0;color:#fff;padding:13px 32px;border-radius:10px;font-size:14px;font-weight:600;text-decoration:none;margin-right:10px;">✓ Approve</a>
          <a href="${args.rejectUrl}" style="display:inline-block;background:#fff;color:#475569;padding:13px 32px;border-radius:10px;font-size:14px;font-weight:600;text-decoration:none;border:1px solid #e2e8f0;">✕ Reject</a>
        </div>
        <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.5;">
          Each button opens a one-time link. After you click, the balance is automatically updated and ${escapeHtml(args.employeeName.split(" ")[0])} gets a confirmation email.
        </p>
      </td></tr>
      <tr><td style="background:#f6f9ff;padding:16px 28px;border-top:1px solid #e2e8f0;">
        <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">
          ${escapeHtml(branding.footerLine)}
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export function employeeDecisionEmail(args: {
  employeeName: string;
  decision: "approved" | "rejected";
  leaveType: string;
  startDate: string;
  endDate: string;
  daysCount: number;
  decisionBy: string;
  notes?: string;
}) {
  const approved = args.decision === "approved";
  const headerBg = approved ? "linear-gradient(135deg,#10b981,#059669)" : "linear-gradient(135deg,#ef4444,#dc2626)";
  const headerLabel = approved ? "Leave Approved" : "Leave Not Approved";
  const notesBlock = args.notes
    ? `<tr><td style="padding:8px 0;font-size:13px;color:#64748b;width:140px;">Note</td><td style="padding:8px 0;font-size:14px;color:#0f172a;">${escapeHtml(args.notes)}</td></tr>`
    : "";
  const cta = approved
    ? `<p style="margin:18px 0 0;font-size:14px;color:#475569;line-height:1.55;">Your balance has been updated. Enjoy your time off!</p>`
    : `<p style="margin:18px 0 0;font-size:14px;color:#475569;line-height:1.55;">Please reach out to ${escapeHtml(args.decisionBy)} if you'd like to discuss.</p>`;
  const branding = getProductBranding();
  return `
<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
  <tr><td align="center">
    <table width="540" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
      <tr><td style="background:${headerBg};padding:24px 28px;">
        <div style="color:rgba(255,255,255,0.8);font-size:11px;letter-spacing:0.18em;font-weight:700;text-transform:uppercase;">${escapeHtml(branding.fullName)}</div>
        <div style="color:#fff;font-size:22px;font-weight:800;margin-top:4px;">${headerLabel}</div>
      </td></tr>
      <tr><td style="padding:28px;">
        <p style="margin:0 0 8px;font-size:15px;color:#0f172a;">Hi ${escapeHtml(args.employeeName.split(" ")[0])},</p>
        <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.55;">
          ${escapeHtml(args.decisionBy)} has <strong>${args.decision}</strong> your leave request.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;padding:18px;background:#f6f9ff;">
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;width:140px;">Type</td><td style="padding:8px 0;font-size:14px;color:#0f172a;text-transform:capitalize;">${escapeHtml(args.leaveType)}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;">From</td><td style="padding:8px 0;font-size:14px;color:#0f172a;">${args.startDate}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;">To</td><td style="padding:8px 0;font-size:14px;color:#0f172a;">${args.endDate}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;">Days</td><td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:600;">${args.daysCount}</td></tr>
          ${notesBlock}
        </table>
        ${cta}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================================
// Public API — same shape as before, just different transport
// ============================================================================

export async function sendLeaveRequestToManager(args: {
  managerEmail: string;
  managerName?: string;
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  daysCount: number;
  reason: string | null;
  approvalToken: string;
  remainingDays: number;
}) {
  const approveUrl = `${APP_URL}/leave-decision/${args.approvalToken}?action=approve`;
  const rejectUrl = `${APP_URL}/leave-decision/${args.approvalToken}?action=reject`;
  return send({
    to: args.managerEmail,
    subject: `Leave request from ${args.employeeName} · ${args.startDate} → ${args.endDate}`,
    html: leaveRequestEmail({
      managerName: args.managerName || "there",
      employeeName: args.employeeName,
      leaveType: args.leaveType,
      startDate: args.startDate,
      endDate: args.endDate,
      daysCount: args.daysCount,
      reason: args.reason,
      approveUrl,
      rejectUrl,
      remainingDays: args.remainingDays,
    }),
  });
}

export async function sendLeaveDecisionToEmployee(args: {
  employeeEmail: string;
  employeeName: string;
  decision: "approved" | "rejected";
  leaveType: string;
  startDate: string;
  endDate: string;
  daysCount: number;
  decisionBy: string;
  notes?: string;
}) {
  return send({
    to: args.employeeEmail,
    subject: `Your leave request was ${args.decision}`,
    html: employeeDecisionEmail({
      employeeName: args.employeeName,
      decision: args.decision,
      leaveType: args.leaveType,
      startDate: args.startDate,
      endDate: args.endDate,
      daysCount: args.daysCount,
      decisionBy: args.decisionBy,
      notes: args.notes,
    }),
  });
}

// ============================================================================
// HR Concierge — escalation notification (additive; reuses the same
// transport/send() helper above, not a new email system)
// ============================================================================

function hrEscalationEmail(args: {
  employeeName: string;
  category: string;
  reason: string;
  conversationId: string;
}) {
  return `
<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
      <tr><td style="background:linear-gradient(135deg,#0040A0,#002060);padding:24px 28px;">
        <div style="color:#dbe4f3;font-size:11px;letter-spacing:0.18em;font-weight:700;text-transform:uppercase;">Digital Rise HR Concierge</div>
        <div style="color:#fff;font-size:22px;font-weight:800;margin-top:4px;">Employee wants to speak with HR</div>
      </td></tr>
      <tr><td style="padding:28px;">
        <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.55;">
          <strong>${escapeHtml(args.employeeName)}</strong> asked HR Concierge to connect them with a human HR team member.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;padding:18px;background:#f6f9ff;">
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;width:140px;">Category</td><td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:600;text-transform:capitalize;">${escapeHtml(args.category)}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;">Note</td><td style="padding:8px 0;font-size:14px;color:#0f172a;">${escapeHtml(args.reason)}</td></tr>
        </table>
        <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">
          This is only what HR Concierge captured — it does not include the rest of their conversation. Please
          follow up with ${escapeHtml(args.employeeName)} directly.
        </p>
      </td></tr>
      <tr><td style="background:#f6f9ff;padding:16px 28px;border-top:1px solid #e2e8f0;">
        <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">
          Digital Rise HR Concierge · Internal use only
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export async function sendHrEscalationNotification(args: {
  employeeName: string;
  category: string;
  reason: string;
  conversationId: string;
}) {
  const to = process.env.HR_CONCIERGE_ESCALATION_EMAIL;
  if (!to) {
    return { ok: false, error: "HR_CONCIERGE_ESCALATION_EMAIL is not set" };
  }
  return send({
    to,
    subject: `HR Concierge: ${args.employeeName} wants to speak with HR (${args.category})`,
    html: hrEscalationEmail(args),
  });
}
