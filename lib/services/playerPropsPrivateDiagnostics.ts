export type PrivatePlayerPropSport = "nfl" | "mlb" | "nba";
export type PrivatePlayerPropSide = "over" | "under" | "yes";
export type PrivatePlayerPropResult = "win" | "loss" | "push";

export type PrivatePlayerPropSettledRow = Readonly<{
  sport: PrivatePlayerPropSport;
  gameId: string;
  playerName: string;
  market: string;
  line: number;
  side: PrivatePlayerPropSide;
  sportsbook: string;
  americanPrice: number;
  canonicalMainLine: boolean;
  projection: number | null;
  independentProjection: number | null;
  rawModelProbability: number | null;
  marketProbability: number | null;
  finalProbability: number | null;
  publishedPrediction: PrivatePlayerPropSide | null;
  grade: string;
  marketMovement: string | null;
  decisionRelease: string;
  lockedAt: string;
  actual: number;
}>;

export type PrivatePlayerPropForecast = Readonly<{
  scopeKey: string;
  sport: PrivatePlayerPropSport;
  gameId: string;
  playerName: string;
  market: string;
  line: number;
  prediction: PrivatePlayerPropSide;
  result: PrivatePlayerPropResult;
  actual: number;
  projection: number | null;
  independentProjection: number | null;
  rawProbability: number | null;
  marketProbability: number | null;
  finalProbability: number | null;
  grade: string;
  canonicalMainLine: boolean;
  exactOfferCount: number;
  bestAvailableAmericanPrice: number | null;
  bestAvailableSportsbook: string | null;
  decisionRelease: string;
}>;

export const PRIVATE_PLAYER_PROP_CUSHIONS: Readonly<Record<PrivatePlayerPropSport, Readonly<Record<string, readonly number[]>>>> = {
  nfl: {
    passing_attempts: [1, 2],
    passing_completions: [1, 2],
    passing_yards: [10, 25],
    rushing_attempts: [1, 2],
    rushing_yards: [5, 10],
    receptions: [1, 2],
    receiving_yards: [5, 10],
  },
  mlb: {
    pitcher_strikeouts: [0.5, 1],
    pitcher_outs: [1, 2],
    pitcher_hits_allowed: [0.5, 1],
    pitcher_walks: [0.5, 1],
    pitcher_earned_runs: [0.5, 1],
    batter_hits: [0.5, 1],
    batter_total_bases: [0.5, 1],
    batter_strikeouts: [0.5, 1],
    batter_walks: [0.5, 1],
    batter_runs: [0.5, 1],
    batter_rbis: [0.5, 1],
    batter_hits_runs_rbis: [0.5, 1],
    batter_stolen_bases: [0.5, 1],
  },
  nba: {
    points: [1, 2],
    rebounds: [1, 2],
    assists: [1, 2],
    threes: [0.5, 1],
    points_rebounds_assists: [2, 4],
    points_rebounds: [2, 4],
    points_assists: [2, 4],
    rebounds_assists: [1, 2],
  },
};

export function buildPrivatePlayerPropForecasts(
  rows: readonly PrivatePlayerPropSettledRow[],
): PrivatePlayerPropForecast[] {
  const groups = group(rows, (row) => [
    row.sport,
    row.gameId,
    normalize(row.playerName),
    row.market,
    row.line,
    row.decisionRelease,
  ].join("|"));
  return [...groups.entries()].flatMap(([scopeKey, scopeRows]) => {
    const actuals = [...new Set(scopeRows.map((row) => row.actual))];
    if (actuals.length !== 1) return [];
    const first = scopeRows[0]!;
    const projection = medianFinite(scopeRows.map((row) => row.projection));
    const independentProjection = medianFinite(scopeRows.map((row) => row.independentProjection));
    const overProbability = sideProbability(scopeRows, "over", "finalProbability");
    const storedPrediction = mode(scopeRows.map((row) => row.publishedPrediction));
    const prediction: PrivatePlayerPropSide = storedPrediction ?? (first.market === "anytime_td"
      ? "yes"
      : projection !== null && projection !== first.line
        ? projection > first.line ? "over" : "under"
        : (overProbability ?? 0.5) >= 0.5 ? "over" : "under");
    const result = settlePlayerProp(prediction, first.line, first.actual);
    const matching = scopeRows.filter((row) => row.side === prediction);
    const bestOffer = [...matching].sort((left, right) => right.americanPrice - left.americanPrice)[0] ?? null;
    return [{
      scopeKey,
      sport: first.sport,
      gameId: first.gameId,
      playerName: first.playerName,
      market: first.market,
      line: first.line,
      prediction,
      result,
      actual: first.actual,
      projection,
      independentProjection,
      rawProbability: selectedProbability(scopeRows, prediction, "rawModelProbability"),
      marketProbability: selectedProbability(scopeRows, prediction, "marketProbability"),
      finalProbability: selectedProbability(scopeRows, prediction, "finalProbability"),
      grade: strongestGrade(matching.length ? matching : scopeRows),
      canonicalMainLine: scopeRows.some((row) => row.canonicalMainLine),
      exactOfferCount: scopeRows.length,
      bestAvailableAmericanPrice: bestOffer?.americanPrice ?? null,
      bestAvailableSportsbook: bestOffer?.sportsbook ?? null,
      decisionRelease: first.decisionRelease,
    }];
  }).sort((first, second) => first.scopeKey.localeCompare(second.scopeKey));
}

export function summarizePrivatePlayerPropTracking(rows: readonly PrivatePlayerPropSettledRow[]) {
  const forecasts = buildPrivatePlayerPropForecasts(rows);
  const main = forecasts.filter((row) => row.canonicalMainLine);
  const alternates = forecasts.filter((row) => !row.canonicalMainLine);
  const releases = [...new Set(forecasts.map((row) => row.decisionRelease))].sort();
  const markets = [...new Set(forecasts.map((row) => row.market))].sort();
  const grades = [...new Set(forecasts.map((row) => row.grade))].sort();
  return {
    exactOfferRows: rows.length,
    forecastScopes: forecasts.length,
    canonicalMainLineScopes: main.length,
    offeredAlternateScopes: alternates.length,
    releaseWarning: releases.length > 1
      ? "Archive aggregate spans multiple releases; current-model performance must be read by release."
      : null,
    mainLine: scorecard(main),
    offeredAlternates: scorecard(alternates),
    byMarket: Object.fromEntries(markets.map((market) => [market, {
      mainLine: scorecard(main.filter((row) => row.market === market)),
      offeredAlternates: scorecard(alternates.filter((row) => row.market === market)),
      cushions: cushionScorecards(main.filter((row) => row.market === market)),
    }])),
    byRelease: Object.fromEntries(releases.map((release) => [release,
      scorecard(main.filter((row) => row.decisionRelease === release)),
    ])),
    byGrade: Object.fromEntries(grades.map((grade) => [grade, {
      mainLine: scorecard(main.filter((row) => row.grade === grade)),
      offeredAlternates: scorecard(alternates.filter((row) => row.grade === grade)),
    }])),
    forecasts,
  };
}

export function settlePlayerProp(
  side: PrivatePlayerPropSide,
  line: number,
  actual: number,
): PrivatePlayerPropResult {
  if (side === "yes") return actual >= 1 ? "win" : "loss";
  if (actual === line) return "push";
  return side === "over" ? actual > line ? "win" : "loss" : actual < line ? "win" : "loss";
}

export function favorablePlayerPropLine(side: Exclude<PrivatePlayerPropSide, "yes">, line: number, cushion: number): number {
  if (!Number.isFinite(cushion) || cushion <= 0) throw new Error("Player-prop cushion must be positive.");
  return side === "over" ? line - cushion : line + cushion;
}

function cushionScorecards(rows: readonly PrivatePlayerPropForecast[]) {
  const first = rows[0];
  if (!first || first.prediction === "yes") return {};
  const cushions = PRIVATE_PLAYER_PROP_CUSHIONS[first.sport][first.market] ?? [];
  return Object.fromEntries(cushions.map((cushion) => {
    const settled = rows.filter((row): row is PrivatePlayerPropForecast & { prediction: "over" | "under" } => row.prediction !== "yes")
      .map((row) => settlePlayerProp(
        row.prediction,
        favorablePlayerPropLine(row.prediction, row.line, cushion),
        row.actual,
      ));
    return [`+${cushion}`, resultSummary(settled)];
  }));
}

function scorecard(rows: readonly PrivatePlayerPropForecast[]) {
  const projectionRows = rows.filter((row) => row.projection !== null);
  const independentRows = rows.filter((row) => row.independentProjection !== null);
  const rawRows = rows.filter((row) => row.rawProbability !== null && row.result !== "push");
  const marketRows = rows.filter((row) => row.marketProbability !== null && row.result !== "push");
  const finalRows = rows.filter((row) => row.finalProbability !== null && row.result !== "push");
  const modelReader = marketReaderLift(rows);
  return {
    ...resultSummary(rows.map((row) => row.result)),
    exactPrice: exactPriceMetrics(rows),
    projection: pointMetrics(projectionRows, (row) => row.projection as number),
    independentProjection: pointMetrics(independentRows, (row) => row.independentProjection as number),
    probability: {
      independent: probabilityMetrics(rawRows, (row) => row.rawProbability as number),
      market: probabilityMetrics(marketRows, (row) => row.marketProbability as number),
      final: probabilityMetrics(finalRows, (row) => row.finalProbability as number),
    },
    marketReader: modelReader,
  };
}

function exactPriceMetrics(rows: readonly PrivatePlayerPropForecast[]) {
  const priced = rows.filter((row) => row.bestAvailableAmericanPrice !== null && row.result !== "push");
  const units = priced.reduce((sum, row) => {
    if (row.result === "loss") return sum - 1;
    const price = row.bestAvailableAmericanPrice as number;
    return sum + (price > 0 ? price / 100 : 100 / -price);
  }, 0);
  return {
    records: priced.length,
    units,
    roi: priced.length > 0 ? units / priced.length : null,
  };
}

function marketReaderLift(rows: readonly PrivatePlayerPropForecast[]) {
  let corrections = 0;
  let harms = 0;
  let confirmations = 0;
  let unchangedLosses = 0;
  let comparable = 0;
  for (const row of rows) {
    if (row.prediction === "yes" || row.result === "push") continue;
    const independent = row.independentProjection !== null
      ? row.independentProjection > row.line ? "over"
        : row.independentProjection < row.line ? "under" : row.prediction
      : row.rawProbability !== null && row.rawProbability !== 0.5
        ? row.rawProbability > 0.5 ? row.prediction : opposite(row.prediction)
        : null;
    if (independent === null) continue;
    const actual = row.actual > row.line ? "over" : row.actual < row.line ? "under" : null;
    if (!actual) continue;
    comparable += 1;
    const independentCorrect = independent === actual;
    const finalCorrect = row.prediction === actual;
    if (!independentCorrect && finalCorrect) corrections += 1;
    else if (independentCorrect && !finalCorrect) harms += 1;
    else if (independentCorrect && finalCorrect) confirmations += 1;
    else unchangedLosses += 1;
  }
  return { comparable, corrections, harms, netCorrections: corrections - harms, confirmations, unchangedLosses };
}

function opposite(side: Exclude<PrivatePlayerPropSide, "yes">): Exclude<PrivatePlayerPropSide, "yes"> {
  return side === "over" ? "under" : "over";
}

function resultSummary(results: readonly PrivatePlayerPropResult[]) {
  const wins = results.filter((result) => result === "win").length;
  const losses = results.filter((result) => result === "loss").length;
  const pushes = results.filter((result) => result === "push").length;
  return {
    records: results.length,
    wins,
    losses,
    pushes,
    hitRate: wins + losses > 0 ? wins / (wins + losses) : null,
  };
}

function pointMetrics(
  rows: readonly PrivatePlayerPropForecast[],
  projection: (row: PrivatePlayerPropForecast) => number,
) {
  if (!rows.length) return { records: 0, mae: null, rmse: null, bias: null };
  const errors = rows.map((row) => projection(row) - row.actual);
  return {
    records: rows.length,
    mae: mean(errors.map(Math.abs)),
    rmse: Math.sqrt(mean(errors.map((error) => error ** 2))),
    bias: mean(errors),
  };
}

function probabilityMetrics(
  rows: readonly PrivatePlayerPropForecast[],
  probability: (row: PrivatePlayerPropForecast) => number,
) {
  if (!rows.length) return { records: 0, brier: null, logLoss: null, calibrationGap: null };
  const scored = rows.map((row) => ({
    probability: bounded(probability(row)),
    outcome: row.result === "win" ? 1 : 0,
  }));
  return {
    records: rows.length,
    brier: mean(scored.map((row) => (row.probability - row.outcome) ** 2)),
    logLoss: mean(scored.map((row) => -(row.outcome * Math.log(row.probability)
      + (1 - row.outcome) * Math.log(1 - row.probability)))),
    calibrationGap: mean(scored.map((row) => row.probability)) - mean(scored.map((row) => row.outcome)),
  };
}

function selectedProbability(
  rows: readonly PrivatePlayerPropSettledRow[],
  side: PrivatePlayerPropSide,
  field: "rawModelProbability" | "marketProbability" | "finalProbability",
): number | null {
  const direct = medianFinite(rows.filter((row) => row.side === side).map((row) => row[field]));
  if (direct !== null || side === "yes") return direct;
  const opposite = medianFinite(rows.filter((row) => row.side !== side && row.side !== "yes").map((row) => row[field]));
  return opposite === null ? null : 1 - opposite;
}

function sideProbability(
  rows: readonly PrivatePlayerPropSettledRow[],
  side: "over" | "under",
  field: "rawModelProbability" | "marketProbability" | "finalProbability",
): number | null {
  return selectedProbability(rows, side, field);
}

function strongestGrade(rows: readonly PrivatePlayerPropSettledRow[]): string {
  const rank = new Map([
    ["Best Angle", 5], ["BEST_ANGLE", 5], ["Lean", 4], ["LEAN", 4],
    ["Watchlist", 3], ["WATCHLIST", 3], ["No Play", 2], ["NO_PLAY", 2], ["Held", 1],
  ]);
  return [...rows].sort((first, second) => (rank.get(second.grade) ?? 0) - (rank.get(first.grade) ?? 0))[0]?.grade ?? "Unknown";
}

function group<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) result.set(key(row), [...(result.get(key(row)) ?? []), row]);
  return result;
}

function medianFinite(values: readonly (number | null)[]): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!finite.length) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle]! : (finite[middle - 1]! + finite[middle]!) / 2;
}

function mode<T extends string>(values: readonly (T | null)[]): T | null {
  const counts = new Map<T, number>();
  for (const value of values) if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
}

function bounded(value: number): number {
  return Math.max(0.000001, Math.min(0.999999, value));
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]/g, "");
}
