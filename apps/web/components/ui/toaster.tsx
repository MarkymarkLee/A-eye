"use client";
import { Toaster as Sonner } from "sonner";
import { useDark } from "@/hooks/use-dark";

export function Toaster() {
  const dark = useDark();
  return (
    <Sonner
      theme={dark ? "dark" : "light"}
      position="top-center"
      offset={72}
      mobileOffset={{ top: 70 }}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-[18px] !border-line !bg-surface !text-ink !shadow-lift !font-sans !text-[14.5px] !gap-3 !px-4 !py-3.5",
          description: "!text-muted",
          actionButton: "!rounded-full !bg-accent !text-on-accent !font-semibold",
          success: "[&_[data-icon]]:!text-ok",
          error: "[&_[data-icon]]:!text-bad",
        },
      }}
    />
  );
}
