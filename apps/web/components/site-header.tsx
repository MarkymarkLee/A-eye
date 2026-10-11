import Link from "next/link";
import { Logo } from "./logo";
import { NavLinks } from "./nav-links";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex h-[60px] max-w-[1400px] items-center justify-between px-4 md:px-6">
        <Link href="/" aria-label="A-eye home">
          <Logo />
        </Link>
        <NavLinks />
      </div>
    </header>
  );
}
