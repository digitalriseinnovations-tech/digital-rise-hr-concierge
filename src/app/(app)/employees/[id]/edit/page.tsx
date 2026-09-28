import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { lookupActiveOrganization, employeeBelongsToActiveOrganization } from "@/lib/concierge/organizations";
import { notFound } from "next/navigation";
import Link from "next/link";
import { EditEmployeeForm } from "./EditEmployeeForm";

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("employee.edit");
  const supabase = await createClient();

  const { data: employee } = await supabase
    .from("employees")
    .select(
      "id, employee_code, full_name, email, phone, designation, department, country, location, joining_date, status, annual_leave_days, air_ticket_entitlement, air_ticket_currency, organization_id",
    )
    .eq("id", id)
    .maybeSingle();

  if (!employee) notFound();

  // Organization isolation (migration_011) — see the same check on the
  // profile page ([id]/page.tsx) for the full rationale.
  const orgLookup = await lookupActiveOrganization();
  if (!employeeBelongsToActiveOrganization(employee.organization_id, orgLookup)) {
    notFound();
  }

  return (
    <div>
      <header className="mb-6">
        <Link href={`/employees/${id}`} className="text-xs text-slate-500 hover:text-navy-700">
          ← Back to profile
        </Link>
        <h1 className="font-display text-3xl font-extrabold text-navy-700 mt-3">Edit {employee.full_name}</h1>
      </header>
      <EditEmployeeForm employeeId={id} employee={employee} />
    </div>
  );
}
