import { TRACK_RECORD, LAST_UPDATED, WHOP_URL } from "../data/trackRecord";

export const metadata = {
  title: "Track Record — Oddsphere AI",
  description:
    "Publicly tracked lifetime performance for Oddsphere AI predictions across the NFL, NBA, MLB, CBB, CFB, UCL, and NHL.",
};

export default function TrackRecordPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <header className="mb-10 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold mb-3">
          Lifetime Model Tracking
        </h1>
        <p className="text-lg text-gray-300">
          Across 7 leagues. Publicly tracked, fully transparent.
        </p>
        <p className="text-sm text-gray-500 mt-2">Last updated: {LAST_UPDATED}</p>
      </header>

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm sm:text-base">
            <thead className="bg-gray-950/80 text-gray-400 uppercase text-xs tracking-wider">
              <tr>
                <th className="text-left py-3 px-4 sm:px-6 font-semibold">
                  Model Tracking
                </th>
                <th className="text-right py-3 px-4 sm:px-6 font-semibold">
                  Lifetime Tally
                </th>
                <th className="text-right py-3 px-4 sm:px-6 font-semibold">
                  Lifetime %
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {TRACK_RECORD.map((row) => {
                const highlight = row.percent >= 60;
                return (
                  <tr
                    key={row.market}
                    className="hover:bg-gray-800/40 transition-colors"
                  >
                    <td className="py-3 px-4 sm:px-6 whitespace-nowrap font-medium">
                      {row.market}{" "}
                      <span className="ml-0.5">{row.emoji}</span>
                    </td>
                    <td className="py-3 px-4 sm:px-6 text-right text-gray-300 tabular-nums whitespace-nowrap">
                      {row.wins.toLocaleString()}/{row.total.toLocaleString()}
                    </td>
                    <td
                      className={`py-3 px-4 sm:px-6 text-right tabular-nums font-semibold whitespace-nowrap ${
                        highlight ? "text-violet-400" : "text-gray-300"
                      }`}
                    >
                      {row.percent.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-500 mt-4">
        * Subset of total MLB tracking.
      </p>

      <section className="mt-14 bg-gradient-to-br from-violet-900/40 to-fuchsia-900/20 border border-violet-800/40 rounded-xl p-8 sm:p-10 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold mb-3">
          Get tomorrow's picks today.
        </h2>
        <p className="text-gray-300 mb-6 max-w-xl mx-auto">
          Join the Whop to unlock daily AI predictions in Discord — and the premium site when it launches.
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
