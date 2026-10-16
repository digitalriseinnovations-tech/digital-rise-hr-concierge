const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  open: "bg-amber-50 text-amber-700 ring-amber-200",
  assigned: "bg-amber-50 text-amber-700 ring-amber-200",
  requested: "bg-amber-50 text-amber-700 ring-amber-200",
  waitlisted: "bg-amber-50 text-amber-700 ring-amber-200",

  in_progress: "bg-sky-50 text-sky-700 ring-sky-200",

  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  confirmed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  resolved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  completed: "bg-indigo-50 text-indigo-700 ring-indigo-200",

  rejected: "bg-red-50 text-red-700 ring-red-200",
  declined: "bg-red-50 text-red-700 ring-red-200",

  cancelled: "bg-slate-100 text-slate-500 ring-slate-200",
  closed: "bg-slate-100 text-slate-500 ring-slate-200",
};

const DOT_STYLES: Record<string, string> = {
  pending: "bg-amber-500",
  open: "bg-amber-500",
  assigned: "bg-amber-500",
  requested: "bg-amber-500",
  waitlisted: "bg-amber-500",
  in_progress: "bg-sky-500",
  approved: "bg-emerald-500",
  confirmed: "bg-emerald-500",
  resolved: "bg-emerald-500",
  completed: "bg-indigo-500",
  rejected: "bg-red-500",
  declined: "bg-red-500",
  cancelled: "bg-slate-400",
  closed: "bg-slate-400",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_STYLES[status] ?? STATUS_STYLES.cancelled;
  const dot = DOT_STYLES[status] ?? DOT_STYLES.cancelled;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ring-inset ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {status.replace("_", " ")}
    </span>
  );
}
