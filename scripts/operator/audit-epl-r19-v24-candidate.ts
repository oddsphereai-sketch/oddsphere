/* eslint-disable @typescript-eslint/no-explicit-any -- immutable EPL snapshots have release-specific JSON shapes */
import { createClient } from "@supabase/supabase-js";
import { deriveEplMatchResultDecision } from "../../lib/services/epl/eplPreviewGrade";
import { selectEplMatchResultSide } from "../../lib/services/epl/eplShadowModel";

type Side = "home" | "draw" | "away";
type Grade = "Best Angle" | "Lean" | "Watchlist" | "Caution" | "No Play";

const gradeRank: Record<Grade, number> = { "No Play": 0, Caution: 1, Watchlist: 2, Lean: 3, "Best Angle": 4 };
const actionable = (grade: string) => grade === "Best Angle" || grade === "Lean";

function counts(rows: Array<{ grade: string }>) {
  return Object.fromEntries(["Best Angle", "Lean", "Watchlist", "Caution", "No Play"].map((grade) => [grade, rows.filter((row) => row.grade === grade).length]));
}

function candidate(row: any) {
  const member = row.snapshot_json?.member_market_at_capture ?? row.markets?.moneyline ?? row;
  const context = member.soccerMatchResultContext;
  const projection = row.snapshot_json?.member_projection_at_capture ?? row.soccerProjection;
  const boardRows = member.soccerPriceBoard?.rows ?? [];
  if (!context?.model || !projection?.expectedGoals || boardRows.length !== 3) return null;
  const arbitration = selectEplMatchResultSide({
    lambdaHome: projection.expectedGoals.home,
    lambdaAway: projection.expectedGoals.away,
    likelyScore: { ...projection.likelyScore, probability: projection.likelyScoreProbability ?? 0 },
    probabilities: {
      ...context.model,
      over25: projection.goalOutlookProbabilities?.over25 ?? 0.5,
      under25: projection.goalOutlookProbabilities?.under25 ?? 0.5,
      bttsYes: projection.goalOutlookProbabilities?.bttsYes ?? 0.5,
      bttsNo: projection.goalOutlookProbabilities?.bttsNo ?? 0.5,
    },
  });
  const bySide = new Map<Side, any>(boardRows.map((item: any) => [item.side as Side, item]));
  const decision = deriveEplMatchResultDecision({
    model: context.model,
    market: {
      home: bySide.get("home")?.market_probability,
      draw: bySide.get("draw")?.market_probability,
      away: bySide.get("away")?.market_probability,
    },
    prices: {
      home: bySide.get("home")?.price_american,
      draw: bySide.get("draw")?.price_american,
      away: bySide.get("away")?.price_american,
    },
    promotedProxy: false,
    forecastSide: arbitration.side,
  });
  return { arbitration, decision };
}

function actualSide(home: number, away: number): Side {
  return home > away ? "home" : home < away ? "away" : "draw";
}

async function main() {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: settled, error: settledError } = await client.from("prediction_records")
    .select("id,matchup,pick,play_grade,snapshot_json,prediction_grades(result,actual_home_score,actual_away_score)")
    .eq("sport", "soccer")
    .eq("market", "match_result")
    .eq("model_version", "epl_goals_coherent_2026_09_02_r18_structural_target_exclusion")
    .not("locked_at", "is", null);
  if (settledError) throw settledError;
  const settledRows: any[] = (settled ?? []).flatMap((row: any) => {
    const next = candidate(row);
    const result = row.prediction_grades;
    if (!next || !Number.isFinite(result?.actual_home_score) || !Number.isFinite(result?.actual_away_score)) return [];
    const actual = actualSide(result.actual_home_score, result.actual_away_score);
    const grade = next.decision.grade.verdict.label as Grade;
    return [{
      matchup: row.matchup,
      actual,
      oldSide: row.pick as Side,
      newSide: next.decision.selectedSide,
      oldGrade: row.play_grade as Grade,
      grade,
      oldWin: row.pick === actual,
      newWin: next.decision.selectedSide === actual,
      drawApplied: next.arbitration.applied,
    }];
  });

  const { data: snapshot, error: snapshotError } = await client.from("lab_response_snapshots")
    .select("payload,generated_at")
    .eq("snapshot_key", "soccer::english_premier_league::current-week")
    .single();
  if (snapshotError) throw snapshotError;
  const currentRows: any[] = ((snapshot.payload as any).games ?? []).flatMap((game: any) => {
    const next = candidate(game);
    if (!next) return [];
    return [{
      matchup: `${game.awayTeam}@${game.homeTeam}`,
      oldSide: game.markets.moneyline.soccerMatchResultContext.displayed_side as Side,
      newSide: next.decision.selectedSide,
      oldGrade: game.markets.moneyline.verdict.label as Grade,
      grade: next.decision.grade.verdict.label as Grade,
      probability: game.markets.moneyline.soccerMatchResultContext.model[next.decision.selectedSide],
      price: game.markets.moneyline.soccerPriceBoard.rows.find((item: any) => item.side === next.decision.selectedSide)?.price_american ?? null,
      drawApplied: next.arbitration.applied,
    }];
  });

  const transitions = (rows: Array<{ oldGrade: Grade; grade: Grade }>) => ({
    promotions: rows.filter((row) => gradeRank[row.grade] > gradeRank[row.oldGrade]).length,
    demotions: rows.filter((row) => gradeRank[row.grade] < gradeRank[row.oldGrade]).length,
    actionablePromotions: rows.filter((row) => !actionable(row.oldGrade) && actionable(row.grade)).length,
    actionableDemotions: rows.filter((row) => actionable(row.oldGrade) && !actionable(row.grade)).length,
  });
  const settledActionOld = settledRows.filter((row) => actionable(row.oldGrade));
  const settledActionNew = settledRows.filter((row) => actionable(row.grade));
  console.log(JSON.stringify({
    releases: {
      model: "epl_goals_coherent_2026_10_01_r19_draw_arbitration",
      grade: "epl_grade_policy_2026_10_01_v24_accuracy_first",
    },
    releasePureForward: {
      games: settledRows.length,
      oldAccuracy: settledRows.filter((row) => row.oldWin).length / settledRows.length,
      newAccuracy: settledRows.filter((row) => row.newWin).length / settledRows.length,
      sideChanges: settledRows.filter((row) => row.oldSide !== row.newSide).length,
      correctedByDrawLane: settledRows.filter((row) => row.drawApplied && !row.oldWin && row.newWin).map((row) => row.matchup),
      oldActionable: { plays: settledActionOld.length, wins: settledActionOld.filter((row) => row.oldWin).length },
      newActionable: { plays: settledActionNew.length, wins: settledActionNew.filter((row) => row.newWin).length },
      gradeCountsOld: counts(settledRows.map((row) => ({ grade: row.oldGrade }))),
      gradeCountsNew: counts(settledRows),
      transitions: transitions(settledRows),
    },
    currentBoard: {
      generatedAt: snapshot.generated_at,
      games: currentRows.length,
      sideChanges: currentRows.filter((row) => row.oldSide !== row.newSide).length,
      gradeCountsOld: counts(currentRows.map((row) => ({ grade: row.oldGrade }))),
      gradeCountsNew: counts(currentRows),
      transitions: transitions(currentRows),
      changedRows: currentRows.filter((row) => row.oldSide !== row.newSide || row.oldGrade !== row.grade),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
