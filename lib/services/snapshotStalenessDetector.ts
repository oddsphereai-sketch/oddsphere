/**
 * Snapshot staleness detector — P7-Commit-B Phase 2 (2026-06-11).
 *
 * Pure helper that compares the sharp_signals captured in a
 * prediction_records snapshot (snapshot_json.signal_rows_at_lock)
 * against the latest live sharp_signals rows for the same game and
 * returns whether the snapshot is materially stale.
 *
 * The Daily Edge route's coherent-snapshot contract (Phase 1) makes
 * the card always render from the writer's snapshot. This detector
 * answers the orchestrator's question: "is the snapshot far enough
 * out of date that the writer should re-run for this game?" When
 * the answer is yes, the orchestrator queues that game for an
 * `automodelService.generatePredictionsForSlate` pass that rebuilds
 * the entire recommendation state — Market Pulse, Quick Read,
 * play_grade, best_angle, confidence, copy — all from one new
 * input moment.
 *
 * Scope:
 *   - Sharp_signals comparison only in V1. Line comparison is a
 *     separate follow-up (would also need lines_at_lock vs current
 *     lines and is a different code path).
 *   - Pre-lock only. Locked rows must never trigger a refresh.
 *   - Material change is deterministic: each flip is observable,
 *     no model re-run inside the detector.
 *
 * Material change rules (any one triggers stale=true):
 *   1. Opposing-money conflict gate FLIPPED — the public-money
 *      conflict guard would now fire when it didn't before, or
 *      vice versa.
 *   2. Picked-side public_money_pct delta >= MATERIAL_PCT_DELTA
 *   3. Opposing-side public_money_pct delta >= MATERIAL_PCT_DELTA
 *   4. Picked-side public_betting_pct delta >= MATERIAL_PCT_DELTA
 *   5. Opposing-side public_betting_pct delta >= MATERIAL_PCT_DELTA
 *   6. has_steam_move flipped on picked or opposing side
 *   7. has_reverse_line_movement flipped on picked or opposing side
 *
 * The threshold is intentionally generous (10pp). Smaller changes
 * are not worth a writer re-run; larger ones can flip a verdict
 * gate (Best Angle public-money guard fires at 60% opposing money
 * + 15pp money-vs-bets divergence, both of which can be crossed by
 * a 10pp move).
 */

export type StalenessSignalRow = {
  market_type: string;
  side: string | null;
  public_money_pct: number | null;
  public_betting_pct: number | null;
  has_steam_move: boolean | null;
  has_reverse_line_movement: boolean | null;
};

export type StalenessReason =
  | "money_conflict_flip_ml"
  | "money_conflict_flip_total"
  | "picked_money_pct_delta"
  | "opp_money_pct_delta"
  | "picked_bets_pct_delta"
  | "opp_bets_pct_delta"
  | "steam_flip"
  | "rlm_flip"
  | "missing_snapshot_signal"
  | "missing_live_signal";

export type StalenessCheckInput = {
  /** Signals captured at writer time (from snapshot_json.signal_rows_at_lock). */
  snapshotSignals: ReadonlyArray<StalenessSignalRow>;
  /** Signals currently in the sharp_signals table for this game. */
  liveSignals: ReadonlyArray<StalenessSignalRow>;
  /** Picked side for moneyline ("home" / "away") — null when ML held / no pick. */
  pickedMl: string | null;
  /** Picked side for total ("over" / "under") — null when OU held / no pick. */
  pickedTotal: string | null;
};

export type StalenessCheckResult = {
  stale: boolean;
  reasons: StalenessReason[];
};

/**
 * Pct-point threshold for material change in public_money_pct or
 * public_betting_pct. Set to 10pp because the Best Angle public-money
 * conflict guard fires at thresholds that a 10pp move can cross
 * (opposing money >= 60% AND money-vs-bets divergence >= 15pp).
 */
export const MATERIAL_PCT_DELTA = 10;

/** Opposing-money conflict thresholds from predictionRecordService. */
const OPP_MONEY_CONFLICT_PCT = 60;
const MONEY_BETS_DIVERGENCE_PCT = 15;

function opposingOf(market: "moneyline" | "total", side: string): string | null {
  if (market === "moneyline") {
    if (side === "home") return "away";
    if (side === "away") return "home";
    return null;
  }
  if (side === "over") return "under";
  if (side === "under") return "over";
  return null;
}

function findSignal(
  rows: ReadonlyArray<StalenessSignalRow>,
  market: string,
  side: string,
): StalenessSignalRow | null {
  return rows.find((r) => r.market_type === market && r.side === side) ?? null;
}

/**
 * Mirrors `hasOpposingPublicMoneyConflict` in predictionRecordService.
 * Returns true when the opposing side carries enough money pressure
 * to fire the Best Angle conflict guard.
 */
function evaluateConflict(
  signals: ReadonlyArray<StalenessSignalRow>,
  market: "moneyline" | "total",
  pickedSide: string,
): boolean {
  const opp = opposingOf(market, pickedSide);
  if (opp === null) return false;
  const oppSig = findSignal(signals, market, opp);
  if (oppSig === null) return false;
  const oppMoney = oppSig.public_money_pct;
  const oppBets = oppSig.public_betting_pct;
  if (typeof oppMoney !== "number" || typeof oppBets !== "number") return false;
  if (oppMoney < OPP_MONEY_CONFLICT_PCT) return false;
  if (oppMoney - oppBets < MONEY_BETS_DIVERGENCE_PCT) return false;
  return true;
}

function deltaExceedsThreshold(
  snapVal: number | null | undefined,
  liveVal: number | null | undefined,
  threshold: number,
): boolean {
  if (typeof snapVal !== "number" || typeof liveVal !== "number") return false;
  return Math.abs(liveVal - snapVal) >= threshold;
}

function flagFlipped(
  snapVal: boolean | null | undefined,
  liveVal: boolean | null | undefined,
): boolean {
  if (typeof snapVal !== "boolean" || typeof liveVal !== "boolean") return false;
  return snapVal !== liveVal;
}

/**
 * Compare snapshot signals to live signals for a given picked side on
 * a market. Returns the list of staleness reasons that fired (may be
 * empty when nothing material changed).
 */
function checkSide(
  market: "moneyline" | "total",
  pickedSide: string,
  snapshotSignals: ReadonlyArray<StalenessSignalRow>,
  liveSignals: ReadonlyArray<StalenessSignalRow>,
): StalenessReason[] {
  const reasons: StalenessReason[] = [];
  const opp = opposingOf(market, pickedSide);

  // Money-conflict guard flip — strongest material change.
  const snapConflict = evaluateConflict(snapshotSignals, market, pickedSide);
  const liveConflict = evaluateConflict(liveSignals, market, pickedSide);
  if (snapConflict !== liveConflict) {
    reasons.push(
      market === "moneyline" ? "money_conflict_flip_ml" : "money_conflict_flip_total",
    );
  }

  const sides = opp !== null ? [pickedSide, opp] : [pickedSide];
  for (const side of sides) {
    const snap = findSignal(snapshotSignals, market, side);
    const live = findSignal(liveSignals, market, side);

    if (snap === null && live !== null) {
      reasons.push("missing_snapshot_signal");
      continue;
    }
    if (snap !== null && live === null) {
      reasons.push("missing_live_signal");
      continue;
    }
    if (snap === null || live === null) continue;

    const isPicked = side === pickedSide;

    if (deltaExceedsThreshold(snap.public_money_pct, live.public_money_pct, MATERIAL_PCT_DELTA)) {
      reasons.push(isPicked ? "picked_money_pct_delta" : "opp_money_pct_delta");
    }
    if (deltaExceedsThreshold(snap.public_betting_pct, live.public_betting_pct, MATERIAL_PCT_DELTA)) {
      reasons.push(isPicked ? "picked_bets_pct_delta" : "opp_bets_pct_delta");
    }
    if (flagFlipped(snap.has_steam_move, live.has_steam_move)) {
      reasons.push("steam_flip");
    }
    if (flagFlipped(snap.has_reverse_line_movement, live.has_reverse_line_movement)) {
      reasons.push("rlm_flip");
    }
  }
  return reasons;
}

/**
 * Detect whether the snapshot's sharp_signals are materially stale
 * compared to the live sharp_signals. Pure — no I/O.
 */
export function detectSnapshotStaleness(
  input: StalenessCheckInput,
): StalenessCheckResult {
  const all: StalenessReason[] = [];

  if (input.pickedMl !== null) {
    all.push(...checkSide("moneyline", input.pickedMl, input.snapshotSignals, input.liveSignals));
  }
  if (input.pickedTotal !== null) {
    all.push(...checkSide("total", input.pickedTotal, input.snapshotSignals, input.liveSignals));
  }

  // Dedup
  const reasons = Array.from(new Set(all));
  return { stale: reasons.length > 0, reasons };
}
