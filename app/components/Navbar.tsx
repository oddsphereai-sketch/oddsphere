"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();

  // 5F.3: "Tools" replaced with "🔒 The Lab" — member-gated research suite.
  // Phase 8 will add the actual auth gate at /lab/*; until then non-members
  // landing on /lab will see the same page members do (internal preview).
  const navLinks: Array<{ href: string; label: string; lab?: boolean }> = [
    { href: "/", label: "Home" },
    { href: "/picks", label: "Picks" },
    { href: "/track-record", label: "Track Record" },
    { href: "/lab", label: "The Lab", lab: true },
  ];

  return (
    <nav className="bg-gray-950/80 backdrop-blur-md border-b border-gray-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20 sm:h-24">
          <Link
            href="/"
            aria-label="Oddsphere AI — Home"
            className="flex items-center shrink-0 transition-all duration-200 hover:brightness-110 hover:scale-105"
          >
            {/* Mobile: icon only */}
            <Image
              src="/icon-logo.png"
              alt="Oddsphere AI"
              width={300}
              height={300}
              priority
              sizes="48px"
              className="block sm:hidden h-12 w-auto invert drop-shadow-[0_0_8px_rgba(167,139,250,0.5)]"
            />
            {/* Desktop: full combo */}
            <Image
              src="/logo-transparent.png"
              alt="Oddsphere AI"
              width={500}
              height={300}
              priority
              sizes="280px"
              className="hidden sm:block h-16 w-auto invert drop-shadow-[0_0_8px_rgba(167,139,250,0.5)]"
            />
          </Link>
          <div className="flex items-center space-x-0.5 sm:space-x-2">
            {navLinks.map((link) => {
              const isActive =
                link.href === "/lab"
                  ? pathname === "/lab" || pathname.startsWith("/lab/")
                  : pathname === link.href;
              const baseClasses =
                "inline-flex items-center gap-1 px-2 sm:px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-colors";
              const stateClasses = isActive
                ? "bg-violet-600 text-white"
                : link.lab
                ? // Lab link: premium-coded styling even when inactive — small
                  // visual cue that this surface is gated.
                  "text-violet-200 bg-violet-900/30 border border-violet-700/40 hover:bg-violet-800/40 hover:text-white"
                : "text-gray-300 hover:bg-gray-800 hover:text-white";
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`${baseClasses} ${stateClasses}`}
                  aria-label={link.lab ? `${link.label} — premium research suite` : undefined}
                >
                  {link.lab && (
                    <span aria-hidden="true" className="text-[11px] leading-none">
                      🔒
                    </span>
                  )}
                  {link.label === "Track Record" ? (
                    <>
                      <span className="sm:hidden">Record</span>
                      <span className="hidden sm:inline">Track Record</span>
                    </>
                  ) : link.label === "The Lab" ? (
                    <>
                      <span className="sm:hidden">Lab</span>
                      <span className="hidden sm:inline">The Lab</span>
                    </>
                  ) : (
                    link.label
                  )}
                </Link>
              );
            })}
            <Link
              href="/join"
              className="ml-1 sm:ml-2 px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-all duration-200 whitespace-nowrap shadow-sm shadow-violet-900/40 hover:shadow-[0_0_15px_rgba(167,139,250,0.45)] hover:scale-[1.03]"
            >
              <span className="sm:hidden">Join</span>
              <span className="hidden sm:inline">Join Premium</span>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
