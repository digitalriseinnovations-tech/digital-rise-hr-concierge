"use client";

import { useState, useTransition } from "react";
import { setTrainingProgramActive } from "./actions";
import { TrainingProgramForm } from "./program-form";

interface Program {
  id: string;
  name: string;
  description: string | null;
  duration_label: string | null;
  delivery_mode: string | null;
  location: string | null;
  eligibility: string | null;
  requires_manager_approval: boolean;
  seats_total: number | null;
  seats_available: number | null;
  next_cohort_start: string | null;
  mandatory: boolean;
  active: boolean;
}

export function TrainingProgramRow({ program, canEdit }: { program: Program; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  if (editing) {
    return (
      <tr>
        <td colSpan={canEdit ? 6 : 5} className="p-4 bg-slate-50">
          <TrainingProgramForm existing={program} onDone={() => setEditing(false)} />
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <div className="font-medium text-slate-800">
          {program.name}
          {program.mandatory && <span className="badge badge-amber ml-2">Mandatory</span>}
        </div>
        {program.description && <div className="text-xs text-slate-400 max-w-md">{program.description}</div>}
      </td>
      <td className="text-sm text-slate-600">
        {program.duration_label || "—"}
        {program.delivery_mode && <div className="text-xs text-slate-400 capitalize">{program.delivery_mode.replace("_", " ")}</div>}
      </td>
      <td className="text-sm text-slate-600">
        {program.seats_total != null ? `${program.seats_available ?? 0} / ${program.seats_total}` : "Uncapped"}
      </td>
      <td className="text-sm text-slate-600">{program.requires_manager_approval ? "Yes" : "Direct"}</td>
      <td>
        {program.active ? <span className="badge badge-green">Active</span> : <span className="badge badge-slate">Inactive</span>}
      </td>
      {canEdit && (
        <td className="whitespace-nowrap">
          <button onClick={() => setEditing(true)} className="text-xs text-indigo-600 hover:underline mr-3">
            Edit
          </button>
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await setTrainingProgramActive(program.id, !program.active);
              })
            }
            className="text-xs text-slate-500 hover:underline"
          >
            {program.active ? "Deactivate" : "Activate"}
          </button>
        </td>
      )}
    </tr>
  );
}
