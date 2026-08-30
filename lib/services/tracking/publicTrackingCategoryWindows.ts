export type PublicTrackingCategoryMetric = {
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  pending: number;
  winPct: number | null;
};

export type PublicTrackingCategoryRow = {
  sport: string;
  market: string;
  detail?: string;
  metrics: PublicTrackingCategoryMetric;
};

export type PublicTrackingCategoryWindow = {
  key: "weekly" | "monthly" | "lifetime";
  label: "Weekly" | "Monthly" | "Lifetime";
  rangeLabel: string;
  rows: PublicTrackingCategoryRow[];
};

type FoundationMetric = {
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  pending: number;
  win_pct: number | null;
};

type FoundationBucket = {
  sport: string;
  market: string;
  metrics: FoundationMetric;
};

type FoundationBaseline = {
  sport: string;
  market: string;
  lifetime_wins: number;
  lifetime_total: number;
  lifetime_pct: number;
};

export type PublicTrackingFoundationSnapshot = {
  baselines?: FoundationBaseline[];
  bySportMarket?: FoundationBucket[];
  thisWeek?: {
    from: string;
    to: string;
    bySportMarket: FoundationBucket[];
  };
  thisMonth?: {
    from: string;
    to: string;
    bySportMarket: FoundationBucket[];
  };
  generatedAt?: string;
};

const SPORT_ORDER: Record<string, number> = {
  mlb: 1,
  nba: 2,
  cbb: 3,
  wnba: 4,
  nfl: 5,
  cfb: 6,
  nhl: 7,
  epl: 8,
  soccer: 9,
  ucl: 10,
};

const MARKET_ORDER: Record<string, number> = {
  moneyline: 1,
  match_result: 1,
  total: 2,
  nrfi: 3,
  yrfi: 4,
  first_inning: 5,
  spread: 6,
  double_chance: 7,
  btts: 8,
};

function formatShortDate(yyyyMmDd: string): string {
  const [year, month, day] = yyyyMmDd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function mapMetric(metric: FoundationMetric): PublicTrackingCategoryMetric {
  return {
    picks: metric.picks,
    wins: metric.wins,
    losses: metric.losses,
    pushes: metric.pushes,
    voids: metric.voids,
    pending: metric.pending,
    winPct: metric.win_pct,
  };
}

function sortRows<T extends { sport: string; market: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => {
    const sportDiff = (SPORT_ORDER[a.sport] ?? 99) - (SPORT_ORDER[b.sport] ?? 99);
    if (sportDiff !== 0) return sportDiff;
    return (MARKET_ORDER[a.market] ?? 99) - (MARKET_ORDER[b.market] ?? 99);
  });
}

function visibleBuckets(buckets: FoundationBucket[]): FoundationBucket[] {
  const hasNrfiOrYrfi = buckets.some((bucket) => bucket.market === "nrfi" || bucket.market === "yrfi");
  return sortRows(
    buckets.filter((bucket) => !(bucket.market === "first_inning" && hasNrfiOrYrfi)),
  );
}

function buildLifetimeRows(
  bySportMarket: FoundationBucket[],
  baselines: FoundationBaseline[],
): PublicTrackingCategoryRow[] {
  const baselineByKey = new Map(baselines.map((baseline) => [`${baseline.sport}:${baseline.market}`, baseline]));
  const liveByKey = new Map(bySportMarket.map((bucket) => [`${bucket.sport}:${bucket.market}`, bucket]));
  const keys = new Set([...baselineByKey.keys(), ...liveByKey.keys()]);
  const rows: PublicTrackingCategoryRow[] = [];

  for (const key of keys) {
    const [sport, market] = key.split(":");
    if (!sport || !market) continue;
    const baseline = baselineByKey.get(key);
    const live = liveByKey.get(key);
    const liveDecided = (live?.metrics.wins ?? 0) + (live?.metrics.losses ?? 0);
    const livePending = live?.metrics.pending ?? 0;

    if (baseline && liveDecided > 0) {
      const wins = baseline.lifetime_wins + (live?.metrics.wins ?? 0);
      const decided = baseline.lifetime_total + liveDecided;
      rows.push({
        sport,
        market,
        detail: `Lifetime · live +${liveDecided}`,
        metrics: {
          picks: decided,
          wins,
          losses: decided - wins,
          pushes: live?.metrics.pushes ?? 0,
          voids: live?.metrics.voids ?? 0,
          pending: livePending,
          winPct: decided > 0 ? (wins / decided) * 100 : null,
        },
      });
      continue;
    }

    if (baseline) {
      rows.push({
        sport,
        market,
        detail: "Lifetime",
        metrics: {
          picks: baseline.lifetime_total,
          wins: baseline.lifetime_wins,
          losses: baseline.lifetime_total - baseline.lifetime_wins,
          pushes: 0,
          voids: 0,
          pending: livePending,
          winPct: baseline.lifetime_pct,
        },
      });
      continue;
    }

    if (live && (liveDecided > 0 || live.metrics.pending > 0)) {
      rows.push({
        sport,
        market,
        detail: "Since launch",
        metrics: mapMetric(live.metrics),
      });
    }
  }

  const mlbHasNrfiAndYrfi = rows.some((row) => row.sport === "mlb" && row.market === "nrfi")
    && rows.some((row) => row.sport === "mlb" && row.market === "yrfi");
  return sortRows(rows.filter((row) => !(mlbHasNrfiAndYrfi && row.sport === "mlb" && row.market === "first_inning")));
}

export function buildPublicTrackingCategoryWindows(
  snapshot: PublicTrackingFoundationSnapshot | null,
): PublicTrackingCategoryWindow[] {
  const week = snapshot?.thisWeek;
  const month = snapshot?.thisMonth;
  const weeklyRows = visibleBuckets(week?.bySportMarket ?? []).map((bucket) => ({
    sport: bucket.sport,
    market: bucket.market,
    metrics: mapMetric(bucket.metrics),
  }));
  const monthlyRows = visibleBuckets(month?.bySportMarket ?? []).map((bucket) => ({
    sport: bucket.sport,
    market: bucket.market,
    metrics: mapMetric(bucket.metrics),
  }));
  const lifetimeRows = buildLifetimeRows(snapshot?.bySportMarket ?? [], snapshot?.baselines ?? []);

  return [
    {
      key: "weekly",
      label: "Weekly",
      rangeLabel: week ? `${formatShortDate(week.from)} → ${formatShortDate(week.to)}` : "This week",
      rows: weeklyRows,
    },
    {
      key: "monthly",
      label: "Monthly",
      rangeLabel: month ? `${formatShortDate(month.from)} → ${formatShortDate(month.to)}` : "Last 30 days",
      rows: monthlyRows,
    },
    {
      key: "lifetime",
      label: "Lifetime",
      rangeLabel: "All-time",
      rows: lifetimeRows,
    },
  ];
}
