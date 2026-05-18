import { WHOP_URL } from "../data/trackRecord";
import NotifyForm from "../components/NotifyForm";

const LAB_FEATURES = [
  {
    icon: "🔥",
    title: "PLAYER PROPS RESEARCH",
    pitch: "Find players riding hot streaks across every prop type.",
    bullets: [
      "Filter by sport, prop (hits, HRs, Ks, RBIs, total bases), and game date.",
      "See hit rate over last 5, 10, and 20 games.",
      "Compare to tonight's line.",
      "AI flags the top edge plays.",
    ],
  },
  {
    icon: "📊",
    title: "TEAM TRENDS",
    pitch: "Validate the line with real team data.",
    bullets: [
      "Recent form, home/away splits, vs. LHP/RHP, head-to-head matchups.",
      "Cross-reference team trends with our score model in seconds.",
    ],
  },
  {
    icon: "🎯",
    title: "EDGE FINDER",
    pitch: "Side-by-side model edge vs. market line.",
    bullets: [
      "Every game in every league, model output beside the sportsbook line.",
      "AI flags the biggest mispricings.",
      "The same intelligence behind our daily picks — now searchable, filterable, yours.",
    ],
  },
];

export const metadata = {
  title: "The Lab — Oddsphere AI",
  description:
    "Introducing The Lab — the most powerful sports stats research tool you've never had. Player props streaks, team trends, edge finder. Launching soon, included with Whop membership.",
};

export default function ToolsPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 space-y-20">
      {/* Hero */}
      <header className="text-center">
        <p className="text-xs font-bold uppercase tracking-wider text-violet-300 mb-3">
          Premium Research Suite — Coming Soon
        </p>
        <h1 className="text-5xl sm:text-7xl font-bold mb-5 leading-tight bg-gradient-to-r from-violet-400 via-purple-500 to-fuchsia-500 bg-clip-text text-transparent">
          Introducing The Lab.
        </h1>
        <p className="text-xl sm:text-2xl text-gray-200 mb-4 max-w-3xl mx-auto leading-relaxed">
          The most powerful sports stats research tool you've never had — built for serious bettors and stat junkies.
        </p>
        <p className="text-sm text-violet-300 font-semibold">
          Launching soon. Included with Whop membership.
        </p>
      </header>

      {/* What is The Lab */}
      <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-8 sm:p-10">
        <h2 className="text-3xl font-bold mb-6">What is The Lab?</h2>
        <div className="space-y-4 text-gray-100 leading-relaxed">
          <p>
            Sports data is broken. Hit rates live on one site, recent form on another, sportsbook lines on a third, and nobody puts model edge vs. market line in front of you in one place. You end up with twelve tabs open and still no clear edge.
          </p>
          <p>
            The Lab fixes that. One searchable, filterable interface for every prop, every team, every game — powered by the same AI model behind our daily picks. Sort by hit rate over the last 10 games, filter to props within 5% of the market line, surface the games where our model disagrees most with the book.
          </p>
          <p className="text-violet-300 font-semibold">
            Real-time data, real edges, no spreadsheets.
          </p>
        </div>
      </section>

      {/* What you'll be able to do */}
      <section>
        <h2 className="text-3xl sm:text-4xl font-bold mb-8 text-center">
          What you'll be able to do
        </h2>
        <div className="space-y-6">
          {LAB_FEATURES.map((feat) => (
            <div
              key={feat.title}
              className="bg-gray-900 border border-gray-800 rounded-xl p-6 sm:p-8 grid grid-cols-1 md:grid-cols-[120px_1fr] gap-6 items-start"
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
      <section className="text-center bg-gray-900/50 border border-gray-800 rounded-xl p-8">
        <h2 className="text-2xl sm:text-3xl font-bold mb-3">Launching with MLB.</h2>
        <p className="text-gray-200 max-w-2xl mx-auto">
          NFL, NBA, NHL, CBB, CFB, and UCL rolling out through season.
        </p>
      </section>

      {/* Email signup */}
      <section className="bg-gradient-to-br from-violet-950/60 via-purple-950/40 to-fuchsia-950/30 border border-violet-800/40 rounded-xl p-8 sm:p-12 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold mb-3">
          Be the first to access The Lab.
        </h2>
        <p className="text-gray-200 mb-6 max-w-xl mx-auto">
          One email, the moment we launch.
        </p>
        <NotifyForm context="The Lab" />
        <p className="text-xs text-gray-300 mt-4">
          We'll send one email when The Lab launches. No spam.
        </p>
      </section>

      {/* Final CTA */}
      <section className="text-center">
        <h2 className="text-3xl sm:text-4xl font-bold mb-3">
          Already a Whop member? You're in.
        </h2>
        <p className="text-gray-200 mb-6 max-w-xl mx-auto leading-relaxed">
          Charter Members locked in at $25/month — your rate stays the same when The Lab launches, even after standard pricing goes to $35.
        </p>
        <a
          href={WHOP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-violet-600 hover:bg-violet-500 text-white font-semibold px-8 py-3 rounded-md transition-colors shadow-lg shadow-violet-900/50"
        >
          Join Premium →
        </a>
      </section>
    </main>
  );
}
