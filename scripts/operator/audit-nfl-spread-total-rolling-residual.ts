import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const AUDIT_RELEASE = "nfl_spread_total_rolling_residual_audit_2026_09_20_r1" as const;
const TRAINING = [2016, 2017, 2018, 2019, 2020, 2021] as const;
const SELECTION = [2022, 2023] as const;
const CONFIRMATION = [2024, 2025] as const;
const SHRINKAGE = [4, 8, 12, 16] as const;
const CARRYOVER = [0.25, 0.5, 0.75] as const;
const RESIDUAL_WEIGHT = [0.1, 0.2, 0.25, 0.33, 0.5] as const;
const HOME_FIELD = [1.5, 2, 2.5] as const;

type CsvRow = Record<string, string>;
type Aggregate = { games: number; scored: number; allowed: number };
type Config = {
  shrinkageGames: number;
  priorSeasonCarryover: number;
  residualWeight: number;
  homeField: number;
};
type Game = {
  id: string; season: number; week: number; away: string; home: string;
  awayScore: number; homeScore: number; spread: number; total: number;
  awaySpreadPrice: number | null; homeSpreadPrice: number | null;
  overPrice: number | null; underPrice: number | null;
};
type Forecast = Game & {
  teamMargin: number; teamTotal: number; marginCenter: number; totalCenter: number;
};
type Market = "spread" | "total";

function parseLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { values.push(value); value = ""; }
    else value += character;
  }
  values.push(value);
  return values;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.trimEnd().split(/\r?\n/);
  const header = parseLine(lines[0]!);
  return lines.slice(1).map((line, index) => {
    const values = parseLine(line);
    if (values.length !== header.length) throw new Error(`Malformed CSV row ${index + 2}.`);
    return Object.fromEntries(header.map((key, column) => [key, values[column]!])) as CsvRow;
  });
}

function finite(value: string): number | null {
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function loadGames(rows: CsvRow[]): Game[] {
  return rows.flatMap((row): Game[] => {
    const season = finite(row.season);
    const week = finite(row.week);
    const awayScore = finite(row.away_score);
    const homeScore = finite(row.home_score);
    const spread = finite(row.spread_line);
    const total = finite(row.total_line);
    if (row.game_type !== "REG" || season === null || week === null || awayScore === null || homeScore === null ||
        spread === null || total === null || season < TRAINING[0] || season > CONFIRMATION.at(-1)! ||
        !row.game_id || !row.away_team || !row.home_team) return [];
    return [{
      id: row.game_id, season, week, away: row.away_team, home: row.home_team,
      awayScore, homeScore, spread, total,
      awaySpreadPrice: finite(row.away_spread_odds), homeSpreadPrice: finite(row.home_spread_odds),
      overPrice: finite(row.over_odds), underPrice: finite(row.under_odds),
    }];
  }).sort((a, b) => a.season - b.season || a.week - b.week || a.id.localeCompare(b.id));
}

function add(map: Map<string, Aggregate>, team: string, scored: number, allowed: number): void {
  const value = map.get(team) ?? { games: 0, scored: 0, allowed: 0 };
  value.games += 1; value.scored += scored; value.allowed += allowed; map.set(team, value);
}

function average(args: {
  team: string; field: "scored" | "allowed"; current: Map<string, Aggregate>;
  previous: Map<string, Aggregate>; league: number; config: Config;
}): number {
  const previous = args.previous.get(args.team);
  const previousAverage = previous ? previous[args.field] / previous.games : args.league;
  const prior = args.config.priorSeasonCarryover * previousAverage +
    (1 - args.config.priorSeasonCarryover) * args.league;
  const current = args.current.get(args.team);
  return (args.config.shrinkageGames * prior + (current?.[args.field] ?? 0)) /
    (args.config.shrinkageGames + (current?.games ?? 0));
}

function forecasts(games: Game[], config: Config): Forecast[] {
  const rows: Forecast[] = [];
  const completedBySeason = new Map<number, Map<string, Aggregate>>();
  const allCompleted: Game[] = [];
  for (const season of [...new Set(games.map((game) => game.season))].sort()) {
    const seasonGames = games.filter((game) => game.season === season);
    const current = new Map<string, Aggregate>();
    const previous = completedBySeason.get(season - 1) ?? new Map<string, Aggregate>();
    const scores = allCompleted.flatMap((game) => [game.awayScore, game.homeScore]);
    const league = scores.length ? mean(scores) : 22.5;
    for (const week of [...new Set(seasonGames.map((game) => game.week))].sort((a, b) => a - b)) {
      const weekGames = seasonGames.filter((game) => game.week === week);
      for (const game of weekGames) {
        const awayOffense = average({ team: game.away, field: "scored", current, previous, league, config });
        const awayDefense = average({ team: game.away, field: "allowed", current, previous, league, config });
        const homeOffense = average({ team: game.home, field: "scored", current, previous, league, config });
        const homeDefense = average({ team: game.home, field: "allowed", current, previous, league, config });
        const awayPoints = (awayOffense + homeDefense) / 2 - config.homeField / 2;
        const homePoints = (homeOffense + awayDefense) / 2 + config.homeField / 2;
        const teamMargin = homePoints - awayPoints;
        const teamTotal = homePoints + awayPoints;
        rows.push({
          ...game, teamMargin, teamTotal,
          marginCenter: game.spread + config.residualWeight * (teamMargin - game.spread),
          totalCenter: game.total + config.residualWeight * (teamTotal - game.total),
        });
      }
      for (const game of weekGames) {
        add(current, game.away, game.awayScore, game.homeScore);
        add(current, game.home, game.homeScore, game.awayScore);
        allCompleted.push(game);
      }
    }
    completedBySeason.set(season, current);
  }
  return rows;
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-x * x));
}

function normalCdf(value: number): number { return 0.5 * (1 + erf(value / Math.sqrt(2))); }

function scale(rows: Forecast[], market: Market): number {
  const selected = rows.filter((row) => TRAINING.includes(row.season as never));
  const errors = selected.map((row) => market === "spread"
    ? (row.homeScore - row.awayScore) - row.marginCenter
    : (row.homeScore + row.awayScore) - row.totalCenter);
  return Math.sqrt(mean(errors.map((error) => error * error)));
}

function probability(row: Forecast, market: Market, sigma: number): number {
  const residual = market === "spread" ? row.marginCenter - row.spread : row.totalCenter - row.total;
  return Math.min(0.995, Math.max(0.005, normalCdf(residual / sigma)));
}

function implied(price: number): number { return price > 0 ? 100 / (price + 100) : -price / (-price + 100); }
function profit(price: number): number { return price > 0 ? price / 100 : 100 / -price; }

function evaluation(row: Forecast, market: Market, sigma: number) {
  const primaryProbability = probability(row, market, sigma);
  const first = primaryProbability >= 0.5;
  const selectedProbability = first ? primaryProbability : 1 - primaryProbability;
  const selectedPrice = market === "spread"
    ? first ? row.homeSpreadPrice : row.awaySpreadPrice
    : first ? row.overPrice : row.underPrice;
  const opposingPrice = market === "spread"
    ? first ? row.awaySpreadPrice : row.homeSpreadPrice
    : first ? row.underPrice : row.overPrice;
  const center = market === "spread" ? row.marginCenter : row.totalCenter;
  const line = market === "spread" ? row.spread : row.total;
  const cushion = first ? center - line : line - center;
  if (selectedPrice === null || opposingPrice === null || selectedPrice === 0 || selectedPrice < -200 || selectedPrice > 200) {
    return { primaryProbability, first, selectedProbability, selectedPrice, edge: null, expectedValue: null, cushion, grade: "No Play" as const };
  }
  const fair = implied(selectedPrice) / (implied(selectedPrice) + implied(opposingPrice));
  const edge = 100 * (selectedProbability - fair);
  const expectedValue = selectedProbability * profit(selectedPrice) - (1 - selectedProbability);
  const sensitive = market === "spread"
    ? [3, 7, 10, 14].some((key) => Math.abs(Math.abs(line) - key) <= 0.25)
    : line <= 41 || line >= 50;
  const penalty = sensitive ? 0.5 : 0;
  const lean = market === "spread"
    ? selectedProbability >= 0.51 && expectedValue >= 0 && edge >= 0 && cushion >= penalty
    : selectedProbability >= 0.535 && expectedValue >= 0.02 && edge >= 1 && cushion >= penalty;
  const best = lean && edge >= 4 && (market === "spread"
    ? selectedProbability >= 0.55 && expectedValue >= 0.04
    : selectedProbability >= 0.535 && expectedValue >= 0.035);
  const watch = market === "spread"
    ? selectedProbability >= 0.5 && expectedValue >= -0.02 && edge >= -1 && cushion >= -0.5 + penalty
    : selectedProbability >= 0.525 && expectedValue >= 0 && edge >= 0 && cushion >= 0.5 + penalty;
  const grade = best ? "Best Angle" : lean ? "Lean" : watch ? "Watchlist" : "No Play";
  return { primaryProbability, first, selectedProbability, selectedPrice, edge, expectedValue, cushion, grade };
}

function metrics(rows: Forecast[], market: Market, sigma: number, seasons: readonly number[]) {
  const selected = rows.filter((row) => seasons.includes(row.season));
  const resolved = selected.filter((row) => market === "spread"
    ? row.homeScore - row.awayScore !== row.spread
    : row.homeScore + row.awayScore !== row.total);
  const outcomes = resolved.map((row) => Number(market === "spread"
    ? row.homeScore - row.awayScore > row.spread
    : row.homeScore + row.awayScore > row.total));
  const probabilities = resolved.map((row) => probability(row, market, sigma));
  const errors = selected.map((row) => market === "spread"
    ? row.marginCenter - (row.homeScore - row.awayScore)
    : row.totalCenter - (row.homeScore + row.awayScore));
  const evaluated = resolved.map((row) => ({ row, value: evaluation(row, market, sigma) }));
  const actionable = evaluated.filter(({ value }) => value.grade === "Best Angle" || value.grade === "Lean");
  const wins = actionable.filter(({ row, value }) => {
    const outcome = market === "spread" ? row.homeScore - row.awayScore > row.spread : row.homeScore + row.awayScore > row.total;
    return value.first === outcome;
  });
  const units = actionable.reduce((sum, { row, value }) => {
    const outcome = market === "spread" ? row.homeScore - row.awayScore > row.spread : row.homeScore + row.awayScore > row.total;
    return sum + (value.first === outcome ? profit(value.selectedPrice!) : -1);
  }, 0);
  return {
    games: selected.length, resolved: resolved.length, pushes: selected.length - resolved.length,
    mae: mean(errors.map(Math.abs)), rmse: Math.sqrt(mean(errors.map((error) => error * error))), bias: mean(errors),
    brier: mean(probabilities.map((value, index) => (value - outcomes[index]!) ** 2)),
    meanPrimaryProbability: mean(probabilities), actualPrimaryRate: mean(outcomes),
    absoluteCalibrationGap: Math.abs(mean(probabilities) - mean(outcomes)),
    selectedSideAccuracy: mean(probabilities.map((value, index) => Number((value >= 0.5) === Boolean(outcomes[index])))),
    primary: probabilities.filter((value) => value >= 0.5).length,
    opposite: probabilities.filter((value) => value < 0.5).length,
    actionable: {
      rows: actionable.length, wins: wins.length, losses: actionable.length - wins.length,
      accuracy: actionable.length ? wins.length / actionable.length : null,
      units, roi: actionable.length ? units / actionable.length : null,
      primary: actionable.filter(({ value }) => value.first).length,
      opposite: actionable.filter(({ value }) => !value.first).length,
      bestAngles: actionable.filter(({ value }) => value.grade === "Best Angle").length,
      leans: actionable.filter(({ value }) => value.grade === "Lean").length,
    },
  };
}

function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }

function marketBaseline(games: Game[], market: Market, seasons: readonly number[]) {
  const selected = games.filter((row) => seasons.includes(row.season));
  const errors = selected.map((row) => market === "spread"
    ? row.spread - (row.homeScore - row.awayScore)
    : row.total - (row.homeScore + row.awayScore));
  const resolved = selected.filter((row) => market === "spread"
    ? row.homeScore - row.awayScore !== row.spread
    : row.homeScore + row.awayScore !== row.total);
  const outcomes = resolved.map((row) => Number(market === "spread"
    ? row.homeScore - row.awayScore > row.spread
    : row.homeScore + row.awayScore > row.total));
  return {
    games: selected.length, resolved: resolved.length, mae: mean(errors.map(Math.abs)),
    rmse: Math.sqrt(mean(errors.map((error) => error * error))), bias: mean(errors),
    brier: 0.25, absoluteCalibrationGap: Math.abs(0.5 - mean(outcomes)), actualPrimaryRate: mean(outcomes),
  };
}

function configs(): Config[] {
  return SHRINKAGE.flatMap((shrinkageGames) => CARRYOVER.flatMap((priorSeasonCarryover) =>
    RESIDUAL_WEIGHT.flatMap((residualWeight) => HOME_FIELD.map((homeField) =>
      ({ shrinkageGames, priorSeasonCarryover, residualWeight, homeField })))));
}

async function main(): Promise<void> {
  const sourceRoot = process.env.NFL_GAMES_CACHE_ROOT ?? path.resolve("football-research/cache/nflverse");
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, "games.latest.json"), "utf8")) as { filename: string; sha256: string };
  const bytes = await readFile(path.join(sourceRoot, manifest.filename));
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== manifest.sha256) throw new Error("nflverse games checksum mismatch");
  const games = loadGames(parseCsv(bytes.toString("utf8")));
  const tournaments = configs().map((config) => {
    const rows = forecasts(games, config);
    const spreadScale = scale(rows, "spread");
    const totalScale = scale(rows, "total");
    return {
      config, rows, spreadScale, totalScale,
      spread: metrics(rows, "spread", spreadScale, SELECTION),
      total: metrics(rows, "total", totalScale, SELECTION),
    };
  });
  const select = (market: Market) => [...tournaments].sort((a, b) =>
    a[market].brier - b[market].brier || a[market].mae - b[market].mae ||
    a.config.residualWeight - b.config.residualWeight || b.config.shrinkageGames - a.config.shrinkageGames)[0]!;
  const reportFor = (market: Market) => {
    const winner = select(market);
    const sigma = market === "spread" ? winner.spreadScale : winner.totalScale;
    return {
      selectedConfig: winner.config, trainingScale: sigma, selection: winner[market],
      confirmation: metrics(winner.rows, market, sigma, CONFIRMATION),
      byConfirmationSeason: Object.fromEntries(CONFIRMATION.map((season) => [season, metrics(winner.rows, market, sigma, [season])])),
      marketBaseline: {
        selection: marketBaseline(games, market, SELECTION), confirmation: marketBaseline(games, market, CONFIRMATION),
        byConfirmationSeason: Object.fromEntries(CONFIRMATION.map((season) => [season, marketBaseline(games, market, [season])])),
      },
      topSelectionCandidates: [...tournaments].sort((a, b) =>
        a[market].brier - b[market].brier || a[market].mae - b[market].mae || a.config.residualWeight - b.config.residualWeight)
        .slice(0, 5).map((entry) => ({ config: entry.config, trainingScale: market === "spread" ? entry.spreadScale : entry.totalScale, selection: entry[market] })),
    };
  };
  console.log(JSON.stringify({
    auditRelease: AUDIT_RELEASE, generatedAt: new Date().toISOString(), source: { ...manifest, verifiedSha256: checksum },
    chronology: { training: TRAINING, selection: SELECTION, confirmation: CONFIRMATION }, sourceGames: games.length,
    spread: reportFor("spread"), total: reportFor("total"),
  }, null, 2));
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
