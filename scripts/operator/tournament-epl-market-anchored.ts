import { BallDontLieEplProvider } from "../../lib/providers/real_api/BallDontLieEplProvider";
import { bivariatePoissonScoreDistribution } from "../../lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "../../lib/services/soccer/soccerMarketProbabilities";
import { fitEplShadowModel, joinEplMatchStats, predictEplMatch, type EplTrainingMatch } from "../../lib/services/epl/eplShadowModel";

type Market = "total" | "btts";
type Row = {
  season: number;
  y: number;
  model: number;
  market: number;
  actualHome: number;
  actualAway: number;
  modelHome: number;
  modelAway: number;
  marketHome: number;
  marketAway: number;
};
const CONFIG = { halfLifeDays: 365, shrinkageMatches: 4, xgWeight: 0, dixonColesTau: -0.1 };
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number) => Math.max(1e-6, Math.min(1 - 1e-6, x));
const logit = (x: number) => Math.log(clamp(x) / (1 - clamp(x)));
const safeLog = (x: number) => Math.log(clamp(x));

function parseCsv(text: string): Record<string, string>[] {
  const lines: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' && quoted && text[i + 1] === '"') { value += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === "," && !quoted) { row.push(value); value = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(value); value = ""; if (row.some(Boolean)) lines.push(row); row = [];
    } else value += c;
  }
  if (value || row.length) { row.push(value); lines.push(row); }
  const header = lines.shift()!.map((item) => item.replace(/^\uFEFF/, ""));
  return lines.map((values) => Object.fromEntries(header.map((key, i) => [key, values[i] ?? ""])));
}

function canonicalTeam(name: string): string {
  const base = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  const aliases: Record<string, string> = {
    mancity: "manchestercity", manunited: "manchesterunited", nottmforest: "nottinghamforest",
    wolves: "wolverhamptonwanderers", brighton: "brightonandhovealbion", tottenham: "tottenhamhotspur",
    newcastle: "newcastleunited", leeds: "leedsunited", westham: "westhamunited", sheffieldunited: "sheffutd",
  };
  return aliases[base] ?? base;
}

function number(row: Record<string, string>, key: string): number | null {
  const value = Number(row[key]); return Number.isFinite(value) && value > 1 ? value : null;
}

function noVig(prices: number[]): number[] { const raw = prices.map((price) => 1 / price); const sum = raw.reduce((a, b) => a + b, 0); return raw.map((value) => value / sum); }

const grid = (() => {
  const rows: Array<{ home: number; draw: number; away: number; over: number; btts: number; homeLambda: number; awayLambda: number }> = [];
  for (let homeLambda = .3; homeLambda <= 3.5; homeLambda += .05) for (let awayLambda = .3; awayLambda <= 3.5; awayLambda += .05) {
    const markets = deriveSoccerMarketProbabilities({ joint: bivariatePoissonScoreDistribution(homeLambda, awayLambda, -.1), totalLine: 2.5 });
    rows.push({ home: markets.match_result.home, draw: markets.match_result.draw, away: markets.match_result.away, over: markets.total.over, btts: markets.btts.yes, homeLambda, awayLambda });
  }
  return rows;
})();

function impliedDistribution(home: number, draw: number, away: number, over: number) {
  let best = grid[0]!, loss = Infinity;
  for (const candidate of grid) {
    const next = (candidate.home - home) ** 2 + (candidate.draw - draw) ** 2 + (candidate.away - away) ** 2 + 1.5 * (candidate.over - over) ** 2;
    if (next < loss) { best = candidate; loss = next; }
  }
  return best;
}

function fit(rows: Row[], l2: number) {
  const vectors = rows.map((row) => [1, logit(row.model), logit(row.market), logit(row.model) - logit(row.market)]);
  const mean = [0, 1, 2, 3].map((j) => j === 0 ? 0 : vectors.reduce((sum, x) => sum + x[j]!, 0) / vectors.length);
  const sd = mean.map((m, j) => j === 0 ? 1 : Math.max(1e-6, Math.sqrt(vectors.reduce((sum, x) => sum + (x[j]! - m) ** 2, 0) / vectors.length)));
  const scaled = vectors.map((x) => x.map((value, j) => j === 0 ? 1 : (value - mean[j]!) / sd[j]!));
  const weights = Array(4).fill(0);
  for (let iteration = 0; iteration < 5000; iteration++) {
    const gradient = Array(4).fill(0);
    rows.forEach((row, i) => { const p = sigmoid(scaled[i]!.reduce((sum, x, j) => sum + x * weights[j], 0)); for (let j = 0; j < 4; j++) gradient[j] += (p - row.y) * scaled[i]![j]!; });
    for (let j = 1; j < 4; j++) gradient[j] += l2 * weights[j];
    const rate = .08 / Math.sqrt(1 + iteration / 250);
    for (let j = 0; j < 4; j++) weights[j] -= rate * gradient[j] / rows.length;
  }
  return (row: Row) => { const x = [1, logit(row.model), logit(row.market), logit(row.model) - logit(row.market)]; return sigmoid(x.reduce((sum, value, j) => sum + (j === 0 ? 1 : (value - mean[j]!) / sd[j]!) * weights[j], 0)); };
}

function metrics(rows: Row[], forecast: (row: Row) => number) {
  const p = rows.map(forecast);
  const brier = rows.reduce((sum, row, i) => sum + (p[i]! - row.y) ** 2, 0) / rows.length;
  const logLoss = rows.reduce((sum, row, i) => sum - (row.y ? safeLog(p[i]!) : safeLog(1 - p[i]!)), 0) / rows.length;
  const cohorts = [0.5, .53, .55, .57, .6].map((floor) => {
    const selected = rows.filter((_, i) => Math.max(p[i]!, 1 - p[i]!) >= floor);
    const correct = selected.filter((row) => (forecast(row) >= .5) === Boolean(row.y)).length;
    return { floor, n: selected.length, accuracy: selected.length ? correct / selected.length : null, yes: selected.filter((row) => forecast(row) >= .5).length, no: selected.filter((row) => forecast(row) < .5).length };
  });
  return { n: rows.length, brier, logLoss, cohorts };
}

function goalMetrics(rows: Row[], projection: (row: Row) => { home: number; away: number }) {
  const absolute = rows.map((row) => {
    const projected = projection(row);
    return {
      home: Math.abs(projected.home - row.actualHome),
      away: Math.abs(projected.away - row.actualAway),
      total: Math.abs(projected.home + projected.away - row.actualHome - row.actualAway),
    };
  });
  return {
    n: rows.length,
    homeMae: absolute.reduce((sum, row) => sum + row.home, 0) / rows.length,
    awayMae: absolute.reduce((sum, row) => sum + row.away, 0) / rows.length,
    combinedTeamMae: absolute.reduce((sum, row) => sum + row.home + row.away, 0) / (rows.length * 2),
    totalMae: absolute.reduce((sum, row) => sum + row.total, 0) / rows.length,
  };
}

function goalProjectionTrials(rows: Row[]) {
  return Array.from({ length: 21 }, (_, index) => index / 20).map((clubWeight) => ({
    clubWeight,
    metrics: goalMetrics(rows, (row) => ({
      home: clubWeight * row.modelHome + (1 - clubWeight) * row.marketHome,
      away: clubWeight * row.modelAway + (1 - clubWeight) * row.marketAway,
    })),
  })).sort((a, b) => a.metrics.combinedTeamMae - b.metrics.combinedTeamMae || a.metrics.totalMae - b.metrics.totalMae);
}

async function main() {
  const key = process.env.BALLDONTLIE_API_KEY; if (!key) throw new Error("BALLDONTLIE_API_KEY is required");
  const provider = new BallDontLieEplProvider(key);
  const seasons = [2022, 2023, 2024, 2025];
  const [matchLists, teams, csvTexts] = await Promise.all([
    Promise.all(seasons.map((season) => provider.listMatches({ season }))),
    Promise.all(seasons.map((season) => provider.listTeams(season))),
    Promise.all(["2223", "2324", "2425", "2526"].map(async (code) => { const response = await fetch(`https://www.football-data.co.uk/mmz4281/${code}/E0.csv`); if (!response.ok) throw new Error(`CSV ${code}: ${response.status}`); return response.text(); })),
  ]);
  const finals = matchLists.flat().filter((match) => match.status_state === "final");
  const stats = await provider.listTeamMatchStats(finals.map((match) => match.id));
  const joined = joinEplMatchStats(finals, stats).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const teamNames = new Map(teams.flat().map((team) => [team.id, team.name]));
  const csvByKey = new Map<string, Record<string, string>>();
  csvTexts.forEach((text, index) => parseCsv(text).forEach((row) => csvByKey.set(`${seasons[index]}:${canonicalTeam(row.HomeTeam)}:${canonicalTeam(row.AwayTeam)}`, row)));
  const rows: Record<Market, Row[]> = { total: [], btts: [] };
  joined.forEach((match, index) => {
    const history = joined.slice(0, index);
    const prediction = predictEplMatch(fitEplShadowModel(history, match.date, CONFIG), match.home_team_id, match.away_team_id);
    const csv = csvByKey.get(`${match.season}:${canonicalTeam(teamNames.get(match.home_team_id) ?? "")}:${canonicalTeam(teamNames.get(match.away_team_id) ?? "")}`);
    if (!csv) return;
    const overPrice = number(csv, "Avg>2.5"), underPrice = number(csv, "Avg<2.5");
    const homePrice = number(csv, "AvgH"), drawPrice = number(csv, "AvgD"), awayPrice = number(csv, "AvgA");
    if (!overPrice || !underPrice || !homePrice || !drawPrice || !awayPrice || !Number.isFinite(prediction.rawDerivedProbabilities.over25)) return;
    const [over] = noVig([overPrice, underPrice]);
    const [home, draw, away] = noVig([homePrice, drawPrice, awayPrice]);
    const implied = impliedDistribution(home!, draw!, away!, over!);
    const common = {
      season: match.season,
      actualHome: match.home_score!,
      actualAway: match.away_score!,
      modelHome: prediction.lambdaHome,
      modelAway: prediction.lambdaAway,
      marketHome: implied.homeLambda,
      marketAway: implied.awayLambda,
    };
    rows.total.push({ ...common, y: Number(match.home_score! + match.away_score! > 2.5), model: prediction.rawDerivedProbabilities.over25, market: over! });
    rows.btts.push({ ...common, y: Number(match.home_score! > 0 && match.away_score! > 0), model: prediction.rawDerivedProbabilities.bttsYes, market: implied.btts });
  });
  const output: Record<string, unknown> = {};
  for (const market of ["total", "btts"] as const) {
    const training = rows[market].filter((row) => row.season === 2022 || row.season === 2023);
    const validation = rows[market].filter((row) => row.season === 2024);
    const holdout = rows[market].filter((row) => row.season === 2025);
    const trials = [0, .1, .3, 1, 3, 10, 30].map((l2) => { const model = fit(training, l2); return { l2, model, validation: metrics(validation, model) }; }).sort((a, b) => a.validation.logLoss - b.validation.logLoss || a.validation.brier - b.validation.brier);
    const selected = trials[0]!; const final = fit([...training, ...validation], selected.l2);
    const blendTrials = Array.from({ length: 21 }, (_, index) => index / 20).map((clubWeight) => {
      const forecast = (row: Row) => clubWeight * row.model + (1 - clubWeight) * row.market;
      return { clubWeight, validation: metrics(validation, forecast) };
    }).sort((a, b) => a.validation.logLoss - b.validation.logLoss || a.validation.brier - b.validation.brier);
    const selectedBlend = blendTrials[0]!;
    const blend = (row: Row) => selectedBlend.clubWeight * row.model + (1 - selectedBlend.clubWeight) * row.market;
    const disagreementTrials = [0, .01, .02, .03, .04, .05, .075, .1].map((marketBand) => {
      const forecast = (row: Row) => Math.abs(row.market - .5) <= marketBand
        && (row.market >= .5) !== (row.model >= .5)
        ? row.model
        : row.market;
      return { marketBand, forecast, validation: metrics(validation, forecast) };
    }).sort((a, b) => a.validation.logLoss - b.validation.logLoss || a.validation.brier - b.validation.brier);
    const selectedDisagreement = disagreementTrials[0]!;
    const selectedGoalProjection = goalProjectionTrials(validation)[0]!;
    const goalProjection = (row: Row) => ({
      home: selectedGoalProjection.clubWeight * row.modelHome + (1 - selectedGoalProjection.clubWeight) * row.marketHome,
      away: selectedGoalProjection.clubWeight * row.modelAway + (1 - selectedGoalProjection.clubWeight) * row.marketAway,
    });
    output[market] = {
      coverage: { training: training.length, validation: validation.length, holdout: holdout.length },
      selectedL2: selected.l2,
      validation: selected.validation,
      holdout: metrics(holdout, final),
      selectedSimpleBlend: { clubWeight: selectedBlend.clubWeight, validation: selectedBlend.validation, holdout: metrics(holdout, blend) },
      selectedNearEvenDisagreementFallback: {
        marketBand: selectedDisagreement.marketBand,
        validation: selectedDisagreement.validation,
        holdout: metrics(holdout, selectedDisagreement.forecast),
      },
      disagreementTrials: disagreementTrials.map((trial) => ({ marketBand: trial.marketBand, validation: trial.validation })),
      goalProjectionHoldout: {
        selectedClubWeight: selectedGoalProjection.clubWeight,
        validation: selectedGoalProjection.metrics,
        selectedHoldout: goalMetrics(holdout, goalProjection),
        club: goalMetrics(holdout, (row) => ({ home: row.modelHome, away: row.modelAway })),
        marketFitted: goalMetrics(holdout, (row) => ({ home: row.marketHome, away: row.marketAway })),
      },
      baselines: { market: metrics(holdout, (row) => row.market), clubModel: metrics(holdout, (row) => row.model) },
    };
  }
  console.log(JSON.stringify({ protocol: "2022_23_train__2024_validation__2025_untouched_holdout", source: "football-data.co.uk average pre-closing market prices", output }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
