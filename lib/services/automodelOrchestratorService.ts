/**
 * Phase 4B — automodel orchestration for operator dry-run scripts.
 *
 * Six entry points that wrap the Phase 3C `generatePredictionsForSlate`
 * write path (always with writeToDb=false in 4B) plus Phase 4A pure
 * helpers (movement thresholds, T-60 selection, stale detection). Each
 * returns a structured report the operator scripts format as text or
 * JSON.
 *
 * PHASE 4B DISCIPLINE:
 *   • Strict dry-run / read-only. No DB writes anywhere.
 *   • Never imports `ingestScoresModel`, `updateMarketSignalsForSlate`,
 *     `updateGradesForSlate`, or `slatePublishService` — write
 *     pathways are out of scope.
 *   • Only calls `generatePredictionsForSlate` with `{ writeToDb: false }`.
 *   • No env flag required to run.
 *   • Does NOT touch sport_specific or persist anything (snapshot_stash
 *     is Phase 4C scope per Daniel's decision §15 #2).
 *
 * Sharp-grade comparison limitation: deriving CURRENT row's grade
 * direction requires `updateGradesForSlate` (a DB write). Phase 4B
 * always passes `currentDerived: { sharp_grade_direction: null }` to
 * `buildStaleReport`. Stale rule 10 (support↔conflict flip) is dormant
 * until Phase 4C populates a fresh prior+current pair.
 *
 * Snapshot stash limitation: Phase 4B reads prior auto rows but the
 * stash fields needed by stale rules 3, 4, 6, 7, 8, 9 (was_scratched,
 * top-3 injury counts, Pinnacle fair-prob/EV, public splits) are NOT
 * persisted yet. Phase 4A's sparse-prior path handles missing fields
 * cleanly — those rules silently don't fire in 4B. Reports flag this.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sport } from "../types/domain/Sport";
import { supabase } from "../db/supabase";
import {
  generatePredictionsForSlate,
  type AutoModelDbWriteOutcome,
} from "./automodelService";
import type {
  AutoModelOutput,
  AutoModelSportSpecific,
  CurrentDerivedForStale,
  CurrentSnapshotForStale,
  EnrichmentHook,
  GameSnapshot,
  ModelStage,
  MovementDeltas,
  PriorPredictionForStale,
  StaleReport,
} from "../automodel/types";
import { buildStaleReport } from "../automodel/staleDetection";
import {
  T60_WINDOW_MINUTES_DEFAULT,
  selectGamesInT60Window,
  type T60Candidate,
  type T60SkipReason,
} from "../automodel/t60Selection";
import { deriveRowSharpGradeDirection } from "../automodel/sharpGradeDirection";
import { buildSnapshotStash } from "../automodel/snapshotStash";

// ─────────────────────────────────────────────────────────────
// Internal row shapes
// ─────────────────────────────────────────────────────────────

type SlateGame = {
  id: number;
  external_id: number;
  game_date: string | null;
  slate_status: string | null;
};

type PriorAutoRow = {
  game_id: number;
  game_external_id: number;
  prediction_source: string;
  source_type: string;
  is_override: boolean;
  model_version: string | null;
  computed_at: string | null;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  predicted_total: number | null;
  predicted_ml_winner: string | null;
  ml_confidence: number | null;
  ml_grade: string | null;
  ml_signal_type: string | null;
  ml_market_signal: string | null;
  predicted_ou_side: string | null;
  ou_confidence: number | null;
  ou_grade: string | null;
  ou_signal_type: string | null;
  ou_market_signal: string | null;
  predicted_nrfi: boolean | null;
  nrfi_confidence: number | null;
  nrfi_grade: string | null;
  nrfi_signal_type: string | null;
  nrfi_market_signal: string | null;
  sport_specific: Record<string, unknown> | null;
};

type AnyPredictionRow = PriorAutoRow & {
  // Same shape; left as alias for clarity in status report path
};

// ─────────────────────────────────────────────────────────────
// Public report types
// ─────────────────────────────────────────────────────────────

export type ConfidenceBand = {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
};

export type ProposedPrediction = {
  game_external_id: number;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  predicted_total: number | null;
  predicted_ml_winner: "home" | "away" | null;
  ml_confidence: number | null;
  predicted_ou_side: "over" | "under" | null;
  ou_confidence: number | null;
  predicted_nrfi: boolean | null;
  nrfi_confidence: number | null;
  held: boolean;
  hold_picks: Array<"ml" | "ou" | "nrfi">;
  hold_reason: string | null;
  stage: ModelStage;
};

export type PriorPredictionSummary = {
  prediction_source: string;
  is_override: boolean;
  computed_at: string | null;
  prior_stage: ModelStage | null;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  predicted_total: number | null;
  predicted_ml_winner: string | null;
  ml_confidence: number | null;
  predicted_ou_side: string | null;
  ou_confidence: number | null;
  predicted_nrfi: boolean | null;
  nrfi_confidence: number | null;
  prior_held: boolean;
  prior_hold_picks: Array<"ml" | "ou" | "nrfi">;
};

export type MorningCardReport = {
  sport: Sport;
  slate_date: string;
  stage: "morning_draft";
  generated_at: string;
  game_count: number;
  predictions_count: number;
  held_count: number;
  pick_null_counts: { ml: number; ou: number; nrfi: number };
  ai_sanity_actions: { approve: number; warn: number; hold: number; rerun: number };
  total_deterministic_corrections: number;
  errors: Array<{ game_external_id: number | null; error: string }>;
  missing_starter_count: number;
  missing_market_line_count: number;
  confidence_bands: { ml: ConfidenceBand; ou: ConfidenceBand; nrfi: ConfidenceBand };
  stale_summary: {
    games_with_prior: number;
    games_stale_vs_prior: number;
    top_reasons: Array<{ reason: string; count: number }>;
    notes: string[];
  };
  predictions: Array<ProposedPrediction & { stale_report: StaleReport | null }>;
  duration_ms: number;
};

export type T60RefreshPredictionEntry = {
  game_external_id: number;
  start_time: string;
  prior_present: boolean;
  prior_stage: ModelStage | null;
  prior_summary: PriorPredictionSummary | null;
  proposed: ProposedPrediction;
  stale_report: StaleReport | null;
};

export type T60RefreshReport = {
  sport: Sport;
  slate_date: string;
  stage: "t60_locked";
  now: string;
  window_minutes: number;
  include_started: boolean;
  generated_at: string;
  candidates_count: number;
  selected_count: number;
  skipped_window: Array<{ game_external_id: number; reason: T60SkipReason }>;
  skipped_override: number[];
  predictions: T60RefreshPredictionEntry[];
  stale_count: number;
  movement_summary: {
    games_with_listed_total_move: number;
    games_with_ml_fair_prob_move: number;
    games_with_ev_flip: number;
    games_with_public_betting_move: number;
    games_with_public_money_move: number;
    games_with_starter_change: number;
    games_with_provider_data_missing: number;
  };
  notes: string[];
  duration_ms: number;
};

export type SingleGameRerunReport = {
  sport: Sport;
  slate_date: string;
  stage: ModelStage;
  game_external_id: number;
  found: boolean;
  manual_override_present: boolean;
  prior: PriorPredictionSummary | null;
  proposed: ProposedPrediction | null;
  stale_report: StaleReport | null;
  notes: string[];
  duration_ms: number;
};

export type HeldRerunResolution =
  | "resolved"
  | "still_held"
  | "partially_resolved"
  | "newly_held";

export type HeldOnlyRerunPredictionEntry = {
  game_external_id: number;
  prior_held: boolean;
  prior_hold_picks: Array<"ml" | "ou" | "nrfi">;
  proposed: ProposedPrediction;
  proposed_held: boolean;
  proposed_hold_picks: Array<"ml" | "ou" | "nrfi">;
  resolution: HeldRerunResolution;
  stale_report: StaleReport | null;
};

export type HeldOnlyRerunReport = {
  sport: Sport;
  slate_date: string;
  stage: ModelStage;
  include_partial_holds: boolean;
  generated_at: string;
  candidates_count: number;
  skipped_override: number[];
  selected_count: number;
  predictions: HeldOnlyRerunPredictionEntry[];
  resolution_summary: {
    resolved: number;
    still_held: number;
    partially_resolved: number;
    newly_held: number;
  };
  notes: string[];
  duration_ms: number;
};

export type SlateStatusReport = {
  sport: Sport;
  slate_date: string;
  generated_at: string;
  games_count: number;
  predictions_count: {
    total: number;
    pure_auto: number;
    manual_override: number;
    pure_manual: number;
    other: number;
  };
  stage_counts: {
    morning_draft: number;
    t60_locked: number;
    other: number;
  };
  hold_counts: {
    fully_held: number;
    partial_held: number;
    no_hold: number;
  };
  stale_count: number;
  derivation_status: {
    games_with_any_grade: number;
    games_with_all_3_grades: number;
    games_with_any_market_signal: number;
  };
  slate_status_summary: {
    draft: number;
    published: number;
    final: number;
    hidden: number;
    null_or_other: number;
  };
};

export type SlateDeltasGameEntry = {
  game_external_id: number;
  stage: ModelStage | null;
  previous_stage: ModelStage | null;
  previous_run_at: string | null;
  is_stale: boolean;
  stale_reason: string | null;
  movement_deltas: MovementDeltas | null;
};

export type SlateDeltasReport = {
  sport: Sport;
  slate_date: string;
  only_stale: boolean;
  generated_at: string;
  games: SlateDeltasGameEntry[];
  totals: {
    games_total: number;
    stale_games: number;
    games_with_starter_change: number;
    games_with_line_move: number;
    games_with_ml_fair_prob_move: number;
    games_with_ev_flip: number;
    games_with_public_split_move: number;
    games_with_sharp_grade_flip: number;
  };
  notes: string[];
};

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

/**
 * Read all games on the slate. Returned in input/db order.
 */
async function fetchGamesForSlate(
  client: SupabaseClient,
  sport: Sport,
  slate_date: string
): Promise<SlateGame[]> {
  const { data, error } = await client
    .from("games")
    .select(
      "id, external_id, game_date, slate_status"
    )
    .eq("sport", sport)
    .eq("slate_date", slate_date);
  if (error) {
    throw new Error(`fetchGamesForSlate failed: ${error.message}`);
  }
  return (data ?? []) as SlateGame[];
}

/**
 * Read auto predictions for the slate (excluding manual overrides).
 * Indexed by game_external_id for O(1) lookup. Caller passes the
 * slate games list to bridge game_id ↔ external_id.
 */
async function fetchPriorAutoRows(
  client: SupabaseClient,
  sport: Sport,
  slate_date: string
): Promise<Map<number, PriorAutoRow>> {
  const games = await fetchGamesForSlate(client, sport, slate_date);
  const idToExternal = new Map(games.map((g) => [g.id, g.external_id]));
  const gameIds = games.map((g) => g.id);
  if (gameIds.length === 0) return new Map();

  const { data, error } = await client
    .from("game_predictions")
    .select(
      "game_id, prediction_source, source_type, is_override, model_version, computed_at, predicted_home_score, predicted_away_score, predicted_total, predicted_ml_winner, ml_confidence, ml_grade, ml_signal_type, ml_market_signal, predicted_ou_side, ou_confidence, ou_grade, ou_signal_type, ou_market_signal, predicted_nrfi, nrfi_confidence, nrfi_grade, nrfi_signal_type, nrfi_market_signal, sport_specific"
    )
    .in("game_id", gameIds)
    .eq("prediction_source", "auto_v1_mlb_rules")
    .eq("is_override", false);
  if (error) {
    throw new Error(`fetchPriorAutoRows failed: ${error.message}`);
  }

  const map = new Map<number, PriorAutoRow>();
  for (const raw of (data ?? []) as Omit<PriorAutoRow, "game_external_id">[]) {
    const ext = idToExternal.get(raw.game_id);
    if (ext === undefined) continue;
    map.set(ext, { ...raw, game_external_id: ext } as PriorAutoRow);
  }
  return map;
}

/**
 * Read ALL prediction rows for the slate (status report path).
 * Returns the raw rows plus an external_id map for joining.
 */
async function fetchAllPredictionRows(
  client: SupabaseClient,
  sport: Sport,
  slate_date: string
): Promise<{ games: SlateGame[]; rows: AnyPredictionRow[] }> {
  const games = await fetchGamesForSlate(client, sport, slate_date);
  if (games.length === 0) return { games, rows: [] };

  const idToExternal = new Map(games.map((g) => [g.id, g.external_id]));
  const gameIds = games.map((g) => g.id);

  const { data, error } = await client
    .from("game_predictions")
    .select(
      "game_id, prediction_source, source_type, is_override, model_version, computed_at, predicted_home_score, predicted_away_score, predicted_total, predicted_ml_winner, ml_confidence, ml_grade, ml_signal_type, ml_market_signal, predicted_ou_side, ou_confidence, ou_grade, ou_signal_type, ou_market_signal, predicted_nrfi, nrfi_confidence, nrfi_grade, nrfi_signal_type, nrfi_market_signal, sport_specific"
    )
    .in("game_id", gameIds);
  if (error) {
    throw new Error(`fetchAllPredictionRows failed: ${error.message}`);
  }

  const rows: AnyPredictionRow[] = [];
  for (const raw of (data ?? []) as Omit<AnyPredictionRow, "game_external_id">[]) {
    const ext = idToExternal.get(raw.game_id);
    if (ext === undefined) continue;
    rows.push({ ...raw, game_external_id: ext } as AnyPredictionRow);
  }
  return { games, rows };
}

/** Manual-override game_external_ids for the slate (skip set for T-60). */
async function listManualOverrideExternalIds(
  client: SupabaseClient,
  sport: Sport,
  slate_date: string
): Promise<Set<number>> {
  const games = await fetchGamesForSlate(client, sport, slate_date);
  const idToExternal = new Map(games.map((g) => [g.id, g.external_id]));
  const gameIds = games.map((g) => g.id);
  if (gameIds.length === 0) return new Set();

  const { data, error } = await client
    .from("game_predictions")
    .select("game_id")
    .in("game_id", gameIds)
    .eq("is_override", true);
  if (error) {
    throw new Error(`listManualOverrideExternalIds failed: ${error.message}`);
  }
  const set = new Set<number>();
  for (const row of (data ?? []) as { game_id: number }[]) {
    const ext = idToExternal.get(row.game_id);
    if (ext !== undefined) set.add(ext);
  }
  return set;
}

/**
 * Map AutoModelOutput → ProposedPrediction (the per-game projection
 * used in all reports).
 */
function projectToProposedPrediction(out: AutoModelOutput): ProposedPrediction {
  return {
    game_external_id: out.game_external_id,
    predicted_home_score: out.predicted_home_score,
    predicted_away_score: out.predicted_away_score,
    predicted_total: out.predicted_total,
    predicted_ml_winner: out.predicted_ml_winner,
    ml_confidence: out.ml_confidence,
    predicted_ou_side: out.predicted_ou_side,
    ou_confidence: out.ou_confidence,
    predicted_nrfi: out.predicted_nrfi,
    nrfi_confidence: out.nrfi_confidence,
    held: out.sport_specific.held,
    hold_picks: out.sport_specific.hold_picks,
    hold_reason: out.sport_specific.hold_reason,
    stage: out.sport_specific.stage,
  };
}

/**
 * Map a PriorAutoRow → PriorPredictionSummary (UI-facing prior view).
 */
function projectToPriorSummary(row: PriorAutoRow): PriorPredictionSummary {
  const ss = row.sport_specific ?? {};
  const stage = (ss as { stage?: unknown }).stage;
  const prior_stage =
    stage === "morning_draft" || stage === "t60_locked" ? stage : null;
  const hold_picks = Array.isArray((ss as { hold_picks?: unknown }).hold_picks)
    ? ((ss as { hold_picks: unknown[] }).hold_picks.filter(
        (x) => x === "ml" || x === "ou" || x === "nrfi"
      ) as Array<"ml" | "ou" | "nrfi">)
    : [];
  const prior_held = (ss as { held?: unknown }).held === true;
  return {
    prediction_source: row.prediction_source,
    is_override: row.is_override,
    computed_at: row.computed_at,
    prior_stage,
    predicted_home_score: row.predicted_home_score,
    predicted_away_score: row.predicted_away_score,
    predicted_total: row.predicted_total,
    predicted_ml_winner: row.predicted_ml_winner,
    ml_confidence: row.ml_confidence,
    predicted_ou_side: row.predicted_ou_side,
    ou_confidence: row.ou_confidence,
    predicted_nrfi: row.predicted_nrfi,
    nrfi_confidence: row.nrfi_confidence,
    prior_held,
    prior_hold_picks: hold_picks,
  };
}

/**
 * Build a PriorPredictionForStale (Phase 4A helper input) from a
 * PriorAutoRow. Most fields are read from sport_specific. Fields the
 * Phase 4C snapshot stash WILL carry (was_scratched, Pinnacle metrics,
 * public splits, top-3 injury counts) are intentionally left undefined
 * here — Phase 4B doesn't have them in DB. Phase 4A's sparse-prior
 * handling skips the corresponding rules cleanly.
 */
function projectToPriorPredictionForStale(
  row: PriorAutoRow
): PriorPredictionForStale {
  const ss = (row.sport_specific ?? {}) as Record<string, unknown>;
  const auto_factors = (ss.auto_factors ?? null) as {
    home_starter_id?: number | null;
    away_starter_id?: number | null;
  } | null;
  const listed = ss.listed_line;
  const starter_confirmed = ss.starter_confirmed;
  const lineup_confirmed = ss.lineup_confirmed;
  return {
    starter_confirmed:
      typeof starter_confirmed === "boolean" ? starter_confirmed : null,
    lineup_confirmed:
      typeof lineup_confirmed === "boolean" ? lineup_confirmed : null,
    home_starter_id: auto_factors?.home_starter_id ?? null,
    away_starter_id: auto_factors?.away_starter_id ?? null,
    listed_total: typeof listed === "number" ? listed : null,
    // sharp_grade_direction derived from the row's per-pick grades
    sharp_grade_direction: deriveRowSharpGradeDirection({
      ml_grade: row.ml_grade,
      ou_grade: row.ou_grade,
      nrfi_grade: row.nrfi_grade,
    }),
    // The fields below are Phase 4C snapshot-stash territory. Left
    // undefined; Phase 4A's sparse-prior handling skips corresponding
    // stale rules without false positives.
  };
}

/**
 * Build a CurrentSnapshotForStale projection from the model's output
 * sport_specific (auto_factors carries starter IDs) plus the prediction's
 * own listed_line. We do NOT have access to the full GameSnapshot from
 * generatePredictionsForSlate's external surface, so we reconstruct what
 * we can from the AutoModelOutput. Fields we can't recover (Pinnacle
 * metrics, public splits, scratched flags from snapshot's starters,
 * top-3 injury counts) are set to placeholder values that don't trigger
 * stale rules incorrectly.
 *
 * Trade-off: Phase 4B stale comparison is intentionally limited. Rules
 * that need the live GameSnapshot (3, 4, 6, 7, 8, 9, 12) won't fire in
 * 4B. Phase 4C will pass a richer CurrentSnapshotForStale because the
 * orchestrator there will own snapshot + model invocation in sequence.
 */
function projectToCurrentSnapshotForStale(
  out: AutoModelOutput
): CurrentSnapshotForStale {
  const af = out.sport_specific.auto_factors;
  return {
    home_starter_external_id: af.home_starter_id,
    away_starter_external_id: af.away_starter_id,
    home_starter_is_scratched: false, // unknown in 4B
    away_starter_is_scratched: false, // unknown in 4B
    starter_confirmed: out.sport_specific.starter_confirmed,
    lineup_confirmed: out.sport_specific.lineup_confirmed,
    listed_total: out.sport_specific.listed_line,
    pinnacle_ml_fair_prob_home: null, // unknown in 4B
    pinnacle_ml_ev_pct: null, // unknown in 4B
    public_betting_pct_home: null,
    public_money_pct_home: null,
    public_betting_pct_over: null,
    public_money_pct_over: null,
    home_top3_hitters_injured_count: 0, // unknown in 4B (would falsely fire if >0)
    away_top3_hitters_injured_count: 0,
    provider_data_present: true, // assume present in 4B (we can't tell from output alone)
  };
}

/** Currently-deferred derived state (sharp grade direction is null until 4C). */
const CURRENT_DERIVED_DEFAULT: CurrentDerivedForStale = {
  sharp_grade_direction: null,
};

/**
 * Confidence band aggregation across a prediction array.
 */
function buildConfidenceBands(predictions: AutoModelOutput[]): {
  ml: ConfidenceBand;
  ou: ConfidenceBand;
  nrfi: ConfidenceBand;
} {
  function band(values: Array<number | null>): ConfidenceBand {
    const numeric = values.filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v)
    );
    if (numeric.length === 0) {
      return { count: 0, min: null, max: null, mean: null };
    }
    const min = Math.min(...numeric);
    const max = Math.max(...numeric);
    const mean = numeric.reduce((s, v) => s + v, 0) / numeric.length;
    return {
      count: numeric.length,
      min,
      max,
      mean: Math.round(mean * 10) / 10,
    };
  }
  return {
    ml: band(predictions.map((p) => p.ml_confidence)),
    ou: band(predictions.map((p) => p.ou_confidence)),
    nrfi: band(predictions.map((p) => p.nrfi_confidence)),
  };
}

/** Count of games that show signs of missing-starter holds. */
function countMissingStarter(predictions: AutoModelOutput[]): number {
  return predictions.filter((p) => {
    const reason = p.sport_specific.hold_reason ?? "";
    return (
      reason.includes("starter") ||
      reason === "missing_or_scratched_starter"
    );
  }).length;
}

/** Count of games missing a market line (listed_line null). */
function countMissingMarketLine(predictions: AutoModelOutput[]): number {
  return predictions.filter((p) => p.sport_specific.listed_line === null)
    .length;
}

/** Tally the top stale reasons across a slate. */
function topStaleReasons(
  reports: Array<StaleReport | null>,
  topN: number = 5
): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of reports) {
    if (r === null || !r.is_stale) continue;
    for (const reason of r.reasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

const PHASE_4B_NOTES = [
  "Sharp grade direction comparison deferred — Phase 4C populates current direction after grade derivation runs.",
  "Snapshot stash (was_scratched, Pinnacle metrics, public splits, top-3 injuries) not yet persisted — Phase 4C will populate. Rules 3, 4, 6, 7, 8, 9 silently skip in 4B reports.",
];

// ─────────────────────────────────────────────────────────────
// Entry point 1 — Morning Card dry-run
// ─────────────────────────────────────────────────────────────

export async function runMorningCardDryRun(
  sport: Sport,
  slate_date: string
): Promise<MorningCardReport> {
  const t0 = Date.now();
  const generated_at = new Date().toISOString();

  const dryRunResult = await generatePredictionsForSlate(
    sport,
    slate_date,
    "morning_draft",
    { writeToDb: false }
  );

  const priors = await fetchPriorAutoRows(supabase, sport, slate_date);

  const predictionsWithStale = dryRunResult.predictions.map((p) => {
    const prior = priors.get(p.game_external_id);
    let stale_report: StaleReport | null = null;
    if (prior) {
      stale_report = buildStaleReport(
        projectToPriorPredictionForStale(prior),
        projectToCurrentSnapshotForStale(p),
        CURRENT_DERIVED_DEFAULT
      );
    }
    return { ...projectToProposedPrediction(p), stale_report };
  });

  const stale_summary = {
    games_with_prior: predictionsWithStale.filter((p) => p.stale_report !== null)
      .length,
    games_stale_vs_prior: predictionsWithStale.filter(
      (p) => p.stale_report?.is_stale === true
    ).length,
    top_reasons: topStaleReasons(predictionsWithStale.map((p) => p.stale_report)),
    notes: PHASE_4B_NOTES,
  };

  return {
    sport,
    slate_date,
    stage: "morning_draft",
    generated_at,
    game_count: dryRunResult.game_count,
    predictions_count: dryRunResult.predictions.length,
    held_count: dryRunResult.held_count,
    pick_null_counts: dryRunResult.pick_null_counts,
    ai_sanity_actions: dryRunResult.ai_sanity_actions,
    total_deterministic_corrections: dryRunResult.total_deterministic_corrections,
    errors: dryRunResult.errors,
    missing_starter_count: countMissingStarter(dryRunResult.predictions),
    missing_market_line_count: countMissingMarketLine(dryRunResult.predictions),
    confidence_bands: buildConfidenceBands(dryRunResult.predictions),
    stale_summary,
    predictions: predictionsWithStale,
    duration_ms: Date.now() - t0,
  };
}

// ─────────────────────────────────────────────────────────────
// Entry point 2 — T-60 refresh dry-run
// ─────────────────────────────────────────────────────────────

export async function runT60RefreshDryRun(
  sport: Sport,
  slate_date: string,
  now: Date,
  window_minutes: number = T60_WINDOW_MINUTES_DEFAULT,
  include_started: boolean = false
): Promise<T60RefreshReport> {
  const t0 = Date.now();
  const generated_at = new Date().toISOString();

  // 1. Read games + select T-60 window via Phase 4A helper
  const games = await fetchGamesForSlate(supabase, sport, slate_date);
  // Phase 4A's T60Candidate uses `start_time` as its field name. The DB
  // column is `games.game_date` (TIMESTAMPTZ) — map the column value into
  // the helper's contract.
  const candidates: T60Candidate[] = games.map((g) => ({
    game_external_id: g.external_id,
    start_time: g.game_date,
  }));
  const selection = selectGamesInT60Window(
    candidates,
    now,
    window_minutes,
    include_started
  );

  // 2. Skip manual overrides
  const overrideSet = await listManualOverrideExternalIds(
    supabase,
    sport,
    slate_date
  );
  const skipped_override: number[] = [];
  const selectedAfterOverride = selection.selected.filter((s) => {
    if (overrideSet.has(s.game_external_id)) {
      skipped_override.push(s.game_external_id);
      return false;
    }
    return true;
  });
  const selectedIds = new Set(
    selectedAfterOverride.map((s) => s.game_external_id)
  );

  // 3. Fetch prior auto rows
  const priors = await fetchPriorAutoRows(supabase, sport, slate_date);

  // 4. Run model for the whole slate (Phase 4B accepts slate-level read
  //    cost — gameExternalIdsFilter is Phase 4C optimization). Filter
  //    output to selected games.
  const dryRunResult = await generatePredictionsForSlate(
    sport,
    slate_date,
    "t60_locked",
    { writeToDb: false }
  );

  const startTimeByExt = new Map(
    candidates
      .filter((c): c is { game_external_id: number; start_time: string } =>
        typeof c.start_time === "string"
      )
      .map((c) => [c.game_external_id, c.start_time])
  );

  const predictions: T60RefreshPredictionEntry[] = [];
  for (const out of dryRunResult.predictions) {
    if (!selectedIds.has(out.game_external_id)) continue;
    const prior = priors.get(out.game_external_id);
    const stale = prior
      ? buildStaleReport(
          projectToPriorPredictionForStale(prior),
          projectToCurrentSnapshotForStale(out),
          CURRENT_DERIVED_DEFAULT
        )
      : null;
    predictions.push({
      game_external_id: out.game_external_id,
      start_time: startTimeByExt.get(out.game_external_id) ?? "",
      prior_present: prior !== undefined,
      prior_stage: prior ? projectToPriorSummary(prior).prior_stage : null,
      prior_summary: prior ? projectToPriorSummary(prior) : null,
      proposed: projectToProposedPrediction(out),
      stale_report: stale,
    });
  }

  // 5. Movement summary
  const movement_summary = {
    games_with_listed_total_move: 0,
    games_with_ml_fair_prob_move: 0,
    games_with_ev_flip: 0,
    games_with_public_betting_move: 0,
    games_with_public_money_move: 0,
    games_with_starter_change: 0,
    games_with_provider_data_missing: 0,
  };
  for (const entry of predictions) {
    const d = entry.stale_report?.movement_deltas;
    if (!d) continue;
    if (
      d.total_line_delta !== null &&
      Math.abs(d.total_line_delta) >= 0.0001
    )
      movement_summary.games_with_listed_total_move++;
    if (
      d.ml_fair_prob_delta !== null &&
      Math.abs(d.ml_fair_prob_delta) >= 0.0001
    )
      movement_summary.games_with_ml_fair_prob_move++;
    if (d.ev_delta !== null && Math.abs(d.ev_delta) >= 0.0001)
      movement_summary.games_with_ev_flip++;
    if (
      d.public_betting_delta !== null &&
      Math.abs(d.public_betting_delta) >= 0.0001
    )
      movement_summary.games_with_public_betting_move++;
    if (
      d.public_money_delta !== null &&
      Math.abs(d.public_money_delta) >= 0.0001
    )
      movement_summary.games_with_public_money_move++;
    if (d.starter_changed) movement_summary.games_with_starter_change++;
    if (d.provider_data_missing)
      movement_summary.games_with_provider_data_missing++;
  }

  const stale_count = predictions.filter(
    (p) => p.stale_report?.is_stale === true
  ).length;

  return {
    sport,
    slate_date,
    stage: "t60_locked",
    now: now.toISOString(),
    window_minutes,
    include_started,
    generated_at,
    candidates_count: candidates.length,
    selected_count: selectedAfterOverride.length,
    skipped_window: selection.skipped,
    skipped_override,
    predictions,
    stale_count,
    movement_summary,
    notes: PHASE_4B_NOTES,
    duration_ms: Date.now() - t0,
  };
}

// ─────────────────────────────────────────────────────────────
// Entry point 3 — Single-game rerun dry-run
// ─────────────────────────────────────────────────────────────

export async function runSingleGameRerunDryRun(
  sport: Sport,
  slate_date: string,
  game_external_id: number,
  stage: ModelStage
): Promise<SingleGameRerunReport> {
  const t0 = Date.now();
  const notes: string[] = [...PHASE_4B_NOTES];

  const games = await fetchGamesForSlate(supabase, sport, slate_date);
  const target = games.find((g) => g.external_id === game_external_id);
  if (!target) {
    return {
      sport,
      slate_date,
      stage,
      game_external_id,
      found: false,
      manual_override_present: false,
      prior: null,
      proposed: null,
      stale_report: null,
      notes: [
        `Game ${game_external_id} not found in ${sport} slate ${slate_date}.`,
      ],
      duration_ms: Date.now() - t0,
    };
  }

  const overrideSet = await listManualOverrideExternalIds(
    supabase,
    sport,
    slate_date
  );
  const manual_override_present = overrideSet.has(game_external_id);
  if (manual_override_present) {
    notes.push(
      `Manual override exists for game ${game_external_id}. Proceeding with dry-run only — Phase 4B cannot write, so no override risk.`
    );
  }

  const priors = await fetchPriorAutoRows(supabase, sport, slate_date);
  const prior = priors.get(game_external_id) ?? null;

  const dryRunResult = await generatePredictionsForSlate(
    sport,
    slate_date,
    stage,
    { writeToDb: false }
  );
  const out = dryRunResult.predictions.find(
    (p) => p.game_external_id === game_external_id
  );
  if (!out) {
    return {
      sport,
      slate_date,
      stage,
      game_external_id,
      found: true,
      manual_override_present,
      prior: prior ? projectToPriorSummary(prior) : null,
      proposed: null,
      stale_report: null,
      notes: [
        ...notes,
        `Game ${game_external_id} found in slate but model did not produce a prediction (likely a snapshot-builder skip — check errors).`,
        ...dryRunResult.errors
          .filter((e) => e.game_external_id === game_external_id)
          .map((e) => `model error: ${e.error}`),
      ],
      duration_ms: Date.now() - t0,
    };
  }

  const stale = prior
    ? buildStaleReport(
        projectToPriorPredictionForStale(prior),
        projectToCurrentSnapshotForStale(out),
        CURRENT_DERIVED_DEFAULT
      )
    : null;

  return {
    sport,
    slate_date,
    stage,
    game_external_id,
    found: true,
    manual_override_present,
    prior: prior ? projectToPriorSummary(prior) : null,
    proposed: projectToProposedPrediction(out),
    stale_report: stale,
    notes,
    duration_ms: Date.now() - t0,
  };
}

// ─────────────────────────────────────────────────────────────
// Entry point 4 — Held-only rerun dry-run
// ─────────────────────────────────────────────────────────────

export async function runHeldOnlyRerunDryRun(
  sport: Sport,
  slate_date: string,
  stage: ModelStage,
  include_partial_holds: boolean
): Promise<HeldOnlyRerunReport> {
  const t0 = Date.now();
  const generated_at = new Date().toISOString();

  const priors = await fetchPriorAutoRows(supabase, sport, slate_date);
  const overrideSet = await listManualOverrideExternalIds(
    supabase,
    sport,
    slate_date
  );

  // Filter prior rows to candidates: held=true OR (include_partial_holds AND
  // hold_picks non-empty).
  const candidateExtIds: number[] = [];
  const skipped_override: number[] = [];
  for (const [ext, row] of priors.entries()) {
    const ss = (row.sport_specific ?? {}) as Record<string, unknown>;
    const held = (ss.held as boolean | undefined) === true;
    const holdPicks = Array.isArray(ss.hold_picks)
      ? (ss.hold_picks as unknown[])
      : [];
    const isHeld = held || (include_partial_holds && holdPicks.length > 0);
    if (!isHeld) continue;
    if (overrideSet.has(ext)) {
      skipped_override.push(ext);
      continue;
    }
    candidateExtIds.push(ext);
  }
  const selectedSet = new Set(candidateExtIds);

  // Run slate; filter to candidates.
  const dryRunResult = await generatePredictionsForSlate(
    sport,
    slate_date,
    stage,
    { writeToDb: false }
  );

  const predictions: HeldOnlyRerunPredictionEntry[] = [];
  const resolution_summary = {
    resolved: 0,
    still_held: 0,
    partially_resolved: 0,
    newly_held: 0,
  };
  for (const out of dryRunResult.predictions) {
    if (!selectedSet.has(out.game_external_id)) continue;
    const prior = priors.get(out.game_external_id);
    const priorSummary = prior ? projectToPriorSummary(prior) : null;
    const prior_held = priorSummary?.prior_held ?? false;
    const prior_hold_picks = priorSummary?.prior_hold_picks ?? [];
    const proposed_held = out.sport_specific.held;
    const proposed_hold_picks = out.sport_specific.hold_picks;

    let resolution: HeldRerunResolution;
    const priorHadAnyHold = prior_held || prior_hold_picks.length > 0;
    const proposedHasAnyHold =
      proposed_held || proposed_hold_picks.length > 0;
    if (!priorHadAnyHold && proposedHasAnyHold) {
      resolution = "newly_held";
    } else if (priorHadAnyHold && !proposedHasAnyHold) {
      resolution = "resolved";
    } else if (priorHadAnyHold && proposedHasAnyHold) {
      // Did SOME holds clear? Compare set membership.
      const someResolved = prior_hold_picks.some(
        (h) => !proposed_hold_picks.includes(h)
      );
      resolution = someResolved ? "partially_resolved" : "still_held";
    } else {
      resolution = "resolved"; // Both empty — degenerate but accept.
    }
    resolution_summary[resolution]++;

    const stale = prior
      ? buildStaleReport(
          projectToPriorPredictionForStale(prior),
          projectToCurrentSnapshotForStale(out),
          CURRENT_DERIVED_DEFAULT
        )
      : null;

    predictions.push({
      game_external_id: out.game_external_id,
      prior_held,
      prior_hold_picks,
      proposed: projectToProposedPrediction(out),
      proposed_held,
      proposed_hold_picks,
      resolution,
      stale_report: stale,
    });
  }

  return {
    sport,
    slate_date,
    stage,
    include_partial_holds,
    generated_at,
    candidates_count: candidateExtIds.length + skipped_override.length,
    skipped_override,
    selected_count: predictions.length,
    predictions,
    resolution_summary,
    notes: PHASE_4B_NOTES,
    duration_ms: Date.now() - t0,
  };
}

// ─────────────────────────────────────────────────────────────
// Entry point 5 — Slate status (READ-ONLY, no model call)
// ─────────────────────────────────────────────────────────────

export async function getSlateStatusReport(
  sport: Sport,
  slate_date: string
): Promise<SlateStatusReport> {
  const generated_at = new Date().toISOString();
  const { games, rows } = await fetchAllPredictionRows(
    supabase,
    sport,
    slate_date
  );

  const predictions_count = {
    total: rows.length,
    pure_auto: 0,
    manual_override: 0,
    pure_manual: 0,
    other: 0,
  };
  const stage_counts = { morning_draft: 0, t60_locked: 0, other: 0 };
  const hold_counts = { fully_held: 0, partial_held: 0, no_hold: 0 };
  let stale_count = 0;
  const derivation_status = {
    games_with_any_grade: 0,
    games_with_all_3_grades: 0,
    games_with_any_market_signal: 0,
  };

  for (const row of rows) {
    // Categorize provenance
    if (
      row.prediction_source === "auto_v1_mlb_rules" &&
      row.is_override === false
    ) {
      predictions_count.pure_auto++;
    } else if (
      row.prediction_source === "manual_daniel" &&
      row.is_override === true
    ) {
      predictions_count.manual_override++;
    } else if (
      row.prediction_source === "manual_daniel" &&
      row.is_override === false
    ) {
      predictions_count.pure_manual++;
    } else {
      predictions_count.other++;
    }

    // Stage / hold / stale stats only for pure-auto rows
    if (
      row.prediction_source === "auto_v1_mlb_rules" &&
      row.is_override === false
    ) {
      const ss = (row.sport_specific ?? {}) as Record<string, unknown>;
      const stage = ss.stage;
      if (stage === "morning_draft") stage_counts.morning_draft++;
      else if (stage === "t60_locked") stage_counts.t60_locked++;
      else stage_counts.other++;

      const holdPicks = Array.isArray(ss.hold_picks)
        ? (ss.hold_picks as unknown[])
        : [];
      const held = ss.held === true;
      if (held) hold_counts.fully_held++;
      else if (holdPicks.length > 0) hold_counts.partial_held++;
      else hold_counts.no_hold++;

      if (ss.stale === true) stale_count++;
    }

    // Derivation status across ALL rows
    const grades = [row.ml_grade, row.ou_grade, row.nrfi_grade];
    const presentGrades = grades.filter((g) => g !== null);
    if (presentGrades.length >= 1) derivation_status.games_with_any_grade++;
    if (presentGrades.length === 3) derivation_status.games_with_all_3_grades++;
    const signals = [
      row.ml_market_signal,
      row.ou_market_signal,
      row.nrfi_market_signal,
    ];
    if (signals.some((s) => s !== null))
      derivation_status.games_with_any_market_signal++;
  }

  const slate_status_summary = {
    draft: 0,
    published: 0,
    final: 0,
    hidden: 0,
    null_or_other: 0,
  };
  for (const g of games) {
    switch (g.slate_status) {
      case "draft":
        slate_status_summary.draft++;
        break;
      case "published":
        slate_status_summary.published++;
        break;
      case "final":
        slate_status_summary.final++;
        break;
      case "hidden":
        slate_status_summary.hidden++;
        break;
      default:
        slate_status_summary.null_or_other++;
    }
  }

  return {
    sport,
    slate_date,
    generated_at,
    games_count: games.length,
    predictions_count,
    stage_counts,
    hold_counts,
    stale_count,
    derivation_status,
    slate_status_summary,
  };
}

// ─────────────────────────────────────────────────────────────
// Entry point 6 — Slate deltas (READ-ONLY, no model call)
// ─────────────────────────────────────────────────────────────

export async function getSlateDeltasReport(
  sport: Sport,
  slate_date: string,
  only_stale: boolean
): Promise<SlateDeltasReport> {
  const generated_at = new Date().toISOString();
  const priors = await fetchPriorAutoRows(supabase, sport, slate_date);

  const games: SlateDeltasGameEntry[] = [];
  const totals = {
    games_total: 0,
    stale_games: 0,
    games_with_starter_change: 0,
    games_with_line_move: 0,
    games_with_ml_fair_prob_move: 0,
    games_with_ev_flip: 0,
    games_with_public_split_move: 0,
    games_with_sharp_grade_flip: 0,
  };

  const notes: string[] = [
    "Phase 4B reads stale flags and movement_deltas from existing sport_specific JSONB. Pre-Phase-4C rows have no movement_deltas — those entries report movement_deltas=null and is_stale=false.",
  ];

  for (const [ext, row] of priors.entries()) {
    totals.games_total++;
    const ss = (row.sport_specific ?? {}) as Record<string, unknown>;
    const stage = (ss.stage as ModelStage | undefined) ?? null;
    const previous_stage =
      (ss.previous_stage as ModelStage | undefined) ?? null;
    const previous_run_at =
      typeof ss.previous_run_at === "string"
        ? (ss.previous_run_at as string)
        : null;
    const is_stale = ss.stale === true;
    const stale_reason =
      typeof ss.stale_reason === "string" ? (ss.stale_reason as string) : null;
    const movement_deltas =
      ss.movement_deltas && typeof ss.movement_deltas === "object"
        ? (ss.movement_deltas as MovementDeltas)
        : null;

    if (only_stale && !is_stale) continue;

    if (is_stale) totals.stale_games++;
    if (movement_deltas) {
      if (movement_deltas.starter_changed) totals.games_with_starter_change++;
      if (
        movement_deltas.total_line_delta !== null &&
        Math.abs(movement_deltas.total_line_delta) >= 0.0001
      )
        totals.games_with_line_move++;
      if (
        movement_deltas.ml_fair_prob_delta !== null &&
        Math.abs(movement_deltas.ml_fair_prob_delta) >= 0.0001
      )
        totals.games_with_ml_fair_prob_move++;
      if (
        movement_deltas.ev_delta !== null &&
        Math.abs(movement_deltas.ev_delta) >= 0.0001
      )
        totals.games_with_ev_flip++;
      if (
        (movement_deltas.public_betting_delta !== null &&
          Math.abs(movement_deltas.public_betting_delta) >= 0.0001) ||
        (movement_deltas.public_money_delta !== null &&
          Math.abs(movement_deltas.public_money_delta) >= 0.0001)
      )
        totals.games_with_public_split_move++;
      if (movement_deltas.sharp_grade_changed)
        totals.games_with_sharp_grade_flip++;
    }

    games.push({
      game_external_id: ext,
      stage,
      previous_stage,
      previous_run_at,
      is_stale,
      stale_reason,
      movement_deltas,
    });
  }

  // Sort: stale first (true > false), then by absolute total_line_delta desc
  games.sort((a, b) => {
    if (a.is_stale !== b.is_stale) return a.is_stale ? -1 : 1;
    const ad = Math.abs(a.movement_deltas?.total_line_delta ?? 0);
    const bd = Math.abs(b.movement_deltas?.total_line_delta ?? 0);
    return bd - ad;
  });

  return {
    sport,
    slate_date,
    only_stale,
    generated_at,
    games,
    totals,
    notes,
  };
}

// ─────────────────────────────────────────────────────────────
// Phase 4C — operator-triggered guarded writes
// ─────────────────────────────────────────────────────────────
//
// Four write entry points alongside the Phase 4B dry-run entries.
// Phase 4B entry points are UNTOUCHED — they keep calling
// generatePredictionsForSlate({ writeToDb: false }) with no
// enrichment hook. Phase 4C entry points call
// generatePredictionsForSlate({ writeToDb: true, ... }) with a
// gameExternalIdsFilter and an enrichmentHook so each write row
// lands with snapshot_stash + previous_run_at + previous_stage +
// movement_deltas + stale + stale_reason + run_kind populated.
//
// Phase 3C's two-key gate (writeToDb + AUTOMODEL_DB_WRITES_ENABLED)
// is enforced INSIDE generatePredictionsForSlate. Phase 4C scripts
// add a third gate (CLI --write) at the script layer via
// scripts/operator/_cliCommon.validateWriteGate.
//
// Manual override safety:
//   • morning / T-60 / held-only: silent skip via gameExternalIdsFilter
//     (orchestrator pre-filters override game_external_ids out of the
//     filter set).
//   • single-game: HARD BLOCK at the orchestrator (returns blocked=true
//     in the result; the script exits 1 with a clear message).
// No --force flag in 4C.

export type WriteRunKind =
  | "morning"
  | "t60"
  | "manual_rerun"
  | "held_rerun";

/**
 * Phase 4C — richer projection from a live GameSnapshot to
 * CurrentSnapshotForStale. Used by the orchestrator's enrichment hook
 * during write paths. Carries the real `is_scratched` flags, Pinnacle
 * metrics, public splits, and top-3 injury counts — fields the
 * Phase 4B (output-only) projection had to fake as null/0.
 *
 * Phase 4A's stale rules now have rich `current` data on write paths.
 * Combined with the snapshot_stash Phase 4C persists on each write,
 * the NEXT run has rich prior+current data and the full stale
 * detection (rules 3, 4, 6, 7, 8, 9) activates.
 */
function projectToCurrentSnapshotForStaleFromSnapshot(
  snap: GameSnapshot
): CurrentSnapshotForStale {
  const sharp = snap.sharp;
  return {
    home_starter_external_id: snap.home_starter?.player_external_id ?? null,
    away_starter_external_id: snap.away_starter?.player_external_id ?? null,
    home_starter_is_scratched: snap.home_starter?.is_scratched ?? false,
    away_starter_is_scratched: snap.away_starter?.is_scratched ?? false,
    starter_confirmed: snap.data_quality.starter_confirmed,
    lineup_confirmed: snap.data_quality.lineup_confirmed,
    listed_total: snap.market.listed_total,
    pinnacle_ml_fair_prob_home: sharp?.pinnacle_ml_fair_prob_home ?? null,
    pinnacle_ml_ev_pct: sharp?.pinnacle_ml_ev_pct ?? null,
    public_betting_pct_home: sharp?.public_betting_pct_home ?? null,
    public_money_pct_home: sharp?.public_money_pct_home ?? null,
    public_betting_pct_over: sharp?.public_betting_pct_over ?? null,
    public_money_pct_over: sharp?.public_money_pct_over ?? null,
    home_top3_hitters_injured_count:
      snap.active_injuries.home_top3_hitters_injured_count,
    away_top3_hitters_injured_count:
      snap.active_injuries.away_top3_hitters_injured_count,
    // True when EITHER sharp signals OR market lines populated
    // (sparse-providers-as-baseline pattern Phase 4A established).
    provider_data_present: snap.sharp !== null || snap.market.listed_total !== null,
  };
}

/**
 * Phase 4C — build the enrichment hook for write entry points.
 *
 * Closure captures the pre-fetched prior auto rows for the slate so
 * the hook can compute a StaleReport per game without re-querying.
 * Returns a partial sport_specific the hook merges into the
 * prediction — `generatePredictionsForSlate` handles the merge.
 *
 * For games with no prior auto row: stash + run_kind populated;
 * previous_run_at / previous_stage / movement_deltas left null;
 * stale=false, stale_reason=null.
 */
function makeWriteEnrichmentHook(
  priors: Map<number, PriorAutoRow>,
  runKind: WriteRunKind
): EnrichmentHook {
  return (snapshot, output) => {
    const stash = buildSnapshotStash(snapshot);
    const prior = priors.get(output.game_external_id);
    if (!prior) {
      return {
        snapshot_stash: stash,
        run_kind: runKind,
        previous_run_at: null,
        previous_stage: null,
        movement_deltas: null,
        stale: false,
        stale_reason: null,
      } satisfies Partial<AutoModelSportSpecific>;
    }
    const priorStaleInputs = projectToPriorPredictionForStale(prior);
    const currentSnap = projectToCurrentSnapshotForStaleFromSnapshot(snapshot);
    const currentDerived: CurrentDerivedForStale = {
      // Phase 4C: derive prior direction from grade columns; current
      // direction stays null because the CURRENT run's grades won't
      // exist until updateGradesForSlate runs AFTER ingest. Rule 10
      // (sharp grade flip) still fires on the NEXT comparison —
      // bootstrap delay of 1 run, same as documented in planning §9.
      sharp_grade_direction: null,
    };
    void priorStaleInputs; // captured by buildStaleReport below
    const staleReport = buildStaleReport(
      priorStaleInputs,
      currentSnap,
      currentDerived
    );
    const priorStage =
      (prior.sport_specific as { stage?: unknown } | null)?.stage;
    const previousStage =
      priorStage === "morning_draft" || priorStage === "t60_locked"
        ? priorStage
        : null;
    return {
      snapshot_stash: stash,
      run_kind: runKind,
      previous_run_at: prior.computed_at,
      previous_stage: previousStage,
      movement_deltas: staleReport.movement_deltas,
      stale: staleReport.is_stale,
      stale_reason: staleReport.is_stale
        ? staleReport.reasons.join("; ")
        : null,
    } satisfies Partial<AutoModelSportSpecific>;
  };
}

/**
 * Compute the filter for write paths that needs to exclude manual
 * overrides. Used by morning/T-60/held-only — single-game has its own
 * hard-block path.
 */
function excludeOverrides(
  candidateExternalIds: number[],
  overrideSet: Set<number>
): { included: number[]; skipped: number[] } {
  const included: number[] = [];
  const skipped: number[] = [];
  for (const ext of candidateExternalIds) {
    if (overrideSet.has(ext)) skipped.push(ext);
    else included.push(ext);
  }
  return { included, skipped };
}

// ─── Public write report types ────────────────────────────────────────

export type MorningCardWriteReport = MorningCardReport & {
  db_writes: AutoModelDbWriteOutcome | null;
  skipped_override_ids: number[];
};

export type T60RefreshWriteReport = T60RefreshReport & {
  db_writes: AutoModelDbWriteOutcome | null;
};

export type SingleGameRerunWriteReport = SingleGameRerunReport & {
  db_writes: AutoModelDbWriteOutcome | null;
  blocked: boolean;
  block_reason: string | null;
};

export type HeldOnlyRerunWriteReport = HeldOnlyRerunReport & {
  db_writes: AutoModelDbWriteOutcome | null;
};

// ─── Entry point 1W — Morning Card WRITE ─────────────────────────────

export async function runMorningCardWrite(
  sport: Sport,
  slate_date: string
): Promise<MorningCardWriteReport> {
  const t0 = Date.now();
  const generated_at = new Date().toISOString();

  // Compute filter: all slate games minus manual overrides.
  const games = await fetchGamesForSlate(supabase, sport, slate_date);
  const allExt = games.map((g) => g.external_id);
  const overrideSet = await listManualOverrideExternalIds(
    supabase,
    sport,
    slate_date
  );
  const { included: filterIds, skipped: skipped_override_ids } =
    excludeOverrides(allExt, overrideSet);

  // Pre-fetch priors for enrichment.
  const priors = await fetchPriorAutoRows(supabase, sport, slate_date);
  const enrichmentHook = makeWriteEnrichmentHook(priors, "morning");

  const writeResult = await generatePredictionsForSlate(
    sport,
    slate_date,
    "morning_draft",
    {
      writeToDb: true,
      gameExternalIdsFilter: filterIds,
      enrichmentHook,
    }
  );

  // Build the same report shape as Morning Card dry-run for parity.
  const predictionsWithStale = writeResult.predictions.map((p) => {
    const prior = priors.get(p.game_external_id);
    const stale_report: StaleReport | null = prior
      ? buildStaleReport(
          projectToPriorPredictionForStale(prior),
          // Use the OUTPUT-projection here since this report is built
          // post-run and we don't carry the live snapshots back out of
          // generatePredictionsForSlate. The richer-from-snapshot path
          // already ran inside the enrichment hook and persisted to DB.
          projectToCurrentSnapshotForStale(p),
          CURRENT_DERIVED_DEFAULT
        )
      : null;
    return { ...projectToProposedPrediction(p), stale_report };
  });

  const stale_summary = {
    games_with_prior: predictionsWithStale.filter((p) => p.stale_report !== null)
      .length,
    games_stale_vs_prior: predictionsWithStale.filter(
      (p) => p.stale_report?.is_stale === true
    ).length,
    top_reasons: topStaleReasons(predictionsWithStale.map((p) => p.stale_report)),
    notes: [
      `Wrote ${writeResult.predictions.length} games; skipped ${skipped_override_ids.length} manual override row(s).`,
      "snapshot_stash + run_kind=morning + audit fields persisted via enrichmentHook.",
      "slate_status unchanged — no auto-publish.",
    ],
  };

  return {
    sport,
    slate_date,
    stage: "morning_draft",
    generated_at,
    game_count: writeResult.game_count,
    predictions_count: writeResult.predictions.length,
    held_count: writeResult.held_count,
    pick_null_counts: writeResult.pick_null_counts,
    ai_sanity_actions: writeResult.ai_sanity_actions,
    total_deterministic_corrections: writeResult.total_deterministic_corrections,
    errors: writeResult.errors,
    missing_starter_count: countMissingStarter(writeResult.predictions),
    missing_market_line_count: countMissingMarketLine(writeResult.predictions),
    confidence_bands: buildConfidenceBands(writeResult.predictions),
    stale_summary,
    predictions: predictionsWithStale,
    duration_ms: Date.now() - t0,
    db_writes: writeResult.db_writes,
    skipped_override_ids,
  };
}

// ─── Entry point 2W — T-60 Refresh WRITE ─────────────────────────────

export async function runT60RefreshWrite(
  sport: Sport,
  slate_date: string,
  now: Date,
  window_minutes: number = T60_WINDOW_MINUTES_DEFAULT,
  include_started: boolean = false
): Promise<T60RefreshWriteReport> {
  const t0 = Date.now();
  const generated_at = new Date().toISOString();

  const games = await fetchGamesForSlate(supabase, sport, slate_date);
  const candidates: T60Candidate[] = games.map((g) => ({
    game_external_id: g.external_id,
    start_time: g.game_date,
  }));
  const selection = selectGamesInT60Window(
    candidates,
    now,
    window_minutes,
    include_started
  );

  const overrideSet = await listManualOverrideExternalIds(
    supabase,
    sport,
    slate_date
  );
  const selectedExt = selection.selected.map((s) => s.game_external_id);
  const { included: filterIds, skipped: skipped_override } = excludeOverrides(
    selectedExt,
    overrideSet
  );

  const priors = await fetchPriorAutoRows(supabase, sport, slate_date);
  const enrichmentHook = makeWriteEnrichmentHook(priors, "t60");

  // If nothing to write, skip the service call (no-op).
  let writeResult:
    | Awaited<ReturnType<typeof generatePredictionsForSlate>>
    | null = null;
  if (filterIds.length > 0) {
    writeResult = await generatePredictionsForSlate(
      sport,
      slate_date,
      "t60_locked",
      {
        writeToDb: true,
        gameExternalIdsFilter: filterIds,
        enrichmentHook,
      }
    );
  }

  // Build per-game entries (only for filtered selection).
  const startTimeByExt = new Map(
    candidates
      .filter((c): c is { game_external_id: number; start_time: string } =>
        typeof c.start_time === "string"
      )
      .map((c) => [c.game_external_id, c.start_time])
  );

  const predictions: T60RefreshPredictionEntry[] = [];
  if (writeResult) {
    for (const out of writeResult.predictions) {
      const prior = priors.get(out.game_external_id);
      const stale = prior
        ? buildStaleReport(
            projectToPriorPredictionForStale(prior),
            projectToCurrentSnapshotForStale(out),
            CURRENT_DERIVED_DEFAULT
          )
        : null;
      predictions.push({
        game_external_id: out.game_external_id,
        start_time: startTimeByExt.get(out.game_external_id) ?? "",
        prior_present: prior !== undefined,
        prior_stage: prior ? projectToPriorSummary(prior).prior_stage : null,
        prior_summary: prior ? projectToPriorSummary(prior) : null,
        proposed: projectToProposedPrediction(out),
        stale_report: stale,
      });
    }
  }

  const movement_summary = {
    games_with_listed_total_move: 0,
    games_with_ml_fair_prob_move: 0,
    games_with_ev_flip: 0,
    games_with_public_betting_move: 0,
    games_with_public_money_move: 0,
    games_with_starter_change: 0,
    games_with_provider_data_missing: 0,
  };
  for (const entry of predictions) {
    const d = entry.stale_report?.movement_deltas;
    if (!d) continue;
    if (d.total_line_delta !== null && Math.abs(d.total_line_delta) >= 0.0001)
      movement_summary.games_with_listed_total_move++;
    if (
      d.ml_fair_prob_delta !== null &&
      Math.abs(d.ml_fair_prob_delta) >= 0.0001
    )
      movement_summary.games_with_ml_fair_prob_move++;
    if (d.ev_delta !== null && Math.abs(d.ev_delta) >= 0.0001)
      movement_summary.games_with_ev_flip++;
    if (
      d.public_betting_delta !== null &&
      Math.abs(d.public_betting_delta) >= 0.0001
    )
      movement_summary.games_with_public_betting_move++;
    if (
      d.public_money_delta !== null &&
      Math.abs(d.public_money_delta) >= 0.0001
    )
      movement_summary.games_with_public_money_move++;
    if (d.starter_changed) movement_summary.games_with_starter_change++;
    if (d.provider_data_missing)
      movement_summary.games_with_provider_data_missing++;
  }

  const stale_count = predictions.filter(
    (p) => p.stale_report?.is_stale === true
  ).length;

  return {
    sport,
    slate_date,
    stage: "t60_locked",
    now: now.toISOString(),
    window_minutes,
    include_started,
    generated_at,
    candidates_count: candidates.length,
    selected_count: filterIds.length,
    skipped_window: selection.skipped,
    skipped_override,
    predictions,
    stale_count,
    movement_summary,
    notes: [
      `Wrote ${predictions.length} T-60 game(s); skipped ${skipped_override.length} manual override row(s) within window.`,
      "snapshot_stash + run_kind=t60 + audit fields persisted via enrichmentHook.",
      "slate_status unchanged — no auto-publish.",
    ],
    duration_ms: Date.now() - t0,
    db_writes: writeResult?.db_writes ?? null,
  };
}

// ─── Entry point 3W — Single-Game Rerun WRITE (with HARD BLOCK) ──────

export async function runSingleGameRerunWrite(
  sport: Sport,
  slate_date: string,
  game_external_id: number,
  stage: ModelStage
): Promise<SingleGameRerunWriteReport> {
  const t0 = Date.now();

  const games = await fetchGamesForSlate(supabase, sport, slate_date);
  const target = games.find((g) => g.external_id === game_external_id);
  if (!target) {
    return {
      sport,
      slate_date,
      stage,
      game_external_id,
      found: false,
      manual_override_present: false,
      prior: null,
      proposed: null,
      stale_report: null,
      notes: [
        `Game ${game_external_id} not found in ${sport} slate ${slate_date}.`,
      ],
      duration_ms: Date.now() - t0,
      db_writes: null,
      blocked: false,
      block_reason: null,
    };
  }

  const overrideSet = await listManualOverrideExternalIds(
    supabase,
    sport,
    slate_date
  );
  const manual_override_present = overrideSet.has(game_external_id);

  // HARD BLOCK: single-game write refuses to overwrite a manual override.
  // The script handles this by exiting 1 with the block_reason.
  if (manual_override_present) {
    const blockMsg =
      `Game ${game_external_id} has a manual override (is_override=true). ` +
      `Phase 4C single-game write refuses to overwrite operator's manual ` +
      `pick. Delete the manual_daniel row via /admin/scores-model first ` +
      `if you intentionally want auto to replace it. No --force flag in 4C.`;
    return {
      sport,
      slate_date,
      stage,
      game_external_id,
      found: true,
      manual_override_present: true,
      prior: null,
      proposed: null,
      stale_report: null,
      notes: [blockMsg],
      duration_ms: Date.now() - t0,
      db_writes: null,
      blocked: true,
      block_reason: blockMsg,
    };
  }

  const priors = await fetchPriorAutoRows(supabase, sport, slate_date);
  const prior = priors.get(game_external_id) ?? null;
  const enrichmentHook = makeWriteEnrichmentHook(priors, "manual_rerun");

  const writeResult = await generatePredictionsForSlate(sport, slate_date, stage, {
    writeToDb: true,
    gameExternalIdsFilter: [game_external_id],
    enrichmentHook,
  });

  const out = writeResult.predictions.find(
    (p) => p.game_external_id === game_external_id
  );
  if (!out) {
    return {
      sport,
      slate_date,
      stage,
      game_external_id,
      found: true,
      manual_override_present: false,
      prior: prior ? projectToPriorSummary(prior) : null,
      proposed: null,
      stale_report: null,
      notes: [
        `Game ${game_external_id} found in slate but model did not produce a prediction. See errors[].`,
        ...writeResult.errors
          .filter((e) => e.game_external_id === game_external_id)
          .map((e) => `model error: ${e.error}`),
      ],
      duration_ms: Date.now() - t0,
      db_writes: writeResult.db_writes,
      blocked: false,
      block_reason: null,
    };
  }

  const stale = prior
    ? buildStaleReport(
        projectToPriorPredictionForStale(prior),
        projectToCurrentSnapshotForStale(out),
        CURRENT_DERIVED_DEFAULT
      )
    : null;

  return {
    sport,
    slate_date,
    stage,
    game_external_id,
    found: true,
    manual_override_present: false,
    prior: prior ? projectToPriorSummary(prior) : null,
    proposed: projectToProposedPrediction(out),
    stale_report: stale,
    notes: [
      "snapshot_stash + run_kind=manual_rerun + audit fields persisted via enrichmentHook.",
      "slate_status unchanged — no auto-publish.",
    ],
    duration_ms: Date.now() - t0,
    db_writes: writeResult.db_writes,
    blocked: false,
    block_reason: null,
  };
}

// ─── Entry point 4W — Held-Only Rerun WRITE ──────────────────────────

export async function runHeldOnlyRerunWrite(
  sport: Sport,
  slate_date: string,
  stage: ModelStage,
  include_partial_holds: boolean
): Promise<HeldOnlyRerunWriteReport> {
  const t0 = Date.now();
  const generated_at = new Date().toISOString();

  const priors = await fetchPriorAutoRows(supabase, sport, slate_date);
  const overrideSet = await listManualOverrideExternalIds(
    supabase,
    sport,
    slate_date
  );

  const candidateExtIds: number[] = [];
  const skipped_override: number[] = [];
  for (const [ext, row] of priors.entries()) {
    const ss = (row.sport_specific ?? {}) as Record<string, unknown>;
    const held = ss.held === true;
    const holdPicks = Array.isArray(ss.hold_picks)
      ? (ss.hold_picks as unknown[])
      : [];
    const isHeld = held || (include_partial_holds && holdPicks.length > 0);
    if (!isHeld) continue;
    if (overrideSet.has(ext)) {
      skipped_override.push(ext);
      continue;
    }
    candidateExtIds.push(ext);
  }

  const enrichmentHook = makeWriteEnrichmentHook(priors, "held_rerun");

  let writeResult:
    | Awaited<ReturnType<typeof generatePredictionsForSlate>>
    | null = null;
  if (candidateExtIds.length > 0) {
    writeResult = await generatePredictionsForSlate(sport, slate_date, stage, {
      writeToDb: true,
      gameExternalIdsFilter: candidateExtIds,
      enrichmentHook,
    });
  }

  const predictions: HeldOnlyRerunPredictionEntry[] = [];
  const resolution_summary = {
    resolved: 0,
    still_held: 0,
    partially_resolved: 0,
    newly_held: 0,
  };
  if (writeResult) {
    for (const out of writeResult.predictions) {
      const prior = priors.get(out.game_external_id);
      const priorSummary = prior ? projectToPriorSummary(prior) : null;
      const prior_held = priorSummary?.prior_held ?? false;
      const prior_hold_picks = priorSummary?.prior_hold_picks ?? [];
      const proposed_held = out.sport_specific.held;
      const proposed_hold_picks = out.sport_specific.hold_picks;

      let resolution: HeldRerunResolution;
      const priorHadAnyHold = prior_held || prior_hold_picks.length > 0;
      const proposedHasAnyHold =
        proposed_held || proposed_hold_picks.length > 0;
      if (!priorHadAnyHold && proposedHasAnyHold) {
        resolution = "newly_held";
      } else if (priorHadAnyHold && !proposedHasAnyHold) {
        resolution = "resolved";
      } else if (priorHadAnyHold && proposedHasAnyHold) {
        const someResolved = prior_hold_picks.some(
          (h) => !proposed_hold_picks.includes(h)
        );
        resolution = someResolved ? "partially_resolved" : "still_held";
      } else {
        resolution = "resolved";
      }
      resolution_summary[resolution]++;

      const stale = prior
        ? buildStaleReport(
            projectToPriorPredictionForStale(prior),
            projectToCurrentSnapshotForStale(out),
            CURRENT_DERIVED_DEFAULT
          )
        : null;

      predictions.push({
        game_external_id: out.game_external_id,
        prior_held,
        prior_hold_picks,
        proposed: projectToProposedPrediction(out),
        proposed_held,
        proposed_hold_picks,
        resolution,
        stale_report: stale,
      });
    }
  }

  return {
    sport,
    slate_date,
    stage,
    include_partial_holds,
    generated_at,
    candidates_count: candidateExtIds.length + skipped_override.length,
    skipped_override,
    selected_count: predictions.length,
    predictions,
    resolution_summary,
    notes: [
      `Wrote ${predictions.length} held game(s); skipped ${skipped_override.length} manual override row(s).`,
      "snapshot_stash + run_kind=held_rerun + audit fields persisted via enrichmentHook.",
      "slate_status unchanged — no auto-publish.",
    ],
    duration_ms: Date.now() - t0,
    db_writes: writeResult?.db_writes ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
// Phase 4B — exported pure helpers for unit tests
// ─────────────────────────────────────────────────────────────
//
// The orchestrator's projection + tally helpers are pure and worth
// testing in isolation (no Supabase mock needed). Exporting them under
// a namespaced object signals "internal — for tests only, not stable
// public API". The convention matches what is common in TS libraries
// when a few private helpers are useful for verification.
//
// PriorAutoRow is also exported (the test needs to construct one).

export type { PriorAutoRow };

export const __internalForTests = {
  projectToProposedPrediction,
  projectToPriorSummary,
  projectToPriorPredictionForStale,
  projectToCurrentSnapshotForStale,
  buildConfidenceBands,
  countMissingStarter,
  countMissingMarketLine,
  topStaleReasons,
  // Phase 4C additions
  projectToCurrentSnapshotForStaleFromSnapshot,
  makeWriteEnrichmentHook,
  excludeOverrides,
};
