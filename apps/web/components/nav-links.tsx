"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Bot, Map, Radio, Trophy, UserRound, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { haptic } from "@/lib/haptics";

/** Single source of navigation for the header (desktop) and the bottom tab bar (mobile). */
export const LINKS: { href: string; label: string; short?: string; icon: LucideIcon }[] = [
  { href: "/", label: "Nearby", icon: Map },
  { href: "/agents", label: "For agents", short: "Agents", icon: Bot },
  { href: "/live", label: "Live", icon: Radio },
  { href: "/leaderboard", label: "Leaderboard", short: "Top", icon: Trophy },
  { href: "/me", label: "Me", icon: UserRound },
];

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="hidden items-center gap-1 text-[14px] md:flex">
      {LINKS.map((l) => {
        const active = isActive(path, l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn("relative rounded-full px-3.5 py-2 font-medium transition-colors", active ? "text-ink" : "text-muted hover:text-ink")}
          >
            {active && (
              <motion.span
                layoutId="nav-pill"
                className="absolute inset-0 rounded-full bg-surface-2"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative">{l.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Thumb-reachable tab bar on phones. Hidden on the answer screen, which has its own sticky action. */
export function TabBar() {
  const path = usePathname();
  if (/^\/q\/[^/]+\/answer/.test(path)) return null;
  return (
    <nav
      aria-label="Main"
      style={{ viewTransitionName: "tab-bar" }}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/85 backdrop-blur-xl md:hidden [padding-bottom:env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid h-16 max-w-[560px] grid-flow-col auto-cols-fr">
        {LINKS.map((l) => {
          const active = isActive(path, l.href);
          const Icon = l.icon;
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                onClick={() => haptic("tap")}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-full flex-col items-center justify-center gap-0.5 text-[11.5px] font-medium transition-colors",
                  active ? "text-ink" : "text-muted",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="tab-pill"
                    className="absolute top-2 h-8 w-14 rounded-full bg-accent-soft"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <Icon aria-hidden className={cn("relative size-[22px]", active && "text-accent-ink")} strokeWidth={active ? 2.4 : 2} />
                <span className="relative mt-1">{l.short ?? l.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
