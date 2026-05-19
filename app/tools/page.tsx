import { WHOP_URL, X_HANDLE, X_URL } from "../data/trackRecord";

const LAB_FEATURES = [
  {
    icon: "🔥",
    title: "PLAYER PROPS RESEARCH",
    pitch: "Find players riding hot streaks across every prop type.",
    bullets: [
      "Filter by sport, prop type, and game date.",
      "See hit rate over last 5, 10, and 20 games.",
      "Compare to tonight's line — find the divergences.",
      "Launching with MLB markets. Expanding to NFL, NBA, NHL, CBB, CFB, and UCL through season.",
    ],
  },
  {
    icon: "📊",
    title: "TEAM TRENDS",
    pitch: "Validate the line with real team data.",
    bullets: [
      "Recent form, home/away splits, head-to-head matchups.",
      "Matchup context adapted to each sport — handedness for MLB, pace and rest for NBA, weather for NFL.",
      "Cross-reference team trends with our score model in seconds.",
    ],
  },
  {
    icon: "🎯",
    title: "MODEL vs. MARKET",
    pitch: "See where our model disagrees most with the line.",
    bullets: [
      "Every game, every market — our model's probability next to the implied probability from the line.",
      "Sort by the size of the gap. Filter by sport.",
      "The same models behind our tracked daily picks — now in a sortable view.",
    ],
  },
];

export const metadata = {
  title: "The Lab — Oddsphere AI",
  description:
    "The bet research tool built on tested signals, transparent math, and real edge. Player props streaks, team trends, model vs. market. Launching with MLB Q3 2026.",
};

export default function ToolsPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 space-y-20 sm:space-y-28">
      {/* Hero */}
      <header className="text-center">
        <p className="text-xs font-bold uppercase tracking-wider text-violet-300 mb-4">
          Research Suite — Coming Soon
        </p>
        <p className="text-2xl sm:text-3xl font-bold italic text-violet-300 mb-3">
          The signal layer above the stats.
        </p>
        <div className="relative isolate inline-block">
          <div className="hero-glow"></div>
          <h1 className="relative text-5xl sm:text-7xl md:text-8xl font-black mb-6 leading-[1.05] tracking-tight bg-gradient-to-r from-violet-400 via-purple-500 to-fuchsia-500 bg-clip-text text-transparent">
            Introducing The Lab.
          </h1>
        </div>
        <p className="text-xl sm:text-2xl md:text-3xl text-gray-200 mb-4 max-w-3xl mx-auto leading-relaxed">
          The bet research tool built on tested signals, transparent math, and real edge.
        </p>
        <p className="text-sm text-violet-300 font-semibold">
          MLB launch — Q3 2026. Other sports rolling out by season. Included with every Whop membership.
        </p>
      </header>

      {/* What is The Lab */}
      <section className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl p-8 sm:p-12 transition-all duration-300 hover:border-violet-500/50 hover:shadow-[0_0_30px_rgba(167,139,250,0.15)]">
        <h2 className="text-3xl sm:text-4xl font-black mb-6 tracking-tight">
          What is The Lab?
        </h2>
        <div className="space-y-5 text-gray-100 leading-relaxed text-base sm:text-lg">
          <p>
            Sports data is broken. Hit rates live on one site, recent form on another, sportsbook lines on a third, and nobody puts model edge vs. market line in front of you in one place. You end up with twelve tabs open and still no clear edge.
          </p>
          <p>
            The Lab brings it together. Every prop. Every game. Tested signals layered on top — hot streaks, matchup history, weather, model edge vs. market.
          </p>
          <p>
            Every signal is backtested. We show you the hit rate, the sample size, and how each one works.
          </p>
          <p className="text-violet-300 font-bold text-lg sm:text-xl">
            No black boxes.
          </p>
        </div>
      </section>

      {/* What you'll be able to do */}
      <section>
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mb-10 text-center tracking-tight">
          What you'll be able to do
        </h2>
        <div className="space-y-6">
          {LAB_FEATURES.map((feat) => (
            <div
              key={feat.title}
              className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl p-6 sm:p-8 grid grid-cols-1 md:grid-cols-[120px_1fr] gap-6 items-start transition-all duration-300 hover:border-violet-500/50 hover:shadow-[0_0_30px_rgba(167,139,250,0.15)]"
            >
              <div className="text-5xl sm:text-6xl text-center md:text-left">
                {feat.icon}
              </div>
              <div>
                <h3 className="text-xl sm:text-2xl font-bold mb-2 tracking-tight">
                  {feat.title}
                </h3>
                <p className="text-violet-300 font-semibold mb-4">{feat.pitch}</p>
                <ul className="space-y-2 text-gray-100 text-sm sm:text-base">
                  {feat.bullets.map((b) => (
                    <li key={b} className="flex gap-2">
                      <span className="text-violet-400 shrink-0">▸</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Sports rollout */}
      <section className="text-center bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl p-10 transition-all duration-300 hover:border-violet-500/50 hover:shadow-[0_0_30px_rgba(167,139,250,0.15)]">
        <h2 className="text-2xl sm:text-3xl font-black mb-3 tracking-tight">
          Launching with MLB.
        </h2>
        <p className="text-lg text-gray-200 max-w-2xl mx-auto">
          NFL, NBA, NHL, CBB, CFB, and UCL rolling out through season.
        </p>
      </section>

      {/* Launch updates via X */}
      <section className="bg-gradient-to-br from-violet-950/60 via-purple-950/40 to-fuchsia-950/30 border border-violet-800/40 rounded-2xl p-8 sm:p-14 text-center transition-all duration-300 hover:border-violet-500 hover:shadow-[0_0_40px_rgba(167,139,250,0.25)]">
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mb-4 tracking-tight">
          Be the first to access The Lab.
        </h2>
        <p className="text-lg text-gray-200 mb-8 max-w-xl mx-auto">
          Follow @{X_HANDLE} on X for launch updates.
        </p>
        <a
          href={X_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-violet-600 hover:bg-violet-500 text-white text-lg font-semibold px-10 py-4 rounded-md transition-all duration-200 shadow-lg shadow-violet-900/50 hover:shadow-[0_0_30px_rgba(167,139,250,0.55)] hover:scale-[1.02]"
        >
          Follow on X →
        </a>
      </section>

      {/* Final CTA */}
      <section className="text-center">
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mb-4 tracking-tight">
          Already a Whop member? You're in.
        </h2>
        <p className="text-lg text-gray-200 mb-8 max-w-xl mx-auto leading-relaxed">
          Charter Members locked in at $25/month — your rate stays the same when The Lab launches, even after standard pricing goes to $35.
        </p>
        <a
          href={WHOP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-violet-600 hover:bg-violet-500 text-white font-semibold px-8 py-3 rounded-md transition-all duration-200 shadow-lg shadow-violet-900/50 hover:shadow-[0_0_25px_rgba(167,139,250,0.5)] hover:scale-[1.02]"
        >
          Join Premium →
        </a>
      </section>
    </main>
  );
}
