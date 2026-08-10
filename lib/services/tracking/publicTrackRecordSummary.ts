import { LAST_UPDATED, TRACK_RECORD } from "@/app/data/trackRecord";
import type {
  TrackedMarketV17,
  TrackedSport,
} from "@/lib/types/domain/Tracking";
import type { TrackingResponse } from "@/app/lab/lib/labTypes";
import {
  readLabResponseSnapshot,
  trackingSnapshotKey,
} from "@/lib/services/labResponseSnapshots";

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
  currentOfficial?: {
    asOf: string;
    latestActivityDate: string;
    wins: number;
    losses: number;
    pushes: number;
    totalPredictions: number;
    /** Percentage on a 0..100 scale for direct public presentation. */
    hitRate: number;
  };
  unavailableReason?: string;
};

const ZERO_METRIC: PublicTrackRecordMetric = {
  picks: 0,
  wins: 0,
  losses: 0,
  pushes: 0,
  voids: 0,
  pending: 0,
  settled: 0,
  decided: 0,
  winPct: null,
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
  "nba",
  "cbb",
  "wnba",
  "nfl",
  "cfb",
  "nhl",
  "soccer",
  "ucl",
];

function metric(wins: number, total: number): PublicTrackRecordMetric {
  const losses = Math.max(0, total - wins);
  return {
    picks: total,
    wins,
    losses,
    pushes: 0,
    voids: 0,
    pending: 0,
    settled: total,
    decided: total,
    winPct: total > 0 ? Math.round((wins / total) * 1000) / 10 : null,
  };
}

function addMetric(a: PublicTrackRecordMetric, b: PublicTrackRecordMetric): PublicTrackRecordMetric {
  return metric(a.wins + b.wins, a.picks + b.picks);
}

function parseSport(market: string): TrackedSport {
  const prefix = market.split(" ")[0]?.toUpperCase();
  if (prefix === "NFL") return "nfl";
  if (prefix === "CFB") return "cfb";
  if (prefix === "NBA") return "nba";
  if (prefix === "CBB") return "cbb";
  if (prefix === "MLB") return "mlb";
  if (prefix === "UCL") return "ucl";
  if (prefix === "NHL") return "nhl";
  return "mlb";
}

function parseMarket(market: string): TrackedMarketV17 {
  const text = market.toLowerCase();
  if (text.includes("double chance")) return "double_chance";
  if (text.includes("nrfi/yrfi")) return "first_inning";
  if (text.includes("nrfi")) return "nrfi";
  if (text.includes("yrfi")) return "yrfi";
  if (text.includes("o/u")) return "total";
  if (text.includes("ml")) return "moneyline";
  return "moneyline";
}

function cleanMarketLabel(raw: string): string {
  const match = raw.match(/\(([^)]+)\)/);
  const label = match?.[1]?.replace("*", "").trim();
  if (label === "ML") return "Moneyline";
  if (label === "O/U") return "Totals";
  if (label === "NRFI/YRFI") return "NRFI/YRFI";
  if (label === "NRFI") return "NRFI";
  if (label === "YRFI") return "YRFI";
  if (label === "Double Chance") return "Double Chance";
  return raw.trim();
}

function compareSport(a: TrackedSport, b: TrackedSport): number {
  const ai = SPORT_ORDER.indexOf(a);
  const bi = SPORT_ORDER.indexOf(b);
  if (ai !== bi) return ai - bi;
  return a.localeCompare(b);
}

export async function getPublicTrackRecordSummary(): Promise<PublicTrackRecordSummary> {
  const asOf = new Date().toISOString();
  const currentSnapshot = await readLabResponseSnapshot<TrackingResponse>(trackingSnapshotKey(), "fresh")
    ?? await readLabResponseSnapshot<TrackingResponse>(trackingSnapshotKey(), "stale");
  let overall = ZERO_METRIC;
  const sportMap = new Map<TrackedSport, PublicTrackRecordMetric>();

  const markets: PublicTrackRecordMarket[] = TRACK_RECORD.map((row) => {
    const sport = parseSport(row.market);
    const market = parseMarket(row.market);
    const metrics = metric(row.lifetimeWins, row.lifetimeTotal);
    overall = addMetric(overall, metrics);
    sportMap.set(sport, addMetric(sportMap.get(sport) ?? ZERO_METRIC, metrics));
    return {
      sport,
      sportLabel: SPORT_LABEL[sport] ?? sport.toUpperCase(),
      market,
      marketLabel: cleanMarketLabel(row.market),
      metrics,
      bestAngles: ZERO_METRIC,
      leans: ZERO_METRIC,
    };
  }).sort((a, b) => {
    const sportDiff = compareSport(a.sport, b.sport);
    if (sportDiff !== 0) return sportDiff;
    return a.marketLabel.localeCompare(b.marketLabel);
  });

  const sports = Array.from(sportMap.entries())
    .map(([sport, metrics]) => ({
      sport,
      label: SPORT_LABEL[sport] ?? sport.toUpperCase(),
      metrics,
    }))
    .sort((a, b) => compareSport(a.sport, b.sport));

  return {
    asOf,
    tablesInitialized: true,
    dateRange: {
      label: "Lifetime Model Archive",
      from: null,
      to: LAST_UPDATED,
    },
    overall,
    bestAngles: ZERO_METRIC,
    leans: ZERO_METRIC,
    sports,
    markets,
    lastUpdatedLabel: LAST_UPDATED,
    currentOfficial: currentSnapshot ? {
      asOf: currentSnapshot.payload.as_of,
      latestActivityDate: currentSnapshot.payload.yesterdayRecap.date,
      wins: currentSnapshot.payload.allTimeAggregate.wins,
      losses: currentSnapshot.payload.allTimeAggregate.losses,
      pushes: currentSnapshot.payload.allTimeAggregate.pushes,
      totalPredictions: currentSnapshot.payload.allTimeAggregate.totalPredictions,
      hitRate: Math.round(currentSnapshot.payload.allTimeAggregate.hitRate * 1_000) / 10,
    } : undefined,
  };
}
