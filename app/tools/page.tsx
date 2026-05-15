import { WHOP_URL } from "../data/trackRecord";

const TOOLS = [
  {
    title: "🔥 MLB Player Props Streaks",
    blurb:
      "Find players riding hot streaks across hits, HRs, Ks, and totals — hit rate over last 5, 10, and 20 games. Sortable, filterable, prop-by-prop.",
    eta: "Coming Soon",
  },
  {
    title: "📊 Team Trends",
    blurb:
      "Recent form, home/away splits, and head-to-head matchup trends across every team and league.",
    eta: "Coming Soon",
  },
  {
    title: "🎯 ML & Totals Research",
    blurb:
      "Side-by-side model edge vs. market lines for every game — the same research powering our daily picks.",
    eta: "Coming Soon",
  },
];

export const metadata = {
  title: "Stat Tools — Oddsphere AI",
  description:
    "The upcoming flagship Oddsphere AI research suite — player props streaks, team trends, and ML/totals research.",
};

export default function ToolsPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <header className="mb-12 text-center">
        <p className="text-xs font-bold uppercase tracking-wider text-violet-400 mb-3">
          Premium Research Suite
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold mb-4">
          Our future flagship product.
        </h1>
        <p className="text-lg text-gray-300 max-w-2xl mx-auto">
          The same data and modeling behind our picks — coming to a sortable, filterable research interface built for Whop members.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        {TOOLS.map((tool) => (
          <div
            key={tool.title}
            className="bg-gray-900 border border-gray-800 rounded-lg p-6 flex flex-col"
          >
            <h3 className="text-xl font-bold mb-2">{tool.title}</h3>
            <p className="text-gray-400 text-sm flex-1">{tool.blurb}</p>
            <p className="text-xs text-violet-400 font-semibold mt-4 uppercase tracking-wider">
              {tool.eta}
            </p>
          </div>
        ))}
      </div>

      <section className="bg-gradient-to-br from-violet-900/40 to-fuchsia-900/20 border border-violet-800/40 rounded-xl p-8 sm:p-12 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold mb-3">Be there on day one.</h2>
        <p className="text-gray-300 mb-6 max-w-xl mx-auto">
          Join the Whop today — get daily AI picks in Discord now, plus access to the premium research suite the moment it launches.
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
