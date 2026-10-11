import Link from "next/link";
import { Logo } from "./logo";
import { NavLinks } from "./nav-links";
import { HowItWorksButton } from "./onboarding";
import { ThemeToggle } from "./ui/theme-toggle";

export function SiteHeader() {
  return (
    <header
      style={{ viewTransitionName: "site-header" }}
      className="sticky top-0 z-30 border-b border-line/70 bg-bg/80 backdrop-blur-xl [padding-top:env(safe-area-inset-top)]"
    >
      <div className="mx-auto flex h-[60px] max-w-[1200px] items-center justify-between gap-2 px-4 md:px-6">
        <Link href="/" aria-label="A-eye home" className="rounded-full">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <NavLinks />
          <HowItWorksButton />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
