"use client";
import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/cn";

/** Expandable section with an animated height. Used to keep technical details out of the way. */
export function Disclosure({
  title,
  icon,
  children,
  className,
  defaultOpen = false,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const reduce = useReducedMotion();
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className={cn("rounded-[20px] bg-surface ring-1 ring-line", className)}>
      <Collapsible.Trigger className="flex min-h-14 w-full items-center gap-3 rounded-[20px] px-4 text-left text-[15px] font-semibold tracking-tight">
        {icon && <span className="text-muted">{icon}</span>}
        <span className="flex-1">{title}</span>
        <ChevronDown aria-hidden className={cn("size-5 text-muted transition-transform duration-300", open && "rotate-180")} />
      </Collapsible.Trigger>
      <AnimatePresence initial={false}>
        {open && (
          <Collapsible.Content forceMount asChild>
            <motion.div
              initial={reduce ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={reduce ? undefined : { height: 0, opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4">{children}</div>
            </motion.div>
          </Collapsible.Content>
        )}
      </AnimatePresence>
    </Collapsible.Root>
  );
}
