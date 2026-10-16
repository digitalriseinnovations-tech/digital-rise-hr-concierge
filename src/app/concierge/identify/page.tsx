import { IdentifyForm } from "./form";
import { getOrgDisplayName } from "@/lib/concierge/org";
import { Sparkles, ShieldCheck, MessageCircleHeart } from "lucide-react";

export const metadata = {
  title: "HR Concierge — Digital Rise",
  // Explicit override — without this, Next.js metadata merging inherits
  // the ROOT layout's product-mode-driven description (see
  // src/app/layout.tsx / src/lib/product-mode.ts).
  description: "Digital Rise HR Concierge — verify your identity to continue.",
  robots: { index: false, follow: false },
};

export default function IdentifyPage() {
  const orgName = getOrgDisplayName();
  return (
    <div className="min-h-screen bg-[#f6f9ff] flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-2 overflow-hidden rounded-3xl shadow-glow bg-white">
        {/* Brand panel */}
        <div className="relative hidden lg:flex flex-col justify-between bg-brand-gradient p-10 text-white overflow-hidden">
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" />
          <div className="absolute -left-10 bottom-10 h-40 w-40 rounded-full bg-white/10" />
          <div className="relative">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-white/70">
              <Sparkles className="h-3.5 w-3.5" />
              Digital Rise
            </div>
            <h1 className="mt-4 font-display text-4xl font-extrabold leading-tight">HR Concierge</h1>
            <p className="mt-3 text-sm text-white/75 max-w-xs">
              Your always-on AI Employee for HR — leave, policies, training and support, grounded in real data.
            </p>
          </div>
          <div className="relative space-y-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-white/15 p-1.5">
                <ShieldCheck className="h-3.5 w-3.5" />
              </div>
              <p className="text-xs text-white/75">Verified employee identity, every session</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-white/15 p-1.5">
                <MessageCircleHeart className="h-3.5 w-3.5" />
              </div>
              <p className="text-xs text-white/75">Answers grounded only in {orgName}&apos;s real HR data</p>
            </div>
          </div>
        </div>

        {/* Form panel */}
        <div className="p-8 sm:p-10 flex flex-col justify-center">
          <div className="lg:hidden mb-6 text-center">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600">Digital Rise</div>
            <h1 className="mt-1 text-2xl font-extrabold text-slate-900">HR Concierge</h1>
          </div>
          <div className="mb-6">
            <h2 className="text-xl font-bold text-slate-900">Verify your identity</h2>
            <p className="mt-1 text-sm text-slate-500">AI Employee for {orgName} — enter your employee details to continue.</p>
          </div>
          <IdentifyForm orgDisplayName={orgName} />
        </div>
      </div>
    </div>
  );
}
