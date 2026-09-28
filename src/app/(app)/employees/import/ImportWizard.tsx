"use client";

import { useRef, useState } from "react";
import { CANONICAL_FIELDS, type ColumnMapping } from "@/lib/employee-import-fields";

interface Organization {
  id: string;
  slug: string;
  name: string;
}

interface ParsedSheet {
  headers: string[];
  rows: Record<string, string | number | null>[];
  suggestedMapping: ColumnMapping;
  truncated: boolean;
}

interface ValidationRowResult {
  rowNumber: number;
  action: "create" | "update" | "skip" | "error";
  employeeCode: string | null;
  email: string | null;
  fullName: string | null;
  errors: string[];
}

interface ValidateResponse {
  organization: Organization;
  results: ValidationRowResult[];
  summary: { toCreate: number; toUpdate: number; toSkip: number; toError: number };
}

interface CommitResponse {
  organization: Organization;
  summary: { created: number; updated: number; skipped: number; errored: number; errors: { rowNumber: number; employeeCode: string | null; email: string | null; errors: string[] }[] };
}

type Step = "upload" | "map" | "review" | "done";

export function ImportWizard({ organizations }: { organizations: Organization[] }) {
  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [orgMode, setOrgMode] = useState<"existing" | "new">(organizations.length > 0 ? "existing" : "new");
  const [selectedOrgId, setSelectedOrgId] = useState(organizations[0]?.id ?? "");
  const [newOrgName, setNewOrgName] = useState("");
  const [duplicateStrategy, setDuplicateStrategy] = useState<"update" | "skip">("skip");

  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [validation, setValidation] = useState<ValidateResponse | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function organizationPayload() {
    return orgMode === "existing" ? { organizationId: selectedOrgId } : { newOrganizationName: newOrgName };
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a .xlsx or .csv file first.");
      return;
    }
    if (orgMode === "existing" && !selectedOrgId) {
      setError("Select an organization.");
      return;
    }
    if (orgMode === "new" && !newOrgName.trim()) {
      setError("Enter a name for the new organization.");
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/employees/import/parse", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Could not read that file.");
        return;
      }
      setParsed(body);
      setMapping(body.suggestedMapping);
      setStep("map");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleValidate() {
    if (!parsed) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/employees/import/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsed.rows, mapping, duplicateStrategy, ...organizationPayload() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Validation failed.");
        return;
      }
      setValidation(body);
      setStep("review");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!parsed) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/employees/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsed.rows, mapping, duplicateStrategy, ...organizationPayload() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Import failed.");
        return;
      }
      setCommitResult(body);
      setStep("done");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setStep("upload");
    setParsed(null);
    setMapping({});
    setValidation(null);
    setCommitResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="space-y-6">
      <div className="section-card">
        <div className="text-sm font-semibold text-navy-700 mb-2">Templates</div>
        <div className="flex gap-3 text-sm">
          <a href="/api/employees/import/template" className="text-indigo-600 hover:underline">
            Download blank template (.xlsx)
          </a>
          <span className="text-slate-300">·</span>
          <a href="/api/employees/import/template?sample=1" className="text-indigo-600 hover:underline">
            Download sample template (.xlsx)
          </a>
        </div>
      </div>

      {error && <div className="section-card border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}

      {step === "upload" && (
        <form onSubmit={handleUpload} className="section-card space-y-4">
          <div>
            <div className="text-sm font-semibold text-navy-700 mb-2">Organization</div>
            <div className="flex gap-4 mb-2 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={orgMode === "existing"} onChange={() => setOrgMode("existing")} disabled={organizations.length === 0} />
                Existing organization
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={orgMode === "new"} onChange={() => setOrgMode("new")} />
                New organization
              </label>
            </div>
            {orgMode === "existing" ? (
              <select
                value={selectedOrgId}
                onChange={(e) => setSelectedOrgId(e.target.value)}
                className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {organizations.length === 0 && <option value="">No organizations yet</option>}
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="e.g. TAQA Generation"
                className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            )}
          </div>

          <div>
            <div className="text-sm font-semibold text-navy-700 mb-2">Spreadsheet (.xlsx or .csv)</div>
            <input ref={fileInputRef} type="file" accept=".xlsx,.csv" className="text-sm" />
          </div>

          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? "Reading file…" : "Upload & Preview"}
          </button>
        </form>
      )}

      {step === "map" && parsed && (
        <div className="section-card space-y-4">
          <div className="text-sm text-slate-500">
            {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"} found{parsed.truncated ? " (file truncated at 2000 rows)" : ""}. Map each
            canonical field to a column from your file.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CANONICAL_FIELDS.map((field) => (
              <div key={field.key}>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                  {field.label}
                  {field.required && <span className="text-red-500"> *</span>}
                </label>
                <select
                  value={mapping[field.key] ?? ""}
                  onChange={(e) => setMapping((m) => ({ ...m, [field.key]: e.target.value || null }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">— Not mapped —</option>
                  {parsed.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div>
            <div className="text-sm font-semibold text-navy-700 mb-2">If an employee code + email already exists in this organization</div>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={duplicateStrategy === "skip"} onChange={() => setDuplicateStrategy("skip")} />
                Skip (leave existing record unchanged)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={duplicateStrategy === "update"} onChange={() => setDuplicateStrategy("update")} />
                Update with spreadsheet values
              </label>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="table-clean">
              <thead>
                <tr>
                  {parsed.headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 5).map((row, i) => (
                  <tr key={i}>
                    {parsed.headers.map((h) => (
                      <td key={h} className="text-xs text-slate-600">
                        {row[h] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2">
            <button onClick={reset} className="btn-ghost">
              Start over
            </button>
            <button onClick={handleValidate} disabled={loading} className="btn-primary">
              {loading ? "Validating…" : "Validate"}
            </button>
          </div>
        </div>
      )}

      {step === "review" && validation && (
        <div className="section-card space-y-4">
          <div className="text-sm font-semibold text-navy-700">
            Importing into <span className="text-indigo-600">{validation.organization.name}</span>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="badge badge-green">{validation.summary.toCreate} to create</span>
            <span className="badge badge-navy">{validation.summary.toUpdate} to update</span>
            <span className="badge badge-slate">{validation.summary.toSkip} to skip</span>
            <span className="badge badge-red">{validation.summary.toError} with errors</span>
          </div>

          {validation.summary.toError > 0 && (
            <div className="overflow-x-auto">
              <table className="table-clean">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Employee Code</th>
                    <th>Email</th>
                    <th>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {validation.results
                    .filter((r) => r.action === "error")
                    .map((r) => (
                      <tr key={r.rowNumber}>
                        <td className="text-xs text-slate-500">{r.rowNumber}</td>
                        <td className="text-xs">{r.employeeCode ?? "—"}</td>
                        <td className="text-xs">{r.email ?? "—"}</td>
                        <td className="text-xs text-red-600">{r.errors.join("; ")}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => setStep("map")} className="btn-ghost">
              Back to mapping
            </button>
            <button
              onClick={handleCommit}
              disabled={loading || validation.summary.toCreate + validation.summary.toUpdate === 0}
              className="btn-primary"
            >
              {loading ? "Importing…" : `Confirm Import (${validation.summary.toCreate + validation.summary.toUpdate} rows)`}
            </button>
          </div>
        </div>
      )}

      {step === "done" && commitResult && (
        <div className="section-card space-y-4">
          <div className="text-lg font-bold text-navy-700">Import complete</div>
          <div className="text-sm text-slate-500">
            Organization: <span className="font-medium text-navy-700">{commitResult.organization.name}</span>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="badge badge-green">{commitResult.summary.created} created</span>
            <span className="badge badge-navy">{commitResult.summary.updated} updated</span>
            <span className="badge badge-slate">{commitResult.summary.skipped} skipped</span>
            <span className="badge badge-red">{commitResult.summary.errored} errored</span>
          </div>
          {commitResult.summary.errors.length > 0 && (
            <div className="overflow-x-auto">
              <table className="table-clean">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Employee Code</th>
                    <th>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {commitResult.summary.errors.map((e) => (
                    <tr key={e.rowNumber}>
                      <td className="text-xs text-slate-500">{e.rowNumber}</td>
                      <td className="text-xs">{e.employeeCode ?? "—"}</td>
                      <td className="text-xs text-red-600">{e.errors.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={reset} className="btn-ghost">
              Import another file
            </button>
            <a href="/employees" className="btn-primary">
              View Employees
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
