import Link from "next/link";
import {
  CHARTER_PRICE,
  CHARTER_SPOTS_LEFT,
  CHARTER_SPOTS_TOTAL,
} from "./data/trackRecord";
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
    name: "Oddsphere AI — Charter",
    price: `${CHARTER_PRICE}/mo`,
    highlight: true,
    bullets: [
      "Daily AI picks across 7 sports",
      "The Lab access (when launched)",
      "Locked-in rate — forever",
    ],
  },
  {
    name: "Typical Picks Discord",
    price: "$50–200/mo",
    highlight: false,
    bullets: ["Picks only", "No transparency", "No research tools"],
  },
  {
    name: "BettingPros",
    price: "$30–50/mo",
    highlight: false,
    bullets: ["Analytics only", "No daily picks", "No AI model"],
  },
];

const CARD =
  "bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-lg transition-all duration-300 hover:border-violet-500/50 hover:shadow-[0_0_30px_rgba(167,139,250,0.15)]";

const CARD_HIGHLIGHT =
  "bg-gradient-to-br from-violet-900/60 to-fuchsia-900/30 border border-violet-600 rounded-lg transition-all duration-300 hover:border-violet-500 hover:shadow-[0_0_40px_rgba(167,139,250,0.3)]";

const PRIMARY_CTA =
  "inline-block bg-violet-600 hover:bg-violet-500 text-white font-semibold px-8 py-3 rounded-md transition-all duration-200 shadow-lg shadow-violet-900/40 hover:shadow-[0_0_25px_rgba(167,139,250,0.5)] hover:scale-[1.02]";

const SECONDARY_CTA =
  "inline-block border border-gray-700 hover:border-violet-500 hover:text-violet-200 hover:bg-violet-900/20 text-gray-200 font-semibold px-8 py-3 rounded-md transition-all duration-200";

export default function Home() {
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 space-y-20 sm:space-y-28">
      {/* Hero */}
      <section className="text-center">
        <div className="relative isolate inline-block">
          <div className="hero-glow"></div>
          <h1 className="relative text-5xl sm:text-7xl md:text-8xl font-black mb-6 leading-[1.05] tracking-tight bg-gradient-to-r from-violet-400 via-purple-500 to-fuchsia-500 bg-clip-text text-transparent">
            Where data meets winning.
          </h1>
        </div>
        <p className="text-xl sm:text-2xl md:text-3xl text-gray-200 mb-10 max-w-3xl mx-auto leading-relaxed">
          AI-powered sports predictions across the NFL, NBA, MLB, CBB, CFB, UCL, and NHL.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-16">
          <Link href="/join" className={PRIMARY_CTA}>
            Join Premium →
          </Link>
          <Link href="/track-record" className={SECONDARY_CTA}>
            See the Track Record
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
          {HERO_STATS.map((stat, i) => (
            <div
              key={stat.label}
              className={`${CARD} p-5 sm:p-6 text-center animate-fade-up hover:-translate-y-0.5`}
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <p className="text-4xl sm:text-5xl font-black text-violet-400 mb-2 tabular-nums">
                {stat.value}
              </p>
              <p className="text-sm font-semibold text-white mb-1">{stat.label}</p>
              <p className="text-xs text-gray-300 uppercase tracking-wider">
                {stat.caption}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-6">
          <Link
            href="/track-record"
            className="text-sm text-violet-400 hover:text-violet-300 transition-colors"
          >
            See the full track record →
          </Link>
        </p>
      </section>

      {/* The Lab — Coming Soon */}
      <section className="bg-gradient-to-br from-violet-950/60 via-purple-950/40 to-fuchsia-950/30 border border-violet-800/40 rounded-2xl p-8 sm:p-14">
        <div className="text-center mb-12">
          <p className="text-xs font-bold uppercase tracking-wider text-violet-300 mb-3">
            Premium Research Suite
          </p>
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-black mb-4 tracking-tight">
            The Lab is coming.
          </h2>
          <p className="text-lg sm:text-xl text-gray-200 max-w-2xl mx-auto leading-relaxed">
            The most powerful sports stats research tool you've never had. Player props streaks, team trends, model edge vs. market lines. Included with every Whop membership.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {LAB_FEATURES.map((feat) => (
            <div key={feat.title} className={`${CARD} p-6`}>
              <h3 className="text-xl font-bold mb-3">{feat.title}</h3>
              <p className="text-gray-100 text-sm leading-relaxed">{feat.blurb}</p>
            </div>
          ))}
        </div>

        <div className="text-center">
          <p className="text-sm text-gray-200 mb-3 font-semibold">
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

      {/* Why $25/month is a steal */}
      <section>
        <div className="text-center mb-12">
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-black mb-3 tracking-tight">
            Why {CHARTER_PRICE}/month is a steal.
          </h2>
          <p className="text-lg text-gray-200">Side-by-side with what's out there.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          {COMPARISON.map((item) => (
            <div
              key={item.name}
              className={`${item.highlight ? CARD_HIGHLIGHT : CARD} p-6 flex flex-col`}
            >
              <p
                className={`text-xs font-bold uppercase tracking-wider mb-2 ${
                  item.highlight ? "text-violet-200" : "text-gray-300"
                }`}
              >
                {item.highlight ? "Our pricing" : "Compare"}
              </p>
              <h3 className="text-xl font-bold mb-1">{item.name}</h3>
              <p
                className={`text-2xl font-black mb-4 tabular-nums ${
                  item.highlight ? "text-violet-200" : "text-gray-100"
                }`}
              >
                {item.price}
              </p>
              <ul className="space-y-2 text-sm text-gray-100 flex-1">
                {item.bullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span className="text-violet-400 shrink-0">
                      {item.highlight ? "✓" : "▸"}
                    </span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="text-center mt-10 text-lg font-semibold text-violet-300">
          Same edge. Half the price. Forever.
        </p>
      </section>

      {/* Final CTA */}
      <section className="bg-gradient-to-br from-violet-900/40 to-fuchsia-900/20 border border-violet-800/40 rounded-2xl p-8 sm:p-14 text-center transition-all duration-300 hover:border-violet-500 hover:shadow-[0_0_40px_rgba(167,139,250,0.25)]">
        <h2 className="text-3xl sm:text-5xl font-black mb-4 tracking-tight">
          Join the edge.
        </h2>
        <p className="text-lg text-gray-200 mb-2 max-w-xl mx-auto">
          Daily AI picks in Discord plus first access to The Lab — all with one Whop subscription.
        </p>
        <p className="text-sm text-violet-300 font-semibold mb-8">
          {CHARTER_PRICE}/month — Charter pricing, first {CHARTER_SPOTS_TOTAL} members only.
        </p>
        <Link href="/join" className={PRIMARY_CTA}>
          Join Premium →
        </Link>
        <p className="text-sm text-violet-300 font-semibold mt-5">
          {CHARTER_SPOTS_LEFT} charter spots left.
        </p>
        <p className="text-xs text-gray-400 italic mt-8">
          For entertainment and informational purposes only.
        </p>
      </section>
    </main>
  );
}
