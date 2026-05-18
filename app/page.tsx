import Link from "next/link";
import { WHOP_URL } from "./data/trackRecord";
import NotifyForm from "./components/NotifyForm";

const HERO_STATS = [
  { label: "CFB Moneyline", value: "76.7%", caption: "Lifetime" },
  { label: "CBB Moneyline", value: "71.8%", caption: "Lifetime" },
  { label: "NBA Moneyline", value: "69.4%", caption: "Lifetime" },
  { label: "Predictions Tracked", value: "25,000+", caption: "Across 7 leagues" },
];

const LAB_FEATURES = [
  {
    title: "🔥 Player Props Streaks",
    blurb:
      "Find the hottest hitters, pitchers, and scorers riding hit streaks. Search by sport, prop type, last 5/10/20 games. See hit rate vs. tonight's line — find your edge instantly.",
  },
  {
    title: "📊 Team Trends",
    blurb:
      "Recent form, home/away splits, head-to-head matchups across every team in every league we cover.",
  },
  {
    title: "🎯 Edge Finder",
    blurb:
      "Side-by-side model edge vs. market lines for every game. AI flags the biggest mispriced bets daily.",
  },
];

const COMPARISON = [
  {
    name: "Oddsphere AI",
    price: "$20/mo",
    highlight: true,
    bullets: [
      "Daily AI picks across 7 sports",
      "The Lab access (when launched)",
      "Lifetime tracked record",
    ],
  },
  {
    name: "Typical Picks Discord",
    price: "$50–200/mo",
    highlight: false,
    bullets: [
      "Picks only",
      "No transparency",
      "No research tools",
    ],
  },
  {
    name: "BettingPros",
    price: "$30–50/mo",
    highlight: false,
    bullets: [
      "Analytics only",
      "No daily picks",
      "No AI model",
    ],
  },
];

export default function Home() {
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20 space-y-24 sm:space-y-32">
      {/* Hero */}
      <section className="text-center">
        <h1 className="text-4xl sm:text-6xl md:text-7xl font-bold mb-4 leading-tight bg-gradient-to-r from-violet-400 via-purple-500 to-fuchsia-500 bg-clip-text text-transparent">
          Where data meets winning.
        </h1>
        <p className="text-lg sm:text-2xl text-gray-300 mb-8 max-w-2xl mx-auto">
          AI-powered sports predictions across the NFL, NBA, MLB, CBB, CFB, UCL, and NHL.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
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
        <p className="mt-5">
          <Link
            href="/track-record"
            className="text-sm text-violet-400 hover:text-violet-300 transition-colors"
          >
            See the full track record →
          </Link>
        </p>
      </section>

      {/* The Lab — Coming Soon */}
      <section className="bg-gradient-to-br from-violet-950/60 via-purple-950/40 to-fuchsia-950/30 border border-violet-800/40 rounded-2xl p-8 sm:p-12">
        <div className="text-center mb-10">
          <p className="text-xs font-bold uppercase tracking-wider text-violet-400 mb-3">
            Premium Research Suite
          </p>
          <h2 className="text-4xl sm:text-5xl font-bold mb-4">The Lab is coming.</h2>
          <p className="text-lg text-gray-300 max-w-2xl mx-auto leading-relaxed">
            The most powerful sports stats research tool you've never had. Player props streaks, team trends, model edge vs. market lines. Included with every Whop membership.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          {LAB_FEATURES.map((feat) => (
            <div
              key={feat.title}
              className="bg-gray-900/70 border border-gray-800 rounded-lg p-6"
            >
              <h3 className="text-xl font-bold mb-3">{feat.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{feat.blurb}</p>
            </div>
          ))}
        </div>

        <div className="text-center">
          <p className="text-sm text-gray-300 mb-3 font-semibold">
            Be the first to access The Lab when it launches.
          </p>
          <NotifyForm context="The Lab" />
          <p className="mt-4">
            <Link
              href="/tools"
              className="text-sm text-violet-400 hover:text-violet-300"
            >
              Learn more about The Lab →
            </Link>
          </p>
        </div>
      </section>

      {/* Why Oddsphere AI */}
      <section>
        <div className="text-center mb-10">
          <h2 className="text-4xl sm:text-5xl font-bold mb-3">
            Why $20/month is a steal.
          </h2>
          <p className="text-gray-400">Side-by-side with what's out there.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          {COMPARISON.map((item) => (
            <div
              key={item.name}
              className={`rounded-lg p-6 flex flex-col ${
                item.highlight
                  ? "bg-gradient-to-br from-violet-900/60 to-fuchsia-900/30 border border-violet-600"
                  : "bg-gray-900 border border-gray-800"
              }`}
            >
              <p
                className={`text-xs font-bold uppercase tracking-wider mb-2 ${
                  item.highlight ? "text-violet-300" : "text-gray-500"
                }`}
              >
                {item.highlight ? "Our pricing" : "Compare"}
              </p>
              <h3 className="text-xl font-bold mb-1">{item.name}</h3>
              <p
                className={`text-2xl font-bold mb-4 tabular-nums ${
                  item.highlight ? "text-violet-300" : "text-gray-300"
                }`}
              >
                {item.price}
              </p>
              <ul className="space-y-2 text-sm text-gray-300 flex-1">
                {item.bullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span
                      className={item.highlight ? "text-violet-400" : "text-gray-500"}
                    >
                      {item.highlight ? "✓" : "•"}
                    </span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="text-center mt-8 text-lg font-semibold text-violet-300">
          Same data edge. Half the price.
        </p>
      </section>

      {/* Final CTA */}
      <section className="bg-gradient-to-br from-violet-900/40 to-fuchsia-900/20 border border-violet-800/40 rounded-xl p-8 sm:p-12 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold mb-3">Join the edge.</h2>
        <p className="text-gray-300 mb-6 max-w-xl mx-auto">
          Daily AI picks in Discord plus first access to The Lab — all with one Whop subscription.
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
