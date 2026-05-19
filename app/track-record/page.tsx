import {
  TRACK_RECORD,
  LAST_UPDATED,
  WHOP_URL,
  type TrackRecordRow,
} from "../data/trackRecord";
import CountUp from "../components/CountUp";

export const metadata = {
  title: "Track Record — Oddsphere AI",
  description:
    "Publicly tracked lifetime and current-season performance for Oddsphere AI predictions across the NFL, NBA, MLB, CBB, CFB, UCL, and NHL.",
};

const HEADLINE_STATS = [
  { label: "CFB Moneyline", end: 76.7, decimals: 1, suffix: "%", caption: "Lifetime" },
  { label: "UCL Double Chance", end: 74.1, decimals: 1, suffix: "%", caption: "Lifetime" },
  { label: "CBB Moneyline", end: 71.8, decimals: 1, suffix: "%", caption: "Lifetime" },
  { label: "Total Predictions", end: 25000, decimals: 0, suffix: "+", caption: "Across 7 leagues" },
];

type SportGroup = {
  key: string;
  label: string;
  emojis: string[];
};

const SPORT_GROUPS: SportGroup[] = [
  { key: "football", label: "🏈 Football", emojis: ["🏈"] },
  { key: "basketball", label: "🏀 Basketball", emojis: ["🏀"] },
  { key: "baseball", label: "⚾ Baseball", emojis: ["⚾"] },
  { key: "soccer", label: "⚽ Soccer", emojis: ["⚽️", "⚽"] },
  { key: "hockey", label: "🏒 Hockey", emojis: ["🏒"] },
];

function rowsForGroup(group: SportGroup): TrackRecordRow[] {
  return TRACK_RECORD.filter((r) => group.emojis.includes(r.emoji)).sort(
    (a, b) => b.lifetimePercent - a.lifetimePercent
  );
}

export default function TrackRecordPage() {
  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
      <header className="mb-12 text-center">
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-black mb-4 tracking-tight">
          Lifetime Model Tracking
        </h1>
        <p className="text-lg text-gray-200">
          Updated {LAST_UPDATED} — fully transparent and publicly tracked.
        </p>
      </header>

      {/* Headline numbers */}
      <section className="mb-12">
        <p className="text-center text-xs font-bold uppercase tracking-wider text-violet-300 mb-6">
          Headline Numbers
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
          {HEADLINE_STATS.map((stat) => (
            <div
              key={stat.label}
              className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-lg p-5 sm:p-6 text-center transition-all duration-300 hover:border-violet-500/50 hover:shadow-[0_0_30px_rgba(167,139,250,0.15)]"
            >
              <p className="text-3xl sm:text-4xl md:text-5xl font-black text-violet-400 mb-2 tabular-nums">
                <CountUp end={stat.end} decimals={stat.decimals} suffix={stat.suffix} />
              </p>
              <p className="text-sm font-semibold text-white mb-1">{stat.label}</p>
              <p className="text-xs text-gray-300 uppercase tracking-wider">
                {stat.caption}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Explainer */}
      <p className="text-center text-base text-gray-300 max-w-3xl mx-auto mb-10 leading-relaxed italic">
        Every prediction we've made, organized by sport. Lifetime hit rates shown
        alongside current season performance. All numbers sourced from publicly
        tracked data — every pick lives on X.
      </p>

      {/* Grouped table */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-lg overflow-hidden transition-all duration-300 hover:border-violet-500/40 hover:shadow-[0_0_30px_rgba(167,139,250,0.12)]">
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
            {SPORT_GROUPS.map((group) => {
              const rows = rowsForGroup(group);
              if (rows.length === 0) return null;
              return (
                <tbody key={group.key} className="divide-y divide-gray-800">
                  <tr className="bg-gray-950">
                    <td
                      colSpan={3}
                      className="py-4 px-4 sm:px-6 text-lg sm:text-xl font-black tracking-tight uppercase text-white"
                    >
                      {group.label}
                    </td>
                  </tr>
                  {rows.map((row, idx) => {
                    const isTopInGroup = idx === 0;
                    const highlight = row.lifetimePercent >= 60;
                    const noCurrent =
                      row.currentSeasonWins == null || row.currentSeasonTotal == null;
                    return (
                      <tr
                        key={row.market}
                        className="hover:bg-gray-800/40 transition-colors"
                      >
                        <td className="py-3 px-4 sm:px-6 whitespace-nowrap font-medium text-white">
                          {isTopInGroup && (
                            <span
                              className="text-yellow-400 mr-1"
                              aria-label="Top performer in group"
                              title="Top performer in this sport"
                            >
                              ⭐
                            </span>
                          )}
                          {row.market}{" "}
                          <span className="ml-0.5">{row.emoji}</span>
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
              );
            })}
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-300 mt-4">
        * Subset of total MLB tracking. ⭐ marks the top performer within each sport.
      </p>

      <section className="mt-20 bg-gradient-to-br from-violet-900/40 to-fuchsia-900/20 border border-violet-800/40 rounded-2xl p-8 sm:p-12 text-center transition-all duration-300 hover:border-violet-500 hover:shadow-[0_0_40px_rgba(167,139,250,0.25)]">
        <h2 className="text-2xl sm:text-4xl font-black mb-4 tracking-tight">
          Get tomorrow's picks today.
        </h2>
        <p className="text-lg text-gray-200 mb-8 max-w-xl mx-auto">
          Join the Whop to unlock daily AI predictions in Discord — and The Lab the moment it launches.
        </p>
        <a
          href={WHOP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-violet-600 hover:bg-violet-500 text-white font-semibold px-8 py-3 rounded-md transition-all duration-200 shadow-lg shadow-violet-900/50 hover:shadow-[0_0_25px_rgba(167,139,250,0.5)] hover:scale-[1.02]"
        >
          Join Premium on Whop →
        </a>
      </section>
    </main>
  );
}
