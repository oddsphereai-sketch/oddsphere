import { isBlockedSportsbook } from "../../config/blockedSportsbooks";
import type { PredictionRecordRow } from "../../types/domain/Tracking";

export const MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_KEY =
  "mlb_fullgame_market_evidence_v1" as const;
export const MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_CONTRACT =
  "mlb_fullgame_market_evidence_capture_2026_09_02_r1" as const;
export const MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_SCHEMA = "mlbfgme1" as const;
export const MLB_FULLGAME_MARKET_EVIDENCE_MAX_MARKET_BYTES = 12_288;
export const MLB_FULLGAME_MARKET_EVIDENCE_MAX_GAME_BYTES = 24_576;
export const MLB_FULLGAME_MARKET_EVIDENCE_MAX_BOOKS = 16;

const MAX_PAIR_SKEW_MS = 2 * 60_000;
const MAX_FRESHNESS_MS = 90 * 60_000;
const MAX_SPLIT_ROWS = 8;
const MAX_SIGNAL_ROWS = 4;
const MAX_STRING = 160;

const SHARP_BOOKS = new Set(["pinnacle", "circa", "bookmaker"]);
const RETAIL_BOOKS = new Set([
  "draftkings", "fanduel", "betmgm", "caesars", "bet365", "hardrock",
  "betrivers", "ballybet", "betparx", "betway", "rebet",
]);
const SYNTHETIC_BOOKS = new Set(["splitsconsensus", "lockedsnapshot", "recommendationsnapshot"]);

export type MlbFullGameCaptureLineRow = {
  market_type: string;
  side: string | null;
  sportsbook: string;
  odds_american: number | null;
  line_value?: number | null;
  fetched_at?: string | null;
};

export type MlbFullGameCaptureHistoryRow = {
  market_type: string;
  side: string | null;
  sportsbook: string;
  odds_american: number | null;
  line_value: number | null;
  recorded_at: string | null;
};

export type MlbFullGameCaptureOpenerRow = MlbFullGameCaptureHistoryRow;

export type MlbFullGameCaptureSignalRow = {
  market_type: string;
  side: string;
  public_money_pct: number | null;
  public_betting_pct: number | null;
  has_steam_move: boolean | null;
  has_reverse_line_movement: boolean | null;
  rlm_direction: string | null;
  signal_strength: string | null;
  computed_at: string | null;
  pinnacle_fair_probability: number | null;
  is_plus_ev: boolean | null;
  ev_pct: number | null;
  steam_detected_at: string | null;
  steam_books_count: number | null;
};

export type MlbFullGameCaptureSplitRow = {
  market_type: string;
  selection_key: string | null;
  provider: string | null;
  source_book: string | null;
  source_type: string | null;
  bets_pct: number | null;
  money_pct: number | null;
  source_observed_at: string | null;
  fetched_at: string | null;
};

export type MlbFullGameCapturePrediction = {
  game_id: number;
  computed_at: string | null;
  locked_at: string | null;
  predicted_ml_winner: string | null;
  predicted_ou_side: string | null;
  ml_confidence: number | null;
  ou_confidence: number | null;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  sport_specific: Record<string, unknown> | null;
};

export type MlbFullGameEvidenceArtifact = {
  schema_version: typeof MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_SCHEMA;
  contract: typeof MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_CONTRACT;
  mode: "capture_only";
  production_gate_enabled: false;
  market: "moneyline" | "total";
  model_cycle_at: string;
  listed_line: number | null;
  evaluated_price: Record<string, unknown>;
  named_book_pairs: Array<Record<string, unknown>>;
  target_excluded_cohort: Record<string, unknown>;
  source_aware_splits: Array<Record<string, unknown>>;
  sharp_signals: Array<Record<string, unknown>>;
  forecast: Record<string, unknown>;
  publication_correction: Record<string, unknown>;
  rejected_counts: Record<string, number>;
  omitted_counts: Record<string, number>;
  bounds: Record<string, number>;
  payload_bytes: number;
};

export function attachMlbFullGameForwardEvidence(args: {
  records: ReadonlyArray<PredictionRecordRow>;
  prediction: MlbFullGameCapturePrediction;
  currentLines: ReadonlyArray<MlbFullGameCaptureLineRow>;
  historyRows: ReadonlyArray<MlbFullGameCaptureHistoryRow>;
  openerRows: ReadonlyArray<MlbFullGameCaptureOpenerRow>;
  signals: ReadonlyArray<MlbFullGameCaptureSignalRow>;
  splitRows: ReadonlyArray<MlbFullGameCaptureSplitRow>;
  observer?: (artifacts: ReadonlyArray<MlbFullGameEvidenceArtifact>) => void;
  /** Narrow test seam for proving oversize failure isolation. Production omits it. */
  limits?: { maxMarketBytes: number; maxGameBytes: number };
}): ReadonlyArray<PredictionRecordRow> {
  try {
    if (args.prediction.locked_at !== null) return args.records;
    const modelMs = args.prediction.computed_at === null ? NaN : Date.parse(args.prediction.computed_at);
    if (!Number.isFinite(modelMs)) return args.records;
    const artifacts = new Map<"moneyline" | "total", MlbFullGameEvidenceArtifact>();
    for (const market of ["moneyline", "total"] as const) {
      const record = args.records.find((candidate) => candidate.market === market);
      if (!record || record.locked_at !== null) continue;
      const artifact = buildArtifact({
        ...args,
        record,
        market,
        modelMs,
        maxMarketBytes: args.limits?.maxMarketBytes ?? MLB_FULLGAME_MARKET_EVIDENCE_MAX_MARKET_BYTES,
        maxGameBytes: args.limits?.maxGameBytes ?? MLB_FULLGAME_MARKET_EVIDENCE_MAX_GAME_BYTES,
      });
      if (artifact === null) return args.records;
      artifacts.set(market, artifact);
    }
    if (artifacts.size === 0) return args.records;
    const combinedBytes = [...artifacts.values()].reduce(
      (sum, artifact) => sum + mlbFullGameEvidenceAddedBytes(artifact),
      0,
    );
    if (combinedBytes > (args.limits?.maxGameBytes ?? MLB_FULLGAME_MARKET_EVIDENCE_MAX_GAME_BYTES)) {
      return args.records;
    }
    args.observer?.([...artifacts.values()]);
    return args.records.map((record) => {
      const artifact = record.market === "moneyline" || record.market === "total"
        ? artifacts.get(record.market)
        : undefined;
      if (!artifact) return record;
      const snapshot = object(record.snapshot_json) ?? {};
      return {
        ...record,
        snapshot_json: {
          ...snapshot,
          [MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_KEY]: artifact,
        },
      };
    });
  } catch {
    return args.records;
  }
}

/**
 * Conservative serialized bytes added to a non-empty snapshot_json object.
 * It includes the property name, colon, value, and separating comma.
 */
export function mlbFullGameEvidenceAddedBytes(artifact: MlbFullGameEvidenceArtifact): number {
  return byteLength({ [MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_KEY]: artifact }) - 1;
}

function buildArtifact(args: {
  record: PredictionRecordRow;
  market: "moneyline" | "total";
  modelMs: number;
  prediction: MlbFullGameCapturePrediction;
  currentLines: ReadonlyArray<MlbFullGameCaptureLineRow>;
  historyRows: ReadonlyArray<MlbFullGameCaptureHistoryRow>;
  openerRows: ReadonlyArray<MlbFullGameCaptureOpenerRow>;
  signals: ReadonlyArray<MlbFullGameCaptureSignalRow>;
  splitRows: ReadonlyArray<MlbFullGameCaptureSplitRow>;
  maxMarketBytes: number;
  maxGameBytes: number;
}): MlbFullGameEvidenceArtifact | null {
  const listedLine = args.market === "total" ? finite(args.record.line_value) : null;
  const evaluated = evaluatedPrice(args.record);
  const pairResult = buildCurrentPairs({
    market: args.market,
    listedLine,
    modelMs: args.modelMs,
    currentLines: args.currentLines,
    historyRows: args.historyRows,
    openerRows: args.openerRows,
    evaluatedBook: evaluated.normalized_book,
  });
  const splitRows = captureSplits(args.splitRows, args.market);
  const signals = captureSignals(args.signals, args.market);
  const forecast = captureForecast(args.prediction, args.record, args.market);
  const correction = capturePublicationCorrection(args.prediction, args.record, args.market);
  const orderedPairs = pairResult.pairs;
  let retainedCount = Math.min(orderedPairs.length, MLB_FULLGAME_MARKET_EVIDENCE_MAX_BOOKS);
  while (retainedCount >= 0) {
    const retainedPairs = orderedPairs.slice(0, retainedCount);
    const omittedBookPairs = orderedPairs.length - retainedPairs.length;
    const artifactWithoutBytes = {
      schema_version: MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_SCHEMA,
      contract: MLB_FULLGAME_MARKET_EVIDENCE_CAPTURE_CONTRACT,
      mode: "capture_only" as const,
      production_gate_enabled: false as const,
      market: args.market,
      model_cycle_at: new Date(args.modelMs).toISOString(),
      listed_line: listedLine,
      evaluated_price: evaluated,
      named_book_pairs: retainedPairs,
      target_excluded_cohort: targetExcludedCohort(
        orderedPairs,
        retainedPairs,
        evaluated.normalized_book,
      ),
      source_aware_splits: splitRows.rows,
      sharp_signals: signals.rows,
      forecast,
      publication_correction: correction,
      rejected_counts: pairResult.rejected,
      omitted_counts: {
        named_book_pairs: omittedBookPairs,
        source_aware_splits: splitRows.omitted,
        sharp_signals: signals.omitted,
      },
      bounds: {
        max_market_bytes: args.maxMarketBytes,
        max_game_bytes: args.maxGameBytes,
        max_named_books: MLB_FULLGAME_MARKET_EVIDENCE_MAX_BOOKS,
        max_source_aware_split_rows: MAX_SPLIT_ROWS,
        max_sharp_signal_rows: MAX_SIGNAL_ROWS,
        max_pair_skew_seconds: MAX_PAIR_SKEW_MS / 1000,
        max_current_age_minutes: MAX_FRESHNESS_MS / 60_000,
      },
    };
    const artifact = withStablePayloadBytes(artifactWithoutBytes);
    if (artifact.payload_bytes <= args.maxMarketBytes) return artifact;
    retainedCount -= 1;
  }
  return null;
}

type PricePoint = {
  normalizedBook: string;
  book: string;
  sourceClass: "sharp" | "retail" | "other_named";
  side: string;
  line: number | null;
  odds: number;
  observedMs: number;
  origin: "lines" | "line_history";
};

function buildCurrentPairs(args: {
  market: "moneyline" | "total";
  listedLine: number | null;
  modelMs: number;
  currentLines: ReadonlyArray<MlbFullGameCaptureLineRow>;
  historyRows: ReadonlyArray<MlbFullGameCaptureHistoryRow>;
  openerRows: ReadonlyArray<MlbFullGameCaptureOpenerRow>;
  evaluatedBook: string | null;
}): { pairs: Array<Record<string, unknown>>; rejected: Record<string, number> } {
  const rejected: Record<string, number> = {
    blocked_or_synthetic: 0,
    unsupported_side: 0,
    line_mismatch: 0,
    invalid_price: 0,
    missing_timestamp: 0,
    invalid_timestamp: 0,
    future_timestamp: 0,
    stale_current: 0,
    unmatched_side: 0,
    pair_skew: 0,
  };
  const points: PricePoint[] = [];
  for (const row of args.currentLines) {
    if (row.market_type !== args.market) continue;
    collectPoint({
      market: args.market,
      listedLine: args.listedLine,
      modelMs: args.modelMs,
      sportsbook: row.sportsbook,
      side: row.side,
      line: row.line_value ?? null,
      odds: row.odds_american,
      observedAt: row.fetched_at ?? null,
      origin: "lines",
      rejected,
      points,
    });
  }
  for (const row of args.historyRows) {
    if (row.market_type !== args.market) continue;
    collectPoint({
      market: args.market,
      listedLine: args.listedLine,
      modelMs: args.modelMs,
      sportsbook: row.sportsbook,
      side: row.side,
      line: row.line_value,
      odds: row.odds_american,
      observedAt: row.recorded_at,
      origin: "line_history",
      rejected,
      points,
    });
  }
  const positiveSide = args.market === "moneyline" ? "home" : "over";
  const negativeSide = args.market === "moneyline" ? "away" : "under";
  const byBook = new Map<string, PricePoint[]>();
  for (const point of points) {
    const list = byBook.get(point.normalizedBook) ?? [];
    list.push(point);
    byBook.set(point.normalizedBook, list);
  }
  const pairs: Array<Record<string, unknown>> = [];
  for (const [normalizedBook, bookPoints] of byBook) {
    const positive = uniqueNewest(bookPoints.filter((point) => point.side === positiveSide));
    const negative = uniqueNewest(bookPoints.filter((point) => point.side === negativeSide));
    if (positive.length === 0 || negative.length === 0) {
      rejected.unmatched_side += 1;
      continue;
    }
    const pair = bestPair(positive, negative);
    if (pair === null) {
      rejected.pair_skew += 1;
      continue;
    }
    const olderMs = Math.min(pair.positive.observedMs, pair.negative.observedMs);
    const ageMs = args.modelMs - olderMs;
    if (ageMs > MAX_FRESHNESS_MS) {
      rejected.stale_current += 1;
      continue;
    }
    const opener = buildOpenerPair({
      rows: args.openerRows,
      market: args.market,
      listedLine: args.listedLine,
      normalizedBook,
      positiveSide,
      negativeSide,
      modelMs: args.modelMs,
    });
    const currentProbability = noVig(pair.positive.odds, pair.negative.odds);
    if (currentProbability === null) {
      rejected.invalid_price += 1;
      continue;
    }
    const sourceClass = pair.positive.sourceClass;
    pairs.push({
      identity: bounded(`${args.market}:${normalizedBook}:${args.listedLine ?? "ml"}`),
      sportsbook: bounded(pair.positive.book),
      normalized_sportsbook: normalizedBook,
      source_class: sourceClass,
      forecast_source_supported: sourceClass === "sharp" || sourceClass === "retail",
      evaluated_book: args.evaluatedBook === normalizedBook,
      line: args.listedLine,
      current: {
        positive_side: positiveSide,
        positive_odds_american: pair.positive.odds,
        negative_side: negativeSide,
        negative_odds_american: pair.negative.odds,
        positive_observed_at: new Date(pair.positive.observedMs).toISOString(),
        negative_observed_at: new Date(pair.negative.observedMs).toISOString(),
        pair_observed_at: new Date(Math.max(pair.positive.observedMs, pair.negative.observedMs)).toISOString(),
        pair_skew_seconds: Math.abs(pair.positive.observedMs - pair.negative.observedMs) / 1000,
        older_side_age_minutes: ageMs / 60_000,
        no_vig_positive_probability: currentProbability,
        origins: [pair.positive.origin, pair.negative.origin].sort(),
      },
      opening: opener,
      movement: opener === null
        ? { available: false, reason: "same_book_exact_line_opener_unavailable" }
        : {
            available: true,
            positive_probability_change_pp:
              (currentProbability - Number(opener.no_vig_positive_probability)) * 100,
            positive_price_change: pair.positive.odds - Number(opener.positive_odds_american),
            negative_price_change: pair.negative.odds - Number(opener.negative_odds_american),
            line_change: 0,
          },
    });
  }
  pairs.sort((left, right) => pairSort(left, right, args.evaluatedBook));
  return { pairs, rejected };
}

function collectPoint(args: {
  market: "moneyline" | "total";
  listedLine: number | null;
  modelMs: number;
  sportsbook: string;
  side: string | null;
  line: number | null;
  odds: number | null;
  observedAt: string | null;
  origin: "lines" | "line_history";
  rejected: Record<string, number>;
  points: PricePoint[];
}): void {
  if (args.market === "total" && args.line !== args.listedLine) {
    args.rejected.line_mismatch += 1;
    return;
  }
  const validSides = args.market === "moneyline" ? ["home", "away"] : ["over", "under"];
  if (args.side === null || !validSides.includes(args.side)) {
    args.rejected.unsupported_side += 1;
    return;
  }
  const normalizedBook = normalizeBook(args.sportsbook);
  if (!normalizedBook || SYNTHETIC_BOOKS.has(normalizedBook) || isBlockedSportsbook(args.sportsbook)) {
    args.rejected.blocked_or_synthetic += 1;
    return;
  }
  if (args.odds === null || !Number.isFinite(args.odds) || args.odds === 0) {
    args.rejected.invalid_price += 1;
    return;
  }
  if (args.observedAt === null) {
    args.rejected.missing_timestamp += 1;
    return;
  }
  const observedMs = Date.parse(args.observedAt);
  if (!Number.isFinite(observedMs)) {
    args.rejected.invalid_timestamp += 1;
    return;
  }
  if (observedMs > args.modelMs) {
    args.rejected.future_timestamp += 1;
    return;
  }
  args.points.push({
    normalizedBook,
    book: bounded(args.sportsbook),
    sourceClass: sourceClass(normalizedBook),
    side: args.side,
    line: args.line,
    odds: args.odds,
    observedMs,
    origin: args.origin,
  });
}

function uniqueNewest(points: PricePoint[]): PricePoint[] {
  const unique = new Map<string, PricePoint>();
  for (const point of points) {
    const key = `${point.observedMs}:${point.odds}:${point.origin}`;
    if (!unique.has(key)) unique.set(key, point);
  }
  return [...unique.values()].sort((a, b) =>
    b.observedMs - a.observedMs ||
    a.odds - b.odds ||
    a.origin.localeCompare(b.origin),
  ).slice(0, 48);
}

function bestPair(positive: PricePoint[], negative: PricePoint[]): { positive: PricePoint; negative: PricePoint } | null {
  let best: { positive: PricePoint; negative: PricePoint } | null = null;
  for (const p of positive) {
    for (const n of negative) {
      const skew = Math.abs(p.observedMs - n.observedMs);
      if (skew > MAX_PAIR_SKEW_MS) continue;
      if (best === null) {
        best = { positive: p, negative: n };
        continue;
      }
      const observed = Math.min(p.observedMs, n.observedMs);
      const bestObserved = Math.min(best.positive.observedMs, best.negative.observedMs);
      const bestSkew = Math.abs(best.positive.observedMs - best.negative.observedMs);
      const identity = `${p.odds}:${n.odds}:${p.origin}:${n.origin}`;
      const bestIdentity = `${best.positive.odds}:${best.negative.odds}:${best.positive.origin}:${best.negative.origin}`;
      if (
        observed > bestObserved ||
        (observed === bestObserved && skew < bestSkew) ||
        (observed === bestObserved && skew === bestSkew && identity < bestIdentity)
      ) {
        best = { positive: p, negative: n };
      }
    }
  }
  return best;
}

function buildOpenerPair(args: {
  rows: ReadonlyArray<MlbFullGameCaptureOpenerRow>;
  market: "moneyline" | "total";
  listedLine: number | null;
  normalizedBook: string;
  positiveSide: string;
  negativeSide: string;
  modelMs: number;
}): Record<string, unknown> | null {
  const points = args.rows.flatMap((row): PricePoint[] => {
    if (row.market_type !== args.market || normalizeBook(row.sportsbook) !== args.normalizedBook) return [];
    if (args.market === "total" && row.line_value !== args.listedLine) return [];
    if (row.side !== args.positiveSide && row.side !== args.negativeSide) return [];
    if (row.odds_american === null || !Number.isFinite(row.odds_american) || row.odds_american === 0) return [];
    if (row.recorded_at === null) return [];
    const observedMs = Date.parse(row.recorded_at);
    if (!Number.isFinite(observedMs) || observedMs > args.modelMs) return [];
    return [{
      normalizedBook: args.normalizedBook,
      book: bounded(row.sportsbook),
      sourceClass: sourceClass(args.normalizedBook),
      side: row.side,
      line: row.line_value,
      odds: row.odds_american,
      observedMs,
      origin: "line_history",
    }];
  });
  const positive = points.filter((point) => point.side === args.positiveSide).sort((a, b) => a.observedMs - b.observedMs);
  const negative = points.filter((point) => point.side === args.negativeSide).sort((a, b) => a.observedMs - b.observedMs);
  let best: { positive: PricePoint; negative: PricePoint } | null = null;
  for (const p of positive) {
    for (const n of negative) {
      const skew = Math.abs(p.observedMs - n.observedMs);
      if (skew > MAX_PAIR_SKEW_MS) continue;
      const observed = Math.max(p.observedMs, n.observedMs);
      const bestObserved = best === null ? Number.POSITIVE_INFINITY : Math.max(best.positive.observedMs, best.negative.observedMs);
      const identity = `${p.odds}:${n.odds}:${p.observedMs}:${n.observedMs}`;
      const bestIdentity = best === null
        ? ""
        : `${best.positive.odds}:${best.negative.odds}:${best.positive.observedMs}:${best.negative.observedMs}`;
      if (observed < bestObserved || (observed === bestObserved && identity < bestIdentity)) {
        best = { positive: p, negative: n };
      }
    }
  }
  if (best === null) return null;
  const probability = noVig(best.positive.odds, best.negative.odds);
  if (probability === null) return null;
  return {
    positive_odds_american: best.positive.odds,
    negative_odds_american: best.negative.odds,
    positive_observed_at: new Date(best.positive.observedMs).toISOString(),
    negative_observed_at: new Date(best.negative.observedMs).toISOString(),
    pair_skew_seconds: Math.abs(best.positive.observedMs - best.negative.observedMs) / 1000,
    no_vig_positive_probability: probability,
    line: args.listedLine,
  };
}

function targetExcludedCohort(
  allPairs: Array<Record<string, unknown>>,
  retainedPairs: Array<Record<string, unknown>>,
  evaluatedBook: string | null,
): Record<string, unknown> {
  const eligiblePairs = allPairs.filter((pair) => pair.normalized_sportsbook !== evaluatedBook);
  const retainedEligiblePairs = retainedPairs.filter(
    (pair) => pair.normalized_sportsbook !== evaluatedBook,
  );
  const sharp = eligiblePairs.filter((pair) => pair.source_class === "sharp");
  const retail = eligiblePairs.filter((pair) => pair.source_class === "retail");
  const other = eligiblePairs.filter((pair) => pair.source_class === "other_named");
  return {
    evaluated_book_excluded: evaluatedBook !== null,
    retained_pair_identities: retainedEligiblePairs.map((pair) => pair.identity),
    total_pair_count: eligiblePairs.length,
    omitted_pair_count: Math.max(0, eligiblePairs.length - retainedEligiblePairs.length),
    sharp_book_count: sharp.length,
    retail_book_count: retail.length,
    other_named_book_count: other.length,
    incumbent_r76_breadth_eligible: sharp.length >= 2 && retail.length >= 2,
    singleton_evaluation_only:
      allPairs.length === 1 && allPairs[0]?.normalized_sportsbook === evaluatedBook,
  };
}

function evaluatedPrice(record: PredictionRecordRow): Record<string, unknown> & { normalized_book: string | null } {
  const snapshot = object(record.snapshot_json) ?? {};
  let book: string | null = null;
  let observedAt: string | null = null;
  let source: string | null = null;
  if (record.market === "moneyline") {
    const evaluation = object(snapshot.ml_evaluation_price);
    book = string(evaluation?.evaluated_book);
    observedAt = string(evaluation?.evaluated_observed_at);
    source = string(evaluation?.policy_mode);
    if (book === null && (record.side === "home" || record.side === "away")) {
      const sources = object(snapshot.odds_source_at_lock_ml);
      const selected = object(sources?.[record.side]);
      book = string(selected?.book);
      observedAt = string(selected?.observedAt);
      source = string(selected?.source);
    }
  } else if (record.market === "total" && (record.side === "over" || record.side === "under")) {
    const sources = object(snapshot.odds_source_at_lock_ou);
    const selected = object(sources?.[record.side]);
    book = string(selected?.book);
    observedAt = string(selected?.observedAt);
    source = string(selected?.source);
  }
  return {
    sportsbook: boundedNullable(book),
    normalized_book: book === null ? null : normalizeBook(book),
    side: boundedNullable(record.side),
    line: finite(record.line_value),
    odds_american: finite(record.odds_american),
    observed_at: boundedNullable(observedAt),
    source: boundedNullable(source),
    role: "exact_price_economics_only",
  };
}

function captureForecast(
  prediction: MlbFullGameCapturePrediction,
  record: PredictionRecordRow,
  market: "moneyline" | "total",
): Record<string, unknown> {
  const sp = object(prediction.sport_specific) ?? {};
  const audit = object(sp.v2_2_audit) ?? {};
  const coherent = object(audit.coherent_market_price_map);
  return {
    model_layer_versions: compactModelVersions(object(sp.model_layer_versions) ?? object(record.snapshot_json?.model_layer_versions)),
    independent: {
      home_runs: finite(audit.independent_home_runs),
      away_runs: finite(audit.independent_away_runs),
      total_runs: finite(audit.independent_total),
    },
    final_game_prediction: {
      home_runs: finite(prediction.predicted_home_score),
      away_runs: finite(prediction.predicted_away_score),
      moneyline_side: boundedNullable(prediction.predicted_ml_winner),
      total_side: boundedNullable(prediction.predicted_ou_side),
      moneyline_confidence: finite(prediction.ml_confidence),
      total_confidence: finite(prediction.ou_confidence),
    },
    incumbent_coherent_price_map: coherent === null ? null : {
      release_id: boundedNullable(string(coherent.release_id)),
      market_applied: market === "moneyline" ? coherent.moneyline_applied === true : coherent.total_applied === true,
      market_side: market === "moneyline" ? compactObject(coherent.moneyline_home) : compactObject(coherent.total_over),
    },
    final_public_record: {
      side: boundedNullable(record.side),
      pick: boundedNullable(record.pick),
      line: finite(record.line_value),
      odds_american: finite(record.odds_american),
      model_probability: finite(record.model_probability),
      market_probability: finite(record.market_probability),
      edge: finite(record.edge),
      expected_value: finite(record.expected_value),
      confidence: finite(record.confidence),
      play_grade: boundedNullable(record.play_grade),
      best_angle: record.best_angle,
      no_bet: record.no_bet,
      held: record.held,
      locked_at: boundedNullable(record.locked_at),
      published_at: boundedNullable(record.published_at),
      model_version: boundedNullable(record.model_version),
    },
  };
}

function capturePublicationCorrection(
  prediction: MlbFullGameCapturePrediction,
  record: PredictionRecordRow,
  market: "moneyline" | "total",
): Record<string, unknown> {
  const snapshot = object(record.snapshot_json) ?? {};
  const pipeline = object(snapshot.decision_pipeline) ?? {};
  const scoreSide = scoreDerivedSide(prediction, market, record.line_value);
  const modelSide = market === "moneyline" ? prediction.predicted_ml_winner : prediction.predicted_ou_side;
  return {
    model_side: boundedNullable(modelSide),
    score_derived_side: scoreSide,
    published_side: boundedNullable(record.side),
    published_side_changed_from_model: modelSide !== null && record.side !== null && modelSide !== record.side,
    published_side_matches_score: scoreSide === null || record.side === null ? null : scoreSide === record.side,
    decision_release_id: boundedNullable(string(pipeline.release_id)),
    original_side: boundedNullable(string(pipeline.original_side)),
    inversion_triggered: pipeline.inversion_triggered === true,
    pick_calibration_applied: pipeline.pick_calibration_applied === true,
    market_aware_correction_applied: pipeline.market_aware_correction_applied === true,
    raw_side_champion_applied: pipeline.raw_side_champion_applied === true,
    raw_side_champion_rule_id: boundedNullable(string(pipeline.raw_side_champion_rule_id)),
    board_action: boundedNullable(string(pipeline.board_action)),
    correction_rule_ids: [
      string(object(snapshot.ml_flip)?.rule_id),
      string(object(snapshot.pick_calibration)?.rule_id),
      string(object(snapshot.market_aware_side_correction)?.rule_id),
      string(object(snapshot.market_aware_total_correction)?.rule_id),
      string(object(snapshot.total_mid_edge_flip)?.rule_id),
      string(object(snapshot.total_mean_flip)?.rule_id),
    ].filter((value): value is string => value !== null).map(bounded),
  };
}

function captureSplits(rows: ReadonlyArray<MlbFullGameCaptureSplitRow>, market: string) {
  const matched = rows
    .filter((row) => row.market_type === market)
    .map((row) => ({
      selection_key: boundedNullable(row.selection_key),
      side: boundedNullable(row.selection_key?.split(":").pop() ?? null),
      provider: boundedNullable(row.provider),
      source_book: boundedNullable(row.source_book),
      source_type: boundedNullable(row.source_type),
      bets_pct: finite(row.bets_pct),
      money_pct: finite(row.money_pct),
      source_observed_at: boundedNullable(row.source_observed_at),
      fetched_at: boundedNullable(row.fetched_at),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { rows: matched.slice(0, MAX_SPLIT_ROWS), omitted: Math.max(0, matched.length - MAX_SPLIT_ROWS) };
}

function captureSignals(rows: ReadonlyArray<MlbFullGameCaptureSignalRow>, market: string) {
  const matched = rows
    .filter((row) => row.market_type === market)
    .map((row) => ({
      side: bounded(row.side),
      public_money_pct: finite(row.public_money_pct),
      public_betting_pct: finite(row.public_betting_pct),
      has_steam_move: row.has_steam_move,
      has_reverse_line_movement: row.has_reverse_line_movement,
      rlm_direction: boundedNullable(row.rlm_direction),
      signal_strength: boundedNullable(row.signal_strength),
      computed_at: boundedNullable(row.computed_at),
      pinnacle_fair_probability: finite(row.pinnacle_fair_probability),
      is_plus_ev: row.is_plus_ev,
      ev_pct: finite(row.ev_pct),
      steam_detected_at: boundedNullable(row.steam_detected_at),
      steam_books_count: finite(row.steam_books_count),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { rows: matched.slice(0, MAX_SIGNAL_ROWS), omitted: Math.max(0, matched.length - MAX_SIGNAL_ROWS) };
}

function pairSort(a: Record<string, unknown>, b: Record<string, unknown>, evaluatedBook: string | null): number {
  const bookA = String(a.normalized_sportsbook ?? "");
  const bookB = String(b.normalized_sportsbook ?? "");
  const evaluatedA = evaluatedBook !== null && bookA === evaluatedBook ? 0 : 1;
  const evaluatedB = evaluatedBook !== null && bookB === evaluatedBook ? 0 : 1;
  if (evaluatedA !== evaluatedB) return evaluatedA - evaluatedB;
  const rank = (source: unknown) => source === "sharp" ? 0 : source === "retail" ? 1 : 2;
  const sourceRank = rank(a.source_class) - rank(b.source_class);
  if (sourceRank !== 0) return sourceRank;
  const ageA = finite(object(a.current)?.older_side_age_minutes) ?? Number.POSITIVE_INFINITY;
  const ageB = finite(object(b.current)?.older_side_age_minutes) ?? Number.POSITIVE_INFINITY;
  return ageA - ageB || bookA.localeCompare(bookB);
}

function scoreDerivedSide(
  prediction: MlbFullGameCapturePrediction,
  market: "moneyline" | "total",
  line: number | null,
): string | null {
  const home = finite(prediction.predicted_home_score);
  const away = finite(prediction.predicted_away_score);
  if (home === null || away === null) return null;
  if (market === "moneyline") return home >= away ? "home" : "away";
  if (line === null) return null;
  const total = home + away;
  return total === line ? null : total > line ? "over" : "under";
}

function compactModelVersions(value: Record<string, unknown> | null): Record<string, unknown> | null {
  if (value === null) return null;
  const output: Record<string, unknown> = {};
  for (const key of [
    "schema_version", "projection_core", "moneyline_probability_head",
    "total_probability_head", "coherent_market_price_map",
    "decision_release_id", "rule_bundle_version", "calibration_version",
  ]) {
    const item = value[key];
    if (typeof item === "string") output[key] = bounded(item);
    else if (typeof item === "number" || typeof item === "boolean") output[key] = item;
  }
  return output;
}

function compactObject(value: unknown): Record<string, unknown> | null {
  const record = object(value);
  if (record === null) return null;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record).sort(([a], [b]) => a.localeCompare(b))) {
    if (typeof item === "string") output[bounded(key)] = bounded(item);
    else if (typeof item === "number" && Number.isFinite(item)) output[bounded(key)] = item;
    else if (typeof item === "boolean" || item === null) output[bounded(key)] = item;
  }
  return output;
}

function sourceClass(book: string): "sharp" | "retail" | "other_named" {
  if (SHARP_BOOKS.has(book)) return "sharp";
  if (RETAIL_BOOKS.has(book)) return "retail";
  return "other_named";
}

function normalizeBook(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, MAX_STRING);
}

function noVig(positiveOdds: number, negativeOdds: number): number | null {
  const positive = implied(positiveOdds);
  const negative = implied(negativeOdds);
  if (positive === null || negative === null) return null;
  const total = positive + negative;
  return total <= 0 ? null : positive / total;
}

function withStablePayloadBytes<T extends Record<string, unknown>>(
  value: T,
): T & { payload_bytes: number } {
  let payloadBytes = 0;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const next = byteLength({ ...value, payload_bytes: payloadBytes });
    if (next === payloadBytes) return { ...value, payload_bytes: next };
    payloadBytes = next;
  }
  const result = { ...value, payload_bytes: payloadBytes };
  result.payload_bytes = byteLength(result);
  return result;
}

function implied(odds: number): number | null {
  if (!Number.isFinite(odds) || odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function bounded(value: string): string {
  return value.slice(0, MAX_STRING);
}

function boundedNullable(value: string | null | undefined): string | null {
  return value === null || value === undefined ? null : bounded(value);
}
