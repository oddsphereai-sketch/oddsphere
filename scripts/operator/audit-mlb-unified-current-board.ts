/**
 * SELECT-only current-board rehearsal for the MLB r92 unified distribution.
 * It runs incumbent and candidate from identical stored inputs and never writes.
 */

import { supabase } from "../../lib/db/supabase";
import { generatePredictionsForSlate } from "../../lib/services/automodelService";
import { createPredictionRecords } from "../../lib/services/predictionRecordService";
import type { GameSnapshot } from "../../lib/automodel/types";
import type { PredictionRecordRow } from "../../lib/types/domain/Tracking";

function parseDate(argv: string[]): string {
  const index = argv.indexOf("--date");
  const value = index >= 0 ? argv[index + 1] : null;
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function grade(record: PredictionRecordRow): string {
  if (record.no_bet) return "no_play";
  if (record.best_angle) return "best_angle";
  return record.play_grade?.toLowerCase() ?? "no_play";
}

function actionable(record: PredictionRecordRow): boolean {
  const value = grade(record);
  return value === "best_angle" || value === "lean";
}

function counts(records: PredictionRecordRow[]) {
  const result = { rows: records.length, bestAngles: 0, leans: 0, actionable: 0 };
  for (const record of records) {
    if (grade(record) === "best_angle") result.bestAngles++;
    if (grade(record) === "lean") result.leans++;
    if (actionable(record)) result.actionable++;
  }
  return result;
}

async function replay(
  date: string,
  enabled: boolean,
  auditSnapshotTransform: (snapshots: GameSnapshot[]) => GameSnapshot[],
) {
  const model = await generatePredictionsForSlate("mlb", date, "morning_draft", {
    modelVersion: "v2_2",
    writeToDb: false,
    respectLocks: true,
    auditUnifiedGameDistributionOverride: enabled,
    auditSnapshotTransform,
  });
  if (model.errors.length > 0) throw new Error(JSON.stringify(model.errors));
  const records = await createPredictionRecords({
    sport: "mlb",
    slateDate: date,
    launchDay: false,
    apply: false,
    supabase,
    auditPredictionsOverride: model.predictions,
  });
  if (records.errors.length > 0) throw new Error(JSON.stringify(records.errors));
  return { model, records: records.proposed };
}

async function main() {
  const date = parseDate(process.argv);
  let frozenSnapshots: GameSnapshot[] | null = null;
  const incumbent = await replay(date, false, (snapshots) => {
    frozenSnapshots = structuredClone(snapshots);
    return snapshots;
  });
  const candidate = await replay(date, true, () => {
    if (frozenSnapshots === null) throw new Error("Missing frozen incumbent snapshots.");
    return structuredClone(frozenSnapshots);
  });
  const before = new Map(incumbent.records.map((record) => [`${record.game_id}:${record.market}`, record]));
  let promotions = 0;
  let demotions = 0;
  let mlSideChanges = 0;
  let mlProbabilityChanges = 0;
  let mlGradeChanges = 0;
  let totalSideChanges = 0;
  let invariantFailures = 0;
  let unifiedForecasts = 0;
  const changes: Array<Record<string, unknown>> = [];

  for (const after of candidate.records) {
    const prior = before.get(`${after.game_id}:${after.market}`);
    if (!prior) continue;
    if (!actionable(prior) && actionable(after)) promotions++;
    if (actionable(prior) && !actionable(after)) demotions++;
    if (after.market === "moneyline") {
      if (prior.side !== after.side) mlSideChanges++;
      if (prior.model_probability !== after.model_probability) mlProbabilityChanges++;
      if (grade(prior) !== grade(after)) mlGradeChanges++;
    }
    if (after.market === "total" && prior.side !== after.side) totalSideChanges++;
    const snapshot = object(after.snapshot_json);
    const forecast = object(snapshot.mlb_unified_final_forecast);
    const invariants = object(forecast.invariants);
    if (Object.keys(forecast).length > 0) {
      unifiedForecasts++;
      if (invariants.passed !== true) invariantFailures++;
    }
    if (
      prior.side !== after.side ||
      prior.model_probability !== after.model_probability ||
      grade(prior) !== grade(after)
    ) {
      changes.push({
        gameId: after.game_id,
        matchup: after.matchup,
        market: after.market,
        before: { side: prior.side, probability: prior.model_probability, grade: grade(prior) },
        after: { side: after.side, probability: after.model_probability, grade: grade(after) },
      });
    }
  }

  const candidateMoneyline = candidate.records.filter((record) => record.market === "moneyline");
  const candidateTotals = candidate.records.filter((record) => record.market === "total");
  const modelComparison = incumbent.model.predictions.map((prior, index) => {
    const after = candidate.model.predictions[index];
    const priorAudit = object(object(prior.sport_specific).v2_2_audit);
    const afterAudit = object(object(after?.sport_specific).v2_2_audit);
    return {
      externalId: prior.game_external_id,
      incumbent: {
        homeScore: prior.predicted_home_score,
        awayScore: prior.predicted_away_score,
        mlSide: prior.predicted_ml_winner,
        mlProbability: priorAudit.ml_model_prob,
        totalSide: prior.predicted_ou_side,
        totalProbability: priorAudit.ou_model_prob,
        posteriorHome: priorAudit.posterior_home_runs,
        posteriorAway: priorAudit.posterior_away_runs,
      },
      candidate: {
        homeScore: after?.predicted_home_score,
        awayScore: after?.predicted_away_score,
        mlSide: after?.predicted_ml_winner,
        mlProbability: afterAudit.ml_model_prob,
        totalSide: after?.predicted_ou_side,
        totalProbability: afterAudit.ou_model_prob,
        posteriorHome: afterAudit.posterior_home_runs,
        posteriorAway: afterAudit.posterior_away_runs,
        unifiedMarginAxis: object(object(afterAudit.unified_game_distribution).margin_axis),
      },
    };
  });
  const report = {
    contract: "mlb_unified_current_board_rehearsal_2026_10_16_r1",
    mode: "SELECT-only; no writes",
    date,
    games: candidate.model.game_count,
    heldGames: candidate.model.held_count,
    candidate: {
      moneyline: counts(candidateMoneyline),
      total: counts(candidateTotals),
      unifiedForecastAttachments: unifiedForecasts,
    },
    impact: {
      promotions,
      demotions,
      netActionable: promotions - demotions,
      moneylineSideChanges: mlSideChanges,
      moneylineProbabilityChanges: mlProbabilityChanges,
      moneylineGradeChanges: mlGradeChanges,
      totalSideChanges,
      invariantFailures,
    },
    modelComparison,
    changes,
  };
  console.log(JSON.stringify(report));
  if (mlSideChanges > 0 || mlProbabilityChanges > 0 || mlGradeChanges > 0 || invariantFailures > 0) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    throw new Error("MLB r92 current-board rehearsal violated a frozen Moneyline or coherence invariant.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
