import type {
  PredictionGradeRow,
  PredictionRecordRow,
  TrackedMarketV17,
} from "@/lib/types/domain/Tracking";
import { NFL_PUBLISHED_PREGAME_RECOVERY_RELEASE } from "../football/nflOfficialTrackingRecord";

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
  source: "current_release" | "prior_release" | "locked_history";
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
  /** Release-pure comparison; never label this as public Lifetime. */
  currentRelease?: AlternateLineWindow;
};

export type AlternateLineSourceRow = {
  record: PredictionRecordRow;
  grade: PredictionGradeRow | null;
  displaySport: string;
};

type AlternateLineRecordProjection = PredictionRecordRow & {
  alternate_line_evidence_sha256?: unknown;
  alternate_line_pregame_recovery?: unknown;
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

function evidencePayloadSha256(record: PredictionRecordRow): string | null {
  const projected = (record as AlternateLineRecordProjection).alternate_line_evidence_sha256;
  if (typeof projected === "string") return projected;
  const raw = record.snapshot_json?.evidence_payload_sha256;
  return typeof raw === "string" ? raw : null;
}

/**
 * An adjusted-line result may use older data only when the exact original
 * market, side, line, and immutable lock existed before the game. Rows written
 * later are admitted only when the recovery preserved a pregame publication
 * timestamp and a hashed evidence payload. Final scores alone are never enough.
 */
export function hasVerifiedAlternateLineSource(record: PredictionRecordRow): boolean {
  if (!supportedMarket(record.market) || !Number.isFinite(record.line_value)) return false;
  const side = String(record.side ?? "").trim().toLowerCase();
  if (record.market === "total" && side !== "over" && side !== "under") return false;
  if (record.market === "spread" && side !== "home" && side !== "away") return false;

  const gameStartsAt = Date.parse(record.game_date ?? "");
  const lockedAt = Date.parse(record.locked_at ?? "");
  const createdAt = Date.parse(record.created_at ?? "");
  if (record.sport === "nfl" && record.prediction_source === "nfl_published_pregame_recovery") {
    const raw = (record as AlternateLineRecordProjection).alternate_line_pregame_recovery ??
      record.snapshot_json?.published_pregame_recovery;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const receipt = raw as Record<string, unknown>;
    const sourceAt = Date.parse(String(receipt.originalCapturedAt ?? ""));
    const evidenceHash = evidencePayloadSha256(record);
    return receipt.release === NFL_PUBLISHED_PREGAME_RECOVERY_RELEASE &&
      receipt.onTimeT60Lock === false && receipt.originalLockedAt === null && receipt.originalStage === "unlocked" &&
      typeof receipt.ownerApproval === "string" && receipt.ownerApproval.trim().length > 0 &&
      typeof receipt.sourceEvidenceId === "string" && receipt.sourceEvidenceId.length > 0 &&
      evidenceHash !== null && /^[a-f0-9]{64}$/i.test(evidenceHash) && receipt.sourcePayloadSha256 === evidenceHash &&
      typeof receipt.failedPayloadSha256 === "string" && /^[a-f0-9]{64}$/i.test(receipt.failedPayloadSha256) &&
      receipt.originalMarket === record.market && receipt.originalSide === record.side && receipt.originalLine === record.line_value &&
      Number.isFinite(gameStartsAt) && Number.isFinite(lockedAt) && lockedAt > gameStartsAt &&
      Date.parse(String(receipt.recoveredAt ?? "")) === lockedAt &&
      Number.isFinite(sourceAt) && sourceAt <= gameStartsAt - 60 * 60_000 &&
      Date.parse(record.published_at ?? "") === sourceAt;
  }
  if (!Number.isFinite(gameStartsAt) || !Number.isFinite(lockedAt) || lockedAt > gameStartsAt) return false;
  if (Number.isFinite(createdAt) && createdAt <= gameStartsAt) return true;

  const publishedAt = Date.parse(record.published_at ?? "");
  const evidenceSha256 = evidencePayloadSha256(record);
  return Number.isFinite(publishedAt)
    && publishedAt <= gameStartsAt
    && evidenceSha256 !== null
    && /^[a-f0-9]{64}$/i.test(evidenceSha256);
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
    if (!row.grade || !hasVerifiedAlternateLineSource(row.record)) return [];
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

/** Public UCL history spans released locks; numerical current-model reporting
 * stays separate. Other sports retain their existing projection and labels. */
export function buildLockedAlternateLineCategories(
  rows: AlternateLineSourceRow[],
  input: { from: string; to: string; sourceLabel?: string },
): AlternateLineCategory[] {
  const range = { from: input.from, to: input.to };
  return [
    ...buildAlternateLineCategories(rows.filter(row => row.displaySport !== "ucl"), range),
    ...buildAlternateLineCategories(rows.filter(row => row.displaySport === "ucl"), {
      ...range, source: "locked_history",
      sourceLabel: input.sourceLabel ?? "Locked history · all model versions",
    }),
  ].sort((a, b) => a.sport.localeCompare(b.sport) || a.market.localeCompare(b.market));
}
