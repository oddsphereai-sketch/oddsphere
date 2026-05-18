import Link from "next/link";
import Script from "next/script";
import { WHOP_URL, X_HANDLE, X_URL } from "../data/trackRecord";

const LOCKED_PICKS = [
  { league: "NFL", emoji: "🏈" },
  { league: "MLB", emoji: "⚾" },
  { league: "CFB", emoji: "🏈" },
];

export const metadata = {
  title: "Today's Picks — Oddsphere AI",
  description:
    "Daily free picks live on X. Premium subscribers get the full slate in Discord. AI predictions across the NFL, NBA, MLB, CBB, CFB, UCL, and NHL.",
};

export default function PicksPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 space-y-16">
      {/* Top: Free picks on X */}
      <section>
        <header className="mb-6 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-violet-300 mb-2">
            Free Picks, Live on X
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold mb-3">
            Today's free picks, live from @{X_HANDLE}
          </h1>
          <p className="text-gray-200 max-w-2xl mx-auto">
            We post free picks daily on X. Premium subscribers get the full slate in Discord.
          </p>
        </header>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-2 sm:p-4">
          <a
            className="twitter-timeline"
            data-theme="dark"
            data-height="600"
            data-chrome="noheader nofooter transparent"
            href={`https://twitter.com/${X_HANDLE}?ref_src=twsrc%5Etfw`}
          >
            Tweets by @{X_HANDLE}
          </a>
          <Script
            src="https://platform.twitter.com/widgets.js"
            strategy="lazyOnload"
          />
        </div>

        <p className="text-center mt-5">
          <a
            href={X_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-400 hover:text-violet-300 text-sm font-medium"
          >
            Follow @{X_HANDLE} for daily free picks →
          </a>
        </p>
      </section>

      {/* Middle: Locked premium */}
      <section>
        <header className="mb-6 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-violet-300 mb-2">
            Want the Full Slate?
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold mb-3">
            Premium picks drop daily in Discord.
          </h2>
          <p className="text-gray-200">Locked for Whop members. Want in?</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {LOCKED_PICKS.map((pick, i) => (
            <div
              key={i}
              className="bg-gray-900 border border-gray-800 rounded-lg p-6 relative overflow-hidden h-44"
            >
              <div className="filter blur-md select-none pointer-events-none">
                <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                  {pick.league} {pick.emoji}
                </p>
                <p className="text-xl font-bold mt-1">Lorem Ipsum vs. Dolor</p>
                <p className="text-sm text-violet-400 mt-2 font-bold">
                  Pick — Premium
                </p>
                <p className="text-xs text-gray-300 mt-3">Confidence: High</p>
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/70">
                <span className="text-3xl mb-2">🔒</span>
                <span className="text-xs uppercase tracking-wider text-gray-200 font-semibold">
                  Premium
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center">
          <a
            href={WHOP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-violet-600 hover:bg-violet-500 text-white font-semibold px-8 py-3 rounded-md transition-colors shadow-lg shadow-violet-900/50"
          >
            Join Premium for Full Slate →
          </a>
        </div>
      </section>

      {/* Bottom: Lab teaser */}
      <section className="bg-gray-900 border border-violet-800/40 rounded-xl p-6 sm:p-8 text-center">
        <p className="text-xs font-bold uppercase tracking-wider text-violet-300 mb-2">
          Coming Soon
        </p>
        <h3 className="text-2xl font-bold mb-2">Plus, The Lab is coming.</h3>
        <p className="text-gray-200 mb-4 max-w-xl mx-auto text-sm leading-relaxed">
          Members also get first access to The Lab — our upcoming player props research tool. Don't miss it.
        </p>
        <Link
          href="/tools"
          className="text-sm text-violet-400 hover:text-violet-300 font-medium"
        >
          See what's launching →
        </Link>
      </section>
    </main>
  );
}
