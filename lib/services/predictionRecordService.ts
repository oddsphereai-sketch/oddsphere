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

function buildMlRecord(
  pred: PredictionRow,
  game: GameRow,
  homeAbbrev: string,
  awayAbbrev: string,
  slateDate: string,
  launchDay: boolean,
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
    best_angle: readBoolish(sp.ml_best_angle_eligible),
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
): PredictionRecordRow | null {
  const sp = (pred.sport_specific ?? {}) as Record<string, unknown>;
  const holdPicks = Array.isArray(sp.hold_picks) ? (sp.hold_picks as string[]) : [];
  const held = holdPicks.includes("ou") || pred.predicted_ou_side === null;
  if (held) return null;
  const v21 = (sp.v2_1_audit ?? {}) as Record<string, unknown>;
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
    line_value:
      typeof v21.market_total === "number" ? (v21.market_total as number) : null,
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
    best_angle: readBoolish(sp.ou_best_angle_eligible),
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
}): PredictionRecordRow[] {
  const proposed: PredictionRecordRow[] = [];
  for (const g of args.games) {
    const pred = args.predictionByGameId.get(g.id);
    if (!pred) continue;
    const home = args.abbrevByTeamId.get(g.home_team_id) ?? "?";
    const away = args.abbrevByTeamId.get(g.away_team_id) ?? "?";
    const ml = buildMlRecord(pred, g, home, away, args.slateDate, args.launchDay);
    const ou = buildOuRecord(pred, g, home, away, args.slateDate, args.launchDay);
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

  const proposed = buildPredictionRecordsFromSlate({
    sport,
    slateDate,
    launchDay,
    games,
    predictionByGameId,
    abbrevByTeamId,
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

  // Upsert per (game_id, market, model_version, slate_date)
  for (const rec of proposed) {
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
