"use client";

/**
 * LabAppNav — persistent app-shell header for /lab/* routes (Phase 6.2).
 *
 * Replaces the old in-page LabNav (which was driven by ?section= URL state).
 * Active-state is now path-based — each module gets its own route segment.
 *
 *   /lab/daily-edge    → Daily Edge
 *   /lab/player-props  → Player Props
 *   /lab/tracking      → Model Tracking (member-facing, Phase 6B.2b)
 *   /lab/my-bets       → My Bets (stub, V1)
 *   /lab/account       → Account (stub, V1)
 *
 * /lab/track-record permanently redirects to /lab/tracking so legacy
 * links keep working.
 *
 * Right side carries the RefreshIndicator (5E) + an Account placeholder.
 * The real auth/account dropdown lands in Phase 7 (Whop OAuth + Magic Link);
 * for V1 it's a text link to /lab/account so members can find it.
 *
 * Branding: "OddSphere AI Lab" wordmark on the left. The giant "🔬 The Lab"
 * hero from app/lab/page.tsx is gone — module pages own their own H1.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import RefreshIndicator from "./RefreshIndicator";

type Tab = {
  href: string;
  label: string;
  icon: string;
};

const TABS: Tab[] = [
  { href: "/lab/daily-edge",   label: "Daily Edge",   icon: "🎯" },
  { href: "/lab/player-props", label: "Player Props", icon: "🎮" },
  { href: "/lab/tracking",     label: "Tracking",     icon: "📈" },
  { href: "/lab/my-bets",      label: "My Bets",      icon: "📊" },
];

// Routes that should highlight a given tab even if their own pathname
// doesn't start with the tab's href. /lab/design-preview is the
// in-progress Daily Edge prototype, so the Daily Edge tab should read
// as active while we're reviewing it.
const ALIASED_AS: Record<string, string> = {
  "/lab/design-preview": "/lab/daily-edge",
};

function isActive(currentPath: string, tabHref: string): boolean {
  const effective = ALIASED_AS[currentPath] ?? currentPath;
  return effective === tabHref || effective.startsWith(`${tabHref}/`);
}

export default function LabAppNav() {
  const pathname = usePathname() ?? "";

  return (
    <header className="sticky top-0 z-40 bg-gray-950/85 backdrop-blur-md border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 h-14 sm:h-16">
          {/* Left: real OddSphere brand mark — matches production Navbar
              pattern (icon-logo on mobile, full wordmark on sm+). */}
          <Link
            href="/lab/daily-edge"
            className="inline-flex items-center transition-all duration-200 hover:brightness-110 hover:scale-[1.02] whitespace-nowrap"
            aria-label="OddSphere AI Lab"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon-logo.png"
              alt="OddSphere"
              className="block sm:hidden h-9 w-auto invert drop-shadow-[0_0_8px_rgba(167,139,250,0.5)]"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-transparent.png"
              alt="OddSphere AI Lab"
              className="hidden sm:block h-11 w-auto invert drop-shadow-[0_0_8px_rgba(167,139,250,0.5)]"
            />
          </Link>

          {/* Center / mobile: section tabs */}
          {/* Mobile: justify-start so the leftmost (and usually active)
              tab is fully visible rather than getting the leading letter
              clipped by the centered-overflow scroll. Desktop keeps the
              centered layout. */}
          <nav
            role="tablist"
            aria-label="Lab sections"
            className="flex-1 flex justify-start sm:justify-center -mx-2 sm:mx-0 overflow-x-auto sm:overflow-visible"
          >
            <div className="flex gap-0.5 sm:gap-1 pl-1 sm:px-0 min-w-max">
              {TABS.map((t) => {
                const active = isActive(pathname, t.href);
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    role="tab"
                    aria-selected={active}
                    className={`relative inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 sm:px-3 py-2 min-h-10 rounded-md text-[11px] sm:text-xs font-bold uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:bg-gray-900/60 focus-visible:text-white ${
                      active
                        ? "text-white"
                        : "text-gray-400 hover:text-violet-300"
                    }`}
                  >
                    <span aria-hidden="true" className="text-sm leading-none">
                      {t.icon}
                    </span>
                    {/* Full label on sm+; abbreviated on mobile for the wider tabs */}
                    <span className="hidden sm:inline">{t.label}</span>
                    <span className="sm:hidden">
                      {abbreviateLabel(t.label)}
                    </span>
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-1.5 -bottom-px h-[2px] bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.7)] rounded-full"
                      />
                    )}
                  </Link>
                );
              })}
            </div>
          </nav>

          {/* Right: status pill + account placeholder */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="hidden sm:block">
              <RefreshIndicator />
            </div>
            <Link
              href="/lab/account"
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 min-h-10 rounded-md text-[11px] sm:text-xs font-bold uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:bg-gray-900/60 focus-visible:text-white ${
                isActive(pathname, "/lab/account")
                  ? "text-white"
                  : "text-gray-400 hover:text-violet-300"
              }`}
            >
              <span aria-hidden="true" className="text-sm leading-none">👤</span>
              <span className="hidden sm:inline">Account</span>
            </Link>
          </div>
        </div>

        {/* Mobile-only: RefreshIndicator stacks below the row so the pill stays
            thumb-reachable without horizontal scroll. */}
        <div className="sm:hidden pb-2 -mt-1 flex justify-end">
          <RefreshIndicator />
        </div>
      </div>
    </header>
  );
}

function abbreviateLabel(label: string): string {
  switch (label) {
    case "Daily Edge":   return "Edge";
    case "Player Props": return "Props";
    case "Tracking":     return "Tracking";
    case "My Bets":      return "Bets";
    default:             return label;
  }
}
