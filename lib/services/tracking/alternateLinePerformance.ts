import type {
  PredictionGradeRow,
  PredictionRecordRow,
  TrackedMarketV17,
} from "@/lib/types/domain/Tracking";

export type AlternateLineDisplaySport =
  | "mlb"
  | "nba"
  | "wnba"
  | "cbb"
  | "nfl"
  | "cfb"
  | "nhl"
  | "epl"
  | "ucl";

export type AlternateLineOutcome = "win" | "loss" | "push";

export type AlternateLineMetrics = {
  wins: number;
  losses: number;
  pushes: number;
  settled: number;
  winPct: number | null;
};

export type AlternateLineAdjustment = {
  delta: number;
  label: string;
  metrics: AlternateLineMetrics;
};

export type AlternateLineCategory = {
  sport: AlternateLineDisplaySport;
  market: "spread" | "total";
  source: "current_release" | "prior_release";
  sourceLabel: string;
  coverageFrom: string;
  coverageTo: string;
  original: AlternateLineMetrics;
  adjustments: AlternateLineAdjustment[];
  excludedRows: number;
};

export type AlternateLineWindow = {
  from: string;
  to: string;
  rows: AlternateLineCategory[];
};

export type AlternateLinePerformance = {
  weekly: AlternateLineWindow;
  monthly: AlternateLineWindow;
  lifetime: AlternateLineWindow;
  archives: AlternateLineCategory[];
};

export type AlternateLineSourceRow = {
  record: PredictionRecordRow;
  grade: PredictionGradeRow | null;
  displaySport: string;
};

type AdjustmentDefinition = {
  delta: number;
  label: string;
};

const ADJUSTMENTS: Partial<Record<AlternateLineDisplaySport, Partial<Record<"spread" | "total", AdjustmentDefinition[]>>>> = {
  nfl: {
    spread: [{ delta: 3, label: "+3 POINTS" }, { delta: 6, label: "+6 POINTS" }],
    total: [{ delta: 3, label: "+3 POINTS" }, { delta: 6, label: "+6 POINTS" }],
  },
  cfb: {
    spread: [{ delta: 3, label: "+3 POINTS" }, { delta: 6, label: "+6 POINTS" }],
    total: [{ delta: 3, label: "+3 POINTS" }, { delta: 6, label: "+6 POINTS" }],
  },
  nba: {
    spread: [{ delta: 3, label: "+3 POINTS" }, { delta: 6, label: "+6 POINTS" }],
    total: [{ delta: 3, label: "+3 POINTS" }, { delta: 6, label: "+6 POINTS" }],
  },
  wnba: {
    spread: [{ delta: 3, label: "+3 POINTS" }, { delta: 6, label: "+6 POINTS" }],
    total: [{ delta: 3, label: "+3 POINTS" }, { delta: 6, label: "+6 POINTS" }],
  },
  cbb: {
    spread: [{ delta: 3, label: "+3 POINTS" }, { delta: 6, label: "+6 POINTS" }],
    total: [{ delta: 3, label: "+3 POINTS" }, { delta: 6, label: "+6 POINTS" }],
  },
  mlb: {
    total: [{ delta: 1, label: "+1 RUN" }, { delta: 2, label: "+2 RUNS" }],
  },
  nhl: {
    spread: [{ delta: 1, label: "+1 GOAL" }, { delta: 2, label: "+2 GOALS" }],
    total: [{ delta: 1, label: "+1 GOAL" }, { delta: 2, label: "+2 GOALS" }],
  },
  epl: {
    total: [{ delta: 0.5, label: "+0.5 GOAL" }, { delta: 1, label: "+1 GOAL" }],
  },
  ucl: {
    total: [{ delta: 0.5, label: "+0.5 GOAL" }, { delta: 1, label: "+1 GOAL" }],
  },
};

function supportedSport(value: string): value is AlternateLineDisplaySport {
  return value in ADJUSTMENTS;
}

function supportedMarket(value: TrackedMarketV17): value is "spread" | "total" {
  return value === "spread" || value === "total";
}

function storedOutcome(grade: PredictionGradeRow): AlternateLineOutcome | null {
  if (grade.result === "win" || grade.win) return "win";
  if (grade.result === "loss" || grade.loss) return "loss";
  if (grade.result === "push" || grade.push) return "push";
  return null;
}

/**
 * Regrade one settled, locked line after moving that line in the selected
 * side's favor. This never changes the stored prediction or grade.
 */
export function alternateLineOutcome(
  record: PredictionRecordRow,
  grade: PredictionGradeRow,
  delta: number,
): AlternateLineOutcome | null {
  const home = grade.actual_home_score;
  const away = grade.actual_away_score;
  const line = record.line_value;
  if (home === null || away === null || line === null) return null;

  if (record.market === "total") {
    const total = grade.actual_total ?? home + away;
    const side = String(record.side ?? "").trim().toLowerCase();
    const adjustedLine = side === "over"
      ? line - delta
      : side === "under"
        ? line + delta
        : null;
    if (adjustedLine === null) return null;
    if (total === adjustedLine) return "push";
    if (side === "over") return total > adjustedLine ? "win" : "loss";
    return total < adjustedLine ? "win" : "loss";
  }

  if (record.market === "spread") {
    const side = String(record.side ?? "").trim().toLowerCase();
    if (side !== "home" && side !== "away") return null;
    const selectedMargin = side === "home" ? home - away : away - home;
    const adjustedMargin = selectedMargin + line + delta;
    if (adjustedMargin === 0) return "push";
    return adjustedMargin > 0 ? "win" : "loss";
  }

  return null;
}

function metrics(outcomes: AlternateLineOutcome[]): AlternateLineMetrics {
  const wins = outcomes.filter((outcome) => outcome === "win").length;
  const losses = outcomes.filter((outcome) => outcome === "loss").length;
  const pushes = outcomes.filter((outcome) => outcome === "push").length;
  const decided = wins + losses;
  return {
    wins,
    losses,
    pushes,
    settled: wins + losses + pushes,
    // Preserve two decimals in the response and let each surface choose its
    // display precision. This matches the main tracking aggregate so an
    // identical record cannot render as 53.9% above and 53.8% below.
    winPct: decided > 0 ? Math.round((wins / decided) * 10000) / 100 : null,
  };
}

function buildCategory(
  sourceRows: AlternateLineSourceRow[],
  source: AlternateLineCategory["source"],
  sourceLabel: string,
): AlternateLineCategory | null {
  const first = sourceRows[0];
  if (!first || !supportedSport(first.displaySport) || !supportedMarket(first.record.market)) return null;
  const definitions = ADJUSTMENTS[first.displaySport]?.[first.record.market];
  if (!definitions || definitions.length === 0) return null;

  const usable = sourceRows.flatMap((row) => {
    if (!row.grade) return [];
    const lockedOutcome = storedOutcome(row.grade);
    const exactLineOutcome = alternateLineOutcome(row.record, row.grade, 0);
    // The immutable stored grade is authoritative. A missing score/line or a
    // disagreement at delta=0 is excluded instead of being reinterpreted.
    if (lockedOutcome === null || exactLineOutcome === null || lockedOutcome !== exactLineOutcome) return [];
    return [{ ...row, lockedOutcome }];
  });
  if (usable.length === 0) return null;

  const dates = usable.map((row) => row.record.slate_date).sort();
  return {
    sport: first.displaySport,
    market: first.record.market,
    source,
    sourceLabel,
    coverageFrom: dates[0]!,
    coverageTo: dates[dates.length - 1]!,
    original: metrics(usable.map((row) => row.lockedOutcome)),
    adjustments: definitions.map((definition) => ({
      ...definition,
      metrics: metrics(usable.map((row) => alternateLineOutcome(row.record, row.grade!, definition.delta)!)),
    })),
    excludedRows: sourceRows.length - usable.length,
  };
}

export function buildAlternateLineCategories(
  rows: AlternateLineSourceRow[],
  input: {
    from: string;
    to: string;
    source?: AlternateLineCategory["source"];
    sourceLabel?: string;
  },
): AlternateLineCategory[] {
  const scoped = rows.filter((row) =>
    row.record.slate_date >= input.from
    && row.record.slate_date <= input.to
    && supportedSport(row.displaySport)
    && supportedMarket(row.record.market)
    && ADJUSTMENTS[row.displaySport]?.[row.record.market] !== undefined,
  );
  const groups = new Map<string, AlternateLineSourceRow[]>();
  for (const row of scoped) {
    const key = `${row.displaySport}::${row.record.market}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map((group) => buildCategory(
      group,
      input.source ?? "current_release",
      input.sourceLabel ?? "Line-level history",
    ))
    .filter((row): row is AlternateLineCategory => row !== null)
    .sort((a, b) => a.sport.localeCompare(b.sport) || a.market.localeCompare(b.market));
}
