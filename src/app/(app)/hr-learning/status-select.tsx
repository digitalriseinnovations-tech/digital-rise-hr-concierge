"use client";

import { useTransition } from "react";

export function StatusSelect({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: readonly string[];
  onChange: (next: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <select
      value={value}
      disabled={disabled || pending}
      onChange={(e) => startTransition(() => onChange(e.target.value))}
      className="rounded-lg border border-slate-300 px-2 py-1 text-xs capitalize"
    >
      {options.map((o) => (
        <option key={o} value={o} className="capitalize">
          {o.replace("_", " ")}
        </option>
      ))}
    </select>
  );
}
