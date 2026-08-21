/**
 * Local-only first NFL margin benchmark tournament.
 *
 * Selection period: 2024 regular season.
 * One-time untouched report: 2025 regular season.
 * Source lines are the nflverse terminal `spread_line`, not an OddSphere lock.
 * No prediction, grade, database, or publication writes.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  FOOTBALL_DYNAMIC_MARGIN_BENCHMARK_RELEASE,
  footballNormalCdf,
  predictDynamicMargin,
  type CompletedMarginGame,
  type DynamicMarginConfig,
  type MarginPredictionTarget,
} from "../../lib/services/football/footballDynamicMarginBenchmark";
import { americanToImpliedProbability } from "../../lib/services/football/footballMarketMath";

const TOURNAMENT_RELEASE = "nfl_dynamic_margin_tournament_2026_08_19_r1" as const;
const TRAINING_START_SEASON = 2010;
const SELECTION_SEASON = 2024;
const HOLDOUT_SEASON = 2025;

type CsvRow = Record<string, string>;
type HistoricalGame = {
  completed: CompletedMarginGame;
  target: MarginPredictionTarget;
  marketHomeMargin: number | null;
  homeSpreadOdds: number | null;
  awaySpreadOdds: number | null;
};

type Evaluation = {
  season: number;
  games: number;
  spreadGames: number;
  marginMae: number;
  marginRmse: number;
  marginBias: number;
  homeWinBrier: number;
  modelHomeCoverBrier: number | null;
  marketHomeCoverBrier: number | null;
  marketMarginMae: number | null;
  marketMarginRmse: number | null;
  modelMinusMarketMae: number | null;
};

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.trimEnd().split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line, rowIndex) => {
    const values = parseCsvLine(line);
    if (values.length !== header.length) throw new Error(`Malformed CSV row ${rowIndex + 2}: expected ${header.length} fields, received ${values.length}`);
    return Object.fromEntries(header.map((key, index) => [key, values[index]]));
  });
}

function finiteNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fairHomeProbability(homePrice: number | null, awayPrice: number | null): number | null {
  if (homePrice === null || awayPrice === null || homePrice === 0 || awayPrice === 0) return null;
  try {
    const home = americanToImpliedProbability(homePrice);
    const away = americanToImpliedProbability(awayPrice);
    return home / (home + away);
  } catch {
    return null;
  }
}

function toGame(row: CsvRow): HistoricalGame | null {
  const season = finiteNumber(row.season);
  const week = finiteNumber(row.week);
  const homeScore = finiteNumber(row.home_score);
  const awayScore = finiteNumber(row.away_score);
  if (row.game_type !== "REG" || season === null || week === null || homeScore === null || awayScore === null) return null;
  if (season < TRAINING_START_SEASON || season > HOLDOUT_SEASON) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.gameday) || !row.home_team || !row.away_team || !row.game_id) return null;
  const kickoff = `${row.gameday}T17:00:00Z`;
  const completed: CompletedMarginGame = {
    league: "nfl",
    gameId: row.game_id,
    season,
    week,
    seasonPhase: "regular",
    kickoff,
    homeTeamId: row.home_team,
    awayTeamId: row.away_team,
    neutralSite: row.location === "Neutral",
    homeScore,
    awayScore,
  };
  return {
    completed,
    target: {
      league: completed.league,
      gameId: completed.gameId,
      season: completed.season,
      week: completed.week,
      seasonPhase: completed.seasonPhase,
      kickoff: completed.kickoff,
      homeTeamId: completed.homeTeamId,
      awayTeamId: completed.awayTeamId,
      neutralSite: completed.neutralSite,
      decisionTimestamp: `${row.gameday}T16:00:00Z`,
    },
    marketHomeMargin: finiteNumber(row.spread_line),
    homeSpreadOdds: finiteNumber(row.home_spread_odds),
    awaySpreadOdds: finiteNumber(row.away_spread_odds),
  };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function evaluateSeason(games: HistoricalGame[], season: number, config: DynamicMarginConfig): Evaluation {
  const priorHistory = games
    .filter((game) => game.completed.season < season)
    .map((game) => game.completed);
  const seasonGames = games.filter((game) => game.completed.season === season);
  const weekBuckets = new Map<number, HistoricalGame[]>();
  for (const game of seasonGames) weekBuckets.set(game.completed.week, [...(weekBuckets.get(game.completed.week) ?? []), game]);
  const history = [...priorHistory];
  const marginErrors: number[] = [];
  const homeWinSquaredErrors: number[] = [];
  const modelCoverSquaredErrors: number[] = [];
  const marketCoverSquaredErrors: number[] = [];
  const marketMarginErrors: number[] = [];
  for (const [, weekGames] of [...weekBuckets.entries()].sort((a, b) => a[0] - b[0])) {
    for (const game of weekGames) {
      const prediction = predictDynamicMargin({ history, target: game.target, config, includedHistoryPhases: ["regular"] });
      const actualMargin = game.completed.homeScore - game.completed.awayScore;
      marginErrors.push(prediction.projectedHomeMargin - actualMargin);
      if (actualMargin !== 0) homeWinSquaredErrors.push(Math.pow(prediction.homeWinProbability - (actualMargin > 0 ? 1 : 0), 2));
      if (game.marketHomeMargin !== null) {
        marketMarginErrors.push(game.marketHomeMargin - actualMargin);
        if (actualMargin !== game.marketHomeMargin) {
          const outcome = actualMargin > game.marketHomeMargin ? 1 : 0;
          const modelHomeCover = footballNormalCdf((prediction.projectedHomeMargin - game.marketHomeMargin) / prediction.marginStdDev);
          modelCoverSquaredErrors.push(Math.pow(modelHomeCover - outcome, 2));
          const marketHomeCover = fairHomeProbability(game.homeSpreadOdds, game.awaySpreadOdds);
          if (marketHomeCover !== null) marketCoverSquaredErrors.push(Math.pow(marketHomeCover - outcome, 2));
        }
      }
    }
    // Complete-week lock: no game in this week trains another prediction in the same week.
    history.push(...weekGames.map((game) => game.completed));
  }
  const mae = mean(marginErrors.map(Math.abs));
  const marketMae = marketMarginErrors.length > 0 ? mean(marketMarginErrors.map(Math.abs)) : null;
  return {
    season,
    games: marginErrors.length,
    spreadGames: marketMarginErrors.length,
    marginMae: mae,
    marginRmse: Math.sqrt(mean(marginErrors.map((error) => error * error))),
    marginBias: mean(marginErrors),
    homeWinBrier: mean(homeWinSquaredErrors),
    modelHomeCoverBrier: modelCoverSquaredErrors.length > 0 ? mean(modelCoverSquaredErrors) : null,
    marketHomeCoverBrier: marketCoverSquaredErrors.length > 0 ? mean(marketCoverSquaredErrors) : null,
    marketMarginMae: marketMae,
    marketMarginRmse: marketMarginErrors.length > 0 ? Math.sqrt(mean(marketMarginErrors.map((error) => error * error))) : null,
    modelMinusMarketMae: marketMae === null ? null : mae - marketMae,
  };
}

function configs(): DynamicMarginConfig[] {
  const values: DynamicMarginConfig[] = [];
  for (const seasonCarryover of [0.55, 0.7, 0.85]) {
    for (const observationVariance of [144, 196]) {
      for (const homeFieldPoints of [1.5, 2, 2.5]) {
        for (const weeklyEvolutionVariance of [0.5, 2]) {
          values.push({
            initialTeamVariance: 64,
            weeklyEvolutionVariance,
            offseasonEvolutionVariance: 25,
            seasonCarryover,
            observationVariance,
            homeFieldPoints,
          });
        }
      }
    }
  }
  return values;
}

async function main() {
  const cacheRoot = path.resolve(process.cwd(), "football-research/cache/nflverse");
  const manifest = JSON.parse(await readFile(path.join(cacheRoot, "games.latest.json"), "utf8")) as { filename?: unknown; sha256?: unknown };
  if (typeof manifest.filename !== "string" || typeof manifest.sha256 !== "string") throw new Error("Invalid nflverse games cache manifest.");
  const csv = await readFile(path.join(cacheRoot, manifest.filename));
  const actualHash = createHash("sha256").update(csv).digest("hex");
  if (actualHash !== manifest.sha256) throw new Error("nflverse games cache checksum mismatch.");
  const games = parseCsv(csv.toString("utf8")).map(toGame).filter((game): game is HistoricalGame => game !== null);
  const ranked = configs().map((config) => ({ config, selection: evaluateSeason(games, SELECTION_SEASON, config) }))
    .sort((a, b) => (a.selection.modelHomeCoverBrier ?? Infinity) - (b.selection.modelHomeCoverBrier ?? Infinity) || a.selection.marginMae - b.selection.marginMae);
  const selected = ranked[0];
  const holdout = evaluateSeason(games, HOLDOUT_SEASON, selected.config);
  const report = {
    tournamentRelease: TOURNAMENT_RELEASE,
    modelRelease: FOOTBALL_DYNAMIC_MARGIN_BENCHMARK_RELEASE,
    sourceChecksum: actualHash,
    sourceRowsUsed: games.length,
    trainingStartSeason: TRAINING_START_SEASON,
    selectionSeason: SELECTION_SEASON,
    holdoutSeason: HOLDOUT_SEASON,
    selectionRule: "lowest_2024_model_home_cover_brier_then_margin_mae",
    configCandidates: ranked.length,
    selectedConfig: selected.config,
    selection: selected.selection,
    holdout,
    topSelectionCandidates: ranked.slice(0, 10),
    limitations: [
      "terminal spread_line is not a timestamped OddSphere decision lock",
      "score-only diagonal state-space benchmark excludes injuries, quarterbacks, efficiency, weather, and full covariance",
      "normal margin distribution does not reproduce discrete NFL key-number mass",
      "holdout is reported once and must not be used to retune this release",
      "all outputs are local shadow research and non-actionable",
    ],
  };
  const reportRoot = path.resolve(process.cwd(), "football-research/reports");
  await mkdir(reportRoot, { recursive: true });
  await writeFile(path.join(reportRoot, `${TOURNAMENT_RELEASE}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
