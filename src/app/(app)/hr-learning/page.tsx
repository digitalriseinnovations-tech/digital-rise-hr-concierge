import { requireUser, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TrainingProgramForm } from "./program-form";
import { TrainingProgramRow } from "./program-row";
import { RegistrationsTable, type RegistrationRow } from "./registrations-table";

export const metadata = { title: "HR Learning — Digital Rise HR", description: "Digital Rise HR Concierge — training and learning admin." };
import { RequestsTable, type HrRequestRow } from "./requests-table";

export const dynamic = "force-dynamic";

export default async function HrLearningPage() {
  const user = await requireUser();
  const canEdit = can(user.role, "hr_learning.edit");
  const supabase = await createClient();

  const [{ data: programs }, { data: registrations }, { data: hrRequests }] = await Promise.all([
    supabase
      .from("training_programs")
      .select(
        "id, name, description, duration_label, delivery_mode, location, eligibility, requires_manager_approval, seats_total, seats_available, next_cohort_start, mandatory, active",
      )
      .order("name"),
    supabase
      .from("training_registrations")
      .select("id, status, requested_via, created_at, training_programs(name), employees(full_name, employee_code)")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("hr_requests")
      .select("id, request_type, category, note, status, created_at, employees(full_name, employee_code)")
      .in("request_type", ["mentorship", "coaching"])
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const registrationRows: RegistrationRow[] = (registrations ?? []).map((r: any) => ({
    id: r.id,
    status: r.status,
    requested_via: r.requested_via,
    created_at: r.created_at,
    programName: r.training_programs?.name ?? "Unknown program",
    employeeName: r.employees?.full_name ?? "Unknown",
    employeeCode: r.employees?.employee_code ?? "—",
  }));

  const requestRows: HrRequestRow[] = (hrRequests ?? []).map((r: any) => ({
    id: r.id,
    requestType: r.request_type,
    category: r.category,
    note: r.note,
    status: r.status,
    created_at: r.created_at,
    employeeName: r.employees?.full_name ?? "Unknown",
    employeeCode: r.employees?.employee_code ?? "—",
  }));

  return (
    <div>
      <header className="mb-6">
        <div className="text-[11px] tracking-[0.18em] uppercase font-bold text-navy-500 mb-2">HR Concierge</div>
        <h1 className="font-display text-3xl font-extrabold text-navy-700">HR Learning</h1>
        <p className="text-sm text-slate-500 mt-1">
          Training programs, registrations, and mentorship/coaching requests captured through HR Concierge. This is a
          lightweight catalogue and request queue, not a full learning management system — HR Concierge never
          auto-approves or auto-matches; every status change here is a human decision.
        </p>
      </header>

      {canEdit && (
        <div className="section-card mb-6">
          <h2 className="text-sm font-bold text-navy-700 mb-3">Add training program</h2>
          <TrainingProgramForm />
        </div>
      )}

      <div className="section-card overflow-x-auto p-0 mb-6">
        <div className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Training programs · {(programs ?? []).length}
        </div>
        <table className="table-clean">
          <thead>
            <tr>
              <th>Program</th>
              <th>Duration / Mode</th>
              <th>Seats</th>
              <th>Approval</th>
              <th>Status</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {(programs ?? []).map((program: any) => (
              <TrainingProgramRow key={program.id} program={program} canEdit={canEdit} />
            ))}
            {(programs ?? []).length === 0 && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="text-center text-sm text-slate-400 py-8">
                  No training programs configured yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="section-card overflow-x-auto p-0 mb-6">
        <div className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Training registrations · {registrationRows.length}
        </div>
        <div className="p-4 pt-2">
          <RegistrationsTable rows={registrationRows} canEdit={canEdit} />
        </div>
      </div>

      <div className="section-card overflow-x-auto p-0">
        <div className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Mentorship &amp; coaching requests · {requestRows.length}
        </div>
        <div className="p-4 pt-2">
          <RequestsTable rows={requestRows} canEdit={canEdit} />
        </div>
      </div>
    </div>
  );
}
