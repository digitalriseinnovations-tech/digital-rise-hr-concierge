import { requirePermission } from "@/lib/auth";
import { listOrganizations } from "@/lib/concierge/organizations";
import { ImportWizard } from "./ImportWizard";

export default async function ImportEmployeesPage() {
  await requirePermission("employee.edit");
  const organizations = await listOrganizations();

  return (
    <div>
      <header className="mb-6">
        <div className="text-[11px] tracking-[0.18em] uppercase font-bold text-navy-500 mb-2">Workforce</div>
        <h1 className="font-display text-3xl font-extrabold text-navy-700">Import Employees</h1>
        <p className="text-sm text-slate-500 mt-1">
          Upload a spreadsheet to add or update employees for one organization — reuses the same employee model and
          identity system as the rest of HR Concierge.
        </p>
      </header>
      <ImportWizard organizations={organizations} />
    </div>
  );
}
