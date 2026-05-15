import Link from "next/link";

export default function Home() {
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div className="text-center mb-16">
        <h1 className="text-5xl sm:text-7xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          Oddsphere 🌐
        </h1>
        <p className="text-xl sm:text-2xl text-gray-300 mb-2">
          MLB Stats, Streaks & Trends
        </p>
        <p className="text-sm text-gray-500 italic">
          For entertainment and informational purposes only.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link
          href="/player-props"
          className="bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg p-6 transition-colors"
        >
          <h2 className="text-2xl font-bold mb-2">🔥 Player Props</h2>
          <p className="text-gray-400">
            Discover players on hot streaks — hit rates, recent performance, and
            prop trends.
          </p>
        </Link>

        <Link
          href="/team-stats"
          className="bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg p-6 transition-colors"
        >
          <h2 className="text-2xl font-bold mb-2">📊 Team Stats</h2>
          <p className="text-gray-400">
            Team trends, recent form, and head-to-head performance across the
            league.
          </p>
        </Link>

        <Link
          href="/games"
          className="bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg p-6 transition-colors"
        >
          <h2 className="text-2xl font-bold mb-2">⚾ Today's Games</h2>
          <p className="text-gray-400">
            Moneylines, spreads, and totals for upcoming MLB games.
          </p>
        </Link>
      </div>
    </main>
  );
}