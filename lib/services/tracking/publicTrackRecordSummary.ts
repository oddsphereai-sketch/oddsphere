import { LAST_UPDATED, TRACK_RECORD, TRACK_RECORD_ARCHIVE_PROVENANCE } from "@/app/data/trackRecord";
import type {
  TrackedMarketV17,
  TrackedSport,
} from "@/lib/types/domain/Tracking";
import type { TrackingResponse } from "@/app/lab/lib/labTypes";
import {
  readLabResponseSnapshot,
  trackingFoundationSnapshotKey,
  trackingSnapshotKey,
} from "@/lib/services/labResponseSnapshots";
import {
  buildPublicTrackingCategoryWindows,
  type PublicTrackingCategoryWindow,
  type PublicTrackingFoundationSnapshot,
} from "@/lib/services/tracking/publicTrackingCategoryWindows";
import { resolveUclFeatureFlags } from "@/lib/services/ucl/uclFeatureFlags";

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

export type PublicOfficialTrackingWindow = {
  label: "Weekly" | "Monthly" | "Lifetime";
  rangeLabel: string;
  wins: number;
  losses: number;
  pushes: number;
  totalPredictions: number;
  /** Percentage on a 0..100 scale for direct public presentation. */
  hitRate: number | null;
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
  archiveProvenance: typeof TRACK_RECORD_ARCHIVE_PROVENANCE;
  categoryTracking: {
    available: boolean;
    asOf: string;
    windows: PublicTrackingCategoryWindow[];
  };
  currentOfficial?: {
    asOf: string;
    latestActivityDate: string;
    wins: number;
    losses: number;
    pushes: number;
    totalPredictions: number;
    /** Percentage on a 0..100 scale for direct public presentation. */
    hitRate: number;
    windows: PublicOfficialTrackingWindow[];
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

function displayHitRate(hitRate: number, wins: number, losses: number): number | null {
  return wins + losses > 0 ? Math.round(hitRate * 1_000) / 10 : null;
}

function withoutUcl<T extends { sport: string }>(rows: T[] | undefined): T[] {
  return (rows ?? []).filter((row) => row.sport !== "ucl");
}

/** Public pages use shared all-sport snapshots. On UCL rollback, remove only
 * current UCL rows from those payloads; the separately rendered static legacy
 * archive remains intact. If the category substrate is unavailable, hide the
 * current composite because its UCL contribution cannot be proven absent. */
export function applyPublicUclTrackingVisibility(input: {
  current: TrackingResponse | null;
  foundation: PublicTrackingFoundationSnapshot | null;
  includeUcl: boolean;
}): { current: TrackingResponse | null; foundation: PublicTrackingFoundationSnapshot | null } {
  if (input.includeUcl) return { current: input.current, foundation: input.foundation };
  const foundation = input.foundation === null ? null : {
    ...input.foundation,
    baselines: withoutUcl(input.foundation.baselines),
    bySportMarket: withoutUcl(input.foundation.bySportMarket),
    thisWeek: input.foundation.thisWeek ? {
      ...input.foundation.thisWeek,
      bySportMarket: withoutUcl(input.foundation.thisWeek.bySportMarket),
    } : undefined,
    thisMonth: input.foundation.thisMonth ? {
      ...input.foundation.thisMonth,
      bySportMarket: withoutUcl(input.foundation.thisMonth.bySportMarket),
    } : undefined,
  };
  if (input.current === null) return { current: null, foundation };

  const currentUclTallies = input.current.tallies.filter((row) => row.sport === "ucl");
  const currentContainsUcl = currentUclTallies.some((row) => (
    row.lifetime.total > 0
    || (row.currentSeason?.total ?? 0) > 0
    || (row.weekly?.total ?? 0) > 0
  ))
    || input.current.yesterdayRecap.results.some((row) => row.sport === "ucl");
  // The legacy composite and foundation snapshots are written independently.
  // Never subtract one snapshot from the other: if the current composite
  // contains UCL, its month/lifetime totals are inseparable and must be hidden.
  if (currentContainsUcl) return { current: null, foundation };
  const yesterdayResults = withoutUcl(input.current.yesterdayRecap.results);
  const yesterdayWins = yesterdayResults.reduce((sum, row) => sum + row.wins, 0);
  const yesterdayLosses = yesterdayResults.reduce((sum, row) => sum + row.losses, 0);
  const yesterdayPushes = yesterdayResults.reduce((sum, row) => sum + row.pushes, 0);

  return {
    foundation,
    current: {
      ...input.current,
      sportOrder: input.current.sportOrder.filter((sport) => sport !== "ucl"),
      tallies: withoutUcl(input.current.tallies),
      yesterdayRecap: {
        ...input.current.yesterdayRecap,
        results: yesterdayResults,
        totalPicks: yesterdayWins + yesterdayLosses + yesterdayPushes,
        totalWins: yesterdayWins,
        totalLosses: yesterdayLosses,
        hitRate: yesterdayWins + yesterdayLosses > 0 ? yesterdayWins / (yesterdayWins + yesterdayLosses) : 0,
      },
    },
  };
}

export async function getPublicTrackRecordSummary(): Promise<PublicTrackRecordSummary> {
  const asOf = new Date().toISOString();
  const todayEt = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const [currentSnapshot, categorySnapshot] = await Promise.all([
    readLabResponseSnapshot<TrackingResponse>(trackingSnapshotKey(), "fresh")
      .then(async (snapshot) => snapshot ?? readLabResponseSnapshot<TrackingResponse>(trackingSnapshotKey(), "stale")),
    readLabResponseSnapshot<PublicTrackingFoundationSnapshot>(
      trackingFoundationSnapshotKey({ date: todayEt }),
      "fresh",
    ).then(async (snapshot) => snapshot ?? readLabResponseSnapshot<PublicTrackingFoundationSnapshot>(
      trackingFoundationSnapshotKey({ date: todayEt }),
      "stale",
    )),
  ]);
  const visible = applyPublicUclTrackingVisibility({
    current: currentSnapshot?.payload ?? null,
    foundation: categorySnapshot?.payload ?? null,
    includeUcl: resolveUclFeatureFlags().member,
  });
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
    archiveProvenance: TRACK_RECORD_ARCHIVE_PROVENANCE,
    categoryTracking: {
      available: visible.foundation !== null,
      asOf: visible.foundation?.generatedAt ?? categorySnapshot?.generatedAt ?? asOf,
      windows: buildPublicTrackingCategoryWindows(visible.foundation),
    },
    currentOfficial: visible.current ? {
      asOf: visible.current.as_of,
      latestActivityDate: visible.current.yesterdayRecap.date,
      wins: visible.current.allTimeAggregate.wins,
      losses: visible.current.allTimeAggregate.losses,
      pushes: visible.current.allTimeAggregate.pushes,
      totalPredictions: visible.current.allTimeAggregate.totalPredictions,
      hitRate: Math.round(visible.current.allTimeAggregate.hitRate * 1_000) / 10,
      windows: [
        {
          label: "Weekly",
          rangeLabel: `${visible.current.weeklyAggregate.weekStartLabel} – ${visible.current.weeklyAggregate.weekEndLabel}`,
          wins: visible.current.weeklyAggregate.wins,
          losses: visible.current.weeklyAggregate.losses,
          pushes: visible.current.weeklyAggregate.pushes,
          totalPredictions: visible.current.weeklyAggregate.totalPicks,
          hitRate: displayHitRate(
            visible.current.weeklyAggregate.hitRate,
            visible.current.weeklyAggregate.wins,
            visible.current.weeklyAggregate.losses,
          ),
        },
        {
          label: "Monthly",
          rangeLabel: "Last 30 days",
          wins: visible.current.last30Days.aggregate.wins,
          losses: visible.current.last30Days.aggregate.losses,
          pushes: Math.max(
            0,
            visible.current.last30Days.aggregate.picks
              - visible.current.last30Days.aggregate.wins
              - visible.current.last30Days.aggregate.losses,
          ),
          totalPredictions: visible.current.last30Days.aggregate.picks,
          hitRate: displayHitRate(
            visible.current.last30Days.aggregate.hitRate,
            visible.current.last30Days.aggregate.wins,
            visible.current.last30Days.aggregate.losses,
          ),
        },
        {
          label: "Lifetime",
          rangeLabel: "Since official tracking began",
          wins: visible.current.allTimeAggregate.wins,
          losses: visible.current.allTimeAggregate.losses,
          pushes: visible.current.allTimeAggregate.pushes,
          totalPredictions: visible.current.allTimeAggregate.totalPredictions,
          hitRate: displayHitRate(
            visible.current.allTimeAggregate.hitRate,
            visible.current.allTimeAggregate.wins,
            visible.current.allTimeAggregate.losses,
          ),
        },
      ],
    } : undefined,
  };
}
