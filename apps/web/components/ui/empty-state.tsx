import { cn } from "@/lib/cn";

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-[20px] border border-dashed border-line bg-surface/60 px-6 py-10 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mb-4 grid size-14 animate-float place-items-center rounded-[18px] bg-accent-soft text-accent-ink">{icon}</div>
      )}
      <p className="text-[17px] font-semibold tracking-tight">{title}</p>
      {body && <div className="mt-1.5 max-w-[38ch] text-[14.5px] leading-relaxed text-muted">{body}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
