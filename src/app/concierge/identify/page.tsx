import { IdentifyForm } from "./form";

export const metadata = {
  title: "HR Concierge — Digital Rise",
  // Explicit override — without this, Next.js metadata merging inherits
  // the ROOT layout's "Verofax internal finance management..." description.
  description: "Digital Rise HR Concierge — verify your identity to continue.",
  robots: { index: false, follow: false },
};

export default function IdentifyPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600">Digital Rise</div>
          <h1 className="mt-1 text-2xl font-extrabold text-slate-900">HR Concierge</h1>
          <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-slate-400">AI Employee for Northstar Global</p>
          <p className="mt-3 text-sm text-slate-500">Verify your identity to continue.</p>
        </div>
        <IdentifyForm />
      </div>
    </div>
  );
}
