"use client";

import { updateTrainingRegistrationStatus } from "./actions";
import { StatusSelect } from "./status-select";

const REGISTRATION_STATUSES = ["requested", "confirmed", "waitlisted", "declined", "cancelled", "completed"] as const;

export interface RegistrationRow {
  id: string;
  status: string;
  requested_via: string;
  created_at: string;
  programName: string;
  employeeName: string;
  employeeCode: string;
}

export function RegistrationsTable({ rows, canEdit }: { rows: RegistrationRow[]; canEdit: boolean }) {
  if (rows.length === 0) {
    return <p className="text-center text-sm text-slate-400 py-8">No training registrations yet.</p>;
  }

  return (
    <table className="table-clean">
      <thead>
        <tr>
          <th>Employee</th>
          <th>Program</th>
          <th>Via</th>
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
            <td className="text-sm text-slate-700">{r.programName}</td>
            <td className="text-xs text-slate-400 capitalize">{r.requested_via}</td>
            <td className="text-xs text-slate-400">{new Date(r.created_at).toLocaleDateString("en", { dateStyle: "medium" })}</td>
            <td>
              {canEdit ? (
                <StatusSelect
                  value={r.status}
                  options={REGISTRATION_STATUSES}
                  onChange={(next) => updateTrainingRegistrationStatus(r.id, next)}
                />
              ) : (
                <span className="badge badge-slate capitalize">{r.status}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
