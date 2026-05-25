/**
 * /lab/* layout — wraps every Lab module page in the persistent app shell.
 *
 * Replaces the giant "🔬 The Lab" hero that used to sit in app/lab/page.tsx.
 * Each module page (daily-edge, player-props, track-record, etc.) now owns
 * its own H1. The Lab branding lives in LabAppNav.
 *
 * The root layout's <Navbar> hides itself on /lab/* (pathname check in
 * app/components/Navbar.tsx) so we get the premium app chrome here instead
 * of the public marketing chrome.
 */

import { Suspense } from "react";
import LabAppNav from "./components/LabAppNav";

export const metadata = {
  title: "The Lab — Oddsphere AI",
  robots: { index: false, follow: false },
};

export default function LabLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <LabAppNav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
        <Suspense
          fallback={
            <div className="text-center text-gray-400 py-16">Loading…</div>
          }
        >
          {children}
        </Suspense>
      </main>
    </>
  );
}
