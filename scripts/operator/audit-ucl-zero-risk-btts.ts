import { BallDontLieUclProvider, type BdlUclMatch } from "../../lib/providers/real_api/BallDontLieUclProvider";
import { bivariatePoissonScoreDistribution } from "../../lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "../../lib/services/soccer/soccerMarketProbabilities";
import { buildUclCompetitionContexts, regulationScore } from "../../lib/services/ucl/uclCompetitionContext";
import { reconcileUclMeanPreserving } from "../../lib/services/ucl/uclEloConsensus";
import { normalizeUclEloClub } from "../../lib/services/ucl/uclEloStrengthFoundation";
import { fitAndPredictUclBaseline, joinUclMatchStats, UCL_MODEL_CONFIG } from "../../lib/services/ucl/uclModel";

type DomesticMatch = { date: string; league: string; home: string; away: string; homeGoals: number; awayGoals: number };
type Forecast = { match: BdlUclMatch; lambdaHome: number; lambdaAway: number; raw: number; zeroRisk: number; actual: 0 | 1 };
type Metrics = { n: number; actualYes: number; predictedYes: number; accuracy: number; noRecall: number; brier: number; logLoss: number; auc: number };

const UCL_SEASONS = [2010] as const;
const DOMESTIC_SEASONS = ["0001", "0102", "0203", "0304", "0405", "0506", "0607", "0708", "0809", "0910", "1011"] as const;
const DOMESTIC_LEAGUES = ["E0", "D1", "I1", "SP1", "F1", "N1", "P1", "B1", "T1", "G1", "SC0"] as const;
const WEIGHTS = [0.15, 0.25, 0.35] as const;
const clip = (value: number) => Math.max(1e-8, Math.min(1 - 1e-8, value));
const logit = (value: number) => Math.log(clip(value) / (1 - clip(value)));
const sigmoid = (value: number) => value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));

function parseCsv(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { values.push(current); current = ""; }
    else current += char;
  }
  values.push(current);
  return values;
}

function footballDataDate(value: string): string | null {
  const parts = value.trim().split(/[\/-]/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const [day, month, rawYear] = parts;
  const year = rawYear! < 100 ? 2000 + rawYear! : rawYear!;
  return new Date(Date.UTC(year, month! - 1, day!)).toISOString();
}

async function fetchDomesticFile(season: string, league: string): Promise<DomesticMatch[]> {
  const response = await fetch(`https://football-data.co.uk/mmz4281/${season}/${league}.csv`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) return [];
  const lines = (await response.text()).split(/\r?\n/).filter(Boolean);
  const header = parseCsv(lines[0] ?? "");
  const at = (name: string) => header.indexOf(name);
  if (["Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG"].some((name) => at(name) < 0)) return [];
  return lines.slice(1).flatMap((line): DomesticMatch[] => {
    const row = parseCsv(line);
    const date = footballDataDate(row[at("Date")] ?? "");
    const homeGoals = Number(row[at("FTHG")]);
    const awayGoals = Number(row[at("FTAG")]);
    if (!date || !Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return [];
    return [{ date, league, home: normalizeUclEloClub(row[at("HomeTeam")] ?? ""), away: normalizeUclEloClub(row[at("AwayTeam")] ?? ""), homeGoals, awayGoals }];
  });
}

async function fetchDomesticMatches(): Promise<DomesticMatch[]> {
  const jobs = DOMESTIC_SEASONS.flatMap((season) => DOMESTIC_LEAGUES.map((league) => ({ season, league })));
  const rows: DomesticMatch[][] = [];
  for (let index = 0; index < jobs.length; index += 6) rows.push(...await Promise.all(jobs.slice(index, index + 6).map(({ season, league }) => fetchDomesticFile(season, league))));
  return rows.flat().sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
}

function auc(rows: Array<{ probability: number; actual: 0 | 1 }>): number {
  const positives = rows.filter((row) => row.actual === 1);
  const negatives = rows.filter((row) => row.actual === 0);
  if (!positives.length || !negatives.length) return 0.5;
  let score = 0;
  for (const positive of positives) for (const negative of negatives) score += positive.probability > negative.probability ? 1 : positive.probability === negative.probability ? 0.5 : 0;
  return score / (positives.length * negatives.length);
}

function metrics(rows: Forecast[], probabilities: number[]): Metrics {
  const reads = rows.map((row, index) => ({ actual: row.actual, probability: clip(probabilities[index]!) }));
  const actualNo = reads.filter((row) => row.actual === 0);
  return {
    n: reads.length,
    actualYes: reads.filter((row) => row.actual === 1).length,
    predictedYes: reads.filter((row) => row.probability >= 0.5).length,
    accuracy: reads.filter((row) => Number(row.probability >= 0.5) === row.actual).length / rows.length,
    noRecall: actualNo.filter((row) => row.probability < 0.5).length / Math.max(1, actualNo.length),
    brier: reads.reduce((sum, row) => sum + (row.probability - row.actual) ** 2, 0) / rows.length,
    logLoss: -reads.reduce((sum, row) => sum + (row.actual ? Math.log(row.probability) : Math.log(1 - row.probability)), 0) / rows.length,
    auc: auc(reads),
  };
}

function zeroRiskProbability(domestic: DomesticMatch[], kickoff: string, home: string, away: string): number {
  const cutoff = Date.parse(kickoff);
  const prior = domestic.filter((row) => Date.parse(row.date) < cutoff);
  const latestLeague = (club: string) => prior.filter((row) => row.home === club || row.away === club).at(-1)?.league ?? null;
  const evidence = (club: string) => {
    const league = latestLeague(club);
    const leagueRows = prior.filter((row) => row.league === league);
    const leagueRate = leagueRows.length
      ? leagueRows.reduce((sum, row) => sum + Number(row.homeGoals > 0) + Number(row.awayGoals > 0), 0) / (2 * leagueRows.length)
      : 0.7;
    let weight = 0;
    let scored = 0;
    let conceded = 0;
    for (const row of leagueRows) {
      const isHome = row.home === club;
      if (!isHome && row.away !== club) continue;
      const recency = Math.pow(0.5, Math.max(0, (cutoff - Date.parse(row.date)) / 86_400_000) / 365);
      weight += recency;
      scored += recency * Number((isHome ? row.homeGoals : row.awayGoals) > 0);
      conceded += recency * Number((isHome ? row.awayGoals : row.homeGoals) > 0);
    }
    const shrink = 8;
    return { scoring: (scored + shrink * leagueRate) / (weight + shrink), conceding: (conceded + shrink * leagueRate) / (weight + shrink) };
  };
  const homeEvidence = evidence(home);
  const awayEvidence = evidence(away);
  const homeScores = (homeEvidence.scoring + awayEvidence.conceding) / 2;
  const awayScores = (awayEvidence.scoring + homeEvidence.conceding) / 2;
  return clip(homeScores * awayScores);
}

function blend(row: Forecast, weight: number): number {
  return sigmoid((1 - weight) * logit(row.raw) + weight * logit(row.zeroRisk));
}

function structure(rows: Forecast[], probabilities: number[]) {
  let teamScoreError = 0;
  let resultResidual = 0;
  let totalResidual = 0;
  let bttsResidual = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const score = regulationScore(row.match).score!;
    const base = bivariatePoissonScoreDistribution(row.lambdaHome, row.lambdaAway, UCL_MODEL_CONFIG.dixonColesTau);
    const before = deriveSoccerMarketProbabilities({ joint: base, totalLine: 2.5 });
    const joint = reconcileUclMeanPreserving(base, before.match_result, before.total.over, probabilities[index]!);
    const after = deriveSoccerMarketProbabilities({ joint, totalLine: 2.5 });
    let homeMean = 0;
    let awayMean = 0;
    for (let home = 0; home < joint.length; home += 1) for (let away = 0; away < joint[home]!.length; away += 1) {
      homeMean += home * joint[home]![away]!;
      awayMean += away * joint[home]![away]!;
    }
    teamScoreError += Math.abs(homeMean - score.home) + Math.abs(awayMean - score.away);
    resultResidual = Math.max(resultResidual, Math.abs(after.match_result.home - before.match_result.home), Math.abs(after.match_result.draw - before.match_result.draw), Math.abs(after.match_result.away - before.match_result.away));
    totalResidual = Math.max(totalResidual, Math.abs(after.total.over - before.total.over));
    bttsResidual = Math.max(bttsResidual, Math.abs(after.btts.yes - probabilities[index]!));
  }
  return { teamScoreMae: teamScoreError / (2 * rows.length), maxResultResidual: resultResidual, maxTotalResidual: totalResidual, maxBttsResidual: bttsResidual };
}

async function main() {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required");
  const provider = new BallDontLieUclProvider(apiKey);
  const [history, teamCohorts, domestic] = await Promise.all([
    provider.listHistoricalMatches([...UCL_SEASONS]),
    Promise.all(UCL_SEASONS.map((season) => provider.listTeams(season))),
    fetchDomesticMatches(),
  ]);
  const matches = history.matches;
  const names = new Map(teamCohorts.flat().map((team) => [team.id, normalizeUclEloClub(team.name)]));
  const training = joinUclMatchStats(matches, []);
  const contexts = buildUclCompetitionContexts(matches);
  const forecast = (block: BdlUclMatch[]) => block.flatMap((match): Forecast[] => {
    const score = regulationScore(match).score;
    const context = contexts.get(match.id);
    const home = names.get(match.home_team_id);
    const away = names.get(match.away_team_id);
    if (!score || !context || !home || !away) return [];
    const prediction = fitAndPredictUclBaseline({ training: training.filter((row) => row.season >= match.season - 1), match, history: matches, context });
    return [{ match, lambdaHome: prediction.lambdaHome, lambdaAway: prediction.lambdaAway, raw: prediction.probabilities.bttsYes,
      zeroRisk: zeroRiskProbability(domestic, match.date, home, away), actual: score.home > 0 && score.away > 0 ? 1 : 0 }];
  });
  const ordered = matches.filter((match) => match.status_state === "final")
    .sort((left, right) => Date.parse(left.date) - Date.parse(right.date) || left.id - right.id);
  const selection = forecast(ordered.slice(70, 95));
  const confirmation = forecast(ordered.slice(95));
  const rawSelection = metrics(selection, selection.map((row) => row.raw));
  const trials = WEIGHTS.map((weight) => ({ weight, metrics: metrics(selection, selection.map((row) => blend(row, weight))) }));
  const selected = [...trials].sort((left, right) => left.metrics.brier - right.metrics.brier || left.metrics.logLoss - right.metrics.logLoss)[0]!;
  const rawConfirmation = metrics(confirmation, confirmation.map((row) => row.raw));
  const probabilities = confirmation.map((row) => blend(row, selected.weight));
  const candidateConfirmation = metrics(confirmation, probabilities);
  const rawStructure = structure(confirmation, confirmation.map((row) => row.raw));
  const candidateStructure = structure(confirmation, probabilities);
  const accepted = candidateConfirmation.accuracy > rawConfirmation.accuracy && candidateConfirmation.noRecall > rawConfirmation.noRecall
    && candidateConfirmation.brier < rawConfirmation.brier && candidateConfirmation.logLoss < rawConfirmation.logLoss
    && candidateConfirmation.auc > rawConfirmation.auc && candidateStructure.teamScoreMae <= rawStructure.teamScoreMae
    && candidateStructure.maxResultResidual <= 1e-8 && candidateStructure.maxTotalResidual <= 1e-8 && candidateStructure.maxBttsResidual <= 1e-8;
  console.log(JSON.stringify({ mode: "read_only_no_runtime_change", cohort: "2010_first_70_warmup_next_25_selection_final_30_untouched_confirmation",
    providerHistory: history.telemetry, domesticRows: domestic.length, rows: { selection: selection.length, confirmation: confirmation.length },
    selection: { raw: rawSelection, trials, selectedWeight: selected.weight },
    confirmation: { raw: rawConfirmation, candidate: candidateConfirmation, rawStructure, candidateStructure }, accepted,
    gate: accepted ? "candidate_passed_all_predeclared_gates" : "candidate_failed_predeclared_gate_do_not_publish" }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
