/**
 * Phase 7L Phase 4 — NHL prediction grading.
 *
 * Reads prediction_records (sport='nhl', no existing grade) joined to
 * games rows with FINAL status, and writes a `prediction_grades` row
 * per ungraded prediction. Mirrors the MLB/NBA shared grader pattern
 * but stays NHL-scoped.
 *
 * Markets graded:
 *   • moneyline (pick side wins)
 *   • total (over/under vs total goals; push if equal to integer line)
 *
 * Scope:
 *   • Reads:  prediction_records (sport='nhl'), games (NHL FINAL).
 *   • Writes: prediction_grades.
 *   • Idempotent: skips rows that already have a grade.
 */

import { supabase } from "../../db/supabase";
import type { PredictionGradeRow, TrackedMarketV17, GradeResult } from "../../types/domain/Tracking";

export type GradeNhlOptions = {
  /** Restrict to a specific slate_date. Default: all ungraded NHL rows. */
  slateDate?: string;
  /** false = dry-run; true = write prediction_grades. */
  apply: boolean;
  logger?: (msg: string) => void;
};

export type GradeNhlResult = {
  mode: "dry-run" | "write";
  pending: number;     // ungraded NHL records found
  finalGamesAvailable: number; // games with FINAL status
  graded: number;
  errors: string[];
};

type PendingRecord = {
  id: number;
  game_id: number;
  market: TrackedMarketV17;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  slate_date: string;
};

type FinalGame = {
  id: number;
  external_id: number;
  home_team_id: number | null;
  away_team_id: number | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
};

function gradeMoneyline(
  side: string | null,
  homeScore: number | null,
  awayScore: number | null,
): GradeResult {
  if (side === null || homeScore === null || awayScore === null) return "pending";
  if (homeScore === awayScore) return "void"; // overtime resolves NHL — but if we ever see ties, void.
  const homeWon = homeScore > awayScore;
  if (side === "home") return homeWon ? "win" : "loss";
  if (side === "away") return homeWon ? "loss" : "win";
  return "pending";
}

function gradeTotal(
  side: string | null,
  lineValue: number | null,
  homeScore: number | null,
  awayScore: number | null,
): GradeResult {
  if (side === null || lineValue === null || homeScore === null || awayScore === null) return "pending";
  const total = homeScore + awayScore;
  if (total === lineValue) return "push";
  const wentOver = total > lineValue;
  if (side === "over") return wentOver ? "win" : "loss";
  if (side === "under") return wentOver ? "loss" : "win";
  return "pending";
}

export async function gradeNhlPredictions(opts: GradeNhlOptions): Promise<GradeNhlResult> {
  const log = opts.logger ?? (() => {});
  const errors: string[] = [];

  // 1. Find ungraded NHL records. We do this as a NOT-EXISTS join via
  //    two queries (Supabase doesn't expose anti-joins cleanly).
  let pendingQuery = supabase
    .from("prediction_records")
    .select("id, game_id, market, pick, side, line_value, slate_date")
    .eq("sport", "nhl");
  if (opts.slateDate) pendingQuery = pendingQuery.eq("slate_date", opts.slateDate);
  const { data: pendingData, error: pendingErr } = await pendingQuery;
  if (pendingErr) throw new Error(`load pending NHL records: ${pendingErr.message}`);
  const allRecords = (pendingData as PendingRecord[] | null) ?? [];

  // 2. Filter out already-graded. Existing rows with result="pending" are
  //    NOT considered graded — they're placeholders written at locked-
  //    snapshot creation time, and need to be UPDATED once the game goes
  //    FINAL. Only rows with result in {win,loss,push,void} are skipped.
  const recordIds = allRecords.map((r) => r.id);
  const existingGradeByRecordId = new Map<number, { id: number; result: string }>();
  if (recordIds.length > 0) {
    const { data: gradesData } = await supabase
      .from("prediction_grades")
      .select("id, prediction_record_id, result")
      .in("prediction_record_id", recordIds);
    for (const g of (gradesData ?? []) as Array<{ id: number; prediction_record_id: number; result: string }>) {
      existingGradeByRecordId.set(g.prediction_record_id, { id: g.id, result: g.result });
    }
  }
  const ungraded = allRecords.filter((r) => {
    const existing = existingGradeByRecordId.get(r.id);
    return existing === undefined || existing.result === "pending";
  });
  log(`Ungraded NHL records: ${ungraded.length} / ${allRecords.length}`);
  if (ungraded.length === 0) {
    return { mode: opts.apply ? "write" : "dry-run", pending: 0, finalGamesAvailable: 0, graded: 0, errors };
  }

  // 3. Pull the games rows we need (FINAL only).
  const gameIds = [...new Set(ungraded.map((r) => r.game_id))];
  const { data: gamesData, error: gamesErr } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, status, home_score, away_score")
    .in("id", gameIds);
  if (gamesErr) throw new Error(`load games: ${gamesErr.message}`);
  const gameById = new Map<number, FinalGame>(
    ((gamesData as FinalGame[] | null) ?? []).map((g) => [g.id, g]),
  );
  const finalGames = ((gamesData as FinalGame[] | null) ?? []).filter(
    (g) => g.status === "FINAL" || g.status === "OFF",
  );
  log(`Final games available: ${finalGames.length} / ${gameIds.length}`);

  // 4. Grade each ungraded record where the game is FINAL.
  let graded = 0;
  for (const r of ungraded) {
    const g = gameById.get(r.game_id);
    if (!g || (g.status !== "FINAL" && g.status !== "OFF")) {
      continue; // game not yet final
    }
    let result: GradeResult = "pending";
    if (r.market === "moneyline") {
      result = gradeMoneyline(r.side, g.home_score, g.away_score);
    } else if (r.market === "total") {
      result = gradeTotal(r.side, r.line_value, g.home_score, g.away_score);
    }
    if (result === "pending") continue;

    const gradeRow: Omit<PredictionGradeRow, "id"> = {
      prediction_record_id: r.id,
      game_id: r.game_id,
      market: r.market,
      result,
      push: result === "push",
      win: result === "win",
      loss: result === "loss",
      void: result === "void",
      pending: false,
    } as Omit<PredictionGradeRow, "id">;

    if (!opts.apply) {
      log(`  [dry-run] record=${r.id} game=${r.game_id} ${r.market}/${r.side} pick="${r.pick}" final=${g.away_score}-${g.home_score} → ${result}`);
      graded += 1;
      continue;
    }
    const existing = existingGradeByRecordId.get(r.id);
    if (existing !== undefined) {
      // UPDATE the placeholder pending row in place. Idempotent — same
      // grade row id, new result/booleans.
      const { error: upErr } = await supabase
        .from("prediction_grades")
        .update({
          result: gradeRow.result,
          push: gradeRow.push,
          win: gradeRow.win,
          loss: gradeRow.loss,
          void: gradeRow.void,
          pending: gradeRow.pending,
        })
        .eq("id", existing.id);
      if (upErr) {
        const msg = `  ✗ update grade for record=${r.id} (grade.id=${existing.id}): ${upErr.message}`;
        log(msg);
        errors.push(msg);
      } else {
        log(`  ✓ updated record=${r.id} ${r.market}/${r.side} pending → ${result}`);
        graded += 1;
      }
      continue;
    }
    const { error: insErr } = await supabase
      .from("prediction_grades")
      .insert(gradeRow);
    if (insErr) {
      const msg = `  ✗ insert grade for record=${r.id}: ${insErr.message}`;
      log(msg);
      errors.push(msg);
    } else {
      log(`  ✓ inserted record=${r.id} ${r.market}/${r.side} → ${result}`);
      graded += 1;
    }
  }

  return {
    mode: opts.apply ? "write" : "dry-run",
    pending: ungraded.length,
    finalGamesAvailable: finalGames.length,
    graded,
    errors,
  };
}
