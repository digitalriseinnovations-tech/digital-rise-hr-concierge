"use client";

import { useMemo, useState } from "react";

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
  country: string | null;
  manager_email: string;
}

const LEAVE_TYPES = [
  { value: "annual",    label: "Annual Leave",    note: "24 days / year" },
  { value: "sick",      label: "Sick Leave",      note: "10 days / year (full pay)" },
  { value: "maternity", label: "Maternity Leave", note: "65 business days (married female)" },
  { value: "paternity", label: "Paternity Leave", note: "5 business days" },
  { value: "mourning",  label: "Mourning Leave",  note: "Up to 5 days, immediate family" },
  { value: "haj",       label: "Haj Leave",       note: "Up to 30 days unpaid, once" },
  { value: "unpaid",    label: "Unpaid Leave",    note: null },
  { value: "other",     label: "Other",           note: "Religious leave, special request" },
];

function daysBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(start);
  const e = new Date(end);
  if (e < s) return 0;
  const diffMs = e.getTime() - s.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

export function LeaveRequestForm({ employees, emailPlaceholder }: { employees: Employee[]; emailPlaceholder: string }) {
  const [employeeId, setEmployeeId] = useState("");
  const [leaveType, setLeaveType] = useState("annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === employeeId),
    [employees, employeeId],
  );

  const totalDays = useMemo(() => daysBetween(startDate, endDate), [startDate, endDate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!employeeId) {
      setError("Please select your name.");
      return;
    }
    if (!startDate || !endDate) {
      setError("Please select both start and end dates.");
      return;
    }
    if (totalDays < 1) {
      setError("End date must be the same or after the start date.");
      return;
    }
    if (!employeeEmail || !employeeEmail.includes("@")) {
      setError("Please enter your email — we'll send you the approval result.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/leave-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          employee_email: employeeEmail,
          leave_type: leaveType,
          start_date: startDate,
          end_date: endDate,
          days_count: totalDays,
          reason: reason || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Submission failed. Please try again.");
        setLoading(false);
        return;
      }
      setSubmitted(true);
    } catch (e: any) {
      setError(e?.message || "Network error. Please try again.");
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="section-card text-center py-10">
        <div className="text-5xl mb-3">✓</div>
        <h2 className="font-display text-2xl font-extrabold text-navy-700 mb-2">Request submitted</h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Your manager has been emailed. You'll receive a follow-up email at <strong>{employeeEmail}</strong> once they approve or reject.
        </p>
        <button
          onClick={() => {
            setSubmitted(false);
            setEmployeeId("");
            setLeaveType("annual");
            setStartDate("");
            setEndDate("");
            setReason("");
            setEmployeeEmail("");
          }}
          className="btn-ghost mt-6"
        >
          Submit another request
        </button>
      </div>
    );
  }

  const currentType = LEAVE_TYPES.find((t) => t.value === leaveType);

  return (
    <form onSubmit={submit} className="section-card space-y-5">
      {/* Employee */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Your name *</label>
        <select
          required
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className="input-field"
        >
          <option value="">— Select your name —</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name} {e.country ? `(${e.country})` : ""}
            </option>
          ))}
        </select>
        {selectedEmployee && (
          <p className="text-xs text-slate-500 mt-1.5">Approver: <strong>{selectedEmployee.manager_email}</strong></p>
        )}
      </div>

      {/* Email */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Your email *</label>
        <input
          type="email"
          required
          value={employeeEmail}
          onChange={(e) => setEmployeeEmail(e.target.value)}
          placeholder={emailPlaceholder}
          className="input-field"
        />
        <p className="text-xs text-slate-500 mt-1.5">You'll receive the approval decision here.</p>
      </div>

      {/* Leave type */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Leave type *</label>
        <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} className="input-field">
          {LEAVE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        {currentType?.note && <p className="text-xs text-slate-500 mt-1.5">{currentType.note}</p>}
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Start date *</label>
          <input
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="input-field"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">End date *</label>
          <input
            type="date"
            required
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="input-field"
          />
        </div>
      </div>

      {totalDays > 0 && (
        <div className="bg-navy-50 border border-navy-100 rounded-lg px-4 py-3 text-sm" style={{ background: "#f6f9ff", border: "1px solid #dbe4f3" }}>
          <strong className="text-navy-700">{totalDays} day{totalDays === 1 ? "" : "s"}</strong> requested · this counts calendar days, manager will adjust if it includes weekends
        </div>
      )}

      {/* Reason */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Reason (optional)</label>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="A brief note for your manager"
          className="input-field resize-none"
        />
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
        {loading ? "Submitting…" : "Submit Leave Request"}
      </button>
    </form>
  );
}
