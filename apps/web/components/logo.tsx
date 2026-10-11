/** The A-eye mark: an aperture ring around a pupil. Single geometric mark. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="var(--accent)" strokeWidth="3" />
        <circle cx="12" cy="12" r="3" fill="currentColor" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight">A-eye</span>
    </span>
  );
}
