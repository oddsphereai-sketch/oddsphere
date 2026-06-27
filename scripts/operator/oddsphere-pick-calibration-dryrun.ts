/**
 * Read-only pick calibration production dry-run.
 *
 * Rebuilds today's MLB prediction_records with calibration flags off and on,
 * then reports the exact proposed row differences. No DB writes.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/oddsphere-pick-calibration-dryrun.ts
 */

import { supabase } from "../../lib/db/supabase";
import { currentSlateDate } from "../../lib/dates/slateDate";
import { createPredictionRecords } from "../../lib/services/predictionRecordService";
import {
  MLB_ML_PICK_CALIBRATION_ENABLED_ENV,
  MLB_PICK_CALIBRATION_ENABLED_ENV,
} from "../../lib/services/pickCalibrationLayer";

const slateDate = process.argv.includes("--date")
  ? process.argv[process.argv.indexOf("--date") + 1] ?? currentSlateDate("mlb")
  : currentSlateDate("mlb");

function setFlags(enabled: boolean) {
  process.env[MLB_PICK_CALIBRATION_ENABLED_ENV] = enabled ? "true" : "false";
  process.env[MLB_ML_PICK_CALIBRATION_ENABLED_ENV] = enabled ? "true" : "false";
}

function key(row: { game_id: number; market: string; model_version: string | null; slate_date: string }) {
  return `${row.game_id}::${row.market}::${row.model_version ?? ""}::${row.slate_date}`;
}

async function build(enabled: boolean) {
  setFlags(enabled);
  const res = await createPredictionRecords({
    sport: "mlb",
    slateDate,
    launchDay: false,
    apply: false,
    supabase,
  });
  if (res.errors.length) {
    throw new Error(`${enabled ? "enabled" : "disabled"} dry-run errors: ${JSON.stringify(res.errors)}`);
  }
  return res.proposed.filter((r) => r.market === "moneyline");
}

async function main() {
  const off = await build(false);
  const on = await build(true);
  const offByKey = new Map(off.map((r) => [key(r), r]));
  const changes = on
    .map((enabledRow) => {
      const disabledRow = offByKey.get(key(enabledRow));
      if (!disabledRow) return null;
      const changed =
        disabledRow.side !== enabledRow.side ||
        disabledRow.pick !== enabledRow.pick ||
        disabledRow.odds_american !== enabledRow.odds_american ||
        disabledRow.model_probability !== enabledRow.model_probability ||
        disabledRow.market_probability !== enabledRow.market_probability ||
        disabledRow.edge !== enabledRow.edge ||
        disabledRow.play_grade !== enabledRow.play_grade ||
        disabledRow.best_angle !== enabledRow.best_angle;
      if (!changed) return null;
      return {
        matchup: enabledRow.matchup,
        game_id: enabledRow.game_id,
        market: enabledRow.market,
        locked_at: enabledRow.locked_at,
        flagsOff: {
          side: disabledRow.side,
          price: disabledRow.odds_american,
          confidence: disabledRow.confidence,
          model_probability: disabledRow.model_probability,
          market_probability: disabledRow.market_probability,
          edge: disabledRow.edge,
          grade: disabledRow.play_grade,
          best_angle: disabledRow.best_angle,
        },
        flagsOn: {
          side: enabledRow.side,
          price: enabledRow.odds_american,
          confidence: enabledRow.confidence,
          model_probability: enabledRow.model_probability,
          market_probability: enabledRow.market_probability,
          edge: enabledRow.edge,
          grade: enabledRow.play_grade,
          best_angle: enabledRow.best_angle,
        },
        calibration: enabledRow.snapshot_json?.pick_calibration ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    slateDate,
    flags: {
      [MLB_PICK_CALIBRATION_ENABLED_ENV]: "dry-run true only",
      [MLB_ML_PICK_CALIBRATION_ENABLED_ENV]: "dry-run true only",
    },
    proposedMoneylineRows: on.length,
    changedRows: changes.length,
    changes,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
