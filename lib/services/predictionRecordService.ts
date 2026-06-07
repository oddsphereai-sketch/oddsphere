/**
 * Push 4 — Prediction Record service.
 *
 * Reads `game_predictions` rows for a slate, splits each into one
 * prediction_records row per non-held market (ML, total, FI), and
 * upserts via the (game_id, market, model_version, slate_date)
 * unique key.
 *
 * Idempotent. Never modifies game_predictions. Never touches
 * locked_at, predictions, or slate_status.
 *
 * When the tracking_baselines / prediction_records tables don't yet
 * exist (migration v17 not applied), the service returns a clean
 * error rather than throwing — the operator script surfaces a
 * helpful message.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PredictionRecordRow,
  TrackedSport,
  TrackedMarketV17,
} from "../types/domain/Tracking";

export type CreateRecordsOptions = {
  sport: TrackedSport;
  slateDate: string;
  /**
   * When true, the records get `launch_day=true` and
   * `manual_outcome_expected=true`. The admin tracking page can
   * exclude these from "fresh automated tracking" aggregates.
   */
  launchDay: boolean;
  /** When false → dry-run; no DB writes. */
  apply: boolean;
  supabase: SupabaseClient;
  /**
   * When true, include held markets as records with held=true. By
   * default, held markets are skipped (matches the v17 design:
   * snapshots represent picks the model actually made).
   */
  includeHeld?: boolean;
};

export type CreateRecordsResult = {
  scanned: number;
  proposed: PredictionRecordRow[];
  insertedCount: number;
  skippedExisting: number;
  skippedHeld: number;
  errors: Array<{ game_id: number; market: TrackedMarketV17; reason: string }>;
  /** Set when the underlying tables are missing — the operator surfaces this. */
  tablesInitialized: boolean;
};

type GameRow = {
  id: number;
  external_id: number;
  game_date: string | null;
  slate_status: string | null;
  home_team_id: number;
  away_team_id: number;
};

type PredictionRow = {
  id: number;
  game_id: number;
  predicted_ml_winner: string | null;
  ml_confidence: number | null;
  predicted_ou_side: string | null;
  ou_confidence: number | null;
  predicted_nrfi: boolean | null;
  nrfi_confidence: number | null;
  prediction_source: string | null;
  is_override: boolean | null;
  locked_at: string | null;
  computed_at: string | null;
  sport_specific: Record<string, unknown> | null;
};

function readBoolish(v: unknown): boolean {
  return v === true;
}
function readStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Phase 6B.11 — minimal sharp_signals row shape used for the
 * best_angle public-money guard. Mirrors the fields the daily-edge
 * route reads in its own copy of this guard (Phase 6B.10).
 */
type PublicSplitsRow = {
  market_type: string;
  side: string;
  public_money_pct: number | null;
  public_betting_pct: number | null;
};

/**
 * Phase 6B.11 — applies the same public-money guard the Daily Edge
 * verdict layer uses (Phase 6B.10), so prediction_records.best_angle
 * matches what members actually see on the slate.
 *
 * Pre-6B.11 prediction_records snapshot best_angle directly from
 * v2_2_audit.{ml,ou}_best_angle_eligible. Daily Edge then suppresses
 * the BA promotion when the OPPOSITE side carries a clear sharp-fade
 * pattern (money >= 60 AND money - bets >= 15). Tracking pending BA
 * counts diverged from the live page — most painfully visible on
 * BAL@TOR ML where Daily Edge correctly showed Watchlist but
 * tracking counted it as a pending Best Angle.
 *
 * Same conservative rule as Phase 6B.10:
 *   • Only suppresses; never invents a Best Angle.
 *   • Only fires when the opposite side has both high money AND
 *     low ticket count (the few-large-bets sharp pattern).
 *   • NEVER touches the underlying pick, picks side, line, or grade
 *     columns on game_predictions. Only the boolean best_angle flag
 *     on prediction_records changes.
 */
function hasOpposingPublicMoneyConflict(
  signals: PublicSplitsRow[],
  market: "moneyline" | "total",
  pickSide: string | null,
): boolean {
  if (pickSide === null) return false;
  let oppositeSide: string | null = null;
  if (market === "moneyline") {
    if (pickSide === "home") oppositeSide = "away";
    else if (pickSide === "away") oppositeSide = "home";
  } else {
    if (pickSide === "over") oppositeSide = "under";
    else if (pickSide === "under") oppositeSide = "over";
  }
  if (oppositeSide === null) return false;
  const opp = signals.find(
    (s) => s.market_type === market && s.side === oppositeSide,
  );
  if (opp === undefined) return false;
  const money = opp.public_money_pct;
  const bets = opp.public_betting_pct;
  if (money === null || bets === null) return false;
  if (money < 60) return false;
  if (money - bets < 15) return false;
  return true;
}

function buildMlRecord(
  pred: PredictionRow,
  game: GameRow,
  homeAbbrev: string,
  awayAbbrev: string,
  slateDate: string,
  launchDay: boolean,
  signalsForGame: PublicSplitsRow[],
): PredictionRecordRow | null {
  const sp = (pred.sport_specific ?? {}) as Record<string, unknown>;
  const holdPicks = Array.isArray(sp.hold_picks) ? (sp.hold_picks as string[]) : [];
  const held = holdPicks.includes("ml") || pred.predicted_ml_winner === null;
  if (held) return null;
  return {
    game_prediction_id: pred.id,
    game_id: game.id,
    external_id: game.external_id,
    sport: "mlb",
    slate_date: slateDate,
    game_date: game.game_date,
    matchup: `${awayAbbrev}@${homeAbbrev}`,
    market: "moneyline",
    pick: pred.predicted_ml_winner,
    side: pred.predicted_ml_winner,
    line_value: null,
    odds_american: null,
    odds_decimal: null,
    model_used: readStringOrNull(sp.model_used),
    model_version: readStringOrNull(sp.model_version),
    prediction_source: pred.prediction_source,
    confidence: pred.ml_confidence,
    model_probability:
      pred.ml_confidence !== null ? pred.ml_confidence / 100 : null,
    market_probability:
      typeof sp.v2_1_audit === "object" && sp.v2_1_audit !== null
        ? (sp.v2_1_audit as Record<string, unknown>).market_home_win_prob !==
            undefined && pred.predicted_ml_winner === "home"
          ? (((sp.v2_1_audit as Record<string, unknown>).market_home_win_prob as number) ?? null)
          : pred.predicted_ml_winner === "away" &&
            (sp.v2_1_audit as Record<string, unknown>).market_away_win_prob !==
              undefined
          ? (((sp.v2_1_audit as Record<string, unknown>).market_away_win_prob as number) ?? null)
          : null
        : null,
    edge: null,
    expected_value: null,
    play_grade: readStringOrNull(sp.ml_play_grade),
    prediction_type: readStringOrNull(sp.ml_prediction_type),
    // Phase 6B.11 — apply the same public-money conflict guard the
    // Daily Edge verdict layer uses (Phase 6B.10). Tracking pending
    // BA count now matches what members see on the live slate.
    best_angle:
      readBoolish(sp.ml_best_angle_eligible) &&
      !hasOpposingPublicMoneyConflict(signalsForGame, "moneyline", pred.predicted_ml_winner),
    no_bet: false,
    no_bet_reason: readStringOrNull(sp.ml_no_bet_reason),
    market_aligned: readBoolish(sp.ml_market_aligned),
    data_quality_tier: readStringOrNull(sp.v2_data_quality_tier),
    source_quality: null,
    provisional: readBoolish(sp.v2_provisional),
    held: false,
    hold_reason: null,
    launch_day: launchDay,
    manual_outcome_expected: launchDay,
    locked_at: pred.locked_at,
    published_at: game.slate_status === "published" ? pred.computed_at : null,
    snapshot_json: sp,
  };
}

function buildOuRecord(
  pred: PredictionRow,
  game: GameRow,
  homeAbbrev: string,
  awayAbbrev: string,
  slateDate: string,
  launchDay: boolean,
  signalsForGame: PublicSplitsRow[],
): PredictionRecordRow | null {
  const sp = (pred.sport_specific ?? {}) as Record<string, unknown>;
  const holdPicks = Array.isArray(sp.hold_picks) ? (sp.hold_picks as string[]) : [];
  const held = holdPicks.includes("ou") || pred.predicted_ou_side === null;
  if (held) return null;
  const v21 = (sp.v2_1_audit ?? {}) as Record<string, unknown>;
  const v22 = (sp.v2_2_audit ?? {}) as Record<string, unknown>;
  // Phase 6B.17 — read line_value from V2.2 audit FIRST (the active
  // model writes here), fall back to V2.1 audit for legacy snapshots.
  // Pre-6B.17 the locked total snapshot stored line_value=null because
  // V2.2 writes market_total under sp.v2_2_audit, not sp.v2_1_audit.
  // Daily Edge then had no locked total line to render and fell back
  // to the live `lines` table — which kept moving mid-game (CWS@PHI
  // pregame 9.5 → mid-game 12.5 was the symptom).
  const lockedTotalLine =
    typeof v22.market_total === "number"
      ? (v22.market_total as number)
      : typeof v21.market_total === "number"
        ? (v21.market_total as number)
        : null;
  return {
    game_prediction_id: pred.id,
    game_id: game.id,
    external_id: game.external_id,
    sport: "mlb",
    slate_date: slateDate,
    game_date: game.game_date,
    matchup: `${awayAbbrev}@${homeAbbrev}`,
    market: "total",
    pick: pred.predicted_ou_side,
    side: pred.predicted_ou_side,
    line_value: lockedTotalLine,
    odds_american: null,
    odds_decimal: null,
    model_used: readStringOrNull(sp.model_used),
    model_version: readStringOrNull(sp.model_version),
    prediction_source: pred.prediction_source,
    confidence: pred.ou_confidence,
    model_probability:
      pred.ou_confidence !== null ? pred.ou_confidence / 100 : null,
    market_probability: null,
    edge: null,
    expected_value: null,
    play_grade: readStringOrNull(sp.ou_play_grade),
    prediction_type: readStringOrNull(sp.ou_prediction_type),
    // Phase 6B.11 — same guard as ML above; see hasOpposingPublicMoneyConflict.
    best_angle:
      readBoolish(sp.ou_best_angle_eligible) &&
      !hasOpposingPublicMoneyConflict(signalsForGame, "total", pred.predicted_ou_side),
    no_bet: false,
    no_bet_reason: readStringOrNull(sp.ou_no_bet_reason),
    market_aligned: readBoolish(sp.ou_market_aligned),
    data_quality_tier: readStringOrNull(sp.v2_data_quality_tier),
    source_quality: null,
    provisional: readBoolish(sp.v2_provisional),
    held: false,
    hold_reason: null,
    launch_day: launchDay,
    manual_outcome_expected: launchDay,
    locked_at: pred.locked_at,
    published_at: game.slate_status === "published" ? pred.computed_at : null,
    snapshot_json: sp,
  };
}

function buildFiRecord(
  pred: PredictionRow,
  game: GameRow,
  homeAbbrev: string,
  awayAbbrev: string,
  slateDate: string,
  launchDay: boolean,
): PredictionRecordRow | null {
  const sp = (pred.sport_specific ?? {}) as Record<string, unknown>;
  const holdPicks = Array.isArray(sp.hold_picks) ? (sp.hold_picks as string[]) : [];
  const held = holdPicks.includes("nrfi") || pred.predicted_nrfi === null;
  if (held) return null;
  const pickLabel = pred.predicted_nrfi === true ? "NRFI" : "YRFI";
  return {
    game_prediction_id: pred.id,
    game_id: game.id,
    external_id: game.external_id,
    sport: "mlb",
    slate_date: slateDate,
    game_date: game.game_date,
    matchup: `${awayAbbrev}@${homeAbbrev}`,
    market: "first_inning",
    pick: pickLabel,
    side: pred.predicted_nrfi === true ? "under" : "over",
    line_value: 0.5,
    odds_american: null,
    odds_decimal: null,
    model_used: readStringOrNull(sp.model_used),
    model_version: readStringOrNull(sp.model_version),
    prediction_source: pred.prediction_source,
    confidence: pred.nrfi_confidence,
    model_probability:
      pred.nrfi_confidence !== null ? pred.nrfi_confidence / 100 : null,
    market_probability: null,
    edge: null,
    expected_value: null,
    play_grade: null,
    prediction_type: null,
    best_angle: false,
    no_bet: false,
    no_bet_reason: null,
    market_aligned: false,
    data_quality_tier: readStringOrNull(sp.v2_data_quality_tier),
    source_quality: null,
    provisional: readBoolish(sp.v2_provisional),
    held: false,
    hold_reason: null,
    launch_day: launchDay,
    manual_outcome_expected: launchDay,
    locked_at: pred.locked_at,
    published_at: game.slate_status === "published" ? pred.computed_at : null,
    snapshot_json: sp,
  };
}

/**
 * Build the list of prediction_records for the slate.
 *
 * Pure function — no DB writes. Caller dispatches to insert in apply mode.
 */
export function buildPredictionRecordsFromSlate(args: {
  sport: TrackedSport;
  slateDate: string;
  launchDay: boolean;
  games: ReadonlyArray<GameRow>;
  predictionByGameId: ReadonlyMap<number, PredictionRow>;
  abbrevByTeamId: ReadonlyMap<number, string>;
  /**
   * Phase 6B.11 — per-game sharp_signals subset, used to apply the
   * public-money conflict guard on best_angle. Empty map / missing
   * key = no guard fires (defaults to V2.2 audit's raw eligibility).
   */
  signalsByGameId?: ReadonlyMap<number, ReadonlyArray<PublicSplitsRow>>;
}): PredictionRecordRow[] {
  const proposed: PredictionRecordRow[] = [];
  for (const g of args.games) {
    const pred = args.predictionByGameId.get(g.id);
    if (!pred) continue;
    const home = args.abbrevByTeamId.get(g.home_team_id) ?? "?";
    const away = args.abbrevByTeamId.get(g.away_team_id) ?? "?";
    const sigs = (args.signalsByGameId?.get(g.id) ?? []) as PublicSplitsRow[];
    const ml = buildMlRecord(pred, g, home, away, args.slateDate, args.launchDay, sigs);
    const ou = buildOuRecord(pred, g, home, away, args.slateDate, args.launchDay, sigs);
    const fi = buildFiRecord(pred, g, home, away, args.slateDate, args.launchDay);
    if (ml) proposed.push(ml);
    if (ou) proposed.push(ou);
    if (fi) proposed.push(fi);
  }
  return proposed;
}

/**
 * Full create flow with DB I/O. Idempotent via the unique key.
 */
export async function createPredictionRecords(
  opts: CreateRecordsOptions,
): Promise<CreateRecordsResult> {
  const { sport, slateDate, launchDay, apply, supabase } = opts;
  const result: CreateRecordsResult = {
    scanned: 0,
    proposed: [],
    insertedCount: 0,
    skippedExisting: 0,
    skippedHeld: 0,
    errors: [],
    tablesInitialized: true,
  };

  // Load slate
  const { data: gameRows, error: gErr } = await supabase
    .from("games")
    .select("id, external_id, game_date, slate_status, home_team_id, away_team_id")
    .eq("sport", sport)
    .eq("slate_date", slateDate);
  if (gErr) {
    result.errors.push({ game_id: 0, market: "moneyline", reason: `games fetch failed: ${gErr.message}` });
    return result;
  }
  const games = (gameRows ?? []) as GameRow[];
  result.scanned = games.length;

  if (games.length === 0) return result;
  const gameIds = games.map((g) => g.id);

  // Load predictions
  const { data: predRows } = await supabase
    .from("game_predictions")
    .select("id, game_id, predicted_ml_winner, ml_confidence, predicted_ou_side, ou_confidence, predicted_nrfi, nrfi_confidence, prediction_source, is_override, locked_at, computed_at, sport_specific")
    .in("game_id", gameIds);
  const preds = ((predRows ?? []) as PredictionRow[]);
  const predictionByGameId = new Map<number, PredictionRow>(
    preds.map((p) => [p.game_id, p]),
  );

  // Load team abbreviations
  const teamIds = Array.from(
    new Set([...games.map((g) => g.home_team_id), ...games.map((g) => g.away_team_id)]),
  );
  const { data: teamRows } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .in("id", teamIds);
  const abbrevByTeamId = new Map<number, string>(
    ((teamRows ?? []) as Array<{ id: number; abbreviation: string }>).map((t) => [t.id, t.abbreviation]),
  );

  // Phase 6B.11 — load per-game sharp_signals (minimal columns) so
  // the buildXxxRecord helpers can apply the public-money conflict
  // guard on best_angle. Missing signals = guard stays off (safe
  // default; no false negatives).
  const { data: signalRows } = await supabase
    .from("sharp_signals")
    .select("game_id, market_type, side, public_money_pct, public_betting_pct")
    .in("game_id", gameIds);
  const signalsByGameId = new Map<number, PublicSplitsRow[]>();
  for (const s of (signalRows ?? []) as Array<{ game_id: number } & PublicSplitsRow>) {
    const list = signalsByGameId.get(s.game_id) ?? [];
    list.push({
      market_type: s.market_type,
      side: s.side,
      public_money_pct: s.public_money_pct,
      public_betting_pct: s.public_betting_pct,
    });
    signalsByGameId.set(s.game_id, list);
  }

  const proposed = buildPredictionRecordsFromSlate({
    sport,
    slateDate,
    launchDay,
    games,
    predictionByGameId,
    abbrevByTeamId,
    signalsByGameId,
  });
  result.proposed = proposed;
  result.skippedHeld =
    games.length * 3 -
    proposed.length -
    games.filter((g) => !predictionByGameId.has(g.id)).length * 3;

  if (!apply) return result;

  // Probe table existence with a HEAD-style query
  const { error: probeErr } = await supabase
    .from("prediction_records")
    .select("id", { head: true, count: "exact" })
    .limit(1);
  if (probeErr && /relation .* does not exist|could not find the table/i.test(probeErr.message)) {
    result.tablesInitialized = false;
    return result;
  }

  // Phase 6B.12 — locked-row-aware upsert. We must update existing
  // unlocked rows so tracking stays in sync with intraday game_predictions
  // refreshes, but we must NEVER overwrite a row that already has
  // locked_at != null (pregame-sweep / lock-on-write owns that
  // transition; pick + line + confidence must freeze at lock). Load
  // existing lock state per (game_id, market, model_version, slate_date)
  // first, then skip the upsert for any locked match.
  const { data: existingLocks } = await supabase
    .from("prediction_records")
    .select("game_id, market, model_version, slate_date, locked_at")
    .in("game_id", proposed.map((r) => r.game_id))
    .eq("slate_date", slateDate);
  const lockedKeys = new Set<string>();
  for (const r of (existingLocks ?? []) as Array<{
    game_id: number;
    market: string;
    model_version: string | null;
    slate_date: string;
    locked_at: string | null;
  }>) {
    if (r.locked_at !== null) {
      lockedKeys.add(
        `${r.game_id}::${r.market}::${r.model_version ?? ""}::${r.slate_date}`,
      );
    }
  }

  // Upsert per (game_id, market, model_version, slate_date). Locked
  // rows are skipped entirely (counted as skippedExisting so the
  // operator/cron summary surfaces them).
  for (const rec of proposed) {
    const key = `${rec.game_id}::${rec.market}::${rec.model_version ?? ""}::${rec.slate_date}`;
    if (lockedKeys.has(key)) {
      result.skippedExisting++;
      continue;
    }
    const { error: upErr } = await supabase
      .from("prediction_records")
      .upsert(rec, {
        onConflict: "game_id,market,model_version,slate_date",
        ignoreDuplicates: false,
      });
    if (upErr) {
      // The most common failure is the conflict path on a table that
      // already has the row — count it as "skippedExisting" if the
      // hint matches.
      if (/duplicate key/i.test(upErr.message)) {
        result.skippedExisting++;
      } else {
        result.errors.push({
          game_id: rec.game_id,
          market: rec.market,
          reason: upErr.message,
        });
      }
    } else {
      result.insertedCount++;
    }
  }
  return result;
}
