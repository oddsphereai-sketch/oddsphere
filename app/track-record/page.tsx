import { TRACK_RECORD, LAST_UPDATED, WHOP_URL } from "../data/trackRecord";

export const metadata = {
  title: "Track Record — Oddsphere AI",
  description:
    "Publicly tracked lifetime and current-season performance for Oddsphere AI predictions across the NFL, NBA, MLB, CBB, CFB, UCL, and NHL.",
};

export default function TrackRecordPage() {
  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <header className="mb-10 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold mb-3">
          Lifetime Model Tracking
        </h1>
        <p className="text-lg text-gray-200">
          Updated {LAST_UPDATED} — fully transparent and publicly tracked.
        </p>
      </header>

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm sm:text-base">
            <thead className="bg-gray-950/80 text-gray-300 uppercase text-xs tracking-wider">
              <tr>
                <th className="text-left py-3 px-4 sm:px-6 font-semibold">
                  Sport / Bet Type
                </th>
                <th className="text-right py-3 px-4 sm:px-6 font-semibold">
                  Lifetime
                </th>
                <th className="text-right py-3 px-4 sm:px-6 font-semibold">
                  Current Season
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {TRACK_RECORD.map((row) => {
                const highlight = row.lifetimePercent >= 60;
                const noCurrent =
                  row.currentSeasonWins == null || row.currentSeasonTotal == null;
                return (
                  <tr
                    key={row.market}
                    className="hover:bg-gray-800/40 transition-colors"
                  >
                    <td className="py-3 px-4 sm:px-6 whitespace-nowrap font-medium text-white">
                      {row.market} <span className="ml-0.5">{row.emoji}</span>
                    </td>
                    <td className="py-3 px-4 sm:px-6 text-right tabular-nums whitespace-nowrap">
                      <span className="text-gray-100">
                        {row.lifetimeWins.toLocaleString()}/
                        {row.lifetimeTotal.toLocaleString()}
                      </span>
                      <span
                        className={`ml-3 font-semibold ${
                          highlight ? "text-violet-300" : "text-gray-100"
                        }`}
                      >
                        {row.lifetimePercent.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 px-4 sm:px-6 text-right tabular-nums whitespace-nowrap text-gray-100">
                      {noCurrent ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        `${row.currentSeasonWins!.toLocaleString()}/${row.currentSeasonTotal!.toLocaleString()}`
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-300 mt-4">
        * Subset of total MLB tracking.
      </p>

      <section className="mt-14 bg-gradient-to-br from-violet-900/40 to-fuchsia-900/20 border border-violet-800/40 rounded-xl p-8 sm:p-10 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold mb-3">
          Get tomorrow's picks today.
        </h2>
        <p className="text-gray-200 mb-6 max-w-xl mx-auto">
          Join the Whop to unlock daily AI predictions in Discord — and The Lab the moment it launches.
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
