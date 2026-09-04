"use client";

import { useMemo, useState } from "react";

import { CategoryBars } from "@/app/lab/tracking/components/TrackingCharts";
import type {
  PublicTrackingCategoryRow,
  PublicTrackingCategoryWindow,
} from "@/lib/services/tracking/publicTrackingCategoryWindows";

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

function groupBySport(rows: PublicTrackingCategoryRow[]): Array<{ sport: string; rows: PublicTrackingCategoryRow[] }> {
  return rows.reduce<Array<{ sport: string; rows: PublicTrackingCategoryRow[] }>>((groups, row) => {
    const group = groups.find((candidate) => candidate.sport === row.sport);
    if (group) group.rows.push(row);
    else groups.push({ sport: row.sport, rows: [row] });
    return groups;
  }, []);
}

function SportGroup({ sport, rows }: { sport: string; rows: PublicTrackingCategoryRow[] }) {
  const theme = SPORT_THEME[sport] ?? DEFAULT_THEME;
  const label = SPORT_LABEL[sport] ?? sport.toUpperCase();
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
          {rows.length} {rows.length === 1 ? "category" : "categories"}
        </span>
      </div>
      <CategoryBars
        rows={rows.map((row) => ({
          label: MARKET_LABEL[row.market] ?? row.market,
          sublabel: row.detail
            ? `${MARKET_SHORT[row.market] ?? row.market.toUpperCase()} · ${row.detail}`
            : (MARKET_SHORT[row.market] ?? row.market.toUpperCase()),
          metrics: {
            ...row.metrics,
            win_pct: row.metrics.winPct,
          },
        }))}
        emptyBody={`${label} results appear once this window has graded picks.`}
      />
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
        {available && groups.length > 0 ? (
          <div className="space-y-3">
            {groups.map((group) => <SportGroup key={group.sport} sport={group.sport} rows={group.rows} />)}
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
