/* eslint-disable @typescript-eslint/no-explicit-any -- historical snapshot is validated at its storage boundary */
import { createClient } from "@supabase/supabase-js";
import { bivariatePoissonScoreDistribution } from "../../lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "../../lib/services/soccer/soccerMarketProbabilities";
import { selectEplMatchResultSide, type EplTrainingMatch } from "../../lib/services/epl/eplShadowModel";

type Side = "home" | "draw" | "away";
type Config = {
  learningRate: number;
  xgWeight: number;
  stateHalfLifeDays: number;
  seasonRegression: number;
};
type ClubState = { attack: number; defenceWeakness: number; lastPlayedAt: number | null };
type Forecast = {
  home: number;
  away: number;
  actualHome: number;
  actualAway: number;
  probabilities: { home: number; draw: number; away: number; over: number; btts: number };
  side: Side;
};

const SNAPSHOT_KEY = "soccer::english_premier_league::historical-foundation::through-2025";
const TAU = -0.1;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const safeLog = (value: number) => Math.log(clamp(value, 1e-9, 1 - 1e-9));

function effectiveGoal(goals: number, xg: number | null, weight: number): number {
  return finite(xg) && xg >= 0 ? (1 - weight) * goals + weight * xg : goals;
}

function actualSide(home: number, away: number): Side {
  return home > away ? "home" : home < away ? "away" : "draw";
}

function freshState(): ClubState {
  return { attack: 0, defenceWeakness: 0, lastPlayedAt: null };
}

function decayState(state: ClubState, kickoff: number, halfLifeDays: number): ClubState {
  if (state.lastPlayedAt === null) return state;
  const ageDays = Math.max(0, (kickoff - state.lastPlayedAt) / 86_400_000);
  const factor = Math.pow(0.5, ageDays / halfLifeDays);
  return { ...state, attack: state.attack * factor, defenceWeakness: state.defenceWeakness * factor };
}

function scoreDistribution(lambdaHome: number, lambdaAway: number) {
  const joint = bivariatePoissonScoreDistribution(lambdaHome, lambdaAway, TAU);
  const market = deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
  let likelyScore = { home: 0, away: 0, probability: joint[0]![0]! };
  for (let home = 0; home < joint.length; home++) for (let away = 0; away < joint[home]!.length; away++) {
    if (joint[home]![away]! > likelyScore.probability) likelyScore = { home, away, probability: joint[home]![away]! };
  }
  const side = selectEplMatchResultSide({
    lambdaHome,
    lambdaAway,
    likelyScore,
    probabilities: {
      home: market.match_result.home,
      draw: market.match_result.draw,
      away: market.match_result.away,
      over25: market.total.over,
      under25: market.total.under,
      bttsYes: market.btts.yes,
      bttsNo: market.btts.no,
    },
  }).side;
  return {
    side,
    probabilities: {
      home: market.match_result.home,
      draw: market.match_result.draw,
      away: market.match_result.away,
      over: 0.6 * market.total.over + 0.4 * 0.5,
      btts: 0.65 * market.btts.yes + 0.35 * 0.5,
    },
  };
}

function evaluateSeason(matches: EplTrainingMatch[], season: number, config: Config): Forecast[] {
  const states = new Map<number, ClubState>();
  let baseHome = Math.log(1.5);
  let baseAway = Math.log(1.2);
  let previousSeason: number | null = null;
  const output: Forecast[] = [];
  const ordered = matches.filter((match) => match.season <= season)
    .sort((left, right) => Date.parse(left.date) - Date.parse(right.date) || left.id - right.id);
  const rounds = new Map<string, EplTrainingMatch[]>();
  for (const match of ordered) {
    const key = `${match.season}|${String(match.round_number ?? match.date.slice(0, 10))}`;
    rounds.set(key, [...(rounds.get(key) ?? []), match]);
  }
  for (const round of rounds.values()) {
    const roundSeason = round[0]!.season;
    if (previousSeason !== null && roundSeason !== previousSeason) {
      for (const state of states.values()) {
        state.attack *= config.seasonRegression;
        state.defenceWeakness *= config.seasonRegression;
      }
    }
    previousSeason = roundSeason;
    const pending: Array<{ match: EplTrainingMatch; home: ClubState; away: ClubState; lambdaHome: number; lambdaAway: number }> = [];
    for (const match of round) {
      if (match.home_score === null || match.away_score === null) continue;
      const kickoff = Date.parse(match.date);
      const home = decayState(states.get(match.home_team_id) ?? freshState(), kickoff, config.stateHalfLifeDays);
      const away = decayState(states.get(match.away_team_id) ?? freshState(), kickoff, config.stateHalfLifeDays);
      const lambdaHome = clamp(Math.exp(baseHome + home.attack + away.defenceWeakness), 0.2, 4.2);
      const lambdaAway = clamp(Math.exp(baseAway + away.attack + home.defenceWeakness), 0.2, 4.2);
      if (roundSeason === season) {
        output.push({
          home: lambdaHome,
          away: lambdaAway,
          actualHome: match.home_score,
          actualAway: match.away_score,
          ...scoreDistribution(lambdaHome, lambdaAway),
        });
      }
      pending.push({ match, home, away, lambdaHome, lambdaAway });
    }
    // Update only after every same-round forecast has been created.
    for (const row of pending) {
      const kickoff = Date.parse(row.match.date);
      const targetHome = effectiveGoal(row.match.home_score!, row.match.home_xg, config.xgWeight);
      const targetAway = effectiveGoal(row.match.away_score!, row.match.away_xg, config.xgWeight);
      const homeResidual = clamp(Math.log((targetHome + 0.35) / (row.lambdaHome + 0.35)), -1, 1);
      const awayResidual = clamp(Math.log((targetAway + 0.35) / (row.lambdaAway + 0.35)), -1, 1);
      row.home.attack = clamp(row.home.attack + 0.5 * config.learningRate * homeResidual, -0.9, 0.9);
      row.away.defenceWeakness = clamp(row.away.defenceWeakness + 0.5 * config.learningRate * homeResidual, -0.9, 0.9);
      row.away.attack = clamp(row.away.attack + 0.5 * config.learningRate * awayResidual, -0.9, 0.9);
      row.home.defenceWeakness = clamp(row.home.defenceWeakness + 0.5 * config.learningRate * awayResidual, -0.9, 0.9);
      row.home.lastPlayedAt = kickoff;
      row.away.lastPlayedAt = kickoff;
      states.set(row.match.home_team_id, row.home);
      states.set(row.match.away_team_id, row.away);
      baseHome = clamp(baseHome + 0.01 * config.learningRate * homeResidual, Math.log(0.9), Math.log(2.1));
      baseAway = clamp(baseAway + 0.01 * config.learningRate * awayResidual, Math.log(0.7), Math.log(1.8));
    }
    const active = [...states.values()];
    if (active.length > 0) {
      const attackMean = active.reduce((sum, state) => sum + state.attack, 0) / active.length;
      const defenceMean = active.reduce((sum, state) => sum + state.defenceWeakness, 0) / active.length;
      for (const state of active) {
        state.attack -= attackMean;
        state.defenceWeakness -= defenceMean;
      }
    }
  }
  return output;
}

function correlation(left: number[], right: number[]): number | null {
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / left.length;
  const meanRight = right.reduce((sum, value) => sum + value, 0) / right.length;
  const numerator = left.reduce((sum, value, index) => sum + (value - meanLeft) * (right[index]! - meanRight), 0);
  const denominator = Math.sqrt(
    left.reduce((sum, value) => sum + (value - meanLeft) ** 2, 0)
      * right.reduce((sum, value) => sum + (value - meanRight) ** 2, 0),
  );
  return denominator > 0 ? numerator / denominator : null;
}

function standardDeviation(values: number[]): number {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function metrics(rows: Forecast[]) {
  const sides: Side[] = ["home", "draw", "away"];
  const teamForecasts = rows.flatMap((row) => [row.home, row.away]);
  const teamActuals = rows.flatMap((row) => [row.actualHome, row.actualAway]);
  const totalForecasts = rows.map((row) => row.home + row.away);
  const totalActuals = rows.map((row) => row.actualHome + row.actualAway);
  const marginForecasts = rows.map((row) => row.home - row.away);
  const marginActuals = rows.map((row) => row.actualHome - row.actualAway);
  return {
    matches: rows.length,
    resultAccuracy: rows.filter((row) => row.side === actualSide(row.actualHome, row.actualAway)).length / rows.length,
    resultBrier: rows.reduce((sum, row) => sum + sides.reduce((inner, side) => inner
      + (row.probabilities[side] - Number(side === actualSide(row.actualHome, row.actualAway))) ** 2, 0), 0) / rows.length,
    resultLogLoss: rows.reduce((sum, row) => sum - safeLog(row.probabilities[actualSide(row.actualHome, row.actualAway)]), 0) / rows.length,
    teamScoreMae: teamForecasts.reduce((sum, value, index) => sum + Math.abs(value - teamActuals[index]!), 0) / teamForecasts.length,
    totalMae: totalForecasts.reduce((sum, value, index) => sum + Math.abs(value - totalActuals[index]!), 0) / rows.length,
    marginMae: marginForecasts.reduce((sum, value, index) => sum + Math.abs(value - marginActuals[index]!), 0) / rows.length,
    totalBrier: rows.reduce((sum, row) => sum + (row.probabilities.over - Number(row.actualHome + row.actualAway > 2.5)) ** 2, 0) / rows.length,
    bttsBrier: rows.reduce((sum, row) => sum + (row.probabilities.btts - Number(row.actualHome > 0 && row.actualAway > 0)) ** 2, 0) / rows.length,
    totalAccuracy: rows.filter((row) => (row.probabilities.over >= 0.5) === (row.actualHome + row.actualAway > 2.5)).length / rows.length,
    bttsAccuracy: rows.filter((row) => (row.probabilities.btts >= 0.5) === (row.actualHome > 0 && row.actualAway > 0)).length / rows.length,
    projectedTeamSd: standardDeviation(teamForecasts),
    actualTeamSd: standardDeviation(teamActuals),
    teamScoreCorrelation: correlation(teamForecasts, teamActuals),
    totalCorrelation: correlation(totalForecasts, totalActuals),
    marginCorrelation: correlation(marginForecasts, marginActuals),
    selectedSides: Object.fromEntries(sides.map((side) => [side, rows.filter((row) => row.side === side).length])),
  };
}

function selectionScore(value: ReturnType<typeof metrics>) {
  return value.teamScoreMae + 0.2 * value.resultLogLoss + 0.1 * value.totalMae + 0.1 * value.marginMae;
}

async function main() {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await client.from("lab_response_snapshots").select("payload").eq("snapshot_key", SNAPSHOT_KEY).single();
  if (error) throw error;
  const matches = (data.payload as any).trainingMatches as EplTrainingMatch[];
  const candidates: Config[] = [];
  for (const learningRate of [0.03, 0.06, 0.1, 0.16])
    for (const xgWeight of [0.2, 0.5, 0.8])
      for (const stateHalfLifeDays of [180, 365, 730])
        for (const seasonRegression of [0.5, 0.75, 1])
          candidates.push({ learningRate, xgWeight, stateHalfLifeDays, seasonRegression });
  const trials = candidates.map((config) => {
    const value = metrics(evaluateSeason(matches, 2024, config));
    return { config, metrics: value, selectionScore: selectionScore(value) };
  }).sort((left, right) => left.selectionScore - right.selectionScore);
  const selected = trials[0]!;
  const holdout = metrics(evaluateSeason(matches, 2025, selected.config));
  console.log(JSON.stringify({
    mode: "read_only_zero_write_zero_provider_calls",
    protocol: "2022_2023_state_warmup__2024_selection__2025_untouched_holdout",
    candidates: candidates.length,
    selected,
    holdout,
    topSelectionTrials: trials.slice(0, 10),
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
