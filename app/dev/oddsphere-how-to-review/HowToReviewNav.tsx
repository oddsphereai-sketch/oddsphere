"use client";

import Link from "next/link";

const tabs = [
  { href: "/lab/daily-edge", label: "Daily Edge", mobile: "Edge", icon: "🎯" },
  { href: "/mlb/props", label: "Player Props", mobile: "Props", icon: "🎮" },
  { href: "/lab/tracking", label: "Tracking", mobile: "Track", icon: "📈" },
  { href: "/dev/oddsphere-how-to-review", label: "How It Works", mobile: "Guide", icon: "📖", active: true },
];

export default function HowToReviewNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-gray-800 bg-gray-950/85 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-4 sm:h-16">
          <Link
            href="/dev/oddsphere-how-to-review"
            className="inline-flex items-center whitespace-nowrap transition-all duration-200 hover:scale-[1.02] hover:brightness-110"
            aria-label="OddSphere AI Lab"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon-logo.png"
              alt="OddSphere"
              className="block h-9 w-auto invert drop-shadow-[0_0_8px_rgba(167,139,250,0.5)] sm:hidden"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-transparent.png"
              alt="OddSphere AI Lab"
              className="hidden h-11 w-auto invert drop-shadow-[0_0_8px_rgba(167,139,250,0.5)] sm:block"
            />
          </Link>

          <nav
            role="tablist"
            aria-label="Lab sections"
            className="-mx-2 flex min-w-0 flex-1 justify-start overflow-x-auto sm:mx-0 sm:justify-center sm:overflow-visible"
          >
            <div className="flex min-w-max gap-0 pl-0.5 sm:gap-1 sm:px-0">
              {tabs.map((tab) => (
                <Link
                  key={tab.href}
                  href={tab.href}
                  role="tab"
                  aria-selected={tab.active === true}
                  className={`relative inline-flex min-h-10 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-2 text-[10px] font-bold uppercase tracking-[0.08em] transition-colors sm:gap-1.5 sm:px-3 sm:text-xs sm:tracking-[0.1em] ${
                    tab.active
                      ? "text-white"
                      : "text-gray-400 hover:text-violet-300"
                  }`}
                >
                  <span aria-hidden="true" className="text-sm leading-none">{tab.icon}</span>
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.mobile}</span>
                  {tab.active ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.7)]"
                    />
                  ) : null}
                </Link>
              ))}
            </div>
          </nav>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span className="hidden items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/[0.08] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-amber-200 sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Review mode
            </span>
            <Link
              href="/lab/account"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-2.5 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-400 transition-colors hover:text-violet-300 sm:px-3 sm:text-xs"
            >
              <span aria-hidden="true" className="text-sm leading-none">👤</span>
              <span className="hidden sm:inline">Account</span>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
