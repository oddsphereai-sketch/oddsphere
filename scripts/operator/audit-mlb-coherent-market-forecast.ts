import { loadEnvConfig } from "@next/env";
import { buildFeatureSnapshots } from "../../lib/automodel/featureSnapshot";
import { runMlbAutoModelV1 } from "../../lib/automodel/mlbAutoModelV1";
import { runMlbAutoModelV2_2 } from "../../lib/automodel/mlbAutoModelV2_2";

loadEnvConfig(process.cwd());

const requestedSlateDate = process.argv.find((value) => value.startsWith("--date="))?.slice(7);
if (!requestedSlateDate) throw new Error("Usage: --date=YYYY-MM-DD");
const slateDate: string = requestedSlateDate;

async function main(): Promise<void> {
  const snapshots = await buildFeatureSnapshots("mlb", slateDate);
  const rows = snapshots.map((snapshot) => {
    const baselineSnapshot = {
      ...snapshot,
      market: { ...snapshot.market, coherent_price_map: null },
    };
    const v1 = runMlbAutoModelV1(baselineSnapshot, "morning_draft");
    const baseline = runMlbAutoModelV2_2(baselineSnapshot, v1, "morning_draft");
    const candidate = runMlbAutoModelV2_2(snapshot, v1, "morning_draft");
    const evidence = candidate.v22Audit.coherent_market_price_map;
    return {
      externalId: snapshot.game_external_id,
      matchup: `${snapshot.away_team.abbreviation}@${snapshot.home_team.abbreviation}`,
      listedTotal: snapshot.market.listed_total,
      moneylineApplied: evidence?.moneyline_applied === true,
      totalApplied: evidence?.total_applied === true,
      moneylineSplitConflict: evidence?.moneyline_split_conflict === true,
      totalSplitConflict: evidence?.total_split_conflict === true,
      baseline: summarize(baseline),
      candidate: summarize(candidate),
      scoreChanged:
        baseline.predicted_home_score !== candidate.predicted_home_score
        || baseline.predicted_away_score !== candidate.predicted_away_score,
      moneylineSideChanged: baseline.predicted_ml_winner !== candidate.predicted_ml_winner,
      totalSideChanged: baseline.predicted_ou_side !== candidate.predicted_ou_side,
      moneylineGradeChanged: baseline.v22Audit.ml_play_grade !== candidate.v22Audit.ml_play_grade,
      totalGradeChanged: baseline.v22Audit.ou_play_grade !== candidate.v22Audit.ou_play_grade,
      evidence,
    };
  });

  console.log(JSON.stringify({
    readOnly: true,
    slateDate,
    games: rows.length,
    impact: {
      moneylineApplied: rows.filter((row) => row.moneylineApplied).length,
      totalApplied: rows.filter((row) => row.totalApplied).length,
      scoreChanges: rows.filter((row) => row.scoreChanged).length,
      moneylineSideChanges: rows.filter((row) => row.moneylineSideChanged).length,
      totalSideChanges: rows.filter((row) => row.totalSideChanged).length,
      moneylineGradeChanges: rows.filter((row) => row.moneylineGradeChanged).length,
      totalGradeChanges: rows.filter((row) => row.totalGradeChanged).length,
      moneylineSplitConflicts: rows.filter((row) => row.moneylineSplitConflict).length,
      totalSplitConflicts: rows.filter((row) => row.totalSplitConflict).length,
    },
    changedRows: rows.filter((row) =>
      row.scoreChanged
      || row.moneylineSideChanged
      || row.totalSideChanged
      || row.moneylineGradeChanged
      || row.totalGradeChanged,
    ),
    allRows: rows,
  }, null, 2));
}

function summarize(output: ReturnType<typeof runMlbAutoModelV2_2>) {
  return {
    projectedAway: output.predicted_away_score,
    projectedHome: output.predicted_home_score,
    projectedTotal: output.predicted_total,
    moneylineSide: output.predicted_ml_winner,
    moneylineProbability: output.v22Audit.ml_model_prob,
    moneylineGrade: output.v22Audit.ml_play_grade,
    totalSide: output.predicted_ou_side,
    totalProbability: output.v22Audit.ou_model_prob,
    totalGrade: output.v22Audit.ou_play_grade,
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
