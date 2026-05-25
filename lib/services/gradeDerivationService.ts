/**
 * gradeDerivationService — synthesize V2.1's 7-category final grade for each
 * prediction in a slate.
 *
 * The grade is the user-facing verdict. It blends Layer 1 (model edge),
 * Layer 3 (market signal — already populated by marketSignalDerivationService),
 * and the pick kind (game vs prop, which sets the edge threshold per V2.1 6.2)
 * into one of seven labels:
 *
 *   best_signal     🔥  Both layers strong + meets best-signal edge threshold
 *   sharp_confirmed ✅  Market confirms model, edge present but below best
 *   market_led      ⚡  Market signal present, no model edge
 *   model_only      📊  Model edge present, market neutral
 *   market_watch    👀  Neither layer convincing
 *   public_smoke    💨  Market sees public chase, no Pinnacle EV
 *   sharp_conflict  ⚠️  Market resistance against model pick
 *
 * Alongside the grade we record a `signal_type` attribution (5 values) so
 * tracking can pivot W/L by signal source without re-deriving from layers.
 *
 * SOURCE OF MODEL EDGE
 *   • Props: prop_predictions.edge_pct (computed by the prop model).
 *   • Games: NO explicit edge column on game_predictions. Pinnacle EV
 *     from sharp_signals.ev_pct serves as the per-market edge proxy.
 *     Looked up per-pick by (game_id, market_type, side) — see V2.1.1
 *     refactor note below.
 *
 * V2.1.1 PER-PICK REFACTOR (Phase 6.3.5b)
 *   Pre-6.3.5b derived a single grade per game_predictions row via ML →
 *   OU → NRFI primary-pick precedence. The refactor:
 *
 *     • For each game_predictions row, derive grade + signal_type
 *       INDEPENDENTLY for each of the 3 markets (ml / ou / nrfi) where
 *       the row has a non-null predicted_<market>_* column. Reads the
 *       per-pick market_signal columns (ml_market_signal, ou_market_signal,
 *       nrfi_market_signal) — populated upstream by
 *       marketSignalDerivationService in the same cron cycle. Markets
 *       with no model pick stay NULL on their per-pick grade columns.
 *     • Writes the 6 per-pick columns added by schema-migration-v13.sql:
 *       ml_grade / ml_signal_type / ou_grade / ou_signal_type /
 *       nrfi_grade / nrfi_signal_type.
 *     • DUAL-WRITE: also populates the legacy `grade` + `signal_type`
 *       columns from the precedence-1 per-pick value (first non-null in
 *       ML → OU → NRFI order). Preserves existing UI behavior bit-for-
 *       bit during the 6.3.5b → 6.3.5f transition; legacy columns are
 *       dropped in a future V14 cleanup commit.
 *     • prop_predictions UNCHANGED — props are per-pick by table shape.
 *
 * BEST-SIGNAL MONITOR (V2.1 6.2 + 6.3.5b pick-count refactor)
 *   After writing a slate, if best_signal share of total derived PICKS
 *   exceeds GRADE_THRESHOLDS.BEST_SIGNAL_SLATE_MONITOR_PCT, we emit a
 *   console.warn. Counts picks across all derivations (ml + ou + nrfi +
 *   props), not games — a stricter bar now that the denominator grew
 *   ~3× post-refactor. No throw; cron keeps running.
 */

import { supabase } from "../db/supabase";
import {
  GRADE_THRESHOLDS,
  SHARP_SIGNAL_THRESHOLDS,
} from "../config/constants";
import type { Sport } from "../types/domain/Sport";
import type { Side } from "../types/domain/Lines";
import type { Grade, MarketSignal, SignalType } from "../types/domain/Grade";

// ─── Public types ─────────────────────────────────────────────────────────

export type GradeKind = "game" | "prop";

export type GradeInput = {
  kind: GradeKind;
  /**
   * Model edge as a percentage. For props this is prop_predictions.edge_pct
   * (model probability vs fair). For games this is the per-market Pinnacle
   * EV from sharp_signals.ev_pct. NULL when the layer doesn't apply.
   */
  modelEdgePct: number | null;
  /**
   * Layer 3 market read, already classified by marketSignalDerivationService.
   * NULL when derivation hasn't run yet — defensive default falls to
   * market_watch (the "neither convincing" verdict).
   */
  marketSignal: MarketSignal | null;
};

export type GradeOutput = {
  grade: Grade;
  signal_type: SignalType;
};

// ─── Pure derivation ──────────────────────────────────────────────────────

function bestSignalThreshold(kind: GradeKind): number {
  return kind === "game"
    ? GRADE_THRESHOLDS.BEST_SIGNAL_GAME_EDGE
    : GRADE_THRESHOLDS.BEST_SIGNAL_PROP_EDGE;
}

function minEdgeThreshold(kind: GradeKind): number {
  return kind === "game"
    ? GRADE_THRESHOLDS.MIN_GAME_EDGE
    : GRADE_THRESHOLDS.MIN_PROP_EDGE;
}

/**
 * Classify ONE pick into a final grade + signal_type attribution. Pure
 * function — no I/O. Single-pass decision tree, priority by branch order.
 */
export function deriveGrade(input: GradeInput): GradeOutput {
  const { kind, modelEdgePct, marketSignal } = input;
  const hasModelEdge =
    modelEdgePct !== null && modelEdgePct >= minEdgeThreshold(kind);
  const bestThreshold = bestSignalThreshold(kind);

  // Defensive fallback for NULL marketSignal — grade engine ran before
  // marketSignalDerivationService had a chance, or signal was never derived.
  if (marketSignal === null) {
    return { grade: "market_watch", signal_type: "balanced" };
  }

  switch (marketSignal) {
    case "steam_alert":
    case "market_confirmed": {
      if (hasModelEdge && (modelEdgePct as number) >= bestThreshold) {
        return { grade: "best_signal", signal_type: "balanced" };
      }
      if (hasModelEdge) {
        return { grade: "sharp_confirmed", signal_type: "balanced" };
      }
      // Market-only conviction — no model edge to confirm.
      return { grade: "market_led", signal_type: "market_only" };
    }

    case "market_resistance": {
      // Sharps fading our pick — caution flag regardless of model edge.
      return {
        grade: "sharp_conflict",
        signal_type: hasModelEdge ? "balanced" : "market_only",
      };
    }

    case "public_smoke": {
      return { grade: "public_smoke", signal_type: "market_only" };
    }

    case "market_neutral": {
      if (hasModelEdge) {
        return { grade: "model_only", signal_type: "model_only" };
      }
      return { grade: "market_watch", signal_type: "balanced" };
    }

    default: {
      // Type-system safety net — should be unreachable given the union.
      return { grade: "market_watch", signal_type: "balanced" };
    }
  }
}

// ─── Batch derivation over a slate ────────────────────────────────────────

type GamePredRow = {
  id: number;
  game_id: number | null;
  predicted_ml_winner: "home" | "away" | null;
  predicted_ou_side: "over" | "under" | null;
  predicted_nrfi: boolean | null;
  /**
   * V13 per-pick market_signal columns — populated upstream by
   * marketSignalDerivationService in the same cron cycle. gradeDerivation
   * reads these directly (NOT the legacy market_signal column) so each
   * market's grade derives against its own market read.
   */
  ml_market_signal: MarketSignal | null;
  ou_market_signal: MarketSignal | null;
  nrfi_market_signal: MarketSignal | null;
};

type PropPredRow = {
  id: number;
  game_id: number | null;
  prop_market: string;
  edge_pct: number | null;
  market_signal: MarketSignal | null;
};

type SharpSignalEvRow = {
  game_id: number;
  market_type: string;
  side: string;
  ev_pct: number | null;
};

/** The three game markets that get per-pick derivation. */
type GameMarketKey = "ml" | "ou" | "nrfi";
const GAME_MARKET_KEYS: readonly GameMarketKey[] = ["ml", "ou", "nrfi"];

/**
 * For a game_predictions row, project each per-market pick info needed for
 * grade derivation (the side to look up ev_pct for, plus the per-pick
 * market_signal already on the row). Returns null for markets where the
 * model didn't pick — those stay NULL across all per-pick columns.
 */
function picksFromRow(row: GamePredRow): Record<
  GameMarketKey,
  { market: string; side: Side; marketSignal: MarketSignal | null } | null
> {
  return {
    ml:
      row.predicted_ml_winner !== null
        ? {
            market: "moneyline",
            side: row.predicted_ml_winner,
            marketSignal: row.ml_market_signal,
          }
        : null,
    ou:
      row.predicted_ou_side !== null
        ? {
            market: "total",
            side: row.predicted_ou_side,
            marketSignal: row.ou_market_signal,
          }
        : null,
    nrfi:
      row.predicted_nrfi !== null
        ? {
            market: "first_inning_total",
            side: row.predicted_nrfi ? "under" : "over",
            marketSignal: row.nrfi_market_signal,
          }
        : null,
  };
}

function evKey(game_id: number, market: string, side: Side): string {
  return `${game_id}:${market}:${side}`;
}

export type SlateGrades = {
  /**
   * Per-pick grades indexed by game_prediction.id. Rows where the model
   * didn't pick a side for a market are ABSENT from that market's inner Map.
   */
  games: {
    ml: Map<number, GradeOutput>;
    ou: Map<number, GradeOutput>;
    nrfi: Map<number, GradeOutput>;
  };
  /**
   * Legacy headline derived via ML → OU → NRFI precedence: first non-null
   * per-pick GradeOutput wins. Both fields (grade + signal_type) come from
   * the same precedence-winning pick. Preserved for dual-write so existing
   * UI keeps reading game_predictions.grade + signal_type unchanged.
   */
  gamesLegacy: Map<number, GradeOutput>;
  props: Map<number, GradeOutput>;
};

/**
 * Read the slate's predictions + sharp signals from the DB and derive
 * grade + signal_type for every (row × market) combination that has a
 * model pick. Pure-ish (only DB reads); does not write.
 */
export async function deriveGradesForSlate(
  sport: Sport,
  slate_date: string
): Promise<SlateGrades> {
  const { data: games } = await supabase
    .from("games")
    .select("id")
    .eq("sport", sport)
    .eq("slate_date", slate_date);
  const gameIds = ((games ?? []) as Array<{ id: number }>).map((g) => g.id);
  const empty: SlateGrades = {
    games: { ml: new Map(), ou: new Map(), nrfi: new Map() },
    gamesLegacy: new Map(),
    props: new Map(),
  };
  if (gameIds.length === 0) return empty;

  // Reads PER-PICK ml_market_signal / ou_market_signal / nrfi_market_signal
  // columns. The legacy market_signal column is NOT read — gradeDerivation
  // pairs each market's grade with its OWN market read.
  const { data: gamePredsRaw } = await supabase
    .from("game_predictions")
    .select(
      "id, game_id, predicted_ml_winner, predicted_ou_side, predicted_nrfi, ml_market_signal, ou_market_signal, nrfi_market_signal"
    )
    .in("game_id", gameIds);
  const gamePreds = (gamePredsRaw ?? []) as GamePredRow[];

  const { data: propsRaw } = await supabase
    .from("prop_predictions")
    .select("id, game_id, prop_market, edge_pct, market_signal")
    .in("game_id", gameIds);
  const propPreds = (propsRaw ?? []) as PropPredRow[];

  // Index sharp_signals.ev_pct by (game_id, market, side) — per-market
  // edge lookup. Each market gets its own EV (ml → moneyline, ou → total,
  // nrfi → first_inning_total).
  const { data: signalsRaw } = await supabase
    .from("sharp_signals")
    .select("game_id, market_type, side, ev_pct")
    .in("game_id", gameIds);
  const evByKey = new Map<string, number | null>();
  for (const row of (signalsRaw ?? []) as SharpSignalEvRow[]) {
    evByKey.set(evKey(row.game_id, row.market_type, row.side as Side), row.ev_pct);
  }

  const result: SlateGrades = {
    games: { ml: new Map(), ou: new Map(), nrfi: new Map() },
    gamesLegacy: new Map(),
    props: new Map(),
  };

  for (const row of gamePreds) {
    if (row.game_id === null) continue;
    const picks = picksFromRow(row);

    for (const key of GAME_MARKET_KEYS) {
      const pick = picks[key];
      if (pick === null) continue;
      const modelEdgePct =
        evByKey.get(evKey(row.game_id, pick.market, pick.side)) ?? null;
      result.games[key].set(
        row.id,
        deriveGrade({
          kind: "game",
          modelEdgePct,
          marketSignal: pick.marketSignal,
        })
      );
    }

    // Legacy headline = precedence-1 winner's GradeOutput (both fields
    // come from the same pick to stay internally consistent).
    const legacy =
      result.games.ml.get(row.id) ??
      result.games.ou.get(row.id) ??
      result.games.nrfi.get(row.id);
    if (legacy !== undefined) result.gamesLegacy.set(row.id, legacy);
  }

  for (const row of propPreds) {
    if (row.game_id === null) continue;
    result.props.set(
      row.id,
      deriveGrade({
        kind: "prop",
        modelEdgePct: row.edge_pct,
        marketSignal: row.market_signal,
      })
    );
  }

  return result;
}

// ─── Best-signal slate monitor ────────────────────────────────────────────

export type BestSignalMonitor = {
  /**
   * Total derived picks across ml + ou + nrfi (skipping NULLs where the
   * model had no pick) plus props. Replaces the pre-6.3.5b "total games"
   * count; denominator grew ~3× post-refactor.
   */
  totalDerivedPicks: number;
  /** Count of picks classified as best_signal across all 4 buckets. */
  bestSignalPicks: number;
  bestSignalPct: number;
  exceededThreshold: boolean;
  /**
   * Per-market sub-counts on games (props are folded into totals but not
   * split here — props are already per-pick by shape and don't have a
   * three-way market breakdown like games do).
   */
  perMarket: {
    ml: { derived: number; bestSignals: number };
    ou: { derived: number; bestSignals: number };
    nrfi: { derived: number; bestSignals: number };
  };
};

/**
 * Inspect a graded slate for the V2.1 6.2 "Best Signal" sanity check.
 * Emits a console.warn when best_signal share of derived PICKS exceeds
 * GRADE_THRESHOLDS.BEST_SIGNAL_SLATE_MONITOR_PCT. Caller decides whether
 * to escalate further (V1: log only).
 */
export function monitorBestSignalShare(
  grades: SlateGrades,
  context: string
): BestSignalMonitor {
  function countMarket(map: Map<number, GradeOutput>): {
    derived: number;
    bestSignals: number;
  } {
    let bestSignals = 0;
    for (const out of map.values()) {
      if (out.grade === "best_signal") bestSignals++;
    }
    return { derived: map.size, bestSignals };
  }

  const ml = countMarket(grades.games.ml);
  const ou = countMarket(grades.games.ou);
  const nrfi = countMarket(grades.games.nrfi);
  const props = countMarket(grades.props);

  const totalDerivedPicks = ml.derived + ou.derived + nrfi.derived + props.derived;
  const bestSignalPicks =
    ml.bestSignals + ou.bestSignals + nrfi.bestSignals + props.bestSignals;
  const bestSignalPct =
    totalDerivedPicks === 0 ? 0 : (bestSignalPicks / totalDerivedPicks) * 100;
  const exceededThreshold =
    bestSignalPct > GRADE_THRESHOLDS.BEST_SIGNAL_SLATE_MONITOR_PCT;

  if (exceededThreshold) {
    console.warn(
      `[gradeDerivationService] Best Signal: ${bestSignalPicks}/${totalDerivedPicks} picks (${bestSignalPct.toFixed(
        1
      )}%) on ${context} — review thresholds if persistent. ` +
        `perMarket: ml=${ml.bestSignals}/${ml.derived} · ou=${ou.bestSignals}/${ou.derived} · nrfi=${nrfi.bestSignals}/${nrfi.derived}`
    );
  }

  return {
    totalDerivedPicks,
    bestSignalPicks,
    bestSignalPct,
    exceededThreshold,
    perMarket: { ml, ou, nrfi },
  };
}

// ─── DB write — per-row dual-write ────────────────────────────────────────

export type UpdateGradesResult = {
  /** Distinct game_predictions rows updated. Each row may carry up to 8
   * column writes (3 per-pick grade + 3 per-pick signal_type + legacy
   * grade + legacy signal_type). */
  gamePredictionsUpdated: number;
  propPredictionsUpdated: number;
  monitor: BestSignalMonitor;
  /** Per-market write counts for cron-status visibility. */
  perMarket: {
    ml: { derived: number; written: number };
    ou: { derived: number; written: number };
    nrfi: { derived: number; written: number };
  };
};

/**
 * Apply derived grades + signal_types to game_predictions + prop_predictions.
 * game_predictions uses per-row UPDATEs (one statement per row touching
 * up to 8 columns) for clarity + transactional consistency across the
 * per-pick triplets + legacy columns. prop_predictions retains bucketed
 * UPDATEs grouped by (grade, signal_type).
 */
export async function updateGradesForSlate(
  sport: Sport,
  slate_date: string
): Promise<UpdateGradesResult> {
  const slate = await deriveGradesForSlate(sport, slate_date);
  const monitor = monitorBestSignalShare(slate, `${sport}/${slate_date}`);

  const perMarket = {
    ml: { derived: slate.games.ml.size, written: 0 },
    ou: { derived: slate.games.ou.size, written: 0 },
    nrfi: { derived: slate.games.nrfi.size, written: 0 },
  };

  // Build the universe of game_prediction.ids that received ANY derivation
  // (legacy or per-pick). Rows in this set get one UPDATE setting all 8
  // columns; absent rows stay NULL everywhere.
  const allIds = new Set<number>([
    ...slate.gamesLegacy.keys(),
    ...slate.games.ml.keys(),
    ...slate.games.ou.keys(),
    ...slate.games.nrfi.keys(),
  ]);

  let gamesUpdated = 0;
  for (const id of allIds) {
    const ml = slate.games.ml.get(id) ?? null;
    const ou = slate.games.ou.get(id) ?? null;
    const nrfi = slate.games.nrfi.get(id) ?? null;
    const legacy = slate.gamesLegacy.get(id) ?? null;

    const { error } = await supabase
      .from("game_predictions")
      .update({
        ml_grade: ml?.grade ?? null,
        ml_signal_type: ml?.signal_type ?? null,
        ou_grade: ou?.grade ?? null,
        ou_signal_type: ou?.signal_type ?? null,
        nrfi_grade: nrfi?.grade ?? null,
        nrfi_signal_type: nrfi?.signal_type ?? null,
        grade: legacy?.grade ?? null,
        signal_type: legacy?.signal_type ?? null,
      })
      .eq("id", id);
    if (error) {
      throw new Error(
        `gradeDerivationService: game_predictions update failed for id=${id}: ${error.message}`
      );
    }
    gamesUpdated++;
    if (ml !== null) perMarket.ml.written++;
    if (ou !== null) perMarket.ou.written++;
    if (nrfi !== null) perMarket.nrfi.written++;
  }

  // Props — bucket by (grade, signal_type) tuple as before.
  type Bucket = { grade: Grade; signal_type: SignalType; ids: number[] };
  const propBuckets = new Map<string, Bucket>();
  for (const [id, out] of slate.props.entries()) {
    const key = `${out.grade}::${out.signal_type}`;
    const existing = propBuckets.get(key);
    if (existing) {
      existing.ids.push(id);
    } else {
      propBuckets.set(key, {
        grade: out.grade,
        signal_type: out.signal_type,
        ids: [id],
      });
    }
  }

  let propsUpdated = 0;
  for (const bucket of propBuckets.values()) {
    const { error } = await supabase
      .from("prop_predictions")
      .update({ grade: bucket.grade, signal_type: bucket.signal_type })
      .in("id", bucket.ids);
    if (error) {
      throw new Error(
        `gradeDerivationService: prop_predictions update failed for ${bucket.grade}/${bucket.signal_type}: ${error.message}`
      );
    }
    propsUpdated += bucket.ids.length;
  }

  return {
    gamePredictionsUpdated: gamesUpdated,
    propPredictionsUpdated: propsUpdated,
    monitor,
    perMarket,
  };
}

// Re-export the constants the service uses so tests can read thresholds
// from one place instead of importing config separately.
export { GRADE_THRESHOLDS, SHARP_SIGNAL_THRESHOLDS };
