"use client";

import type { Sport } from "../data/mockData";
import { SPORT_META } from "../data/mockData";
import {
  ALL_TIME_AGGREGATE,
  LAST_30_AGGREGATE,
  SPORT_DISPLAY_ORDER,
  getAllTallies,
  getCurrentStreak,
  getLast30Days,
  getWeeklyAggregate,
  getYesterdayRecap,
  type DailyMarketResult,
  type SportMarketTally,
} from "../data/trackingMockData";

const CARD =
  "bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl transition-all duration-200 hover:border-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]";

function pct(n: number, fractionDigits = 0): string {
  return `${(n * 100).toFixed(fractionDigits)}%`;
}

function fmtCompact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

export default function TrackingView() {
  const yesterday = getYesterdayRecap();
  const week = getWeeklyAggregate();
  const allTime = ALL_TIME_AGGREGATE;
  const streak = getCurrentStreak();
  const tallies = getAllTallies();
  const last30 = getLast30Days();

  return (
    <main className="max-w-5xl mx-auto space-y-10 sm:space-y-12">
      {/* Header */}
      <header>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-2">
          📈 Track Record
        </h1>
        <p className="text-sm text-gray-300">
          Every prediction tracked. Every result verified.
        </p>
      </header>

      {/* Summary row — 4 stat cards */}
      <section
        aria-label="Summary stats"
        className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"
      >
        <StatCard
          label="This Week"
          headline={`${week.wins}-${week.losses}`}
          sub={`${pct(week.hitRate)} hit rate · all sports`}
        />
        <StatCard
          label="Yesterday"
          headline={`${yesterday.totalWins}-${yesterday.totalPicks - yesterday.totalWins}`}
          sub={`${pct(yesterday.hitRate, 1)} hit rate · ${yesterday.results.length} markets`}
        />
        <StatCard
          label="All-Time"
          headline={`${allTime.wins.toLocaleString()}-${allTime.losses.toLocaleString()}`}
          sub={`${pct(allTime.hitRate, 1)} hit rate · ${fmtCompact(allTime.totalPredictions)} predictions`}
        />
        <StatCard
          label="Streak"
          headline={
            <span className="text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.45)]">
              🔥 {streak.count}
              {streak.type}
            </span>
          }
          sub={streak.description}
        />
      </section>

      {/* HERO 1: Yesterday's recap */}
      <YesterdayRecapSection
        label={yesterday.label}
        wins={yesterday.totalWins}
        losses={yesterday.totalPicks - yesterday.totalWins}
        hitRate={yesterday.hitRate}
        results={yesterday.results}
      />

      {/* HERO 2: This week tally */}
      <ThisWeekSection tallies={tallies} week={week} />

      {/* 30-day chart */}
      <ThirtyDaySection days={last30} />

      {/* All-Time Record */}
      <AllTimeRecordSection tallies={tallies} />

      {/* Footer */}
      <p className="text-xs italic text-gray-500 text-center leading-relaxed pt-2">
        Track record auto-updates every morning at 3am ET. Every prediction is
        logged before games start and marked W/L based on final scores. No
        edits, no cherry-picking.
      </p>
    </main>
  );
}

// ───────────────────────── Stat Card ─────────────────────────

function StatCard({
  label,
  headline,
  sub,
}: {
  label: string;
  headline: React.ReactNode;
  sub: string;
}) {
  return (
    <div className={`${CARD} p-4 sm:p-5`}>
      <p className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-semibold mb-1.5">
        {label}
      </p>
      <p className="text-2xl sm:text-3xl font-black tracking-tight tabular-nums mb-1 leading-none">
        {headline}
      </p>
      <p className="text-xs text-gray-300">{sub}</p>
    </div>
  );
}

// ───────────────────────── Yesterday Recap (HERO 1) ─────────────────────────

function YesterdayRecapSection({
  label,
  wins,
  losses,
  hitRate,
  results,
}: {
  label: string;
  wins: number;
  losses: number;
  hitRate: number;
  results: DailyMarketResult[];
}) {
  const sportsWithResults = Array.from(new Set(results.map((r) => r.sport))) as Sport[];

  return (
    <section>
      <header className="mb-4">
        <h2 className="text-xl font-medium tracking-tight">
          🎯 Yesterday — <span className="text-gray-300">{label}</span>
        </h2>
      </header>

      <div className={`${CARD} p-5 sm:p-6`}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-6 pb-5 border-b border-gray-800/60">
          <span className="text-2xl sm:text-3xl font-black tabular-nums tracking-tight">
            <span className="text-emerald-400">{wins}</span>{" "}
            <span className="text-gray-500 text-xl">·</span>{" "}
            <span className="text-rose-300/80">{losses}</span>
          </span>
          <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
            wins · losses
          </span>
          <span className="text-gray-500">·</span>
          <span className="text-sm text-violet-300 font-semibold">
            {pct(hitRate, 1)} hit rate
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
          {sportsWithResults.map((sport) => {
            const sportResults = results.filter((r) => r.sport === sport);
            const meta = SPORT_META[sport];
            return (
              <div key={sport}>
                <p className="text-sm uppercase tracking-wider text-gray-400 font-semibold mb-3 flex items-center gap-2">
                  <span aria-hidden="true" className="text-base">
                    {meta.icon}
                  </span>
                  {meta.label}
                </p>
                <div className="space-y-3">
                  {sportResults.map((r) => (
                    <RecapMarketRow key={`${r.sport}-${r.market}`} result={r} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function RecapMarketRow({ result }: { result: DailyMarketResult }) {
  const hr = result.total > 0 ? result.wins / result.total : 0;
  const isFlawless = result.wins === result.total && result.total > 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-sm text-gray-100 font-medium">
          {result.market}
        </span>
        <span className="text-sm tabular-nums">
          <span className="text-gray-100 font-semibold">
            {result.wins}/{result.total}
          </span>{" "}
          <span
            className={
              isFlawless
                ? "text-emerald-300"
                : hr >= 0.6
                ? "text-emerald-300"
                : hr >= 0.4
                ? "text-gray-400"
                : "text-rose-300/80"
            }
          >
            ({pct(hr)})
          </span>
        </span>
      </div>
      <div className="bg-gray-800/60 rounded-full h-1.5 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-emerald-500/70 to-emerald-400 rounded-full"
          style={{ width: `${hr * 100}%` }}
        />
      </div>
    </div>
  );
}

// ───────────────────────── This Week Tally (HERO 2) ─────────────────────────

function ThisWeekSection({
  tallies,
  week,
}: {
  tallies: SportMarketTally[];
  week: ReturnType<typeof getWeeklyAggregate>;
}) {
  // Only rows with a weekly entry
  const weekly = tallies.filter((t) => t.weekly !== null);
  // Group by sport in display order, then by hit rate desc within sport
  const grouped: Array<{ sport: Sport; rows: SportMarketTally[] }> =
    SPORT_DISPLAY_ORDER.flatMap((sport) => {
      const rows = weekly
        .filter((t) => t.sport === sport)
        .sort((a, b) => (b.weekly?.hitRate ?? 0) - (a.weekly?.hitRate ?? 0));
      return rows.length > 0 ? [{ sport, rows }] : [];
    });

  const flatRows = grouped.flatMap((g) => g.rows);
  const maxHr = Math.max(...flatRows.map((r) => r.weekly?.hitRate ?? 0));

  return (
    <section>
      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-xl font-medium tracking-tight">📅 This Week</h2>
        <span className="text-sm text-gray-400 tabular-nums">
          {week.weekStart} — {week.weekEnd}
        </span>
      </header>

      <div className={`${CARD} p-5 sm:p-6`}>
        {/* Desktop: table */}
        <div className="hidden sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                <th className="text-left py-2 font-semibold">Sport</th>
                <th className="text-left py-2 font-semibold">Market</th>
                <th className="text-right py-2 font-semibold">This Week</th>
                <th className="text-right py-2 font-semibold">Hit Rate</th>
                <th className="text-left py-2 pl-4 font-semibold w-1/3">
                  Visual
                </th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((group, gi) => (
                <SportGroup
                  key={group.sport}
                  group={group}
                  isFirst={gi === 0}
                  maxHr={maxHr}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: cards */}
        <div className="sm:hidden space-y-5">
          {grouped.map((group) => {
            const meta = SPORT_META[group.sport];
            return (
              <div key={group.sport}>
                <p className="text-sm uppercase tracking-wider text-gray-400 font-semibold mb-2.5 flex items-center gap-2">
                  <span aria-hidden="true">{meta.icon}</span>
                  {meta.label}
                </p>
                <div className="space-y-3">
                  {group.rows.map((row) => {
                    const hr = row.weekly?.hitRate ?? 0;
                    return (
                      <div key={`${row.sport}-${row.market}`}>
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <span className="text-sm text-gray-100 font-medium">
                            {row.market}
                          </span>
                          <span className="text-sm tabular-nums">
                            <span className="text-gray-100 font-semibold">
                              {row.weekly?.wins}/{row.weekly?.total}
                            </span>{" "}
                            <span className="text-violet-300">
                              ({pct(hr, 0)})
                            </span>
                          </span>
                        </div>
                        <HitRateBar hitRate={hr} max={maxHr} />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 pt-5 border-t border-gray-800/60 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-emerald-300 font-bold">
              🔥 Best day
            </span>
            <span className="text-gray-200 tabular-nums">
              {LAST_30_AGGREGATE.bestDay.record}
            </span>
            <span className="text-gray-500">
              on {LAST_30_AGGREGATE.bestDay.dateLabel}
            </span>
          </div>
          <div className="flex items-baseline gap-2 sm:justify-end flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-rose-300/80 font-bold">
              ❄ Worst day
            </span>
            <span className="text-gray-200 tabular-nums">
              {LAST_30_AGGREGATE.worstDay.record}
            </span>
            <span className="text-gray-500">
              on {LAST_30_AGGREGATE.worstDay.dateLabel}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function SportGroup({
  group,
  isFirst,
  maxHr,
}: {
  group: { sport: Sport; rows: SportMarketTally[] };
  isFirst: boolean;
  maxHr: number;
}) {
  const meta = SPORT_META[group.sport];
  return (
    <>
      {group.rows.map((row, ri) => {
        const hr = row.weekly?.hitRate ?? 0;
        return (
          <tr
            key={`${row.sport}-${row.market}`}
            className={`hover:bg-gray-900/40 transition-colors ${
              ri === 0 && !isFirst ? "border-t border-gray-800/60" : ""
            }`}
          >
            <td className="py-2.5 pr-3 align-middle whitespace-nowrap">
              {ri === 0 && (
                <span className="inline-flex items-center gap-2 text-sm font-medium text-gray-100">
                  <span aria-hidden="true" className="text-base">
                    {meta.icon}
                  </span>
                  {meta.label}
                </span>
              )}
            </td>
            <td className="py-2.5 pr-3 align-middle text-sm text-gray-200">
              {row.market}
            </td>
            <td className="py-2.5 pr-3 align-middle text-sm text-right tabular-nums text-gray-100">
              {row.weekly?.wins}-{(row.weekly?.total ?? 0) - (row.weekly?.wins ?? 0)}
            </td>
            <td className="py-2.5 pr-3 align-middle text-sm text-right tabular-nums font-semibold text-violet-300">
              {pct(hr, 0)}
            </td>
            <td className="py-2.5 pl-4 align-middle">
              <HitRateBar hitRate={hr} max={maxHr} />
            </td>
          </tr>
        );
      })}
    </>
  );
}

function HitRateBar({ hitRate, max }: { hitRate: number; max: number }) {
  const width = `${(hitRate / Math.max(max, 0.01)) * 100}%`;
  return (
    <div className="bg-gray-800/60 rounded-full h-1.5 overflow-hidden w-full">
      <div
        className="h-full bg-gradient-to-r from-emerald-500/80 to-emerald-400 rounded-full"
        style={{ width }}
      />
    </div>
  );
}

// ───────────────────────── 30-Day Chart ─────────────────────────

function ThirtyDaySection({
  days,
}: {
  days: ReturnType<typeof getLast30Days>;
}) {
  return (
    <section>
      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-xl font-medium tracking-tight">📊 Last 30 Days</h2>
        <span className="text-sm text-gray-300 tabular-nums">
          · {LAST_30_AGGREGATE.wins}-{LAST_30_AGGREGATE.losses}{" "}
          <span className="text-violet-300">
            ({pct(LAST_30_AGGREGATE.hitRate, 0)} hit rate)
          </span>
        </span>
      </header>

      <div className={`${CARD} p-5 sm:p-6`}>
        <div className="relative">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 border-t border-dashed border-gray-700/60"
            style={{ top: "50%" }}
          />
          <div className="relative flex items-end gap-px h-[80px]">
            {days.map((day, i) => {
              const color =
                day.hitRate > 0.55
                  ? "bg-emerald-500"
                  : day.hitRate < 0.45
                  ? "bg-rose-500/40"
                  : "bg-amber-500/70";
              const heightPct = Math.max(day.hitRate * 100, 4);
              const losses = day.picks - day.wins;
              const title = `Day ${i + 1} (${day.date}): ${day.wins}-${losses} (${Math.round(day.hitRate * 100)}%)`;
              return (
                <div
                  key={day.date}
                  title={title}
                  className={`flex-1 ${color} rounded-t-sm transition-opacity hover:opacity-80`}
                  style={{ height: `${heightPct}%` }}
                />
              );
            })}
          </div>
        </div>
        <div className="flex justify-between text-[10px] text-gray-500 mt-2 tabular-nums">
          <span>1</span>
          <span>5</span>
          <span>10</span>
          <span>15</span>
          <span>20</span>
          <span>25</span>
          <span>30</span>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-emerald-300 font-bold">
              Best day
            </span>
            <span className="text-gray-200 tabular-nums">
              {LAST_30_AGGREGATE.bestDay.record}
            </span>
          </div>
          <div className="flex items-baseline gap-2 sm:justify-end flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-violet-300 font-bold">
              Most picks
            </span>
            <span className="text-gray-200 tabular-nums">
              {LAST_30_AGGREGATE.mostPicks.count}
            </span>
            <span className="text-gray-500">
              on {LAST_30_AGGREGATE.mostPicks.dateLabel}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ───────────────────────── All-Time Record ─────────────────────────

function AllTimeRecordSection({ tallies }: { tallies: SportMarketTally[] }) {
  const grouped: Array<{ sport: Sport; rows: SportMarketTally[] }> =
    SPORT_DISPLAY_ORDER.flatMap((sport) => {
      const rows = tallies.filter((t) => t.sport === sport);
      return rows.length > 0 ? [{ sport, rows }] : [];
    });

  const maxLifetimeHr = Math.max(
    ...tallies.map((t) => t.lifetime.hitRate),
    0.01
  );

  return (
    <section>
      <header className="mb-4">
        <h2 className="text-xl font-medium tracking-tight">
          🏆 All-Time Record
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          Career predictions by sport and market
        </p>
      </header>

      <div className={`${CARD} p-5 sm:p-6`}>
        {/* Desktop: table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold border-b border-gray-800/60">
                <th className="text-left py-2.5 pr-3 font-semibold">Sport</th>
                <th className="text-left py-2.5 pr-3 font-semibold">Market</th>
                <th className="text-left py-2.5 pr-3 font-semibold w-1/4">
                  Lifetime
                </th>
                <th className="text-right py-2.5 pr-3 font-semibold">
                  Current Season
                </th>
                <th className="text-right py-2.5 font-semibold">Weekly</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((group, gi) => (
                <AllTimeSportGroup
                  key={group.sport}
                  group={group}
                  isFirst={gi === 0}
                  maxLifetimeHr={maxLifetimeHr}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: cards per row */}
        <div className="md:hidden space-y-5">
          {grouped.map((group) => {
            const meta = SPORT_META[group.sport];
            return (
              <div key={group.sport}>
                <p className="text-sm uppercase tracking-wider text-gray-400 font-semibold mb-3 flex items-center gap-2">
                  <span aria-hidden="true">{meta.icon}</span>
                  {meta.label}
                </p>
                <div className="space-y-3">
                  {group.rows.map((row) => (
                    <MobileAllTimeRow
                      key={`${row.sport}-${row.market}`}
                      row={row}
                      maxLifetimeHr={maxLifetimeHr}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function AllTimeSportGroup({
  group,
  isFirst,
  maxLifetimeHr,
}: {
  group: { sport: Sport; rows: SportMarketTally[] };
  isFirst: boolean;
  maxLifetimeHr: number;
}) {
  const meta = SPORT_META[group.sport];
  return (
    <>
      {group.rows.map((row, ri) => {
        const lifetimeBarWidth = `${(row.lifetime.hitRate / Math.max(maxLifetimeHr, 0.01)) * 100}%`;
        return (
          <tr
            key={`${row.sport}-${row.market}`}
            className={`hover:bg-gray-900/40 transition-colors ${
              ri === 0 && !isFirst ? "border-t border-gray-800/60" : ""
            }`}
          >
            <td className="py-3 pr-3 align-middle whitespace-nowrap">
              {ri === 0 && (
                <span className="inline-flex items-center gap-2 text-sm font-medium text-gray-100">
                  <span aria-hidden="true" className="text-base">
                    {meta.icon}
                  </span>
                  {meta.label}
                </span>
              )}
            </td>
            <td className="py-3 pr-3 align-middle text-sm text-gray-200 whitespace-nowrap">
              {row.market}
            </td>
            <td className="py-3 pr-3 align-middle">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm tabular-nums text-gray-100">
                  {row.lifetime.wins.toLocaleString()}/
                  {row.lifetime.total.toLocaleString()}{" "}
                  <span className="text-gray-400">
                    ({pct(row.lifetime.hitRate, 1)})
                  </span>
                </span>
                <div className="bg-gray-800/60 rounded-full h-1 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500/80 to-emerald-400 rounded-full"
                    style={{ width: lifetimeBarWidth }}
                  />
                </div>
              </div>
            </td>
            <td className="py-3 pr-3 align-middle text-sm text-right tabular-nums whitespace-nowrap">
              {row.currentSeason ? (
                <span className="text-gray-100">
                  {row.currentSeason.wins.toLocaleString()}/
                  {row.currentSeason.total.toLocaleString()}{" "}
                  <span className="text-gray-400">
                    ({pct(row.currentSeason.hitRate, 1)})
                  </span>
                </span>
              ) : (
                <span className="text-gray-600">—</span>
              )}
            </td>
            <td className="py-3 align-middle text-sm text-right tabular-nums whitespace-nowrap">
              {row.weekly ? (
                <span className="text-gray-100">
                  {row.weekly.wins}/{row.weekly.total}{" "}
                  <span className="text-gray-400">
                    ({pct(row.weekly.hitRate, 0)})
                  </span>
                </span>
              ) : (
                <span className="text-gray-600">—</span>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function MobileAllTimeRow({
  row,
  maxLifetimeHr,
}: {
  row: SportMarketTally;
  maxLifetimeHr: number;
}) {
  const lifetimeBarWidth = `${(row.lifetime.hitRate / Math.max(maxLifetimeHr, 0.01)) * 100}%`;
  return (
    <div className="bg-gray-900/40 border border-gray-800/60 rounded-lg p-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-sm font-medium text-gray-100">{row.market}</span>
        <span className="text-sm tabular-nums text-violet-300 font-semibold">
          {pct(row.lifetime.hitRate, 1)}
        </span>
      </div>
      <div className="bg-gray-800/60 rounded-full h-1 overflow-hidden mb-3">
        <div
          className="h-full bg-gradient-to-r from-emerald-500/80 to-emerald-400 rounded-full"
          style={{ width: lifetimeBarWidth }}
        />
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
        <div>
          <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
            Lifetime
          </p>
          <p className="text-gray-100">
            {row.lifetime.wins.toLocaleString()}/
            {row.lifetime.total.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
            Season
          </p>
          {row.currentSeason ? (
            <p className="text-gray-100">
              {row.currentSeason.wins.toLocaleString()}/
              {row.currentSeason.total.toLocaleString()}
            </p>
          ) : (
            <p className="text-gray-600">—</p>
          )}
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
            Weekly
          </p>
          {row.weekly ? (
            <p className="text-gray-100">
              {row.weekly.wins}/{row.weekly.total}
            </p>
          ) : (
            <p className="text-gray-600">—</p>
          )}
        </div>
      </div>
    </div>
  );
}
