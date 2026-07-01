"use client";

/**
 * Footer — global responsible-gambling footer (V2.1 spec Part 13, Phase 6.2c).
 *
 * Visible on every public page. Hides itself on /lab/* and /admin/* via the
 * same pathname check Navbar uses — the premium app shell + admin chrome own
 * their own bottom-of-page treatment (or none at all).
 *
 * Phase 6B.4 — wired the utility links to real V1 launch pages under
 * /legal/* (terms / privacy / responsible-gambling). Contact remains a
 * mailto: link to support@oddsphereai.com. The Responsible Gambling
 * utility link now routes to the dedicated page rather than tel:, but
 * the help-line at the bottom of the footer still dials 1-800-GAMBLER
 * directly.
 */

import { usePathname } from "next/navigation";
import Link from "next/link";

const PHONE_TEL = "tel:1-800-426-2537"; // 1-800-GAMBLER

export default function Footer() {
  const pathname = usePathname();

  // Hide on premium + admin shells (V2.1: footer is public-pages only).
  if (pathname.startsWith("/lab") || pathname.startsWith("/admin")) {
    return null;
  }

  return (
    <footer className="bg-gray-950/80 border-t border-gray-800 mt-20 py-10 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Utility links */}
        <nav
          aria-label="Footer"
          className="flex flex-wrap justify-center items-center gap-x-3 gap-y-2 text-xs sm:text-sm font-medium text-gray-300 mb-6"
        >
          <Link
            href="/legal/terms"
            className="hover:text-white transition-colors focus-visible:outline-none focus-visible:text-white"
          >
            Terms
          </Link>
          <span aria-hidden="true" className="text-gray-700">·</span>
          <Link
            href="/legal/privacy"
            className="hover:text-white transition-colors focus-visible:outline-none focus-visible:text-white"
          >
            Privacy
          </Link>
          <span aria-hidden="true" className="text-gray-700">·</span>
          <Link
            href="/legal/responsible-gambling"
            className="hover:text-white transition-colors focus-visible:outline-none focus-visible:text-white"
          >
            Responsible Gambling
          </Link>
          <span aria-hidden="true" className="text-gray-700">·</span>
          <Link
            href="/legal/refund-cancellation"
            className="hover:text-white transition-colors focus-visible:outline-none focus-visible:text-white"
          >
            Refund &amp; Cancellation
          </Link>
          <span aria-hidden="true" className="text-gray-700">·</span>
          <a
            href="mailto:support@oddsphereai.com"
            className="hover:text-white transition-colors focus-visible:outline-none focus-visible:text-white"
          >
            Contact
          </a>
        </nav>

        {/* Disclaimer — verbatim from V2.1 spec Part 13. */}
        <p className="text-center text-sm text-gray-300 max-w-2xl mx-auto mb-2 leading-relaxed">
          OddSphere provides sports research and model projections.
          <br />
          It does not guarantee betting outcomes.
        </p>

        {/* Help-line line — kept from the prior footer for the gambling-help
            number, separated from the brand disclaimer above so the legal text
            reads as one thought and the help-line as another. */}
        <p className="text-center text-xs text-gray-400 max-w-xl mx-auto leading-relaxed">
          21+. Gambling involves risk. Need help? Call{" "}
          <a
            href={PHONE_TEL}
            className="text-violet-300 hover:text-violet-200 transition-colors"
          >
            1-800-GAMBLER
          </a>
          .
        </p>

        <p className="text-center text-xs text-gray-500 mt-6">
          © 2026 OddSphere AI
        </p>
      </div>
    </footer>
  );
}
