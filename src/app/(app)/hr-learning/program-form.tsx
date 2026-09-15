"use client";

import { useState, useTransition } from "react";
import { createTrainingProgram, updateTrainingProgram } from "./actions";

interface ExistingProgram {
  id: string;
  name: string;
  description: string | null;
  duration_label: string | null;
  delivery_mode: string | null;
  location: string | null;
  eligibility: string | null;
  requires_manager_approval: boolean;
  seats_total: number | null;
  next_cohort_start: string | null;
  mandatory: boolean;
}

export function TrainingProgramForm({ existing, onDone }: { existing?: ExistingProgram; onDone?: () => void }) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [durationLabel, setDurationLabel] = useState(existing?.duration_label ?? "");
  const [deliveryMode, setDeliveryMode] = useState(existing?.delivery_mode ?? "");
  const [location, setLocation] = useState(existing?.location ?? "");
  const [eligibility, setEligibility] = useState(existing?.eligibility ?? "");
  const [requiresManagerApproval, setRequiresManagerApproval] = useState(existing?.requires_manager_approval ?? false);
  const [seatsTotal, setSeatsTotal] = useState(existing?.seats_total?.toString() ?? "");
  const [nextCohortStart, setNextCohortStart] = useState(existing?.next_cohort_start ?? "");
  const [mandatory, setMandatory] = useState(existing?.mandatory ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const input = {
          name,
          description,
          durationLabel,
          deliveryMode,
          location,
          eligibility,
          requiresManagerApproval,
          seatsTotal,
          nextCohortStart,
          mandatory,
        };
        if (existing) {
          await updateTrainingProgram(existing.id, input);
        } else {
          await createTrainingProgram(input);
          setName("");
          setDescription("");
          setDurationLabel("");
          setDeliveryMode("");
          setLocation("");
          setEligibility("");
          setRequiresManagerApproval(false);
          setSeatsTotal("");
          setNextCohortStart("");
          setMandatory(false);
        }
        onDone?.();
      } catch (err: any) {
        setError(err?.message || "Could not save.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Emerging Leaders Program"
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Duration</label>
          <input
            type="text"
            value={durationLabel}
            onChange={(e) => setDurationLabel(e.target.value)}
            placeholder="e.g. 6 weeks"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Delivery mode</label>
          <select
            value={deliveryMode}
            onChange={(e) => setDeliveryMode(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">—</option>
            <option value="virtual">Virtual</option>
            <option value="in_person">In person</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Location</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Next cohort start</label>
          <input
            type="date"
            value={nextCohortStart}
            onChange={(e) => setNextCohortStart(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Eligibility (free text — never auto-matched)</label>
        <input
          type="text"
          value={eligibility}
          onChange={(e) => setEligibility(e.target.value)}
          placeholder="e.g. People managers with 1+ years tenure"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="grid grid-cols-3 gap-3 items-end">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Seats total (blank = uncapped)</label>
          <input
            type="number"
            min={0}
            value={seatsTotal}
            onChange={(e) => setSeatsTotal(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 pb-2">
          <input type="checkbox" checked={requiresManagerApproval} onChange={(e) => setRequiresManagerApproval(e.target.checked)} />
          Requires manager/HR approval
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700 pb-2">
          <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
          Mandatory
        </label>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving…" : existing ? "Save changes" : "Add program"}
        </button>
        {existing && onDone && (
          <button type="button" onClick={onDone} className="text-sm text-slate-500 hover:text-slate-700">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
