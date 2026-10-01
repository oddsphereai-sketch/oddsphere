/* eslint-disable @typescript-eslint/no-explicit-any -- historical foundation and immutable forward snapshots have versioned JSON shapes */
import { createClient } from "@supabase/supabase-js";
import { fitEplShadowModel, predictEplMatch, type EplTrainingMatch } from "../../lib/services/epl/eplShadowModel";

type Side = "home" | "draw" | "away";
type Example = {
  season: string;
  outcome: Side;
  raw: Side;
  probabilities: Record<Side, number>;
  lambdaHome: number;
  lambdaAway: number;
  modalDraw: boolean;
};

type Rule = {
  maxGap: number;
  maxLambdaGap: number;
  minDrawProbability: number;
  maxClubProbability: number;
  requireModalDraw: boolean;
};

const sides: Side[] = ["home", "draw", "away"];

function selected(probabilities: Record<Side, number>): Side {
  return sides.reduce((best, side) => probabilities[side] > probabilities[best] ? side : best, "home");
}

function actual(home: number, away: number): Side {
  return home > away ? "home" : home < away ? "away" : "draw";
}

function applyRule(row: Example, rule: Rule): Side {
  const bestClub = row.probabilities.home >= row.probabilities.away ? "home" : "away";
  const clubProbability = row.probabilities[bestClub];
  const eligible = row.raw !== "draw"
    && (!rule.requireModalDraw || row.modalDraw)
    && clubProbability - row.probabilities.draw <= rule.maxGap
    && Math.abs(row.lambdaHome - row.lambdaAway) <= rule.maxLambdaGap
    && row.probabilities.draw >= rule.minDrawProbability
    && clubProbability <= rule.maxClubProbability;
  return eligible ? "draw" : row.raw;
}

function metrics(rows: Example[], rule?: Rule) {
  const picks = rows.map((row) => rule ? applyRule(row, rule) : row.raw);
  const wins = picks.filter((pick, index) => pick === rows[index]!.outcome).length;
  const drawIndexes = picks.flatMap((pick, index) => pick === "draw" ? [index] : []);
  const drawWins = drawIndexes.filter((index) => rows[index]!.outcome === "draw").length;
  const actualDraws = rows.filter((row) => row.outcome === "draw").length;
  return {
    games: rows.length,
    wins,
    accuracy: rows.length ? wins / rows.length : null,
    drawCalls: drawIndexes.length,
    drawWins,
    drawPrecision: drawIndexes.length ? drawWins / drawIndexes.length : null,
    actualDraws,
    drawRecall: actualDraws ? drawWins / actualDraws : null,
  };
}

function confidenceCohort(rows: Example[], floor: number) {
  const selectedRows = rows.filter((row) => row.probabilities[row.raw] >= floor);
  const wins = selectedRows.filter((row) => row.raw === row.outcome).length;
  return {
    floor,
    plays: selectedRows.length,
    wins,
    accuracy: selectedRows.length ? wins / selectedRows.length : null,
  };
}

function evaluateSeason(all: EplTrainingMatch[], season: number): Example[] {
  const matches = all.filter((match) => match.season === season).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const history = all.filter((match) => match.season < season);
  return matches.map((match, index) => {
    const prediction = predictEplMatch(
      fitEplShadowModel([...history, ...matches.slice(0, index)], match.date),
      match.home_team_id,
      match.away_team_id,
    );
    const probabilities = {
      home: prediction.probabilities.home,
      draw: prediction.probabilities.draw,
      away: prediction.probabilities.away,
    };
    return {
      season: String(season),
      outcome: actual(match.home_score!, match.away_score!),
      raw: selected(probabilities),
      probabilities,
      lambdaHome: prediction.lambdaHome,
      lambdaAway: prediction.lambdaAway,
      modalDraw: prediction.likelyScore.home === prediction.likelyScore.away,
    };
  });
}

async function currentForward(client: any): Promise<Example[]> {
  const { data, error } = await client.from("prediction_records")
    .select("snapshot_json,prediction_grades(result,actual_home_score,actual_away_score)")
    .eq("sport", "soccer")
    .eq("market", "match_result")
    .eq("model_version", "epl_goals_coherent_2026_09_02_r18_structural_target_exclusion")
    .not("locked_at", "is", null);
  if (error) throw error;
  return ((data ?? []) as any[]).flatMap((row: any) => {
    const grade = row.prediction_grades;
    if (!grade || !Number.isFinite(grade.actual_home_score) || !Number.isFinite(grade.actual_away_score)) return [];
    const market = row.snapshot_json?.member_market_at_capture;
    const probabilities = market?.soccerMatchResultContext?.model;
    const projection = row.snapshot_json?.member_projection_at_capture;
    if (!probabilities || !projection?.expectedGoals) return [];
    return [{
      season: "2026_forward",
      outcome: actual(grade.actual_home_score, grade.actual_away_score),
      raw: selected(probabilities),
      probabilities,
      lambdaHome: projection.expectedGoals.home,
      lambdaAway: projection.expectedGoals.away,
      modalDraw: projection.likelyScore?.home === projection.likelyScore?.away,
    } satisfies Example];
  });
}

async function main() {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await client.from("lab_response_snapshots")
    .select("payload")
    .eq("snapshot_key", "soccer::english_premier_league::historical-foundation::through-2025")
    .single();
  if (error) throw error;
  const all = (data.payload as any).trainingMatches as EplTrainingMatch[];
  const calibration = evaluateSeason(all, 2024);
  const holdout = evaluateSeason(all, 2025);
  const forward = await currentForward(client);
  const rules: Rule[] = [];
  for (const maxGap of [0.02, 0.04, 0.06, 0.08, 0.1, 0.12])
    for (const maxLambdaGap of [0.1, 0.2, 0.3, 0.4, 0.5])
      for (const minDrawProbability of [0.24, 0.26, 0.28, 0.3])
        for (const maxClubProbability of [0.36, 0.38, 0.4, 0.42, 0.45])
          for (const requireModalDraw of [false, true])
            rules.push({ maxGap, maxLambdaGap, minDrawProbability, maxClubProbability, requireModalDraw });
  const candidates = rules.map((rule) => ({ rule, calibration: metrics(calibration, rule) }))
    .filter((row) => row.calibration.drawCalls >= 8)
    .sort((a, b) => (b.calibration.accuracy ?? 0) - (a.calibration.accuracy ?? 0)
      || (b.calibration.drawPrecision ?? 0) - (a.calibration.drawPrecision ?? 0)
      || a.calibration.drawCalls - b.calibration.drawCalls);
  const selectedRule = candidates[0]!.rule;
  console.log(JSON.stringify({
    design: "Select only on 2024-25; report 2025-26 and exact 2026 release as untouched tests.",
    raw: { calibration: metrics(calibration), holdout: metrics(holdout), forward: metrics(forward) },
    confidenceCohorts: Object.fromEntries([0.5, 0.55, 0.6, 0.65].map((floor) => [String(floor), {
      calibration: confidenceCohort(calibration, floor),
      holdout: confidenceCohort(holdout, floor),
      forward: confidenceCohort(forward, floor),
    }])),
    selected: {
      rule: selectedRule,
      calibration: metrics(calibration, selectedRule),
      holdout: metrics(holdout, selectedRule),
      forward: metrics(forward, selectedRule),
    },
    nearbyGapRobustness: [0.06, 0.08, 0.1, 0.12].map((maxGap) => {
      const rule = { maxGap, maxLambdaGap: 0.2, minDrawProbability: 0.24, maxClubProbability: 0.4, requireModalDraw: true };
      return { rule, calibration: metrics(calibration, rule), holdout: metrics(holdout, rule), forward: metrics(forward, rule) };
    }),
    topCalibrationCandidates: candidates.slice(0, 10),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
