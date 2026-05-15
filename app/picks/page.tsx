import { WHOP_URL } from "../data/trackRecord";

const SAMPLE_PICK = {
  league: "NBA",
  emoji: "🏀",
  matchup: "Lakers vs. Celtics",
  pick: "Lakers ML",
  confidence: "High — model edge +6.2%",
  reasoning:
    "Model favors LAL on recent form, pace differential, and rest advantage. Illustrative sample only.",
};

const LOCKED_PICKS = [
  { league: "NFL", emoji: "🏈" },
  { league: "MLB", emoji: "⚾" },
  { league: "CFB", emoji: "🏈" },
];

export const metadata = {
  title: "Today's Picks — Oddsphere AI",
  description:
    "A free sample pick plus the full premium AI slate — daily predictions across the NFL, NBA, MLB, CBB, CFB, UCL, and NHL.",
};

export default function PicksPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <header className="mb-10 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold mb-3">Today's Picks</h1>
        <p className="text-gray-400">
          One free sample. Full slate unlocked for Whop members.
        </p>
      </header>

      {/* Free Pick */}
      <section className="mb-12">
        <p className="text-xs font-bold uppercase tracking-wider text-violet-400 mb-3">
          Free Sample Pick
        </p>
        <div className="bg-gray-900 border border-violet-800/60 rounded-lg p-6">
          <div className="flex items-start justify-between gap-4 mb-2">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                {SAMPLE_PICK.league} {SAMPLE_PICK.emoji}
              </p>
              <h2 className="text-2xl font-bold mt-1">{SAMPLE_PICK.matchup}</h2>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Pick</p>
              <p className="text-xl font-bold text-violet-400">{SAMPLE_PICK.pick}</p>
            </div>
          </div>
          <p className="text-sm text-gray-300 mt-3">{SAMPLE_PICK.confidence}</p>
          <p className="text-sm text-gray-500 mt-2">{SAMPLE_PICK.reasoning}</p>
        </div>
      </section>

      {/* Locked Premium Picks */}
      <section className="mb-12">
        <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">
          🔒 Premium Picks
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {LOCKED_PICKS.map((pick, i) => (
            <div
              key={i}
              className="bg-gray-900 border border-gray-800 rounded-lg p-6 relative overflow-hidden h-44"
            >
              <div className="filter blur-md select-none pointer-events-none">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {pick.league} {pick.emoji}
                </p>
                <p className="text-xl font-bold mt-1">Lorem Ipsum vs. Dolor</p>
                <p className="text-sm text-violet-400 mt-2 font-bold">
                  Pick — Premium
                </p>
                <p className="text-xs text-gray-500 mt-3">Confidence: High</p>
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/70">
                <span className="text-3xl mb-2">🔒</span>
                <span className="text-xs uppercase tracking-wider text-gray-400">
                  Premium
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-br from-violet-900/40 to-fuchsia-900/20 border border-violet-800/40 rounded-xl p-8 sm:p-10 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold mb-3">
          Unlock today's full slate.
        </h2>
        <p className="text-gray-300 mb-6 max-w-xl mx-auto">
          Daily AI predictions across the NFL, NBA, MLB, CBB, CFB, UCL, and NHL — delivered in Discord.
        </p>
        <a
          href={WHOP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-violet-600 hover:bg-violet-500 text-white font-semibold px-8 py-3 rounded-md transition-colors shadow-lg shadow-violet-900/50"
        >
          Join Premium on Whop →
        </a>
      </section>
    </main>
  );
}
