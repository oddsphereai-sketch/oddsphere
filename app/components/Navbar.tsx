"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { TRIAL_CHECKOUT_URL } from "@/lib/marketing/trialOffer";

export default function Navbar() {
  const pathname = usePathname();

  // 6.2a: hide the public marketing Navbar on premium + admin shells. /lab/*
  // gets its own LabAppNav (app-style header); /admin/* uses its scoped chrome.
  // This way the marketing chrome only ever appears on actual marketing pages.
  if (
    pathname.startsWith("/lab") ||
    pathname.startsWith("/admin") ||
    pathname === "/mlb/props" ||
    pathname === "/dev/mlb-props-preview"
  ) {
    return null;
  }

  const navLinks: Array<{ href: string; label: string }> = [
    { href: "/", label: "Home" },
    { href: "/track-record", label: "Track Record" },
    { href: "/pricing", label: "Pricing" },
    { href: "/login", label: "Log In" },
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
              const isActive = pathname === link.href;
              const baseClasses =
                "items-center px-2 sm:px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-colors focus-visible:outline-none focus-visible:bg-gray-800 focus-visible:text-white";
              const mobileVisibility = link.label === "Log In" ? "inline-flex" : "hidden sm:inline-flex";
              const stateClasses = isActive
                ? "bg-violet-600 text-white"
                : "text-gray-300 hover:bg-gray-800 hover:text-white";
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`${baseClasses} ${mobileVisibility} ${stateClasses}`}
                >
                  {link.label === "Track Record" ? (
                    <>
                      <span className="sm:hidden">Record</span>
                      <span className="hidden sm:inline">Track Record</span>
                    </>
                  ) : link.label === "Log In" ? (
                    <>
                      <span className="sm:hidden">Login</span>
                      <span className="hidden sm:inline">Log In</span>
                    </>
                  ) : (
                    link.label
                  )}
                </Link>
              );
            })}
            <a
              href={TRIAL_CHECKOUT_URL}
              className="ml-1 sm:ml-2 px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-all duration-200 whitespace-nowrap shadow-sm shadow-violet-900/40 hover:shadow-[0_0_15px_rgba(167,139,250,0.45)] hover:scale-[1.03]"
              rel="noopener noreferrer"
              target="_blank"
            >
              Start Free Trial
            </a>
          </div>
        </div>
      </div>
    </nav>
  );
}
