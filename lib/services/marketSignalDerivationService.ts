/**
 * marketSignalDerivationService — compute Layer 3 (market read) for each
 * prediction in a slate.
 *
 * V2.1's 3-layer signal architecture:
 *   • Layer 1 (model)   — already on game_predictions / prop_predictions
 *                         (ml_confidence, ou_confidence, edge_pct, etc.)
 *   • Layer 2 (context) — populated by signalDerivationService into the
 *                         prop_predictions.signals JSONB column (vs_lhp,
 *                         wind_out, park, hot/cold, etc.).
 *   • Layer 3 (market)  — THIS SERVICE. Populates the new market_signal
 *                         TEXT column on game_predictions + prop_predictions.
 *                         Reads from the sharp_signals table (which the
 *                         linesService.refreshSharpSignals cron has filled
 *                         via the ISharpSignalProvider).
 *
 * Output vocabulary (5 values, mirrors schema-migration-v6.sql CHECK):
 *   steam_alert         — coordinated sharp move worth flagging regardless
 *                         of model alignment.
 *   market_resistance   — sharps fading our pick (RLM opposes model side).
 *   market_confirmed    — sharps confirming our pick (aligned RLM OR Pinnacle
 *                         positive EV on the side we already like).
 *   public_smoke        — heavy public tickets with flat money flow + no
 *                         Pinnacle EV (recreational chase).
 *   market_neutral      — explicit "no actionable market read" — used both
 *                         when a signal row exists but doesn't trip any
 *                         rule AND when no signal row exists for the tuple.
 *
 * Priority ordering: steam > resistance > confirmed > smoke > neutral.
 *
 * SCOPE NOTE — game_predictions row vs. pick
 *   A single game_predictions row can carry up to 3 picks (ML, total,
 *   first_inning_total) but only ONE market_signal column. We pick the
 *   "primary" pick by precedence: predicted_ml_winner → predicted_ou_side
 *   → predicted_nrfi. This convention may evolve in 6.3d if the grade
 *   engine demands per-pick granularity; for 6.3c it's the simplest
 *   reasonable default. Rows with no model pick at all (every side NULL)
 *   are SKIPPED — market_signal stays NULL.
 *
 *   prop_predictions are always "over" by convention (the model only
 *   surfaces props it thinks the over has edge on) — see edgeCalculator.ts.
 *
 * THRESHOLDS — all reused from SHARP_SIGNAL_THRESHOLDS (lib/config/constants.ts)
 *   so re-tuning happens in one place across this service and Daily Edge's
 *   sharpSignalEvaluator.
 *
 * RLM DIRECTION FORMAT
 *   Mock fixtures use `toward_${side}` (e.g. "toward_home", "toward_over").
 *   The schema doc also allows the longer `${from}_${market}_to_${side}`
 *   format. Both end with the destination side, so the alignment check is:
 *   `rlm_direction.endsWith(modelSide)` → RLM aligned with model.
 */

import { supabase } from "../db/supabase";
import { SHARP_SIGNAL_THRESHOLDS } from "../config/constants";
import type { Sport } from "../types/domain/Sport";
import type { Side } from "../types/domain/Lines";
import type { MarketSignal } from "../types/domain/Grade";
import type { SharpSignalRecord } from "../providers/interfaces/ISharpSignalProvider";

// ─── Public types ─────────────────────────────────────────────────────────

/**
 * Minimal sharp-signal shape the pure derivation needs. Accepts either a
 * SharpSignalRecord (provider boundary) or a `sharp_signals` DB row — both
 * carry the same fields.
 */
export type MarketSignalSource = Pick<
  SharpSignalRecord,
  | "is_plus_ev"
  | "ev_pct"
  | "has_steam_move"
  | "steam_books_count"
  | "has_reverse_line_movement"
  | "rlm_direction"
  | "public_betting_pct"
  | "public_money_pct"
>;

// ─── Pure derivation ──────────────────────────────────────────────────────

/**
 * Classify the market read for ONE pick against ONE sharp-signal observation.
 * Pure function — no I/O. Caller is responsible for matching the signal to
 * the prediction's (game, market, side) tuple before invocation.
 *
 * Priority (highest first): steam > resistance > confirmed > smoke > neutral.
 * If no signal exists (`signal === null`) the result is `market_neutral` —
 * the explicit "derivation ran, found no market read" verdict, NOT NULL.
 */
export function deriveMarketSignal(
  modelSide: Side,
  signal: MarketSignalSource | null
): MarketSignal {
  if (signal === null) return "market_neutral";

  // ── 1. steam_alert ─────────────────────────────────────────────────────
  // Coordinated multi-book sharp move. Always wins — regardless of alignment
  // with the model. The user wants to know that steam is happening.
  if (
    signal.has_steam_move &&
    (signal.steam_books_count ?? 0) >= SHARP_SIGNAL_THRESHOLDS.MIN_STEAM_BOOKS
  ) {
    return "steam_alert";
  }

  // ── 2. market_resistance — RLM AGAINST the model's side ────────────────
  // Both directions of RLM matter; check resistance first so an opposing
  // line move isn't mis-tagged as confirmation by a separate EV signal
  // elsewhere on the same row.
  if (
    signal.has_reverse_line_movement &&
    signal.rlm_direction !== null &&
    !signal.rlm_direction.endsWith(modelSide)
  ) {
    return "market_resistance";
  }

  // ── 3. market_confirmed — RLM aligned OR Pinnacle positive EV ──────────
  if (
    signal.has_reverse_line_movement &&
    signal.rlm_direction !== null &&
    signal.rlm_direction.endsWith(modelSide)
  ) {
    return "market_confirmed";
  }
  if (
    signal.is_plus_ev === true &&
    (signal.ev_pct ?? 0) >= SHARP_SIGNAL_THRESHOLDS.MIN_EV_FOR_PLUS_EV_SIGNAL
  ) {
    return "market_confirmed";
  }

  // ── 4. public_smoke — heavy tickets, flat money, no Pinnacle EV ────────
  // Money tracks tickets within the flatness threshold = recreational chase
  // (lots of small bets, no sharp dollar flow). And Pinnacle doesn't see EV.
  if (
    signal.is_plus_ev !== true &&
    signal.public_betting_pct !== null &&
    signal.public_money_pct !== null &&
    signal.public_betting_pct >= SHARP_SIGNAL_THRESHOLDS.MIN_PUBLIC_HEAVY_PCT &&
    Math.abs(signal.public_money_pct - signal.public_betting_pct) <
      SHARP_SIGNAL_THRESHOLDS.PUBLIC_MONEY_FLATNESS_PP
  ) {
    return "public_smoke";
  }

  // ── 5. market_neutral — none of the above tripped ──────────────────────
  return "market_neutral";
}

// ─── Batch derivation over a slate ────────────────────────────────────────

type GamePredRow = {
  id: number;
  game_id: number | null;
  predicted_ml_winner: "home" | "away" | null;
  predicted_ou_side: "over" | "under" | null;
  predicted_nrfi: boolean | null;
};

type PropPredRow = {
  id: number;
  game_id: number | null;
  prop_market: string;
};

type SharpSignalRow = {
  game_id: number;
  market_type: string;
  side: string;
  is_plus_ev: boolean | null;
  ev_pct: number | null;
  has_steam_move: boolean | null;
  steam_books_count: number | null;
  has_reverse_line_movement: boolean | null;
  rlm_direction: string | null;
  public_betting_pct: number | null;
  public_money_pct: number | null;
};

/**
 * Determine the (market, side) tuple to look up for a game_predictions row,
 * using the precedence rule documented above. Returns null when the row has
 * no model pick at all — caller skips those rows.
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

function signalKey(game_id: number, market: string, side: Side): string {
  return `${game_id}:${market}:${side}`;
}

/**
 * Normalize a raw sharp_signals DB row's boolean-ish columns. Postgres
 * DEFAULT FALSE means new rows are never NULL, but historical rows MAY be —
 * tighten the type before passing to the pure function.
 */
function normalizeSignal(row: SharpSignalRow): MarketSignalSource {
  return {
    is_plus_ev: row.is_plus_ev ?? false,
    ev_pct: row.ev_pct,
    has_steam_move: row.has_steam_move ?? false,
    steam_books_count: row.steam_books_count,
    has_reverse_line_movement: row.has_reverse_line_movement ?? false,
    rlm_direction: row.rlm_direction,
    public_betting_pct: row.public_betting_pct,
    public_money_pct: row.public_money_pct,
  };
}

export type SlateMarketSignals = {
  /** game_prediction.id → derived signal. Rows with no model pick are absent. */
  games: Map<number, MarketSignal>;
  /** prop_prediction.id → derived signal. */
  props: Map<number, MarketSignal>;
};

/**
 * Read the slate's predictions + sharp signals from the DB and derive a
 * MarketSignal for every row that has a classifiable pick. Pure-ish (only DB
 * reads); does not write.
 */
export async function deriveMarketSignalsForSlate(
  sport: Sport,
  slate_date: string
): Promise<SlateMarketSignals> {
  // ── 1. Slate games + their predictions ─────────────────────────────────
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
      "id, game_id, predicted_ml_winner, predicted_ou_side, predicted_nrfi"
    )
    .in("game_id", gameIds);
  const gamePreds = (gamePredsRaw ?? []) as GamePredRow[];

  const { data: propsRaw } = await supabase
    .from("prop_predictions")
    .select("id, game_id, prop_market")
    .in("game_id", gameIds);
  const propPreds = (propsRaw ?? []) as PropPredRow[];

  // ── 2. sharp_signals for the slate, indexed by (game_id, market, side) ─
  const { data: signalsRaw } = await supabase
    .from("sharp_signals")
    .select(
      "game_id, market_type, side, is_plus_ev, ev_pct, has_steam_move, steam_books_count, has_reverse_line_movement, rlm_direction, public_betting_pct, public_money_pct"
    )
    .in("game_id", gameIds);
  const signalByKey = new Map<string, MarketSignalSource>();
  for (const raw of (signalsRaw ?? []) as SharpSignalRow[]) {
    signalByKey.set(
      signalKey(raw.game_id, raw.market_type, raw.side as Side),
      normalizeSignal(raw)
    );
  }

  // ── 3. Derive per-row ──────────────────────────────────────────────────
  const result: SlateMarketSignals = { games: new Map(), props: new Map() };

  for (const row of gamePreds) {
    if (row.game_id === null) continue;
    const pick = primaryGamePick(row);
    if (pick === null) continue; // No model pick — skip; column stays NULL.
    const signal =
      signalByKey.get(signalKey(row.game_id, pick.market, pick.side)) ?? null;
    result.games.set(row.id, deriveMarketSignal(pick.side, signal));
  }

  for (const row of propPreds) {
    if (row.game_id === null) continue;
    // Props are over-only (see edgeCalculator.ts:34).
    const signal =
      signalByKey.get(signalKey(row.game_id, row.prop_market, "over")) ?? null;
    result.props.set(row.id, deriveMarketSignal("over", signal));
  }

  return result;
}

/**
 * Apply derived market signals to game_predictions.market_signal and
 * prop_predictions.market_signal for the slate. Idempotent — a second run
 * over the same input writes the same values.
 *
 * Batches one UPDATE per (table × distinct signal value) for efficiency.
 */
export async function updateMarketSignalsForSlate(
  sport: Sport,
  slate_date: string
): Promise<{ gamePredictionsUpdated: number; propPredictionsUpdated: number }> {
  const map = await deriveMarketSignalsForSlate(sport, slate_date);

  // Group by signal value so we can UPDATE all rows of the same verdict in
  // one statement instead of N round-trips.
  const gameBuckets = new Map<MarketSignal, number[]>();
  for (const [id, signal] of map.games.entries()) {
    const bucket = gameBuckets.get(signal) ?? [];
    bucket.push(id);
    gameBuckets.set(signal, bucket);
  }
  const propBuckets = new Map<MarketSignal, number[]>();
  for (const [id, signal] of map.props.entries()) {
    const bucket = propBuckets.get(signal) ?? [];
    bucket.push(id);
    propBuckets.set(signal, bucket);
  }

  let gamesUpdated = 0;
  for (const [signal, ids] of gameBuckets.entries()) {
    const { error } = await supabase
      .from("game_predictions")
      .update({ market_signal: signal })
      .in("id", ids);
    if (error) {
      throw new Error(
        `marketSignalDerivationService: game_predictions update failed for signal=${signal}: ${error.message}`
      );
    }
    gamesUpdated += ids.length;
  }

  let propsUpdated = 0;
  for (const [signal, ids] of propBuckets.entries()) {
    const { error } = await supabase
      .from("prop_predictions")
      .update({ market_signal: signal })
      .in("id", ids);
    if (error) {
      throw new Error(
        `marketSignalDerivationService: prop_predictions update failed for signal=${signal}: ${error.message}`
      );
    }
    propsUpdated += ids.length;
  }

  return {
    gamePredictionsUpdated: gamesUpdated,
    propPredictionsUpdated: propsUpdated,
  };
}
