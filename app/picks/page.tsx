import Image from "next/image";
import Link from "next/link";
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

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="w-4 h-4 text-violet-400 shrink-0"
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function PicksPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 space-y-20 sm:space-y-28">
      {/* Top: Free picks on X */}
      <section>
        <header className="mb-10 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-violet-300 mb-3">
            Free Picks, Live on X
          </p>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black mb-4 tracking-tight">
            Today's free picks, live from @{X_HANDLE}
          </h1>
          <p className="text-lg text-gray-200 max-w-2xl mx-auto">
            We post free picks daily on X. Premium subscribers get the full slate in Discord.
          </p>
        </header>

        {/* Follow on X CTA card */}
        <div className="max-w-2xl mx-auto bg-gradient-to-br from-gray-900 to-gray-950 border border-violet-800/50 rounded-2xl p-8 sm:p-12 text-center transition-all duration-300 hover:border-violet-500 hover:shadow-[0_0_40px_rgba(167,139,250,0.25)]">
          <div className="flex justify-center mb-6">
            <Image
              src="/icon-logo.png"
              alt="Oddsphere AI"
              width={300}
              height={300}
              sizes="80px"
              className="h-16 w-auto invert drop-shadow-[0_0_10px_rgba(167,139,250,0.5)]"
            />
          </div>
          <p className="text-2xl sm:text-3xl font-black text-white mb-2 tracking-tight">
            @{X_HANDLE}
          </p>
          <p className="text-lg text-gray-200 mb-8">Daily free picks. Live on X.</p>
          <a
            href={X_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold px-8 py-3 rounded-md transition-all duration-200 shadow-lg shadow-violet-900/40 hover:shadow-[0_0_25px_rgba(167,139,250,0.5)] hover:scale-[1.02]"
          >
            Follow on X →
          </a>
          <div className="mt-8 pt-6 border-t border-gray-800 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-gray-200">
            <span className="inline-flex items-center gap-1.5">
              <CheckIcon />
              2.1K+ followers
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckIcon />
              Verified
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckIcon />
              Updated daily
            </span>
          </div>
        </div>
      </section>

      {/* Middle: Locked premium */}
      <section>
        <header className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-violet-300 mb-3">
            Want the Full Slate?
          </p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mb-4 tracking-tight">
            Premium picks drop daily in Discord.
          </h2>
          <p className="text-lg text-gray-200">Locked for Whop members. Want in?</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
          {LOCKED_PICKS.map((pick, i) => (
            <div
              key={i}
              className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-lg p-6 relative overflow-hidden h-44 transition-all duration-300 hover:border-violet-500/50 hover:shadow-[0_0_30px_rgba(167,139,250,0.15)]"
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
            className="inline-block bg-violet-600 hover:bg-violet-500 text-white font-semibold px-8 py-3 rounded-md transition-all duration-200 shadow-lg shadow-violet-900/40 hover:shadow-[0_0_25px_rgba(167,139,250,0.5)] hover:scale-[1.02]"
          >
            Join Premium for Full Slate →
          </a>
        </div>
      </section>

      {/* Bottom: Lab teaser */}
      <section className="bg-gradient-to-br from-gray-900 to-gray-950 border border-violet-800/40 rounded-xl p-6 sm:p-8 text-center transition-all duration-300 hover:border-violet-500/60 hover:shadow-[0_0_30px_rgba(167,139,250,0.15)]">
        <p className="text-xs font-bold uppercase tracking-wider text-violet-300 mb-2">
          Coming Soon
        </p>
        <h3 className="text-2xl sm:text-3xl font-bold mb-2 tracking-tight">
          Plus, The Lab is coming.
        </h3>
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
