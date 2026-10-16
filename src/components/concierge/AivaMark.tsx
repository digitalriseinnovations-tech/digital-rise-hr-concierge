// AIVA's monogram — a geometric "A" with a spark at the apex. Kept as a
// single small component so the mark stays pixel-identical everywhere it
// appears (identify screen, hub header, chat header, chat avatars).
export function AivaMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 4.5L4.5 19.5M12 4.5L19.5 19.5M8 15H16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="4.5" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function AivaBadge({ size = "h-9 w-9" }: { size?: string }) {
  return (
    <div className={`flex ${size} shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-card`}>
      <AivaMark className="h-[45%] w-[45%]" />
    </div>
  );
}
