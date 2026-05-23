"use client";

import type {
  AllTimeAggregate,
  DailyHitRatePoint,
  DailyMarketResult,
  DailyRecap,
  LastThirtyDays,
  SportMarketTally,
  Streak,
  TrackingResponse,
  WeeklyAggregate,
} from "../lib/labTypes";
import type { Sport } from "../data/mockData";
import { SPORT_META } from "../data/mockData";
import { useTracking } from "../hooks/useTracking";
import CalibrationDisplay from "./tracking/CalibrationDisplay";

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
  const { data, error, isLoading } = useTracking();

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

      {error ? (
        <ErrorState message={error.message} />
      ) : isLoading && !data ? (
        <LoadingSkeleton />
      ) : !data ? (
        <EmptyState />
      ) : (
        <TrackingContent data={data} />
      )}

      {/* Footer */}
      <p className="text-xs italic text-gray-500 text-center leading-relaxed pt-2">
        Track record auto-updates every morning at 3am ET. Every prediction is
        logged before games start and marked W/L based on final scores. No
        edits, no cherry-picking.
      </p>
    </main>
  );
}

// ───────────────────────── Tracking Content (data-driven) ─────────────────

function TrackingContent({ data }: { data: TrackingResponse }) {
  const {
    yesterdayRecap,
    weeklyAggregate,
    last30Days,
    allTimeAggregate,
    streak,
    tallies,
    sportOrder,
  } = data;

  // For "This Week" row in the summary cards.
  const weekWins = weeklyAggregate.wins;
  const weekLosses = weeklyAggregate.losses;

  return (
    <>
      {/* Summary row — 4 stat cards */}
      <section
        aria-label="Summary stats"
        className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"
      >
        <StatCard
          label="This Week"
          headline={`${weekWins}-${weekLosses}`}
          sub={
            weeklyAggregate.totalPicks === 0
              ? "No activity this week yet"
              : `${pct(weeklyAggregate.hitRate)} hit rate · all sports`
          }
        />
        <StatCard
          label={yesterdayRecap.isYesterday ? "Yesterday" : "Most recent"}
          headline={`${yesterdayRecap.totalWins}-${yesterdayRecap.totalLosses}`}
          sub={
            yesterdayRecap.totalPicks === 0
              ? "No resolved picks yet"
              : `${pct(yesterdayRecap.hitRate, 1)} hit rate · ${yesterdayRecap.results.length} markets`
          }
        />
        <StatCard
          label="All-Time"
          headline={`${allTimeAggregate.wins.toLocaleString()}-${allTimeAggregate.losses.toLocaleString()}`}
          sub={`${pct(allTimeAggregate.hitRate, 1)} hit rate · ${fmtCompact(allTimeAggregate.totalPredictions)} predictions`}
        />
        <StatCard
          label="Streak"
          headline={
            streak.type === "NONE" ? (
              <span className="text-gray-400">—</span>
            ) : streak.type === "W" ? (
              <span className="text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.45)]">
                🔥 {streak.count}W
              </span>
            ) : (
              <span className="text-rose-300/80">
                ❄ {streak.count}L
              </span>
            )
          }
          sub={streak.description}
        />
      </section>

      {/* HERO 1: Yesterday's recap */}
      <YesterdayRecapSection recap={yesterdayRecap} />

      {/* HERO 2: This week tally */}
      <ThisWeekSection
        tallies={tallies}
        week={weeklyAggregate}
        sportOrder={sportOrder}
        last30={last30Days}
      />

      {/* 30-day chart */}
      <ThirtyDaySection last30={last30Days} />

      {/* Calibration honesty — between 30-day and All-Time per spec 5E. */}
      <CalibrationDisplay />

      {/* All-Time Record */}
      <AllTimeRecordSection tallies={tallies} sportOrder={sportOrder} />
    </>
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

function YesterdayRecapSection({ recap }: { recap: DailyRecap }) {
  const sportsWithResults = Array.from(
    new Set(recap.results.map((r) => r.sport))
  ) as Sport[];

  return (
    <section>
      <header className="mb-4">
        <h2 className="text-xl font-medium tracking-tight">
          🎯 {recap.isYesterday ? "Yesterday" : "Last activity"} —{" "}
          <span className="text-gray-300">{recap.label}</span>
        </h2>
        {!recap.isYesterday && (
          <p className="text-xs text-gray-500 mt-1 italic">
            Calendar yesterday had no resolved picks yet — showing the most
            recent day with activity.
          </p>
        )}
      </header>

      <div className={`${CARD} p-5 sm:p-6`}>
        {recap.totalPicks === 0 ? (
          <p className="text-sm text-gray-300 italic">
            No resolved picks yet. Check back after tonight&rsquo;s slate finishes.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-6 pb-5 border-b border-gray-800/60">
              <span className="text-2xl sm:text-3xl font-black tabular-nums tracking-tight">
                <span className="text-emerald-400">{recap.totalWins}</span>{" "}
                <span className="text-gray-500 text-xl">·</span>{" "}
                <span className="text-rose-300/80">{recap.totalLosses}</span>
              </span>
              <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
                wins · losses
              </span>
              <span className="text-gray-500">·</span>
              <span className="text-sm text-violet-300 font-semibold">
                {pct(recap.hitRate, 1)} hit rate
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
              {sportsWithResults.map((sport) => {
                const sportResults = recap.results.filter((r) => r.sport === sport);
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
          </>
        )}
      </div>
    </section>
  );
}

function RecapMarketRow({ result }: { result: DailyMarketResult }) {
  const decided = result.wins + result.losses;
  const hr = decided > 0 ? result.wins / decided : 0;
  const isFlawless = result.wins === decided && decided > 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-sm text-gray-100 font-medium">{result.market}</span>
        <span className="text-sm tabular-nums">
          <span className="text-gray-100 font-semibold">
            {result.wins}/{decided}
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
  sportOrder,
  last30,
}: {
  tallies: SportMarketTally[];
  week: WeeklyAggregate;
  sportOrder: Sport[];
  last30: LastThirtyDays;
}) {
  const weekly = tallies.filter((t) => t.weekly !== null);
  const grouped: Array<{ sport: Sport; rows: SportMarketTally[] }> =
    sportOrder.flatMap((sport) => {
      const rows = weekly
        .filter((t) => t.sport === sport)
        .sort((a, b) => (b.weekly?.hitRate ?? 0) - (a.weekly?.hitRate ?? 0));
      return rows.length > 0 ? [{ sport, rows }] : [];
    });

  const flatRows = grouped.flatMap((g) => g.rows);
  const maxHr = Math.max(...flatRows.map((r) => r.weekly?.hitRate ?? 0), 0.01);

  return (
    <section>
      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-xl font-medium tracking-tight">📅 This Week</h2>
        <span className="text-sm text-gray-400 tabular-nums">
          {week.weekStartLabel} — {week.weekEndLabel}
        </span>
      </header>

      <div className={`${CARD} p-5 sm:p-6`}>
        {grouped.length === 0 ? (
          <p className="text-sm text-gray-300 italic">
            No activity in the rolling 7-day window yet.
          </p>
        ) : (
          <>
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
                        const decided = (row.weekly?.wins ?? 0) + (row.weekly?.losses ?? 0);
                        return (
                          <div key={`${row.sport}-${row.market}`}>
                            <div className="flex items-baseline justify-between gap-2 mb-1">
                              <span className="text-sm text-gray-100 font-medium">
                                {row.market}
                              </span>
                              <span className="text-sm tabular-nums">
                                <span className="text-gray-100 font-semibold">
                                  {row.weekly?.wins}/{decided}
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
          </>
        )}

        {(last30.bestDay || last30.worstDay) && (
          <div className="mt-6 pt-5 border-t border-gray-800/60 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {last30.bestDay && (
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider text-emerald-300 font-bold">
                  🔥 Best day
                </span>
                <span className="text-gray-200 tabular-nums">
                  {last30.bestDay.record}
                </span>
                <span className="text-gray-500">
                  on {last30.bestDay.dateLabel}
                </span>
              </div>
            )}
            {last30.worstDay && (
              <div className="flex items-baseline gap-2 sm:justify-end flex-wrap">
                <span className="text-[10px] uppercase tracking-wider text-rose-300/80 font-bold">
                  ❄ Worst day
                </span>
                <span className="text-gray-200 tabular-nums">
                  {last30.worstDay.record}
                </span>
                <span className="text-gray-500">
                  on {last30.worstDay.dateLabel}
                </span>
              </div>
            )}
          </div>
        )}
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
        const decided = (row.weekly?.wins ?? 0) + (row.weekly?.losses ?? 0);
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
              {row.weekly?.wins}-{(row.weekly?.losses ?? 0)}
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

function ThirtyDaySection({ last30 }: { last30: LastThirtyDays }) {
  return (
    <section>
      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-xl font-medium tracking-tight">📊 Last 30 Days</h2>
        <span className="text-sm text-gray-300 tabular-nums">
          · {last30.aggregate.wins}-{last30.aggregate.losses}{" "}
          <span className="text-violet-300">
            ({pct(last30.aggregate.hitRate, 0)} hit rate)
          </span>
        </span>
      </header>

      <div className={`${CARD} p-5 sm:p-6`}>
        {last30.aggregate.picks === 0 ? (
          <p className="text-sm text-gray-300 italic">
            No resolved picks in the last 30 days.
          </p>
        ) : (
          <>
            <div className="relative">
              <div
                aria-hidden="true"
                className="absolute inset-x-0 border-t border-dashed border-gray-700/60"
                style={{ top: "50%" }}
              />
              <div className="relative flex items-end gap-px h-[80px]">
                {last30.days.map((day, i) => {
                  if (day.picks === 0) {
                    return (
                      <div
                        key={day.date}
                        title={`${day.date}: no picks`}
                        className="flex-1 bg-gray-800/30 rounded-t-sm"
                        style={{ height: "4%" }}
                      />
                    );
                  }
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
              {last30.bestDay && (
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider text-emerald-300 font-bold">
                    Best day
                  </span>
                  <span className="text-gray-200 tabular-nums">
                    {last30.bestDay.record}
                  </span>
                </div>
              )}
              {last30.mostPicks && (
                <div className="flex items-baseline gap-2 sm:justify-end flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider text-violet-300 font-bold">
                    Most picks
                  </span>
                  <span className="text-gray-200 tabular-nums">
                    {last30.mostPicks.count}
                  </span>
                  <span className="text-gray-500">
                    on {last30.mostPicks.dateLabel}
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ───────────────────────── All-Time Record ─────────────────────────

function AllTimeRecordSection({
  tallies,
  sportOrder,
}: {
  tallies: SportMarketTally[];
  sportOrder: Sport[];
}) {
  // Always include every sport. Sports with zero lifetime activity render an
  // "Offseason / coming online" row instead of being hidden — Daniel's spec.
  const grouped: Array<{ sport: Sport; rows: SportMarketTally[]; hasActivity: boolean }> =
    sportOrder.flatMap((sport) => {
      const rows = tallies.filter((t) => t.sport === sport);
      const hasActivity = rows.some((r) => r.lifetime.total > 0);
      return rows.length > 0 ? [{ sport, rows, hasActivity }] : [];
    });

  const maxLifetimeHr = Math.max(...tallies.map((t) => t.lifetime.hitRate), 0.01);

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
                {!group.hasActivity ? (
                  <div className="bg-gray-900/40 border border-gray-800/60 rounded-lg p-3 text-xs text-gray-400 italic">
                    Offseason — no recent activity.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {group.rows.map((row) => (
                      <MobileAllTimeRow
                        key={`${row.sport}-${row.market}`}
                        row={row}
                        maxLifetimeHr={maxLifetimeHr}
                      />
                    ))}
                  </div>
                )}
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
  group: { sport: Sport; rows: SportMarketTally[]; hasActivity: boolean };
  isFirst: boolean;
  maxLifetimeHr: number;
}) {
  const meta = SPORT_META[group.sport];
  if (!group.hasActivity) {
    return (
      <tr
        className={`hover:bg-gray-900/40 transition-colors ${
          !isFirst ? "border-t border-gray-800/60" : ""
        }`}
      >
        <td className="py-3 pr-3 align-middle whitespace-nowrap">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-gray-300">
            <span aria-hidden="true" className="text-base opacity-60">
              {meta.icon}
            </span>
            {meta.label}
          </span>
        </td>
        <td colSpan={4} className="py-3 pr-3 align-middle text-sm text-gray-400 italic">
          Offseason — no recent activity.
        </td>
      </tr>
    );
  }
  return (
    <>
      {group.rows.map((row, ri) => {
        const lifetimeBarWidth = `${(row.lifetime.hitRate / Math.max(maxLifetimeHr, 0.01)) * 100}%`;
        const lifetimeDecided = row.lifetime.wins + row.lifetime.losses;
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
              {lifetimeDecided === 0 ? (
                <span className="text-gray-600 text-sm">—</span>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm tabular-nums text-gray-100">
                    {row.lifetime.wins.toLocaleString()}/{lifetimeDecided.toLocaleString()}{" "}
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
              )}
            </td>
            <td className="py-3 pr-3 align-middle text-sm text-right tabular-nums whitespace-nowrap">
              {row.currentSeason && row.currentSeason.wins + row.currentSeason.losses > 0 ? (
                <span className="text-gray-100">
                  {row.currentSeason.wins.toLocaleString()}/{(row.currentSeason.wins + row.currentSeason.losses).toLocaleString()}{" "}
                  <span className="text-gray-400">
                    ({pct(row.currentSeason.hitRate, 1)})
                  </span>
                </span>
              ) : (
                <span className="text-gray-600">—</span>
              )}
            </td>
            <td className="py-3 align-middle text-sm text-right tabular-nums whitespace-nowrap">
              {row.weekly && row.weekly.wins + row.weekly.losses > 0 ? (
                <span className="text-gray-100">
                  {row.weekly.wins}/{row.weekly.wins + row.weekly.losses}{" "}
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
  const lifetimeDecided = row.lifetime.wins + row.lifetime.losses;
  const seasonDecided = (row.currentSeason?.wins ?? 0) + (row.currentSeason?.losses ?? 0);
  const weeklyDecided = (row.weekly?.wins ?? 0) + (row.weekly?.losses ?? 0);
  return (
    <div className="bg-gray-900/40 border border-gray-800/60 rounded-lg p-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-sm font-medium text-gray-100">{row.market}</span>
        <span className="text-sm tabular-nums text-violet-300 font-semibold">
          {lifetimeDecided > 0 ? pct(row.lifetime.hitRate, 1) : "—"}
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
            {lifetimeDecided === 0
              ? "—"
              : `${row.lifetime.wins.toLocaleString()}/${lifetimeDecided.toLocaleString()}`}
          </p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
            Season
          </p>
          {row.currentSeason && seasonDecided > 0 ? (
            <p className="text-gray-100">
              {row.currentSeason.wins.toLocaleString()}/{seasonDecided.toLocaleString()}
            </p>
          ) : (
            <p className="text-gray-600">—</p>
          )}
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
            Weekly
          </p>
          {row.weekly && weeklyDecided > 0 ? (
            <p className="text-gray-100">
              {row.weekly.wins}/{weeklyDecided}
            </p>
          ) : (
            <p className="text-gray-600">—</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Loading / Empty / Error ─────────────────────────

function LoadingSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`${CARD} p-4 sm:p-5 animate-pulse`}>
            <div className="h-3 w-20 rounded bg-gray-800 mb-2" />
            <div className="h-8 rounded bg-gray-800/70 mb-2" />
            <div className="h-3 rounded bg-gray-800/50" />
          </div>
        ))}
      </div>
      <div className={`${CARD} p-5 sm:p-6 animate-pulse h-48`} aria-hidden="true" />
      <div className={`${CARD} p-5 sm:p-6 animate-pulse h-64`} aria-hidden="true" />
      <div className={`${CARD} p-5 sm:p-6 animate-pulse h-48`} aria-hidden="true" />
      <div className={`${CARD} p-5 sm:p-6 animate-pulse h-64`} aria-hidden="true" />
    </>
  );
}

function EmptyState() {
  return (
    <div className={`${CARD} p-12 text-center text-gray-300`}>
      <p className="text-sm">No tracking data available yet.</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-rose-950/40 border border-rose-800/50 rounded-xl p-6 text-sm text-rose-100">
      <p className="font-semibold text-rose-200 mb-1">
        Couldn&rsquo;t load tracking data.
      </p>
      <p className="text-rose-100/80 leading-relaxed">{message}</p>
    </div>
  );
}
