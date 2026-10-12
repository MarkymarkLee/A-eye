"use client";
import { Drawer } from "vaul";
import { cn } from "@/lib/cn";

/** Spring-animated bottom sheet (vaul). Drag down or tap outside to dismiss. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50" />
        <Drawer.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] max-w-[560px] flex-col rounded-t-[28px] bg-surface shadow-lift ring-1 ring-line outline-none",
            className,
          )}
        >
          <div aria-hidden className="mx-auto mt-3 h-1.5 w-11 shrink-0 rounded-full bg-surface-3" />
          <div className="overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
            <Drawer.Title className="sr-only">{title}</Drawer.Title>
            {description && <Drawer.Description className="sr-only">{description}</Drawer.Description>}
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
