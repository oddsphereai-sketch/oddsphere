import { supabase } from "@/lib/db/supabase";
import {
  computeTrackingAggregate,
  type AggregateMetrics,
} from "@/lib/services/trackingAggregateService";
import type {
  TrackedMarketV17,
  TrackedSport,
} from "@/lib/types/domain/Tracking";

export type PublicTrackRecordMetric = {
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  pending: number;
  settled: number;
  decided: number;
  winPct: number | null;
};

export type PublicTrackRecordSport = {
  sport: TrackedSport;
  label: string;
  metrics: PublicTrackRecordMetric;
};

export type PublicTrackRecordMarket = {
  sport: TrackedSport;
  sportLabel: string;
  market: TrackedMarketV17;
  marketLabel: string;
  metrics: PublicTrackRecordMetric;
  bestAngles: PublicTrackRecordMetric;
  leans: PublicTrackRecordMetric;
};

export type PublicTrackRecordSummary = {
  asOf: string;
  tablesInitialized: boolean;
  dateRange: {
    label: string;
    from: string | null;
    to: string | null;
  };
  overall: PublicTrackRecordMetric;
  bestAngles: PublicTrackRecordMetric;
  leans: PublicTrackRecordMetric;
  sports: PublicTrackRecordSport[];
  markets: PublicTrackRecordMarket[];
  lastUpdatedLabel: string;
  unavailableReason?: string;
};

const SPORT_LABEL: Record<TrackedSport, string> = {
  mlb: "MLB",
  wnba: "WNBA",
  soccer: "World Cup / Soccer",
  nba: "NBA",
  nhl: "NHL",
  nfl: "NFL",
  cfb: "CFB",
  cbb: "CBB",
  ucl: "UCL",
};

const SPORT_ORDER: TrackedSport[] = [
  "mlb",
  "wnba",
  "soccer",
  "nba",
  "nhl",
  "nfl",
  "cfb",
  "cbb",
  "ucl",
];

const MARKET_LABEL: Record<TrackedMarketV17, string> = {
  moneyline: "Moneyline",
  total: "Totals",
  first_inning: "First Inning",
  nrfi: "NRFI",
  yrfi: "YRFI",
  spread: "Spread",
  match_result: "Match Result",
  double_chance: "Double Chance",
  btts: "BTTS",
};

function toMetric(m: AggregateMetrics): PublicTrackRecordMetric {
  const settled = m.wins + m.losses + m.pushes + m.voids;
  const decided = m.wins + m.losses;
  return {
    picks: m.picks,
    wins: m.wins,
    losses: m.losses,
    pushes: m.pushes,
    voids: m.voids,
    pending: m.pending,
    settled,
    decided,
    winPct: m.win_pct,
  };
}

function compareSport(a: TrackedSport, b: TrackedSport): number {
  const ai = SPORT_ORDER.indexOf(a);
  const bi = SPORT_ORDER.indexOf(b);
  if (ai !== bi) return ai - bi;
  return a.localeCompare(b);
}

function formatUpdatedLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

export async function getPublicTrackRecordSummary(): Promise<PublicTrackRecordSummary> {
  const asOf = new Date().toISOString();
  const base: Omit<PublicTrackRecordSummary, "overall" | "bestAngles" | "leans"> = {
    asOf,
    tablesInitialized: true,
    dateRange: {
      label: "Tracked Results Since Launch",
      from: null,
      to: null,
    },
    sports: [],
    markets: [],
    lastUpdatedLabel: formatUpdatedLabel(asOf),
  };

  try {
    const aggregate = await computeTrackingAggregate({
      supabase,
      includeLaunchDay: false,
    });

    if (!aggregate.tablesInitialized) {
      return {
        ...base,
        tablesInitialized: false,
        unavailableReason: "Tracking tables are not initialized yet.",
        overall: toMetric(aggregate.overall),
        bestAngles: toMetric(aggregate.bestAngles),
        leans: toMetric(aggregate.leans),
      };
    }

    const settledDates = aggregate.recentlySettled
      .map((p) => p.slate_date)
      .filter((d): d is string => typeof d === "string" && d.length > 0);
    const recentDates = [
      ...settledDates,
      aggregate.thisMonth.from,
    ].filter((d): d is string => typeof d === "string" && d.length > 0);
    const sortedDates = [...new Set(recentDates)].sort();

    const sports = aggregate.bySport
      .filter((row) => row.metrics.picks > 0)
      .map((row) => ({
        sport: row.label,
        label: SPORT_LABEL[row.label] ?? row.label.toUpperCase(),
        metrics: toMetric(row.metrics),
      }))
      .sort((a, b) => compareSport(a.sport, b.sport));

    const markets = aggregate.bySportMarket
      .filter((row) => row.metrics.picks > 0)
      .map((row) => ({
        sport: row.sport,
        sportLabel: SPORT_LABEL[row.sport] ?? row.sport.toUpperCase(),
        market: row.market,
        marketLabel: MARKET_LABEL[row.market] ?? row.market,
        metrics: toMetric(row.metrics),
        bestAngles: toMetric(row.bestAngles),
        leans: toMetric(row.leans),
      }))
      .sort((a, b) => {
        const sportDiff = compareSport(a.sport, b.sport);
        if (sportDiff !== 0) return sportDiff;
        return a.marketLabel.localeCompare(b.marketLabel);
      });

    return {
      ...base,
      tablesInitialized: aggregate.tablesInitialized,
      dateRange: {
        label: "Tracked Results Since Launch",
        from: "2026-06-07",
        to: sortedDates[sortedDates.length - 1] ?? null,
      },
      overall: toMetric(aggregate.overall),
      bestAngles: toMetric(aggregate.bestAngles),
      leans: toMetric(aggregate.leans),
      sports,
      markets,
    };
  } catch (error) {
    return {
      ...base,
      tablesInitialized: false,
      unavailableReason: "Tracking summary is temporarily unavailable.",
      overall: toMetric({
        picks: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        voids: 0,
        pending: 0,
        win_pct: null,
        avg_confidence: null,
        avg_edge: null,
        avg_ev: null,
        brier_score: null,
        log_loss: null,
      }),
      bestAngles: toMetric({
        picks: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        voids: 0,
        pending: 0,
        win_pct: null,
        avg_confidence: null,
        avg_edge: null,
        avg_ev: null,
        brier_score: null,
        log_loss: null,
      }),
      leans: toMetric({
        picks: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        voids: 0,
        pending: 0,
        win_pct: null,
        avg_confidence: null,
        avg_edge: null,
        avg_ev: null,
        brier_score: null,
        log_loss: null,
      }),
    };
  }
}
