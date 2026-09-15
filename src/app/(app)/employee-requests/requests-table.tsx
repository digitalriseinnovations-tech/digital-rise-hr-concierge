"use client";

import { updateEmployeeRequestStatus } from "./actions";
import { StatusSelect } from "../hr-learning/status-select";

const HR_REQUEST_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

export interface EmployeeRequestRow {
  id: string;
  requestType: "escalation" | "general" | "mentorship" | "coaching";
  category: string | null;
  note: string | null;
  status: string;
  urgent: boolean;
  created_at: string;
  employeeName: string;
  employeeCode: string;
}

const TYPE_BADGE: Record<string, string> = {
  escalation: "badge-red",
  general: "badge-slate",
  mentorship: "badge-navy",
  coaching: "badge-navy",
};

export function EmployeeRequestsTable({ rows, canEdit }: { rows: EmployeeRequestRow[]; canEdit: boolean }) {
  if (rows.length === 0) {
    return <p className="text-center text-sm text-slate-400 py-8">No employee requests yet.</p>;
  }

  return (
    <table className="table-clean">
      <thead>
        <tr>
          <th>Employee</th>
          <th>Type</th>
          <th>Note</th>
          <th>Requested</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="text-sm text-slate-700">
              {r.employeeName} <span className="text-xs text-slate-400">({r.employeeCode})</span>
            </td>
            <td>
              <span className={`badge ${TYPE_BADGE[r.requestType] ?? "badge-slate"} capitalize`}>{r.requestType}</span>
              {r.urgent && <span className="badge badge-red ml-1">Urgent</span>}
              {r.category && <div className="text-xs text-slate-400 mt-1">{r.category}</div>}
            </td>
            <td className="text-sm text-slate-600 max-w-md">{r.note || "—"}</td>
            <td className="text-xs text-slate-400">{new Date(r.created_at).toLocaleDateString("en", { dateStyle: "medium" })}</td>
            <td>
              {canEdit ? (
                <StatusSelect value={r.status} options={HR_REQUEST_STATUSES} onChange={(next) => updateEmployeeRequestStatus(r.id, next)} />
              ) : (
                <span className="badge badge-slate capitalize">{r.status.replace("_", " ")}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
