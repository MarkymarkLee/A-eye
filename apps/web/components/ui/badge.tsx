import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

export const badgeVariants = cva("inline-flex items-center gap-1.5 rounded-full font-medium [&_svg]:shrink-0", {
  variants: {
    tone: {
      neutral: "bg-surface-2 text-muted",
      accent: "bg-accent-soft text-accent-ink",
      ok: "bg-ok-soft text-ok",
      warn: "bg-warn-soft text-warn",
      bad: "bg-bad-soft text-bad",
      sky: "bg-[color-mix(in_oklab,var(--sky)_14%,var(--surface))] text-[color-mix(in_oklab,var(--sky)_70%,var(--ink))]",
      solid: "bg-accent text-on-accent",
    },
    size: { sm: "h-6 px-2.5 text-[12px]", md: "h-7 px-3 text-[13px]" },
  },
  defaultVariants: { tone: "neutral", size: "sm" },
});

export function Badge({
  className,
  tone,
  size,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}

/** A pulsing dot for "live" states. */
export function LiveDot({ className, tone = "accent" }: { className?: string; tone?: "accent" | "ok" | "sky" }) {
  const color = tone === "ok" ? "bg-ok" : tone === "sky" ? "bg-sky" : "bg-accent";
  return (
    <span aria-hidden className={cn("relative inline-flex size-2", className)}>
      <span className={cn("absolute inset-0 animate-pulse-ring rounded-full", color)} />
      <span className={cn("relative inline-flex size-2 rounded-full", color)} />
    </span>
  );
}
