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
 *   • Games: NO explicit edge column on game_predictions. We use the
 *     primary pick's Pinnacle EV from sharp_signals.ev_pct as the proxy.
 *     Same ML→OU→NRFI precedence used by marketSignalDerivationService
 *     in 6.3c — keeps the two services aligned on "which pick is the row's
 *     headline" until per-pick granularity becomes a separate schema decision.
 *
 * BEST-SIGNAL MONITOR (V2.1 6.2)
 *   After writing a slate, if best_signal share of total graded > 25% we
 *   emit a console.warn with the count + percentage. Sanity check — the
 *   bar may have drifted too loose for current data. No throw; cron must
 *   keep running.
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
   * (model probability vs fair). For games this is the primary pick's
   * Pinnacle EV from sharp_signals.ev_pct. NULL when the layer doesn't apply.
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
  market_signal: MarketSignal | null;
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

/**
 * Determine the primary pick for a game_predictions row using the same
 * ML→OU→NRFI precedence marketSignalDerivationService uses. Returns null
 * when no pick exists — those rows are skipped during batch derivation.
 */
function primaryGamePick(
  row: GamePredRow
): { market: string; side: Side } | null {
  if (row.predicted_ml_winner !== null) {
    return { market: "moneyline", side: row.predicted_ml_winner };
  }
  if (row.predicted_ou_side !== null) {
    return { market: "total", side: row.predicted_ou_side };
  }
  if (row.predicted_nrfi !== null) {
    return {
      market: "first_inning_total",
      side: row.predicted_nrfi ? "under" : "over",
    };
  }
  return null;
}

function evKey(game_id: number, market: string, side: Side): string {
  return `${game_id}:${market}:${side}`;
}

export type SlateGrades = {
  games: Map<number, GradeOutput>;
  props: Map<number, GradeOutput>;
};

/**
 * Read the slate's predictions + sharp signals from the DB and derive a
 * grade + signal_type for every pick that has a classifiable side. Pure-ish
 * (only DB reads); does not write.
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
  if (gameIds.length === 0) {
    return { games: new Map(), props: new Map() };
  }

  const { data: gamePredsRaw } = await supabase
    .from("game_predictions")
    .select(
      "id, game_id, predicted_ml_winner, predicted_ou_side, predicted_nrfi, market_signal"
    )
    .in("game_id", gameIds);
  const gamePreds = (gamePredsRaw ?? []) as GamePredRow[];

  const { data: propsRaw } = await supabase
    .from("prop_predictions")
    .select("id, game_id, prop_market, edge_pct, market_signal")
    .in("game_id", gameIds);
  const propPreds = (propsRaw ?? []) as PropPredRow[];

  // Index sharp_signals.ev_pct by (game_id, market, side) so game-pick
  // edge derivation is a single map lookup per row.
  const { data: signalsRaw } = await supabase
    .from("sharp_signals")
    .select("game_id, market_type, side, ev_pct")
    .in("game_id", gameIds);
  const evByKey = new Map<string, number | null>();
  for (const row of (signalsRaw ?? []) as SharpSignalEvRow[]) {
    evByKey.set(evKey(row.game_id, row.market_type, row.side as Side), row.ev_pct);
  }

  const result: SlateGrades = { games: new Map(), props: new Map() };

  for (const row of gamePreds) {
    if (row.game_id === null) continue;
    const pick = primaryGamePick(row);
    if (pick === null) continue; // No model pick — skip; column stays NULL.
    const modelEdgePct =
      evByKey.get(evKey(row.game_id, pick.market, pick.side)) ?? null;
    result.games.set(
      row.id,
      deriveGrade({
        kind: "game",
        modelEdgePct,
        marketSignal: row.market_signal,
      })
    );
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
  total: number;
  bestSignalCount: number;
  bestSignalPct: number;
  exceededThreshold: boolean;
};

/**
 * Inspect a graded slate for the V2.1 6.2 "Best Signal" sanity check. Emits
 * a console.warn when best_signal share exceeds BEST_SIGNAL_SLATE_MONITOR_PCT.
 * Caller decides whether to escalate further (V1: log only).
 *
 * Counted across games + props combined — a slate is a slate.
 */
export function monitorBestSignalShare(
  grades: SlateGrades,
  context: string
): BestSignalMonitor {
  let total = 0;
  let bestSignalCount = 0;
  for (const out of grades.games.values()) {
    total++;
    if (out.grade === "best_signal") bestSignalCount++;
  }
  for (const out of grades.props.values()) {
    total++;
    if (out.grade === "best_signal") bestSignalCount++;
  }
  const bestSignalPct = total === 0 ? 0 : (bestSignalCount / total) * 100;
  const exceededThreshold =
    bestSignalPct > GRADE_THRESHOLDS.BEST_SIGNAL_SLATE_MONITOR_PCT;

  if (exceededThreshold) {
    console.warn(
      `[gradeDerivationService] best_signal share too high (${bestSignalPct.toFixed(
        1
      )}% > ${GRADE_THRESHOLDS.BEST_SIGNAL_SLATE_MONITOR_PCT}%): ` +
        `${bestSignalCount} of ${total} picks classified as best_signal — ` +
        `threshold may have drifted too loose. context=${context}`
    );
  }

  return { total, bestSignalCount, bestSignalPct, exceededThreshold };
}

// ─── DB write — idempotent UPDATE batched by (grade × signal_type) ────────

export async function updateGradesForSlate(
  sport: Sport,
  slate_date: string
): Promise<{
  gamePredictionsUpdated: number;
  propPredictionsUpdated: number;
  monitor: BestSignalMonitor;
}> {
  const slate = await deriveGradesForSlate(sport, slate_date);
  const monitor = monitorBestSignalShare(slate, `${sport}/${slate_date}`);

  // Bucket by (grade, signal_type) pair so we write one UPDATE per distinct
  // verdict combo instead of one per row.
  type Bucket = { grade: Grade; signal_type: SignalType; ids: number[] };
  function bucketize(map: Map<number, GradeOutput>): Bucket[] {
    const groups = new Map<string, Bucket>();
    for (const [id, out] of map.entries()) {
      const key = `${out.grade}::${out.signal_type}`;
      const existing = groups.get(key);
      if (existing) {
        existing.ids.push(id);
      } else {
        groups.set(key, {
          grade: out.grade,
          signal_type: out.signal_type,
          ids: [id],
        });
      }
    }
    return Array.from(groups.values());
  }

  let gamesUpdated = 0;
  for (const bucket of bucketize(slate.games)) {
    const { error } = await supabase
      .from("game_predictions")
      .update({ grade: bucket.grade, signal_type: bucket.signal_type })
      .in("id", bucket.ids);
    if (error) {
      throw new Error(
        `gradeDerivationService: game_predictions update failed for ${bucket.grade}/${bucket.signal_type}: ${error.message}`
      );
    }
    gamesUpdated += bucket.ids.length;
  }

  let propsUpdated = 0;
  for (const bucket of bucketize(slate.props)) {
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
  };
}

// Re-export the constants the service uses so tests can read thresholds
// from one place instead of importing config separately.
export { GRADE_THRESHOLDS, SHARP_SIGNAL_THRESHOLDS };
