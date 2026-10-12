import { cn } from "@/lib/cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-[20px] bg-surface shadow-panel ring-1 ring-line", className)} {...props} />;
}
