/**
 * Push 4c — Prediction grading service.
 *
 * Encapsulates the grading flow so both the operator (grade-predictions.ts)
 * AND the tracking-refresh cron call the same code. Pure-ish: takes a
 * supabase client, loads records + games + existing grades, computes
 * grades via gradePrediction, upserts new/changed grades.
 *
 * Idempotent on prediction_record_id (1:1 with prediction_grades).
 * Never writes to game_predictions. Never modifies prediction_records.
 *
 * Skip rules (avoid regressing finalized grades):
 *   - If existing grade row is non-pending AND new grade is pending,
 *     SKIP the upsert. We never flip a graded record back to pending
 *     just because the score data temporarily disappeared.
 *
 * Launch-day handling:
 *   - launch_day records ARE graded (so admin can see today's outcomes)
 *   - launch_day records are EXCLUDED from member-facing fresh-tracking
 *     aggregates by the tracking aggregate service, not here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { gradePrediction } from "./predictionGrader";
import {
  selectClosingLine,
  buildClosingLineValue,
  type ClosingLineHistoryRow,
} from "./closingLineCapture";
import type {
  PredictionGradeRow,
  PredictionRecordRow,
  TrackedSport,
} from "../types/domain/Tracking";

export type GradingResult = {
  sport: TrackedSport;
  slateDate: string;
  recordsLoaded: number;
  computed: {
    wins: number;
    losses: number;
    pushes: number;
    voids: number;
    pending: number;
  };
  upsertedCount: number;
  skippedPendingDowngrade: number;
  /** Settle-time CLV/closing-line captures written to snapshot_json (MLB ml/total). */
  clvCaptured: number;
  errors: Array<{ prediction_record_id: number | undefined; reason: string }>;
};

/**
 * Pure helper: should we upsert this new grade row?
 *
 *   - If no existing grade → yes
 *   - If existing was pending and new is anything → yes
 *   - If existing was a final result and new is pending → NO (avoid regression)
 *   - If existing was final and new is also final (same result) → yes (no-op)
 */
export function shouldUpsertGrade(args: {
  existingResult: string | null | undefined;
  newResult: string;
}): boolean {
  const existing = args.existingResult;
  if (existing === null || existing === undefined) return true;
  if (existing === "pending") return true;
  if (args.newResult === "pending") return false;
  return true;
}

export async function gradePredictionsForSlate(args: {
  sport: TrackedSport;
  slateDate: string;
  apply: boolean;
  supabase: SupabaseClient;
  source: PredictionGradeRow["grade_source"];
}): Promise<GradingResult> {
  const { sport, slateDate, apply, supabase, source } = args;
  const result: GradingResult = {
    sport,
    slateDate,
    recordsLoaded: 0,
    computed: { wins: 0, losses: 0, pushes: 0, voids: 0, pending: 0 },
    upsertedCount: 0,
    skippedPendingDowngrade: 0,
    clvCaptured: 0,
    errors: [],
  };

  // Load records
  const { data: recRows, error: recErr } = await supabase
    .from("prediction_records")
    .select("*")
    .eq("sport", sport)
    .eq("slate_date", slateDate);
  if (recErr) {
    result.errors.push({ prediction_record_id: undefined, reason: `records fetch: ${recErr.message}` });
    return result;
  }
  const records = (recRows ?? []) as PredictionRecordRow[];
  result.recordsLoaded = records.length;
  if (records.length === 0) return result;

  // Load games + first_inning_runs
  const gameIds = Array.from(new Set(records.map((r) => r.game_id)));
  const { data: gameRows, error: gErr } = await supabase
    .from("games")
    .select("id, status, home_score, away_score, first_inning_runs, game_date")
    .in("id", gameIds);
  if (gErr) {
    result.errors.push({ prediction_record_id: undefined, reason: `games fetch: ${gErr.message}` });
    return result;
  }
  const gameById = new Map<number, {
    id: number;
    status: string | null;
    home_score: number | null;
    away_score: number | null;
    first_inning_runs: number | null;
    game_date: string | null;
  }>(
    ((gameRows ?? []) as Array<{
      id: number;
      status: string | null;
      home_score: number | null;
      away_score: number | null;
      first_inning_runs: number | null;
      game_date: string | null;
    }>).map((g) => [g.id, g]),
  );

  // 2026-06-22 — Settle-time CLV/closing-line capture (MLB ml/total only;
  // line_history does not carry first_inning). Reconstruct the closing line
  // from line_history and stamp a closing_line_value audit blob into
  // prediction_records.snapshot_json. Only fetch history for games that still
  // have an uncaptured ml/total record. Additive audit — never touches grades
  // or any decision field; idempotent (skips rows already captured).
  const closingHistByGame = new Map<number, ClosingLineHistoryRow[]>();
  if (apply && sport === "mlb") {
    const gamesNeedingClv = new Set<number>();
    for (const rec of records) {
      if (rec.market !== "moneyline" && rec.market !== "total") continue;
      if (rec.side === null) continue;
      const existing = (rec.snapshot_json?.closing_line_value ?? null) as
        | { closing_odds_american?: number | null }
        | null;
      if (existing === null || existing.closing_odds_american == null) {
        gamesNeedingClv.add(rec.game_id);
      }
    }
    const histResults = await Promise.all(
      Array.from(gamesNeedingClv).map(async (gid) => {
        const g = gameById.get(gid);
        if (!g?.game_date) return [gid, [] as ClosingLineHistoryRow[]] as const;
        const { data } = await supabase
          .from("line_history")
          .select("market_type, side, sportsbook, odds_american, line_value, recorded_at")
          .eq("game_id", gid)
          .in("market_type", ["moneyline", "total"])
          .is("player_id", null)
          .lte("recorded_at", g.game_date)
          .order("recorded_at", { ascending: false })
          .limit(150);
        return [gid, (data ?? []) as ClosingLineHistoryRow[]] as const;
      }),
    );
    for (const [gid, rows] of histResults) closingHistByGame.set(gid, rows);
  }

  // Existing grades — to decide skip-vs-upsert
  const recordIds = records
    .map((r) => r.id)
    .filter((x): x is number => x !== undefined);
  const { data: existingGrades } = await supabase
    .from("prediction_grades")
    .select("prediction_record_id, result")
    .in("prediction_record_id", recordIds);
  const existingByRecordId = new Map<number, string>(
    ((existingGrades ?? []) as Array<{ prediction_record_id: number; result: string }>).map(
      (g) => [g.prediction_record_id, g.result],
    ),
  );

  const nowISO = new Date().toISOString();
  for (const rec of records) {
    const game = gameById.get(rec.game_id);
    if (game === undefined || rec.id === undefined) continue;
    const grade = gradePrediction({
      record: rec,
      game: {
        status: game.status ?? "unknown",
        home_score: game.home_score,
        away_score: game.away_score,
        first_inning_runs: game.first_inning_runs,
      },
      source,
    });
    if (grade.win) result.computed.wins++;
    else if (grade.loss) result.computed.losses++;
    else if (grade.push) result.computed.pushes++;
    else if (grade.void) result.computed.voids++;
    else result.computed.pending++;

    // Settle-time CLV capture (MLB ml/total). Runs once per record on/after the
    // first settled result, independent of the grade upsert skip logic, so a
    // capture that previously failed is retried. Skips gracefully when no
    // closing line exists (e.g. first_inning, or no pre-start history).
    if (
      apply &&
      sport === "mlb" &&
      grade.result !== "pending" &&
      (rec.market === "moneyline" || rec.market === "total") &&
      rec.side !== null &&
      game.game_date !== null
    ) {
      const existing = (rec.snapshot_json?.closing_line_value ?? null) as
        | { closing_odds_american?: number | null }
        | null;
      const alreadyCaptured = existing !== null && existing.closing_odds_american != null;
      if (!alreadyCaptured) {
        const histRows: ClosingLineHistoryRow[] = closingHistByGame.get(rec.game_id) ?? [];
        const selection = selectClosingLine(histRows, rec.market, rec.side, game.game_date);
        if (selection !== null) {
          const closingLineValue = buildClosingLineValue({
            market: rec.market,
            side: rec.side,
            betOddsAmerican: rec.odds_american,
            selection,
            gameDateISO: game.game_date,
            nowISO,
          });
          const mergedSnapshot = { ...(rec.snapshot_json ?? {}), closing_line_value: closingLineValue };
          const { error: clvErr } = await supabase
            .from("prediction_records")
            .update({ snapshot_json: mergedSnapshot })
            .eq("id", rec.id);
          if (clvErr) {
            result.errors.push({ prediction_record_id: rec.id, reason: `clv capture: ${clvErr.message}` });
          } else {
            result.clvCaptured++;
          }
        }
      }
    }

    const existingResult = existingByRecordId.get(rec.id);
    const shouldWrite = shouldUpsertGrade({
      existingResult,
      newResult: grade.result,
    });
    if (!shouldWrite) {
      result.skippedPendingDowngrade++;
      continue;
    }
    if (!apply) {
      // dry-run mode — count but don't write
      result.upsertedCount++;
      continue;
    }

    // Phase 6B.21 — stamp graded_at = NOW when a row transitions from
    // pending (or first insert) to a settled result. Postgres UPDATE
    // doesn't bump the DB DEFAULT now() on conflict, so without this
    // explicit stamp a row that was first INSERTed as pending then
    // UPSERTed to win/loss keeps the original pending-time timestamp —
    // which would mis-order the "Latest Results" feed. We do NOT bump
    // graded_at on settled→settled idempotent re-upserts (would cause
    // historical rows to perpetually float to the top of the feed).
    const isFirstSettle =
      grade.result !== "pending" &&
      (existingResult === undefined ||
        existingResult === null ||
        existingResult === "pending");
    const payload = isFirstSettle
      ? { ...grade, graded_at: new Date().toISOString() }
      : grade;
    const { error: upErr } = await supabase
      .from("prediction_grades")
      .upsert(payload, { onConflict: "prediction_record_id" });
    if (upErr) {
      result.errors.push({ prediction_record_id: rec.id, reason: upErr.message });
      continue;
    }
    result.upsertedCount++;
  }

  return result;
}
