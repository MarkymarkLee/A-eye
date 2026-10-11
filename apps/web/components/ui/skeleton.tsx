import { cn } from "@/lib/cn";

/** Shimmering placeholder. Use the same shape as the content it stands in for. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("skeleton rounded-[10px]", className)} {...props} />;
}
