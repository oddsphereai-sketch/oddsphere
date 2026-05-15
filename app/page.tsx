import Link from "next/link";

const HERO_STATS = [
  { label: "CFB Moneyline", value: "76.7%", caption: "Lifetime" },
  { label: "CBB Moneyline", value: "71.8%", caption: "Lifetime" },
  { label: "NBA Moneyline", value: "69.4%", caption: "Lifetime" },
  { label: "Predictions Tracked", value: "23,000+", caption: "Across 7 leagues" },
];

const TOOL_TEASERS = [
  {
    title: "🔥 Player Props Streaks",
    blurb:
      "Spot MLB players riding hot streaks across hits, HRs, Ks, and totals.",
  },
  {
    title: "📊 Team Trends",
    blurb:
      "Recent form, splits, and head-to-head trends across every team.",
  },
  {
    title: "🎯 ML & Totals Research",
    blurb:
      "Model edge vs. market lines — the research powering our daily picks.",
  },
];

export default function Home() {
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
      {/* Hero */}
      <section className="text-center mb-16">
        <h1 className="text-4xl sm:text-6xl md:text-7xl font-bold mb-4 leading-tight bg-gradient-to-r from-violet-400 via-purple-500 to-fuchsia-500 bg-clip-text text-transparent">
          Where data meets winning.
        </h1>
        <p className="text-lg sm:text-2xl text-gray-300 mb-8 max-w-2xl mx-auto">
          AI-powered sports predictions across the NFL, NBA, MLB, CBB, CFB, UCL, and NHL.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/join"
            className="inline-block bg-violet-600 hover:bg-violet-500 text-white font-semibold px-8 py-3 rounded-md transition-colors shadow-lg shadow-violet-900/40"
          >
            Join Premium →
          </Link>
          <Link
            href="/track-record"
            className="inline-block border border-gray-700 hover:border-violet-500 hover:text-violet-300 text-gray-300 font-semibold px-8 py-3 rounded-md transition-colors"
          >
            See the Track Record
          </Link>
        </div>
      </section>

      {/* Hero Stat Cards */}
      <section className="mb-20">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
          {HERO_STATS.map((stat) => (
            <div
              key={stat.label}
              className="bg-gray-900 border border-gray-800 rounded-lg p-5 text-center"
            >
              <p className="text-3xl sm:text-4xl font-bold text-violet-400 mb-1 tabular-nums">
                {stat.value}
              </p>
              <p className="text-sm font-semibold text-white mb-1">{stat.label}</p>
              <p className="text-xs text-gray-500">{stat.caption}</p>
            </div>
          ))}
        </div>
        <p className="text-center mt-5">
          <Link
            href="/track-record"
            className="text-sm text-violet-400 hover:text-violet-300 transition-colors"
          >
            See the full audit →
          </Link>
        </p>
      </section>

      {/* Tools Teaser */}
      <section className="mb-16">
        <div className="text-center mb-8">
          <h2 className="text-3xl sm:text-4xl font-bold mb-2">
            Stat Tools — Coming Soon
          </h2>
          <p className="text-gray-400">
            Premium research suite for Whop members. Free previews rolling out first.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TOOL_TEASERS.map((tool) => (
            <div
              key={tool.title}
              className="bg-gray-900 border border-gray-800 rounded-lg p-6"
            >
              <h3 className="text-xl font-bold mb-2">{tool.title}</h3>
              <p className="text-gray-400 text-sm">{tool.blurb}</p>
            </div>
          ))}
        </div>
        <div className="text-center mt-8">
          <Link
            href="/tools"
            className="text-sm text-violet-400 hover:text-violet-300 transition-colors"
          >
            See all upcoming tools →
          </Link>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-gradient-to-br from-violet-900/40 to-fuchsia-900/20 border border-violet-800/40 rounded-xl p-8 sm:p-12 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold mb-3">Join the edge.</h2>
        <p className="text-gray-300 mb-6 max-w-xl mx-auto">
          Daily AI picks in Discord plus access to the upcoming premium website — all with one Whop subscription.
        </p>
        <Link
          href="/join"
          className="inline-block bg-violet-600 hover:bg-violet-500 text-white font-semibold px-8 py-3 rounded-md transition-colors shadow-lg shadow-violet-900/50"
        >
          Join Premium →
        </Link>
        <p className="text-xs text-gray-500 italic mt-6">
          For entertainment and informational purposes only.
        </p>
      </section>
    </main>
  );
}
