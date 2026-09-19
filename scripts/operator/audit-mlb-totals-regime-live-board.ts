/**
 * SELECT-only exact-board comparison for the MLB totals regime candidate.
 *
 * It runs the incumbent (explicit null regime prior) and candidate (the
 * production rolling prior) from the same slate, then sends each result
 * through the authoritative prediction-record builder. No rows are written.
 *
 * Usage:
 *   npx tsx --env-file=.env.local \
 *     scripts/operator/audit-mlb-totals-regime-live-board.ts --date 2026-09-19
 */

import { generatePredictionsForSlate } from "../../lib/services/automodelService";
import { createPredictionRecords } from "../../lib/services/predictionRecordService";
import { supabase } from "../../lib/db/supabase";
import type { PredictionRecordRow } from "../../lib/types/domain/Tracking";

function parseDate(argv: string[]): string {
  const index = argv.indexOf("--date");
  const value = index >= 0 ? argv[index + 1] : null;
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  throw new Error("Usage: audit-mlb-totals-regime-live-board.ts --date YYYY-MM-DD");
}

function grade(record: PredictionRecordRow): string {
  if (record.no_bet) return "no_play";
  if (record.best_angle) return "best_angle";
  return record.play_grade?.toLowerCase() ?? "no_play";
}

function actionable(record: PredictionRecordRow): boolean {
  const resolved = grade(record);
  return !record.no_bet && (resolved === "best_angle" || resolved === "lean");
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function counts(records: PredictionRecordRow[]): Record<string, number> {
  const output = {
    best_angle: 0,
    lean: 0,
    watchlist: 0,
    no_play: 0,
    other: 0,
    actionable: 0,
  };
  for (const record of records) {
    const resolved = grade(record);
    if (resolved === "best_angle") output.best_angle++;
    else if (resolved === "lean") output.lean++;
    else if (resolved === "watchlist" || resolved === "market_aligned" || resolved === "provisional") {
      output.watchlist++;
    } else if (resolved === "no_play") output.no_play++;
    else output.other++;
    if (actionable(record)) output.actionable++;
  }
  return output;
}

async function main(): Promise<void> {
  const date = parseDate(process.argv);
  const incumbent = await generatePredictionsForSlate("mlb", date, "morning_draft", {
    modelVersion: "v2_2",
    writeToDb: false,
    respectLocks: false,
    auditTotalsRegimePriorOverride: null,
  });
  const candidate = await generatePredictionsForSlate("mlb", date, "morning_draft", {
    modelVersion: "v2_2",
    writeToDb: false,
    respectLocks: false,
  });
  if (incumbent.errors.length > 0 || candidate.errors.length > 0) {
    throw new Error(`Model replay errors: ${JSON.stringify({
      incumbent: incumbent.errors,
      candidate: candidate.errors,
    })}`);
  }

  const [incumbentRecords, candidateRecords] = await Promise.all([
    createPredictionRecords({
      sport: "mlb",
      slateDate: date,
      launchDay: false,
      apply: false,
      supabase,
      auditPredictionsOverride: incumbent.predictions,
    }),
    createPredictionRecords({
      sport: "mlb",
      slateDate: date,
      launchDay: false,
      apply: false,
      supabase,
      auditPredictionsOverride: candidate.predictions,
    }),
  ]);
  if (incumbentRecords.errors.length > 0 || candidateRecords.errors.length > 0) {
    throw new Error(`Record replay errors: ${JSON.stringify({
      incumbent: incumbentRecords.errors,
      candidate: candidateRecords.errors,
    })}`);
  }

  const incumbentTotals = incumbentRecords.proposed.filter((record) => record.market === "total");
  const candidateTotals = candidateRecords.proposed.filter((record) => record.market === "total");
  const incumbentByGame = new Map(incumbentTotals.map((record) => [record.game_id, record]));
  const candidateByGame = new Map(candidateTotals.map((record) => [record.game_id, record]));
  let promotions = 0;
  let demotions = 0;
  let sideChanges = 0;
  let probabilityChanges = 0;
  const changes: Array<Record<string, unknown>> = [];
  for (const [gameId, after] of candidateByGame) {
    const before = incumbentByGame.get(gameId);
    if (!before) continue;
    const beforeActionable = actionable(before);
    const afterActionable = actionable(after);
    if (!beforeActionable && afterActionable) promotions++;
    if (beforeActionable && !afterActionable) demotions++;
    if (before.side !== after.side) sideChanges++;
    if (before.model_probability !== after.model_probability) probabilityChanges++;
    if (
      before.side !== after.side ||
      grade(before) !== grade(after) ||
      before.no_bet !== after.no_bet ||
      before.model_probability !== after.model_probability
    ) {
      changes.push({
        gameId,
        matchup: after.matchup,
        before: {
          side: before.side,
          probability: before.model_probability,
          grade: grade(before),
          noBet: before.no_bet,
          reason: before.no_bet_reason,
        },
        after: {
          side: after.side,
          probability: after.model_probability,
          grade: grade(after),
          noBet: after.no_bet,
          reason: after.no_bet_reason,
        },
      });
    }
  }
  const prior = candidate.predictions
    .map((prediction) => object(object(
      object(prediction.sport_specific).v2_2_audit,
    ).total_regime_calibration).prior)
    .find((value) => value !== null && value !== undefined) ?? null;
  console.log(JSON.stringify({
    contract: "mlb_totals_regime_live_board_audit_2026_09_19_r1",
    mode: "SELECT-only; no writes",
    date,
    games: candidate.game_count,
    prior,
    incumbent: counts(incumbentTotals),
    candidate: counts(candidateTotals),
    promotions,
    demotions,
    netActionable: promotions - demotions,
    sideChanges,
    probabilityChanges,
    changes,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
