"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface EditableEmployee {
  id: string;
  employee_code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  department: string | null;
  country: string | null;
  location: string | null;
  joining_date: string | null;
  status: string;
  annual_leave_days: number | null;
  air_ticket_entitlement: number | null;
  air_ticket_currency: string | null;
}

const STATUS_OPTIONS = ["active", "inactive", "on_leave", "terminated"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputClass = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";

export function EditEmployeeForm({ employeeId, employee }: { employeeId: string; employee: EditableEmployee }) {
  const router = useRouter();
  const [form, setForm] = useState({
    employee_code: employee.employee_code,
    full_name: employee.full_name,
    email: employee.email ?? "",
    phone: employee.phone ?? "",
    designation: employee.designation ?? "",
    department: employee.department ?? "",
    country: employee.country ?? "",
    location: employee.location ?? "",
    joining_date: employee.joining_date ?? "",
    status: employee.status,
    annual_leave_days: employee.annual_leave_days ?? "",
    air_ticket_entitlement: employee.air_ticket_entitlement ?? "",
    air_ticket_currency: employee.air_ticket_currency ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/employees/${employeeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          annual_leave_days: form.annual_leave_days === "" ? null : Number(form.annual_leave_days),
          air_ticket_entitlement: form.air_ticket_entitlement === "" ? null : Number(form.air_ticket_entitlement),
          joining_date: form.joining_date || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Could not save changes.");
        return;
      }
      router.push(`/employees/${employeeId}`);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      {error && <div className="section-card border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}

      <div className="section-card">
        <h2 className="font-display text-lg font-extrabold text-navy-700 mb-4">Basic Information</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Full Name">
            <input className={inputClass} value={form.full_name} onChange={(e) => set("full_name", e.target.value)} required />
          </Field>
          <Field label="Employee Code">
            <input className={inputClass} value={form.employee_code} onChange={(e) => set("employee_code", e.target.value)} required />
          </Field>
          <Field label="Work Email">
            <input type="email" className={inputClass} value={form.email} onChange={(e) => set("email", e.target.value)} required />
          </Field>
          <Field label="Phone">
            <input className={inputClass} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Designation">
            <input className={inputClass} value={form.designation} onChange={(e) => set("designation", e.target.value)} />
          </Field>
          <Field label="Department">
            <input className={inputClass} value={form.department} onChange={(e) => set("department", e.target.value)} />
          </Field>
          <Field label="Country">
            <input className={inputClass} value={form.country} onChange={(e) => set("country", e.target.value)} />
          </Field>
          <Field label="Location">
            <input className={inputClass} value={form.location} onChange={(e) => set("location", e.target.value)} />
          </Field>
          <Field label="Joining Date">
            <input type="date" className={inputClass} value={form.joining_date} onChange={(e) => set("joining_date", e.target.value)} />
          </Field>
          <Field label="Status">
            <select className={inputClass} value={form.status} onChange={(e) => set("status", e.target.value)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <div className="section-card">
        <h2 className="font-display text-lg font-extrabold text-navy-700 mb-4">Leave & Air Ticket Entitlement</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Annual Leave Days">
            <input
              type="number"
              step="0.5"
              className={inputClass}
              value={form.annual_leave_days}
              onChange={(e) => set("annual_leave_days", e.target.value)}
            />
          </Field>
          <Field label="Air Ticket Entitlement">
            <input
              type="number"
              step="0.01"
              className={inputClass}
              value={form.air_ticket_entitlement}
              onChange={(e) => set("air_ticket_entitlement", e.target.value)}
            />
          </Field>
          <Field label="Air Ticket Currency">
            <input className={inputClass} value={form.air_ticket_currency} onChange={(e) => set("air_ticket_currency", e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => router.push(`/employees/${employeeId}`)} className="btn-ghost">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
