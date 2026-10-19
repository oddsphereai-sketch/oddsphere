"use client";

import { useMemo, useState } from "react";

import { CategoryBars } from "@/app/lab/tracking/components/TrackingCharts";
import type {
  PublicTrackingCategoryRow,
  PublicTrackingCategoryWindow,
} from "@/lib/services/tracking/publicTrackingCategoryWindows";
import type {
  AlternateLineCategory,
  AlternateLineMetrics,
} from "@/lib/services/tracking/alternateLinePerformance";

const SPORT_LABEL: Record<string, string> = {
  mlb: "MLB",
  wnba: "WNBA",
  nfl: "NFL",
  nba: "NBA",
  nhl: "NHL",
  cfb: "CFB",
  cbb: "CBB",
  ucl: "UCL",
  epl: "Premier League",
  soccer: "World Cup",
};

const MARKET_LABEL: Record<string, string> = {
  moneyline: "Moneyline",
  match_result: "Match Result",
  total: "Over / Under",
  btts: "BTTS",
  first_inning: "First Inning",
  nrfi: "NRFI",
  yrfi: "YRFI",
  spread: "Spread",
  double_chance: "Double Chance",
};

const MARKET_SHORT: Record<string, string> = {
  moneyline: "ML",
  match_result: "Match",
  total: "O/U",
  btts: "BTTS",
  first_inning: "FI",
  nrfi: "NRFI",
  yrfi: "YRFI",
  spread: "ATS",
  double_chance: "DC",
};

const WINDOW_ORDER: PublicTrackingCategoryWindow["key"][] = ["lifetime", "monthly", "weekly"];

type SportTheme = {
  accent: string;
  border: string;
  surface: string;
};

const SPORT_THEME: Record<string, SportTheme> = {
  mlb: { accent: "rgb(147 197 253)", border: "rgba(96,165,250,0.22)", surface: "rgba(59,130,246,0.045)" },
  wnba: { accent: "rgb(253 186 116)", border: "rgba(251,146,60,0.22)", surface: "rgba(249,115,22,0.045)" },
  nfl: { accent: "rgb(110 231 183)", border: "rgba(52,211,153,0.20)", surface: "rgba(16,185,129,0.04)" },
  cfb: { accent: "rgb(252 211 77)", border: "rgba(251,191,36,0.20)", surface: "rgba(245,158,11,0.04)" },
  epl: { accent: "rgb(216 180 254)", border: "rgba(192,132,252,0.22)", surface: "rgba(168,85,247,0.045)" },
  soccer: { accent: "rgb(103 232 249)", border: "rgba(34,211,238,0.20)", surface: "rgba(6,182,212,0.04)" },
  ucl: { accent: "rgb(196 181 253)", border: "rgba(167,139,250,0.20)", surface: "rgba(139,92,246,0.04)" },
  nba: { accent: "rgb(252 165 165)", border: "rgba(248,113,113,0.20)", surface: "rgba(239,68,68,0.04)" },
};

const DEFAULT_THEME: SportTheme = {
  accent: "rgb(165 180 252)",
  border: "rgba(129,140,248,0.20)",
  surface: "rgba(99,102,241,0.04)",
};

function groupBySport<T extends { sport: string }>(rows: T[]): Array<{ sport: string; rows: T[] }> {
  return rows.reduce<Array<{ sport: string; rows: T[] }>>((groups, row) => {
    const group = groups.find((candidate) => candidate.sport === row.sport);
    if (group) group.rows.push(row);
    else groups.push({ sport: row.sport, rows: [row] });
    return groups;
  }, []);
}

function formatShortDate(yyyyMmDd: string): string {
  const [year, month, day] = yyyyMmDd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function alternateRecord(metrics: AlternateLineMetrics): string {
  return `${metrics.wins}-${metrics.losses}${metrics.pushes > 0 ? `-${metrics.pushes}` : ""}`;
}

function alternateMarketLabel(sport: string, market: AlternateLineCategory["market"]): string {
  if (sport === "nhl" && market === "spread") return "Puck Line";
  return MARKET_LABEL[market] ?? market;
}

function alternateSourceLabel(row: AlternateLineCategory): string {
  if (row.source === "prior_release") return row.sourceLabel;
  return row.sourceLabel === "Current release"
    ? row.sourceLabel
    : `Current release · ${row.sourceLabel}`;
}

function AlternateLinePerformanceRows({
  rows,
  embedded = false,
}: {
  rows: AlternateLineCategory[];
  embedded?: boolean;
}) {
  return (
    <div className={embedded ? "mt-3" : "mt-4 border-t border-white/[0.06] pt-4"}>
      <div className="mb-1.5 flex items-center gap-2">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
          {embedded ? "Alternate lines" : "Alternate Line Performance"}
        </p>
        <details className="group relative">
          <summary
            aria-label="How alternate line performance is calculated"
            className="flex h-4 w-4 cursor-pointer list-none items-center justify-center rounded-full border border-slate-400/25 bg-slate-300/[0.06] text-[9px] font-black text-slate-300 marker:content-none"
          >
            ?
          </summary>
          <p className="absolute left-0 top-6 z-20 w-64 rounded-lg border border-white/[0.10] bg-[#111722] p-3 text-[11px] font-medium normal-case leading-relaxed tracking-normal text-gray-300 shadow-2xl">
            Same tracked picks, graded with the line moved in the prediction&apos;s favor. Prices are not included. These are not additional independent picks or betting returns.
          </p>
        </details>
      </div>
      <p className="mb-3 text-[10px] leading-relaxed text-gray-500">
        Same tracked picks at adjusted lines. Prices excluded; not additional independent picks or betting returns.
      </p>
      <div className="space-y-4">
        {rows.map((row) => {
          const coverage = row.coverageFrom === row.coverageTo
            ? formatShortDate(row.coverageFrom)
            : `${formatShortDate(row.coverageFrom)} → ${formatShortDate(row.coverageTo)}`;
          return (
            <div key={`${row.sport}-${row.market}-${row.source}`}>
              <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-0.5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {!embedded ? <p className="text-[12px] font-bold text-gray-200">{alternateMarketLabel(row.sport, row.market)}</p> : null}
                  <p className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-gray-500">
                    {alternateSourceLabel(row)} · {row.original.settled.toLocaleString()} graded · {coverage}
                  </p>
                </div>
                <div className="text-right text-[9.5px] tabular-nums text-gray-500">
                  <span className="font-black uppercase tracking-[0.1em]">Original line</span>
                  <span className="ml-2 font-extrabold text-gray-300">{alternateRecord(row.original)}</span>
                  {row.original.winPct !== null ? <span className="ml-1.5 font-bold text-gray-400">{row.original.winPct.toFixed(1)}%</span> : null}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {row.adjustments.map((adjustment) => (
                  <div
                    key={adjustment.label}
                    className="w-full rounded-lg border border-slate-400/30 bg-slate-950/35 px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex min-w-[96px] items-center justify-center rounded-md border border-slate-300/35 bg-slate-300/[0.12] px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.11em] text-slate-100 shadow-sm">
                        {adjustment.label}
                      </span>
                      <div className="text-right tabular-nums">
                        <span className="text-[13px] font-extrabold text-gray-100">{alternateRecord(adjustment.metrics)}</span>
                        {adjustment.metrics.winPct !== null ? (
                          <span className="ml-2 text-[11px] font-extrabold text-emerald-300/95">{adjustment.metrics.winPct.toFixed(1)}%</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
                      {adjustment.metrics.winPct !== null ? (
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300"
                          style={{ width: `${Math.min(100, adjustment.metrics.winPct)}%` }}
                        />
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SportGroup({
  sport,
  rows,
  alternateRows,
}: {
  sport: string;
  rows: PublicTrackingCategoryRow[];
  alternateRows: AlternateLineCategory[];
}) {
  const theme = SPORT_THEME[sport] ?? DEFAULT_THEME;
  const label = SPORT_LABEL[sport] ?? sport.toUpperCase();
  const mainMarkets = new Set(rows.map((row) => row.market));
  const unmatchedAlternateRows = alternateRows.filter((row) => !mainMarkets.has(row.market));
  const categoryCount = new Set([
    ...rows.map((row) => row.market),
    ...alternateRows.map((row) => row.market),
  ]).size;
  return (
    <section
      className="rounded-xl border p-3.5 sm:p-4"
      style={{ borderColor: theme.border, background: theme.surface }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: theme.accent }} aria-hidden="true" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">{label}</p>
            <h3 className="mt-0.5 text-sm font-bold text-gray-100">{label} models</h3>
          </div>
        </div>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500">
          {categoryCount} {categoryCount === 1 ? "category" : "categories"}
        </span>
      </div>
      {rows.length > 0 ? (
        <div className="space-y-5">
          {rows.map((row, index) => {
            const matchingAlternateRows = alternateRows.filter((alternate) => alternate.market === row.market);
            return (
              <div
                key={`${sport}-${row.market}`}
                data-tracking-market={row.market}
                className={index > 0 ? "border-t border-white/[0.08] pt-5" : undefined}
              >
                <CategoryBars
                  rows={[{
                    label: MARKET_LABEL[row.market] ?? row.market,
                    sublabel: row.detail
                      ? `${MARKET_SHORT[row.market] ?? row.market.toUpperCase()} · ${row.detail}`
                      : (MARKET_SHORT[row.market] ?? row.market.toUpperCase()),
                    metrics: {
                      ...row.metrics,
                      win_pct: row.metrics.winPct,
                    },
                  }]}
                  emptyBody={`${label} results appear once this window has graded picks.`}
                />
                {matchingAlternateRows.length > 0 ? (
                  <AlternateLinePerformanceRows rows={matchingAlternateRows} embedded />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {unmatchedAlternateRows.length > 0 ? (
        <AlternateLinePerformanceRows rows={unmatchedAlternateRows} />
      ) : null}
    </section>
  );
}

export function HomepageTrackingCategoryBoard({
  windows,
  available,
}: {
  windows: PublicTrackingCategoryWindow[];
  available: boolean;
}) {
  const [activeKey, setActiveKey] = useState<PublicTrackingCategoryWindow["key"]>("lifetime");
  const orderedWindows = useMemo(
    () => [...windows].sort((a, b) => WINDOW_ORDER.indexOf(a.key) - WINDOW_ORDER.indexOf(b.key)),
    [windows],
  );
  const activeWindow = useMemo(
    () => orderedWindows.find((window) => window.key === activeKey) ?? orderedWindows[0],
    [activeKey, orderedWindows],
  );
  const groups = groupBySport(activeWindow?.rows ?? []);
  const alternateGroups = groupBySport(activeWindow?.alternateRows ?? []);
  const sportKeys = Array.from(new Set([
    ...groups.map((group) => group.sport),
    ...alternateGroups.map((group) => group.sport),
  ]));

  return (
    <div className="mt-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-fit items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.025] p-1">
          {orderedWindows.map((window) => {
            const active = window.key === activeKey;
            return (
              <button
                key={window.key}
                type="button"
                onClick={() => setActiveKey(window.key)}
                aria-pressed={active}
                className={`rounded-md px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] transition-colors sm:px-4 sm:text-[11px] ${
                  active
                    ? "bg-emerald-300/[0.14] text-emerald-100 shadow-[inset_0_0_0_1px_rgba(110,231,183,0.2)]"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {window.label}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">
          {activeWindow?.rangeLabel ?? "Tracking window"}
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.018] p-3 sm:p-4">
        {available && sportKeys.length > 0 ? (
          <div className="space-y-3">
            {sportKeys.map((sport) => (
              <SportGroup
                key={sport}
                sport={sport}
                rows={groups.find((group) => group.sport === sport)?.rows ?? []}
                alternateRows={alternateGroups.find((group) => group.sport === sport)?.rows ?? []}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-10 text-center">
            <p className="text-sm font-bold text-gray-300">Tracking by category is updating</p>
            <p className="mt-2 text-xs leading-relaxed text-gray-500">Records appear here after the next settled tracking snapshot.</p>
          </div>
        )}
      </div>
    </div>
  );
}
