#!/usr/bin/env tsx

/** SELECT-only reconciliation of one CFB slate's immutable tracking ledger. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { gradePrediction } from "../../lib/services/predictionGrader";
import type { PredictionRecordRow, GradeResult } from "../../lib/types/domain/Tracking";

loadEnvConfig(process.cwd());

type Json = Record<string, unknown>;
type StoredGrade = {
  result: GradeResult;
  actual_home_score: number | null;
  actual_away_score: number | null;
  actual_total: number | null;
  graded_at: string | null;
};
type RecordRow = PredictionRecordRow & {
  external_id: number | null;
  matchup: string;
  slate_date: string;
  game_date: string;
  play_grade: string | null;
  model_version: string | null;
  calibration_version: string | null;
  snapshot_json: Json | null;
  prediction_grades: StoredGrade | StoredGrade[] | null;
};
type GameRow = {
  id: number;
  status: string;
  home_score: number | null;
  away_score: number | null;
  game_date: string;
};

const date = process.argv.find((value) => value.startsWith("--date="))?.slice(7) ?? "2026-10-03";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase read credentials are required.");

function storedGrade(value: RecordRow["prediction_grades"]): StoredGrade | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function canonicalGrade(value: string | null): string {
  return (value ?? "missing").trim().toLowerCase().replaceAll(" ", "_");
}

function tally(rows: RecordRow[], field: (row: RecordRow) => string): Record<string, number> {
  const output: Record<string, number> = {};
  for (const row of rows) {
    const value = field(row);
    output[value] = (output[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)));
}

async function main(): Promise<void> {
  const client = createClient(url!, key!, { auth: { persistSession: false } });
  const { data, error } = await client
    .from("prediction_records")
    .select([
      "id", "game_id", "external_id", "sport", "slate_date", "game_date", "matchup", "market", "pick", "side",
      "line_value", "odds_american", "confidence", "model_probability", "market_probability", "edge", "expected_value",
      "play_grade", "best_angle", "no_bet", "held", "locked_at", "published_at", "created_at", "model_version",
      "calibration_version", "snapshot_json",
      "prediction_grades(result,actual_home_score,actual_away_score,actual_total,graded_at)",
    ].join(","))
    .eq("sport", "cfb")
    .eq("slate_date", date)
    .order("game_date", { ascending: true })
    .limit(2_000);
  if (error) throw new Error(`CFB prediction-record audit read failed: ${error.message}`);
  const records = (data ?? []) as unknown as RecordRow[];
  const gameIds = [...new Set(records.map((row) => row.game_id))];
  const { data: gameData, error: gameError } = gameIds.length === 0
    ? { data: [], error: null }
    : await client.from("games").select("id,status,home_score,away_score,game_date").in("id", gameIds);
  if (gameError) throw new Error(`CFB game audit read failed: ${gameError.message}`);
  const games = new Map(((gameData ?? []) as GameRow[]).map((game) => [game.id, game]));

  const byGame = new Map<number, RecordRow[]>();
  for (const row of records) byGame.set(row.game_id, [...(byGame.get(row.game_id) ?? []), row]);
  const duplicateKeys = [...new Map(records.map((row) => [`${row.external_id}:${row.market}`, 0])).keys()]
    .filter((key) => records.filter((row) => `${row.external_id}:${row.market}` === key).length > 1);
  const incompleteGames = [...byGame.entries()].flatMap(([gameId, rows]) => {
    const missing = (["moneyline", "spread", "total"] as const).filter((market) => !rows.some((row) => row.market === market));
    return missing.length > 0 ? [{ gameId, matchup: rows[0]?.matchup ?? String(gameId), missing }] : [];
  });
  const lockViolations = records.flatMap((row) => {
    const startsAt = Date.parse(row.game_date);
    const lockedAt = Date.parse(row.locked_at ?? "");
    if (!row.locked_at) return [{ id: row.id, matchup: row.matchup, market: row.market, reason: "missing_lock" }];
    if (!Number.isFinite(startsAt) || !Number.isFinite(lockedAt) || lockedAt > startsAt) {
      return [{ id: row.id, matchup: row.matchup, market: row.market, reason: "lock_after_start", lockedAt: row.locked_at, startsAt: row.game_date }];
    }
    return [];
  });
  const gradeMismatches: Array<Record<string, unknown>> = [];
  const actualMismatches: Array<Record<string, unknown>> = [];
  const missingGrades: Array<Record<string, unknown>> = [];
  for (const row of records) {
    const game = games.get(row.game_id);
    const stored = storedGrade(row.prediction_grades);
    if (!game) {
      missingGrades.push({ id: row.id, matchup: row.matchup, market: row.market, reason: "game_missing" });
      continue;
    }
    if (!stored) {
      missingGrades.push({ id: row.id, matchup: row.matchup, market: row.market, reason: "grade_missing" });
      continue;
    }
    const recomputed = gradePrediction({
      record: row,
      game: { ...game, first_inning_runs: null },
      source: "auto_score_ingest",
    });
    if (stored.result !== recomputed.result) {
      gradeMismatches.push({ id: row.id, matchup: row.matchup, market: row.market, stored: stored.result, recomputed: recomputed.result });
    }
    const expectedTotal = game.home_score === null || game.away_score === null ? null : game.home_score + game.away_score;
    if (stored.actual_home_score !== game.home_score || stored.actual_away_score !== game.away_score || stored.actual_total !== expectedTotal) {
      actualMismatches.push({
        id: row.id, matchup: row.matchup, market: row.market,
        stored: [stored.actual_away_score, stored.actual_home_score, stored.actual_total],
        game: [game.away_score, game.home_score, expectedTotal],
      });
    }
  }

  const resolved = records.filter((row) => {
    const result = storedGrade(row.prediction_grades)?.result;
    return result === "win" || result === "loss" || result === "push";
  });
  const resultByMarketAndGrade = Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => [
    market,
    Object.fromEntries([...new Set(records.filter((row) => row.market === market).map((row) => canonicalGrade(row.play_grade)))]
      .sort()
      .map((grade) => {
        const cohort = records.filter((row) => row.market === market && canonicalGrade(row.play_grade) === grade);
        return [grade, tally(cohort, (row) => storedGrade(row.prediction_grades)?.result ?? "missing")];
      })),
  ]));

  const blockers = duplicateKeys.length + incompleteGames.length + lockViolations.length + gradeMismatches.length + actualMismatches.length + missingGrades.length;
  console.log(JSON.stringify({
    release: "cfb_tracking_integrity_select_audit_2026_10_04_r1",
    readOnly: true,
    providerCalls: 0,
    writes: 0,
    date,
    games: byGame.size,
    records: records.length,
    recordsByMarket: tally(records, (row) => row.market),
    recordsByModelRelease: tally(records, (row) => row.model_version ?? "missing"),
    resolvedRecords: resolved.length,
    resultByMarket: Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => [
      market,
      tally(records.filter((row) => row.market === market), (row) => storedGrade(row.prediction_grades)?.result ?? "missing"),
    ])),
    resultByMarketAndGrade,
    integrity: {
      healthy: blockers === 0,
      blockers,
      duplicateKeys,
      incompleteGames,
      lockViolations,
      missingGrades,
      gradeMismatches,
      actualMismatches,
    },
  }, null, 2));
  if (blockers > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
