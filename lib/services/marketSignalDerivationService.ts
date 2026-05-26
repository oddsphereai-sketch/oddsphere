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
 *   • Layer 3 (market)  — THIS SERVICE. Populates market_signal columns
 *                         on game_predictions + prop_predictions, reading
 *                         from the sharp_signals table (which the
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
 * V2.1.1 PER-PICK REFACTOR (Phase 6.3.5b)
 *   Pre-6.3.5b this service collapsed each game_predictions row to a single
 *   "primary pick" market_signal via ML → OU → NRFI precedence. External
 *   review surfaced the nuance loss — a game can be Sharp Confirmed on the
 *   moneyline AND Market Watch on the total. The refactor:
 *
 *     • For each game_predictions row, derive market_signal INDEPENDENTLY
 *       for each of the 3 markets (ml / ou / nrfi) where the row has a
 *       non-null predicted_<market>_* column. Markets with no model pick
 *       stay NULL on their per-pick column.
 *     • Write the 3 per-pick columns (ml_market_signal, ou_market_signal,
 *       nrfi_market_signal) added by schema-migration-v13.sql.
 *     • DUAL-WRITE: also populate the legacy game_predictions.market_signal
 *       column from the precedence-1 per-pick value (first non-null in
 *       ML → OU → NRFI order). This preserves existing UI behavior bit-for-
 *       bit during the 6.3.5b → 6.3.5f transition; legacy column is dropped
 *       in a future V14 cleanup commit.
 *     • prop_predictions UNCHANGED — props are per-pick by table shape
 *       (one row per game × player × prop_market tuple), so the existing
 *       single market_signal column there stays authoritative.
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

/** The three game markets that get per-pick derivation. Used to drive
 * deterministic ordering across batch + DB write code. */
type GameMarketKey = "ml" | "ou" | "nrfi";
const GAME_MARKET_KEYS: readonly GameMarketKey[] = ["ml", "ou", "nrfi"];

/**
 * For a game_predictions row, project each per-market pick (or null if the
 * model didn't pick that market). Used to drive per-pick derivation in
 * lockstep with the V13 column names.
 */
function picksFromRow(row: GamePredRow): Record<
  GameMarketKey,
  { market: string; side: Side } | null
> {
  return {
    ml:
      row.predicted_ml_winner !== null
        ? { market: "moneyline", side: row.predicted_ml_winner }
        : null,
    ou:
      row.predicted_ou_side !== null
        ? { market: "total", side: row.predicted_ou_side }
        : null,
    nrfi:
      row.predicted_nrfi !== null
        ? {
            market: "first_inning_total",
            side: row.predicted_nrfi ? "under" : "over",
          }
        : null,
  };
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
  /**
   * Per-pick market signals indexed by game_prediction.id. Rows where the
   * model didn't pick a side for that specific market are ABSENT from the
   * inner Map (no entry, not null entry) — caller distinguishes "no model
   * pick" from "derived market_neutral."
   *
   * V2.1.1 (Phase 6.3.5e): the previous `gamesLegacy` Map was removed
   * along with the dual-write to the legacy game_predictions.market_signal
   * column. Consumers that need a "headline" market_signal derive it
   * client-side (perPickHeadline.ts) from these per-pick maps.
   */
  games: {
    ml: Map<number, MarketSignal>;
    ou: Map<number, MarketSignal>;
    nrfi: Map<number, MarketSignal>;
  };
  /** prop_predictions are already per-pick by table shape. */
  props: Map<number, MarketSignal>;
};

/**
 * Read the slate's predictions + sharp signals from the DB and derive
 * market_signal for every (row × market) combination that has a model
 * pick. Pure-ish (only DB reads); does not write.
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
  const empty: SlateMarketSignals = {
    games: { ml: new Map(), ou: new Map(), nrfi: new Map() },
    props: new Map(),
  };
  if (gameIds.length === 0) return empty;

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

  // ── 3. Derive per-pick market_signal for each game_predictions row ──
  const result: SlateMarketSignals = {
    games: { ml: new Map(), ou: new Map(), nrfi: new Map() },
    props: new Map(),
  };

  for (const row of gamePreds) {
    if (row.game_id === null) continue;
    const picks = picksFromRow(row);

    // Per-market: derive a signal only when the model picked that market.
    // Markets without a pick stay ABSENT from their inner Map (their
    // corresponding per-pick column stays NULL).
    for (const key of GAME_MARKET_KEYS) {
      const pick = picks[key];
      if (pick === null) continue;
      const signal =
        signalByKey.get(signalKey(row.game_id, pick.market, pick.side)) ?? null;
      result.games[key].set(row.id, deriveMarketSignal(pick.side, signal));
    }
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

// ─── DB write — per-row dual-write ────────────────────────────────────────

export type UpdateMarketSignalsResult = {
  /** Distinct game_predictions rows updated (one row carries up to 3
   * column writes — one per market). */
  gamePredictionsUpdated: number;
  propPredictionsUpdated: number;
  /** Per-market derivation counts for cron-status visibility. `derived`
   * counts rows where the market had a model pick (and thus got a
   * per-pick value); `written` mirrors `derived` since the write is
   * idempotent on each row. */
  perMarket: {
    ml: { derived: number; written: number };
    ou: { derived: number; written: number };
    nrfi: { derived: number; written: number };
  };
};

/**
 * Apply derived market signals to game_predictions + prop_predictions for
 * the slate. Idempotent — a second run over the same input writes the same
 * values. game_predictions uses per-row UPDATEs (one statement per row
 * touching up to 3 per-pick columns). prop_predictions retains the
 * bucketed UPDATE pattern (one column per row).
 *
 * V2.1.1 (Phase 6.3.5e): the legacy game_predictions.market_signal column
 * is no longer written. Headline derivation moved to the client
 * (perPickHeadline.ts). The legacy DB column is orphaned post-6.3.5e —
 * V14 cleanup migration drops it.
 */
export async function updateMarketSignalsForSlate(
  sport: Sport,
  slate_date: string
): Promise<UpdateMarketSignalsResult> {
  const slate = await deriveMarketSignalsForSlate(sport, slate_date);

  const perMarket = {
    ml: { derived: slate.games.ml.size, written: 0 },
    ou: { derived: slate.games.ou.size, written: 0 },
    nrfi: { derived: slate.games.nrfi.size, written: 0 },
  };

  // Build the universe of game_prediction.ids that received ANY per-pick
  // derivation. Rows in this set get one UPDATE setting the 3 per-pick
  // columns; absent rows stay NULL everywhere.
  const allIds = new Set<number>([
    ...slate.games.ml.keys(),
    ...slate.games.ou.keys(),
    ...slate.games.nrfi.keys(),
  ]);

  let gamesUpdated = 0;
  for (const id of allIds) {
    const ml = slate.games.ml.get(id) ?? null;
    const ou = slate.games.ou.get(id) ?? null;
    const nrfi = slate.games.nrfi.get(id) ?? null;

    const { error } = await supabase
      .from("game_predictions")
      .update({
        ml_market_signal: ml,
        ou_market_signal: ou,
        nrfi_market_signal: nrfi,
      })
      .eq("id", id);
    if (error) {
      throw new Error(
        `marketSignalDerivationService: game_predictions update failed for id=${id}: ${error.message}`
      );
    }
    gamesUpdated++;
    if (ml !== null) perMarket.ml.written++;
    if (ou !== null) perMarket.ou.written++;
    if (nrfi !== null) perMarket.nrfi.written++;
  }

  // Props — single column per row; bucketed UPDATE is still optimal.
  const propBuckets = new Map<MarketSignal, number[]>();
  for (const [id, signal] of slate.props.entries()) {
    const bucket = propBuckets.get(signal) ?? [];
    bucket.push(id);
    propBuckets.set(signal, bucket);
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
    perMarket,
  };
}
