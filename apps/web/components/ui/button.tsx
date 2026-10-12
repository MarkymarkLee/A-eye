import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold tracking-[-0.005em] transition-[transform,background-color,box-shadow,color,opacity] duration-200 ease-[var(--ease-out-expo)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-on-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_10px_24px_-12px_var(--accent)] hover:bg-[color-mix(in_oklab,var(--accent)_90%,var(--ink))] disabled:bg-surface-2 disabled:text-muted disabled:opacity-100 disabled:shadow-none",
        ink: "bg-ink text-bg hover:bg-[color-mix(in_oklab,var(--ink)_85%,var(--bg))]",
        secondary: "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--line)] hover:bg-surface-2",
        soft: "bg-surface-2 text-ink hover:bg-surface-3",
        ghost: "text-muted hover:bg-surface-2 hover:text-ink",
        danger: "bg-bad-soft text-bad hover:bg-[color-mix(in_oklab,var(--bad)_18%,var(--surface))]",
      },
      size: {
        sm: "h-9 px-3.5 text-[13.5px]",
        md: "h-11 px-5 text-[15px]",
        lg: "h-13 px-6 text-[16px]",
        xl: "h-14 px-7 text-[17px]",
        icon: "size-11",
        "icon-sm": "size-9",
      },
      block: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, asChild, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...props}
    />
  );
});
