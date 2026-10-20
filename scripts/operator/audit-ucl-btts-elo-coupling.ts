import { BallDontLieUclProvider, type BdlUclMatch } from "../../lib/providers/real_api/BallDontLieUclProvider";
import { bivariatePoissonScoreDistribution, type ScoreDistribution } from "../../lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "../../lib/services/soccer/soccerMarketProbabilities";
import { buildUclCompetitionContexts, regulationScore } from "../../lib/services/ucl/uclCompetitionContext";
import { partitionUclChronologicalMatches } from "../../lib/services/ucl/uclChronologicalEvaluation";
import { logPoolUclResult } from "../../lib/services/ucl/uclEloConsensus";
import { normalizeUclEloClub } from "../../lib/services/ucl/uclEloStrengthFoundation";
import { fitAndPredictUclBaseline, joinUclMatchStats, UCL_MODEL_CONFIG } from "../../lib/services/ucl/uclModel";

const PUBLIC_ELO_URL = "https://raw.githubusercontent.com/xgabora/Club-Football-Match-Data/main/data/EloRatings.csv";
const SIDES = ["home", "draw", "away"] as const;
type ResultVector = Record<(typeof SIDES)[number], number>;
type Rating = { at: number; elo: number };
type Row = { match: BdlUclMatch; base: ScoreDistribution; actual: 0 | 1 };

function parseCsv(line: string): string[] {
  const result: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { result.push(value); value = ""; }
    else value += char;
  }
  result.push(value);
  return result;
}

async function publicEloHistory(): Promise<Map<string, Rating[]>> {
  const response = await fetch(PUBLIC_ELO_URL, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`public Elo returned ${response.status}`);
  const lines = (await response.text()).split(/\r?\n/).filter(Boolean);
  const header = parseCsv(lines[0] ?? "");
  const dateAt = header.indexOf("date");
  const clubAt = header.indexOf("club");
  const eloAt = header.indexOf("elo");
  if ([dateAt, clubAt, eloAt].some((index) => index < 0)) throw new Error("public Elo schema mismatch");
  const history = new Map<string, Rating[]>();
  for (const line of lines.slice(1)) {
    const row = parseCsv(line);
    const club = normalizeUclEloClub(row[clubAt] ?? "");
    const at = Date.parse(row[dateAt] ?? "");
    const elo = Number(row[eloAt]);
    if (!club || !Number.isFinite(at) || !Number.isFinite(elo)) continue;
    const ratings = history.get(club) ?? [];
    ratings.push({ at, elo });
    history.set(club, ratings);
  }
  for (const ratings of history.values()) ratings.sort((left, right) => left.at - right.at);
  return history;
}

function ratingAt(history: Map<string, Rating[]>, club: string, before: number): number | null {
  const ratings = history.get(normalizeUclEloClub(club));
  if (!ratings?.length) return null;
  let low = 0;
  let high = ratings.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (ratings[middle]!.at < before) low = middle + 1;
    else high = middle;
  }
  return low > 0 ? ratings[low - 1]!.elo : null;
}

function normalize(joint: ScoreDistribution): void {
  const mass = joint.flat().reduce((sum, value) => sum + value, 0);
  for (const row of joint) for (let index = 0; index < row.length; index += 1) row[index] = row[index]! / mass;
}

function resultSide(home: number, away: number): keyof ResultVector {
  return home > away ? "home" : home < away ? "away" : "draw";
}

function applyPartition(joint: ScoreDistribution, groups: Array<{ target: number; contains: (home: number, away: number) => boolean }>): void {
  const current = groups.map((group) => joint.reduce((sum, row, home) => sum + row.reduce(
    (inside, value, away) => inside + (group.contains(home, away) ? value : 0), 0,
  ), 0));
  for (let home = 0; home < joint.length; home += 1) for (let away = 0; away < joint[home]!.length; away += 1) {
    const index = groups.findIndex((group) => group.contains(home, away));
    joint[home]![away] = joint[home]![away]! * groups[index]!.target / Math.max(1e-12, current[index]!);
  }
  normalize(joint);
}

function expectedTotal(joint: ScoreDistribution): number {
  return joint.reduce((sum, row, home) => sum + row.reduce((inside, value, away) => inside + (home + away) * value, 0), 0);
}

function tiltMean(joint: ScoreDistribution, target: number): ScoreDistribution {
  const meanAt = (theta: number) => {
    let mass = 0;
    let mean = 0;
    for (let home = 0; home < joint.length; home += 1) for (let away = 0; away < joint[home]!.length; away += 1) {
      const value = joint[home]![away]! * Math.exp(theta * (home + away));
      mass += value;
      mean += (home + away) * value;
    }
    return mean / mass;
  };
  let low = -4;
  let high = 4;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (low + high) / 2;
    if (meanAt(middle) < target) low = middle;
    else high = middle;
  }
  const theta = (low + high) / 2;
  const result = joint.map((row, home) => row.map((probability, away) => probability * Math.exp(theta * (home + away))));
  normalize(result);
  return result;
}

/** Preserve result, Over 2.5 and expected total, but deliberately allow BTTS
 * to emerge from the strength-informed score shape instead of pinning it to r7. */
function reconcileWithoutFrozenBtts(base: ScoreDistribution, result: ResultVector): ScoreDistribution {
  const original = deriveSoccerMarketProbabilities({ joint: base, totalLine: 2.5 });
  const targetMean = expectedTotal(base);
  let joint = base.map((row) => [...row]);
  for (let iteration = 0; iteration < 150; iteration += 1) {
    applyPartition(joint, SIDES.map((side) => ({ target: result[side], contains: (home, away) => resultSide(home, away) === side })));
    applyPartition(joint, [
      { target: original.total.over, contains: (home, away) => home + away > 2.5 },
      { target: 1 - original.total.over, contains: (home, away) => home + away < 2.5 },
    ]);
    joint = tiltMean(joint, targetMean);
    const markets = deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
    const residual = Math.max(
      ...SIDES.map((side) => Math.abs(markets.match_result[side] - result[side])),
      Math.abs(markets.total.over - original.total.over),
      Math.abs(expectedTotal(joint) - targetMean),
    );
    if (residual < 1e-10) break;
  }
  return joint;
}

function eloVector(base: ResultVector, homeElo: number, awayElo: number): ResultVector {
  const conditionalHome = 1 / (1 + 10 ** (-((homeElo + 45 - awayElo) / 400)));
  return { home: (1 - base.draw) * conditionalHome, draw: base.draw, away: (1 - base.draw) * (1 - conditionalHome) };
}

function auc(probabilities: number[], actuals: number[]): number {
  const positives = probabilities.flatMap((probability, index) => actuals[index] === 1 ? [probability] : []);
  const negatives = probabilities.flatMap((probability, index) => actuals[index] === 0 ? [probability] : []);
  let score = 0;
  for (const positive of positives) for (const negative of negatives) score += positive > negative ? 1 : positive === negative ? 0.5 : 0;
  return score / Math.max(1, positives.length * negatives.length);
}

function metrics(rows: Row[], probabilities: number[]) {
  const noRows = rows.filter((row) => row.actual === 0);
  return {
    n: rows.length,
    actualYes: rows.filter((row) => row.actual === 1).length,
    predictedYes: probabilities.filter((probability) => probability >= 0.5).length,
    accuracy: probabilities.filter((probability, index) => (probability >= 0.5 ? 1 : 0) === rows[index]!.actual).length / rows.length,
    noRecall: probabilities.filter((probability, index) => rows[index]!.actual === 0 && probability < 0.5).length / Math.max(1, noRows.length),
    brier: probabilities.reduce((sum, probability, index) => sum + (probability - rows[index]!.actual) ** 2, 0) / rows.length,
    logLoss: -probabilities.reduce((sum, raw, index) => {
      const probability = Math.max(1e-8, Math.min(1 - 1e-8, raw));
      return sum + (rows[index]!.actual ? Math.log(probability) : Math.log(1 - probability));
    }, 0) / rows.length,
    auc: auc(probabilities, rows.map((row) => row.actual)),
  };
}

async function main() {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required");
  const provider = new BallDontLieUclProvider(apiKey);
  const [{ matches, telemetry }, eloHistory, teams2024, teams2025] = await Promise.all([
    provider.listHistoricalMatches([2024, 2025]),
    publicEloHistory(),
    provider.listTeams(2024),
    provider.listTeams(2025),
  ]);
  const names = new Map([...teams2024, ...teams2025].map((team) => [team.id, team.name]));
  const ids = matches.filter((match) => match.status_state === "final").map((match) => match.id);
  const stats = await provider.listTeamMatchStats(ids);
  const training = joinUclMatchStats(matches, stats);
  const contexts = buildUclCompetitionContexts(matches);
  const { train, calibration, holdout } = partitionUclChronologicalMatches(matches);
  const rowsFor = (block: BdlUclMatch[]) => block.flatMap((match): Row[] => {
    const score = regulationScore(match).score;
    const context = contexts.get(match.id);
    if (!score || !context) return [];
    const prediction = fitAndPredictUclBaseline({ training, match, history: matches, context });
    return [{
      match,
      base: bivariatePoissonScoreDistribution(prediction.lambdaHome, prediction.lambdaAway, UCL_MODEL_CONFIG.dixonColesTau),
      actual: score.home > 0 && score.away > 0 ? 1 : 0,
    }];
  });
  const trainRows = rowsFor(train);
  const selectionRows = rowsFor(calibration);
  const confirmationRows = rowsFor(holdout);
  const prediction = (rows: Row[], weight: number) => rows.map((row) => {
    const markets = deriveSoccerMarketProbabilities({ joint: row.base, totalLine: 2.5 });
    const homeName = names.get(row.match.home_team_id) ?? "";
    const awayName = names.get(row.match.away_team_id) ?? "";
    const at = Date.parse(row.match.date);
    const homeElo = ratingAt(eloHistory, homeName, at);
    const awayElo = ratingAt(eloHistory, awayName, at);
    if (homeElo === null || awayElo === null) return { probability: markets.btts.yes, covered: false };
    const result = logPoolUclResult(markets.match_result, eloVector(markets.match_result, homeElo, awayElo), weight);
    const joint = reconcileWithoutFrozenBtts(row.base, result);
    return { probability: deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 }).btts.yes, covered: true };
  });
  const raw = (rows: Row[]) => rows.map((row) => deriveSoccerMarketProbabilities({ joint: row.base, totalLine: 2.5 }).btts.yes);
  const incumbent = metrics(selectionRows, raw(selectionRows));
  const weights = [0.1, 0.25, 0.4, 0.6, 0.8] as const;
  const trials = weights.map((weight) => {
    const values = prediction(selectionRows, weight);
    return { weight, covered: values.filter((value) => value.covered).length, metrics: metrics(selectionRows, values.map((value) => value.probability)) };
  });
  const eligible = trials.filter((trial) => trial.metrics.accuracy >= incumbent.accuracy
    && trial.metrics.noRecall > incumbent.noRecall
    && trial.metrics.brier < incumbent.brier
    && trial.metrics.logLoss < incumbent.logLoss
    && trial.metrics.auc >= incumbent.auc);
  const selected = [...eligible].sort((left, right) => left.metrics.brier - right.metrics.brier)[0] ?? null;
  const confirmation = selected ? prediction(confirmationRows, selected.weight) : null;
  console.log(JSON.stringify({
    mode: "read_only_chronological_public_elo_btts_coupling",
    providerHistory: telemetry,
    rows: { train: trainRows.length, selection: selectionRows.length, confirmation: confirmationRows.length },
    incumbent: { selection: incumbent, confirmation: metrics(confirmationRows, raw(confirmationRows)) },
    selectionTrials: trials,
    selected: selected && confirmation ? {
      ...selected,
      confirmationCovered: confirmation.filter((value) => value.covered).length,
      confirmation: metrics(confirmationRows, confirmation.map((value) => value.probability)),
    } : null,
    gate: selected ? "selection_passed_all_gates_confirmation_opened_once" : "no_selection_candidate_passed_all_gates",
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
