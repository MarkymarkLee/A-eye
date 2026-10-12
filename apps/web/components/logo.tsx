/** The A-eye mark: an aperture ring around a pupil, with a gradient iris. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 24 24" className="size-7" aria-hidden>
        <defs>
          <linearGradient id="aeye-iris" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="url(#aeye-iris)" strokeWidth="3" />
        <circle cx="12" cy="12" r="3.2" fill="currentColor" />
        <circle cx="13.3" cy="10.7" r="1" fill="var(--bg)" />
      </svg>
      <span className="text-[18px] font-semibold tracking-tight">A-eye</span>
    </span>
  );
}
