import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Team = { tricode: string };
type Game = {
  id: number;
  season: number;
  game_date: string;
  start_time_utc: string;
  home_team: Team;
  away_team: Team;
  home_score: number;
  away_score: number;
  postseason: boolean;
  status_state?: string;
};
type Opening = {
  game_id: number;
  vendor: string;
  spread_home_value: string | number | null;
  spread_home_odds: number | null;
  spread_away_value: string | number | null;
  spread_away_odds: number | null;
  moneyline_home_odds: number | null;
  moneyline_away_odds: number | null;
  total_value: string | number | null;
  total_over_odds: number | null;
  total_under_odds: number | null;
};
type Cache = { games: Game[]; opening_odds: Opening[] };
type Params = { alpha: number; eloK: number; eloHome: number; goalHome: number; mlSlope: number };
type TeamState = { elo: number; gf: number; ga: number; lastDate: string | null };
type Forecast = {
  game: Game;
  independentHomeProb: number;
  independentHomeGoals: number;
  independentAwayGoals: number;
  independentTotal: number;
  marketHomeProb: number | null;
  marketTotal: number | null;
  spreadHome: number | null;
};

const EXCLUDED_VENDORS = new Set(["kalshi", "polymarket"]);

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function implied(american: number | null): number | null {
  if (american === null || american === 0) return null;
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function consensus(openings: Opening[]): { homeProb: number | null; total: number | null; spreadHome: number | null } {
  const usable = openings.filter((row) => !EXCLUDED_VENDORS.has(row.vendor));
  const homeProbabilities: number[] = [];
  for (const row of usable) {
    const home = implied(row.moneyline_home_odds);
    const away = implied(row.moneyline_away_odds);
    if (home !== null && away !== null && home + away > 0) homeProbabilities.push(home / (home + away));
  }
  return {
    homeProb: median(homeProbabilities),
    total: median(usable.map((row) => num(row.total_value)).filter((value): value is number => value !== null)),
    spreadHome: median(usable.map((row) => num(row.spread_home_value)).filter((value): value is number => value !== null)),
  };
}

function stateFor(states: Map<string, TeamState>, team: string): TeamState {
  const found = states.get(team);
  if (found) return found;
  const created = { elo: 1500, gf: 3.05, ga: 3.05, lastDate: null };
  states.set(team, created);
  return created;
}

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function daysBetween(a: string | null, b: string): number | null {
  if (a === null) return null;
  return Math.max(0, (Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function generateForecasts(games: Game[], openingsByGame: Map<number, Opening[]>, params: Params): Forecast[] {
  const ordered = [...games].sort((a, b) => Date.parse(a.start_time_utc) - Date.parse(b.start_time_utc));
  const states = new Map<string, TeamState>();
  const forecasts: Forecast[] = [];
  let season: number | null = null;

  for (const game of ordered) {
    if (season !== null && game.season !== season) {
      for (const state of states.values()) {
        state.elo = 1500 + (state.elo - 1500) * 0.72;
        state.gf = 3.05 + (state.gf - 3.05) * 0.62;
        state.ga = 3.05 + (state.ga - 3.05) * 0.62;
        state.lastDate = null;
      }
    }
    season = game.season;
    const home = stateFor(states, game.home_team.tricode);
    const away = stateFor(states, game.away_team.tricode);
    const homeRest = daysBetween(home.lastDate, game.game_date);
    const awayRest = daysBetween(away.lastDate, game.game_date);
    const restGoal = homeRest !== null && awayRest !== null
      ? Math.max(-0.16, Math.min(0.16, (homeRest - awayRest) * 0.035))
      : 0;
    const independentHomeGoals = (home.gf + away.ga) / 2 + params.goalHome + restGoal / 2;
    const independentAwayGoals = (away.gf + home.ga) / 2 - restGoal / 2;
    const scoringDiff = independentHomeGoals - independentAwayGoals;
    const eloDiffGoals = ((home.elo + params.eloHome) - away.elo) / 330;
    const independentGoalDiff = 0.58 * scoringDiff + 0.42 * eloDiffGoals;
    const independentHomeProb = logistic(params.mlSlope * independentGoalDiff);
    const market = consensus(openingsByGame.get(game.id) ?? []);
    forecasts.push({
      game,
      independentHomeProb,
      independentHomeGoals,
      independentAwayGoals,
      independentTotal: independentHomeGoals + independentAwayGoals,
      marketHomeProb: market.homeProb,
      marketTotal: market.total,
      spreadHome: market.spreadHome,
    });

    const actualHomeWin = game.home_score > game.away_score ? 1 : 0;
    const eloExpected = 1 / (1 + 10 ** (-(home.elo + params.eloHome - away.elo) / 400));
    const change = params.eloK * (actualHomeWin - eloExpected);
    home.elo += change;
    away.elo -= change;
    home.gf = (1 - params.alpha) * home.gf + params.alpha * game.home_score;
    home.ga = (1 - params.alpha) * home.ga + params.alpha * game.away_score;
    away.gf = (1 - params.alpha) * away.gf + params.alpha * game.away_score;
    away.ga = (1 - params.alpha) * away.ga + params.alpha * game.home_score;
    home.lastDate = game.game_date;
    away.lastDate = game.game_date;
  }
  return forecasts;
}

function nextSeasonPriors(games: Game[], params: Params): Record<string, { elo: number; goalsFor: number; goalsAgainst: number }> {
  const ordered = [...games].sort((a, b) => Date.parse(a.start_time_utc) - Date.parse(b.start_time_utc));
  const states = new Map<string, TeamState>();
  let season: number | null = null;
  for (const game of ordered) {
    if (season !== null && game.season !== season) {
      for (const state of states.values()) {
        state.elo = 1500 + (state.elo - 1500) * 0.72;
        state.gf = 3.05 + (state.gf - 3.05) * 0.62;
        state.ga = 3.05 + (state.ga - 3.05) * 0.62;
      }
    }
    season = game.season;
    const home = stateFor(states, game.home_team.tricode);
    const away = stateFor(states, game.away_team.tricode);
    const actualHomeWin = game.home_score > game.away_score ? 1 : 0;
    const expected = 1 / (1 + 10 ** (-(home.elo + params.eloHome - away.elo) / 400));
    const change = params.eloK * (actualHomeWin - expected);
    home.elo += change;
    away.elo -= change;
    home.gf = (1 - params.alpha) * home.gf + params.alpha * game.home_score;
    home.ga = (1 - params.alpha) * home.ga + params.alpha * game.away_score;
    away.gf = (1 - params.alpha) * away.gf + params.alpha * game.away_score;
    away.ga = (1 - params.alpha) * away.ga + params.alpha * game.home_score;
  }
  // The cache ends with 2025. Apply the frozen between-season regression once
  // to create the exact opening priors consumed by the 2026 runtime.
  return Object.fromEntries([...states.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([team, state]) => [team, {
    elo: 1500 + (state.elo - 1500) * 0.72,
    goalsFor: 3.05 + (state.gf - 3.05) * 0.62,
    goalsAgainst: 3.05 + (state.ga - 3.05) * 0.62,
  }]));
}

function brier(probability: number, outcome: number): number {
  return (probability - outcome) ** 2;
}

function logLoss(probability: number, outcome: number): number {
  const p = Math.max(0.001, Math.min(0.999, probability));
  return -(outcome * Math.log(p) + (1 - outcome) * Math.log(1 - p));
}

function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax));
  return 0.5 * (1 + sign * y);
}

function metrics(rows: Forecast[], weights: { ml: number; total: number; spread: number }) {
  let mlN = 0, mlCorrect = 0, mlBrier = 0, mlLogLoss = 0;
  let totalN = 0, totalCorrect = 0, totalMae = 0;
  let spreadN = 0, spreadCorrect = 0, spreadBrier = 0;
  for (const row of rows) {
    const outcomeHome = row.game.home_score > row.game.away_score ? 1 : 0;
    if (row.marketHomeProb !== null) {
      const p = (1 - weights.ml) * row.independentHomeProb + weights.ml * row.marketHomeProb;
      mlN += 1;
      mlCorrect += Number((p >= 0.5 ? 1 : 0) === outcomeHome);
      mlBrier += brier(p, outcomeHome);
      mlLogLoss += logLoss(p, outcomeHome);
    }
    if (row.marketTotal !== null) {
      const projected = (1 - weights.total) * row.independentTotal + weights.total * row.marketTotal;
      const actual = row.game.home_score + row.game.away_score;
      if (Math.abs(projected - row.marketTotal) >= 0.02 && actual !== row.marketTotal) {
        totalN += 1;
        totalCorrect += Number((projected > row.marketTotal) === (actual > row.marketTotal));
      }
      totalMae += Math.abs(projected - actual);
    }
    if (row.marketHomeProb !== null && row.marketTotal !== null && row.spreadHome !== null) {
      const independentDiff = Math.log(row.independentHomeProb / (1 - row.independentHomeProb)) / 0.78;
      const marketDiff = Math.log(row.marketHomeProb / (1 - row.marketHomeProb)) / 0.78;
      const mean = (1 - weights.spread) * independentDiff + weights.spread * marketDiff;
      const sigma = Math.sqrt(Math.max(4.5, (1 - weights.total) * row.independentTotal + weights.total * row.marketTotal));
      // The market boundary is already a half goal (normally +/-1.5), so
      // `-spreadHome` is the continuity-corrected threshold for the integer
      // score differential. Do not apply a second half-goal correction.
      const homeCoverProbability = 1 - normalCdf((-row.spreadHome - mean) / sigma);
      const pickHome = homeCoverProbability >= 0.5;
      const actualDiff = row.game.home_score - row.game.away_score;
      if (actualDiff + row.spreadHome !== 0) {
        const outcome = actualDiff + row.spreadHome > 0 ? 1 : 0;
        spreadN += 1;
        spreadCorrect += Number(pickHome === Boolean(outcome));
        spreadBrier += brier(homeCoverProbability, outcome);
      }
    }
  }
  return {
    moneyline: { n: mlN, accuracy: mlN ? mlCorrect / mlN : null, brier: mlN ? mlBrier / mlN : null, log_loss: mlN ? mlLogLoss / mlN : null },
    total: { n: totalN, accuracy: totalN ? totalCorrect / totalN : null, score_mae: rows.length ? totalMae / rows.length : null },
    puckline: { n: spreadN, accuracy: spreadN ? spreadCorrect / spreadN : null, brier: spreadN ? spreadBrier / spreadN : null },
  };
}

function actionableSet(rows: Forecast[], weights: { ml: number; total: number; spread: number }) {
  const sets = { moneyline: new Set<number>(), total: new Set<number>(), puckline: new Set<number>() };
  for (const row of rows) {
    if (row.marketHomeProb !== null) {
      const homeProbability = (1 - weights.ml) * row.independentHomeProb + weights.ml * row.marketHomeProb;
      const probability = Math.max(homeProbability, 1 - homeProbability);
      const marketProbability = homeProbability >= 0.5 ? row.marketHomeProb : 1 - row.marketHomeProb;
      const conviction = Math.abs(probability - 0.5);
      const edge = Math.abs(probability - marketProbability);
      if (conviction >= 0.045 || edge >= 0.012) sets.moneyline.add(row.game.id);
    }
    if (row.marketTotal !== null) {
      if (Math.abs(row.independentTotal - row.marketTotal) >= 0.20) sets.total.add(row.game.id);
    }
    if (row.marketHomeProb !== null && row.marketTotal !== null) {
      const independentDiff = Math.log(row.independentHomeProb / (1 - row.independentHomeProb)) / 0.78;
      const marketDiff = Math.log(row.marketHomeProb / (1 - row.marketHomeProb)) / 0.78;
      const mean = (1 - weights.spread) * independentDiff + weights.spread * marketDiff;
      const total = (1 - weights.total) * row.independentTotal + weights.total * row.marketTotal;
      const sigma = Math.sqrt(Math.max(4.5, total));
      const homeFavorite = row.marketHomeProb >= 0.5;
      const homeLine = homeFavorite ? -1.5 : 1.5;
      const homeCover = 1 - normalCdf((-homeLine - mean) / sigma);
      const probability = Math.max(homeCover, 1 - homeCover);
      if (probability >= 0.62) sets.puckline.add(row.game.id);
    }
  }
  return sets;
}

function boardImpact(rows: Forecast[], beforeWeights: { ml: number; total: number; spread: number }, afterWeights: { ml: number; total: number; spread: number }) {
  const before = actionableSet(rows, beforeWeights);
  const after = actionableSet(rows, afterWeights);
  return Object.fromEntries((Object.keys(before) as Array<keyof typeof before>).map((marketName) => {
    const retained = [...before[marketName]].filter((id) => after[marketName].has(id)).length;
    const promoted = [...after[marketName]].filter((id) => !before[marketName].has(id)).length;
    const demoted = [...before[marketName]].filter((id) => !after[marketName].has(id)).length;
    return [marketName, {
      before: before[marketName].size,
      after: after[marketName].size,
      retained,
      promoted,
      demoted,
      net: after[marketName].size - before[marketName].size,
    }];
  }));
}

function totalActionCurve(rows: Forecast[], totalWeight: number) {
  return [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.45, 0.5].map((minimumIndependentGap) => {
    let n = 0, correct = 0;
    for (const row of rows) {
      if (row.marketTotal === null) continue;
      const independentGap = row.independentTotal - row.marketTotal;
      if (Math.abs(independentGap) < minimumIndependentGap) continue;
      const projected = (1 - totalWeight) * row.independentTotal + totalWeight * row.marketTotal;
      const actual = row.game.home_score + row.game.away_score;
      if (actual === row.marketTotal) continue;
      n += 1;
      correct += Number((projected > row.marketTotal) === (actual > row.marketTotal));
    }
    return { minimumIndependentGap, n, accuracy: n ? correct / n : null };
  });
}

async function main(): Promise<void> {
  const rootArg = process.argv.find((arg) => arg.startsWith("--root="));
  const root = path.resolve(rootArg?.slice("--root=".length) || process.cwd());
  const cachePath = path.join(root, "nhl-research/cache/balldontlie/nhl_regular_history_2023_2025.json");
  const cache = JSON.parse(await readFile(cachePath, "utf8")) as Cache;
  const openingsByGame = new Map<number, Opening[]>();
  for (const row of cache.opening_odds) {
    const current = openingsByGame.get(row.game_id) ?? [];
    current.push(row);
    openingsByGame.set(row.game_id, current);
  }

  const paramsCandidates: Params[] = [];
  for (const alpha of [0.04, 0.06, 0.08, 0.1, 0.12]) {
    for (const eloK of [8, 12, 16, 20]) {
      for (const eloHome of [20, 30, 40]) {
        for (const goalHome of [0.05, 0.1, 0.15]) {
          paramsCandidates.push({ alpha, eloK, eloHome, goalHome, mlSlope: 0.78 });
        }
      }
    }
  }
  let bestParams = paramsCandidates[0]!;
  let bestParamScore = Number.POSITIVE_INFINITY;
  for (const params of paramsCandidates) {
    const rows = generateForecasts(cache.games, openingsByGame, params).filter((row) => row.game.season === 2024);
    let goalMae = 0, mlLoss = 0;
    for (const row of rows) {
      goalMae += Math.abs(row.independentHomeGoals - row.game.home_score) + Math.abs(row.independentAwayGoals - row.game.away_score);
      mlLoss += logLoss(row.independentHomeProb, row.game.home_score > row.game.away_score ? 1 : 0);
    }
    const score = goalMae / (2 * rows.length) + 0.35 * (mlLoss / rows.length);
    if (score < bestParamScore) {
      bestParamScore = score;
      bestParams = params;
    }
  }

  const allForecasts = generateForecasts(cache.games, openingsByGame, bestParams);
  const season2025 = allForecasts.filter((row) => row.game.season === 2025 && row.marketHomeProb !== null && row.marketTotal !== null);
  season2025.sort((a, b) => Date.parse(a.game.start_time_utc) - Date.parse(b.game.start_time_utc));
  const split = Math.floor(season2025.length * 0.7);
  const tune = season2025.slice(0, split);
  const holdout = season2025.slice(split);
  const weights = Array.from({ length: 21 }, (_, index) => index * 0.05);
  let mlWeight = 0, totalWeight = 0, spreadWeight = 0;
  let mlScore = Number.NEGATIVE_INFINITY, totalScore = Number.NEGATIVE_INFINITY, spreadScore = Number.NEGATIVE_INFINITY;
  for (const weight of weights) {
    const current = metrics(tune, { ml: weight, total: weight, spread: weight });
    // Market is an enhancer, not a replacement for the independent model.
    // Bound ML at 50% market weight and select by directional accuracy first,
    // with Brier as the tie-breaker encoded as a small penalty.
    const candidateMl = weight <= 0.5
      ? (current.moneyline.accuracy ?? 0) - 0.01 * (current.moneyline.brier ?? 1)
      : Number.NEGATIVE_INFINITY;
    if (candidateMl > mlScore) { mlScore = candidateMl; mlWeight = weight; }
    const candidateTotal = (current.total.accuracy ?? 0) - 0.02 * (current.total.score_mae ?? 10);
    if (candidateTotal > totalScore) { totalScore = candidateTotal; totalWeight = weight; }
    const candidateSpread = weight <= 0.6
      ? (current.puckline.accuracy ?? 0) - 0.15 * (current.puckline.brier ?? 1)
      : Number.NEGATIVE_INFINITY;
    if (candidateSpread > spreadScore) { spreadScore = candidateSpread; spreadWeight = weight; }
  }
  const selected = { ml: mlWeight, total: totalWeight, spread: spreadWeight };
  const independent = { ml: 0, total: 0, spread: 0 };
  const market = { ml: 1, total: 1, spread: 1 };
  const report = {
    release: "nhl_regular_model_tournament_2026_09_23_r1",
    source_manifest: "bdl_nhl_regular_history_2026_09_23_r1",
    design: {
      parameter_training: "2024 regular season, after 2023 warmup",
      market_weight_tuning: `first ${split} priced games of 2025 regular season`,
      untouched_holdout: `last ${holdout.length} priced games of 2025 regular season`,
      note: "All features are updated only after each game's outcome; no result is used before its forecast.",
    },
    selected_parameters: bestParams,
    runtime_2026_opening_priors: nextSeasonPriors(cache.games, bestParams),
    selected_market_weights: selected,
    weight_curve: weights.map((weight) => ({
      weight,
      tune: metrics(tune, { ml: weight, total: weight, spread: weight }),
      holdout: metrics(holdout, { ml: weight, total: weight, spread: weight }),
    })),
    tune: {
      independent: metrics(tune, independent),
      market: metrics(tune, market),
      selected: metrics(tune, selected),
    },
    holdout: {
      independent: metrics(holdout, independent),
      market: metrics(holdout, market),
      selected: metrics(holdout, selected),
    },
    board_impact_vs_independent: {
      tune: boardImpact(tune, independent, selected),
      holdout: boardImpact(holdout, independent, selected),
      note: "Paired on the same eligible games. Puck line is a new official market; before counts are the independent-only candidate under the same thresholds, not prior production.",
    },
    total_action_curve: {
      tune: totalActionCurve(tune, selected.total),
      holdout: totalActionCurve(holdout, selected.total),
    },
  };
  const outputPath = path.join(root, "nhl-research/nhl_regular_model_tournament_2026_09_23_r1.json");
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
