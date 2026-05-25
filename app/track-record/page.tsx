/**
 * /track-record — public "Performance Snapshot" (Phase 6.2b, V2.1 spec Part 11).
 *
 * Marketing-grade framing — NOT the full analytical view that members get
 * inside /lab/track-record. Per V2.1: lifetime overview, current-season
 * snapshot, strongest markets, "every pick tracked" note, profitability
 * disclaimer, Join Premium CTA.
 *
 * Data source: static app/data/trackRecord.ts (Daniel's authoritative
 * pre-launch baseline). Phase 7.5 swaps to tracking_baseline DB reads
 * without changing this page's shape.
 */

import Link from "next/link";
import { TRACK_RECORD, LAST_UPDATED, type TrackRecordRow } from "../data/trackRecord";

export const metadata = {
  title: "Track Record — OddSphere AI",
  description:
    "Performance snapshot for OddSphere model picks across the NFL, NBA, MLB, CBB, CFB, UCL, and NHL. Every pick tracked.",
};

// Lifetime totals across every tracked market.
function aggregate(rows: TrackRecordRow[]): {
  wins: number;
  total: number;
  hitRate: number;
} {
  const wins = rows.reduce((s, r) => s + r.lifetimeWins, 0);
  const total = rows.reduce((s, r) => s + r.lifetimeTotal, 0);
  return { wins, total, hitRate: total > 0 ? wins / total : 0 };
}

// Current-season totals where data exists (some sports off-season → null).
function seasonAggregate(rows: TrackRecordRow[]): {
  wins: number;
  total: number;
  hitRate: number;
} {
  const live = rows.filter(
    (r) => r.currentSeasonWins !== null && r.currentSeasonTotal !== null
  );
  const wins = live.reduce((s, r) => s + (r.currentSeasonWins ?? 0), 0);
  const total = live.reduce((s, r) => s + (r.currentSeasonTotal ?? 0), 0);
  return { wins, total, hitRate: total > 0 ? wins / total : 0 };
}

// Strongest 5 markets by lifetime hit rate (require >= 100 picks for honesty).
function strongestMarkets(rows: TrackRecordRow[]): TrackRecordRow[] {
  return [...rows]
    .filter((r) => r.lifetimeTotal >= 100)
    .sort((a, b) => b.lifetimePercent - a.lifetimePercent)
    .slice(0, 5);
}

function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtCompact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

export default function PublicTrackRecordPage() {
  const lifetime = aggregate(TRACK_RECORD);
  const season = seasonAggregate(TRACK_RECORD);
  const strongest = strongestMarkets(TRACK_RECORD);

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
      <header className="text-center mb-12">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-300 mb-3">
          Performance snapshot
        </p>
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight mb-3">
          Every model pick. Tracked.
        </h1>
        <p className="text-base sm:text-lg text-gray-200 max-w-2xl mx-auto leading-relaxed">
          Lifetime hit rates across seven leagues. Logged before games start,
          marked W/L based on final scores. No edits, no cherry-picking.
        </p>
        <p className="text-xs text-gray-400 mt-3 tabular-nums">
          Last updated {LAST_UPDATED}
        </p>
      </header>

      {/* Lifetime + current season overview */}
      <section
        aria-label="Overview"
        className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-12"
      >
        <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-2xl p-6 sm:p-8 text-center">
          <p className="text-[10px] uppercase tracking-[0.14em] text-gray-400 font-bold mb-2">
            Lifetime
          </p>
          <p className="text-4xl sm:text-5xl font-black tabular-nums text-violet-300 mb-1">
            {pct(lifetime.hitRate, 1)}
          </p>
          <p className="text-sm text-gray-200 tabular-nums">
            {lifetime.wins.toLocaleString()}–
            {(lifetime.total - lifetime.wins).toLocaleString()}
            <span className="text-gray-500"> · </span>
            {fmtCompact(lifetime.total)} picks
          </p>
        </div>
        <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-2xl p-6 sm:p-8 text-center">
          <p className="text-[10px] uppercase tracking-[0.14em] text-gray-400 font-bold mb-2">
            Current season
          </p>
          {season.total > 0 ? (
            <>
              <p className="text-4xl sm:text-5xl font-black tabular-nums text-emerald-300 mb-1">
                {pct(season.hitRate, 1)}
              </p>
              <p className="text-sm text-gray-200 tabular-nums">
                {season.wins.toLocaleString()}–
                {(season.total - season.wins).toLocaleString()}
                <span className="text-gray-500"> · </span>
                {fmtCompact(season.total)} picks
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-300 italic mt-4">
              In-season data activates as sports begin their schedules.
            </p>
          )}
        </div>
      </section>

      {/* Strongest markets */}
      <section className="mb-12">
        <header className="mb-4">
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">
            Strongest markets
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Top hit rates with a meaningful sample (100+ picks).
          </p>
        </header>
        <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl overflow-hidden">
          <ul className="divide-y divide-gray-800/60">
            {strongest.map((row, i) => (
              <li
                key={row.market}
                className="flex items-center gap-4 px-5 py-4 sm:px-6 sm:py-5"
              >
                <span
                  aria-hidden="true"
                  className="text-xs font-bold uppercase tracking-wider text-gray-500 tabular-nums w-5 shrink-0"
                >
                  #{i + 1}
                </span>
                <span className="text-base sm:text-lg font-medium text-gray-100 flex-1 min-w-0 truncate">
                  <span aria-hidden="true" className="mr-2">{row.emoji}</span>
                  {row.market}
                </span>
                <span className="text-xs text-gray-400 tabular-nums hidden sm:inline">
                  {row.lifetimeWins.toLocaleString()}/{row.lifetimeTotal.toLocaleString()}
                </span>
                <span className="text-xl sm:text-2xl font-black tabular-nums text-violet-300 shrink-0">
                  {row.lifetimePercent.toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Profitability disclaimer */}
      <section className="mb-12 bg-amber-950/20 border border-amber-800/30 rounded-xl p-5 sm:p-6 text-sm leading-relaxed text-amber-100/90">
        <p className="font-semibold text-amber-200 mb-1">
          Hit rate isn&rsquo;t the same as profit.
        </p>
        <p>
          A 60% hit rate at <span className="font-semibold">−150 odds</span> loses
          money. A 53% hit rate at <span className="font-semibold">+110 odds</span>
          {" "}wins. Odds, line shopping, and unit sizing matter. Inside the Lab
          you get every pick with its line and confidence so you can size and
          act for yourself.
        </p>
      </section>

      {/* Join Premium CTA */}
      <section className="bg-gradient-to-br from-violet-900/40 to-fuchsia-900/20 border border-violet-700/40 rounded-2xl p-8 sm:p-12 text-center shadow-[0_0_40px_rgba(167,139,250,0.18)]">
        <h2 className="text-2xl sm:text-3xl font-black tracking-tight mb-3">
          Want the full analytical view?
        </h2>
        <p className="text-base text-gray-200 max-w-xl mx-auto mb-6 leading-relaxed">
          Premium members see every pick by sport and market, daily and weekly
          hit-rate charts, calibration honesty, and the underlying signal
          breakdown for every game.
        </p>
        <Link
          href="/pricing"
          className="inline-block bg-violet-600 hover:bg-violet-500 text-white font-bold px-8 py-3.5 rounded-lg transition-all duration-200 shadow-lg shadow-violet-900/40 hover:shadow-[0_0_25px_rgba(167,139,250,0.5)] hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
        >
          Join Premium — $25/mo →
        </Link>
        <p className="text-xs text-gray-400 mt-4 italic">
          Locked for life. Cancel anytime through Whop.
        </p>
      </section>
    </main>
  );
}
