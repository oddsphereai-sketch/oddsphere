/** Build a leakage-safe feature matrix from complete raw NBA research packages. */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildNbaPointInTimeFeatures,
  NBA_POINT_IN_TIME_FEATURE_RELEASE,
  normalizeNbaHistoricalGame,
  normalizeNbaHistoricalPlayerAdvanced,
  normalizeNbaHistoricalPlayerBox,
} from "../../../lib/services/nba/nbaPointInTimeFeatures";
import {
  nbaOpeningMarketByGame,
  normalizeNbaHistoricalOpeningOdds,
} from "../../../lib/services/nba/nbaHistoricalOpeningMarket";

function values(name: string): string[] {
  const output: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) output.push(process.argv[index + 1]!);
  }
  return output;
}

function value(name: string): string | undefined {
  return values(name)[0];
}

async function json(pathname: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(pathname, "utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${pathname} is not a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

async function jsonl(pathname: string): Promise<Record<string, unknown>[]> {
  const body = await readFile(pathname, "utf8");
  return body.split("\n").filter(Boolean).map((line, index) => {
    const parsed = JSON.parse(line) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${pathname}:${index + 1} is not a JSON object.`);
    }
    return parsed as Record<string, unknown>;
  });
}

function uniqueById<T>(rows: T[], id: (row: T) => number, label: string): T[] {
  const byId = new Map<number, { serialized: string; row: T }>();
  for (const row of rows) {
    const key = id(row);
    const serialized = JSON.stringify(row);
    const existing = byId.get(key);
    if (existing && existing.serialized !== serialized) throw new Error(`${label} ${key} is contradictory across inputs.`);
    if (!existing) byId.set(key, { serialized, row });
  }
  return [...byId.values()].map((item) => item.row);
}

async function main(): Promise<void> {
  const inputs = values("--input").map((item) => path.resolve(item));
  if (inputs.length === 0) throw new Error("At least one --input complete NBA research directory is required.");
  const sourceManifests: Record<string, unknown>[] = [];
  const rawGames: Record<string, unknown>[] = [];
  const rawBoxes: Record<string, unknown>[] = [];
  const rawAdvanced: Record<string, unknown>[] = [];
  const rawOpeningOdds: Record<string, unknown>[] = [];
  for (const input of inputs) {
    const manifest = await json(path.join(input, "manifest.json"));
    if (manifest.scoreBacktestEligible !== true) {
      throw new Error(`${input} is not a complete score-backtest-eligible package.`);
    }
    sourceManifests.push(manifest);
    rawGames.push(...await jsonl(path.join(input, "games.jsonl")));
    rawBoxes.push(...await jsonl(path.join(input, "box.jsonl")));
    rawAdvanced.push(...await jsonl(path.join(input, "advanced.jsonl")));
    if (manifest.exactOpeningPriceBacktestEligible === true) {
      const datasets = manifest.datasets as Record<string, Record<string, unknown>> | undefined;
      const openingFile = datasets?.opening_odds?.file;
      if (typeof openingFile !== "string" || openingFile.length === 0) {
        throw new Error(`${input} claims exact opening-price eligibility without an opening-odds file.`);
      }
      rawOpeningOdds.push(...await jsonl(path.join(input, openingFile)));
    }
  }

  const games = uniqueById(rawGames.map(normalizeNbaHistoricalGame), (row) => row.gameId, "NBA game");
  const boxes = uniqueById(rawBoxes.map(normalizeNbaHistoricalPlayerBox), (row) => row.rowId, "NBA box row");
  const advanced = uniqueById(
    rawAdvanced.map(normalizeNbaHistoricalPlayerAdvanced),
    (row) => row.rowId,
    "NBA advanced row",
  );
  const gameIds = new Set(games.map((game) => game.gameId));
  const outOfScopeBoxes = boxes.filter((row) => !gameIds.has(row.gameId));
  if (outOfScopeBoxes.length > 0) {
    throw new Error(`NBA feature build found ${outOfScopeBoxes.length} box rows outside the exact game set.`);
  }
  const outOfScopeAdvanced = advanced.filter((row) => !gameIds.has(row.gameId));
  if (outOfScopeAdvanced.length > 0) {
    throw new Error(`NBA feature build found ${outOfScopeAdvanced.length} advanced rows outside the exact game set.`);
  }
  const advancedTeamsByGame = new Map<number, Set<number>>();
  for (const row of advanced) {
    const teams = advancedTeamsByGame.get(row.gameId) ?? new Set<number>();
    teams.add(row.teamId);
    advancedTeamsByGame.set(row.gameId, teams);
  }
  const gamesWithAdvancedTeamCoverage = games.filter((game) => {
    const teams = advancedTeamsByGame.get(game.gameId);
    return teams?.has(game.homeTeamId) === true && teams.has(game.awayTeamId);
  }).length;
  const openingRows = uniqueById(
    rawOpeningOdds.map(normalizeNbaHistoricalOpeningOdds),
    (row) => row.rowId,
    "NBA opening-odds row",
  );
  const openingMarketByGame = nbaOpeningMarketByGame({
    rows: openingRows,
    gameStartById: new Map(games.map((game) => [game.gameId, game.startTime])),
  });
  const featureRows = buildNbaPointInTimeFeatures({ games, boxes, advanced }).map((row) => {
    const market = openingMarketByGame.get(row.game_id);
    return {
      ...row,
      evaluation_opening_market_home_probability: market?.homeWinProbability ?? null,
      evaluation_opening_moneyline_home_price: market?.homeMoneylinePrice ?? null,
      evaluation_opening_moneyline_away_price: market?.awayMoneylinePrice ?? null,
      evaluation_opening_home_spread: market?.homeSpread ?? null,
      evaluation_opening_home_cover_probability: market?.homeCoverProbability ?? null,
      evaluation_opening_home_spread_price: market?.homeSpreadPrice ?? null,
      evaluation_opening_away_spread_price: market?.awaySpreadPrice ?? null,
      evaluation_opening_total: market?.total ?? null,
      evaluation_opening_over_probability: market?.overProbability ?? null,
      evaluation_opening_over_price: market?.overPrice ?? null,
      evaluation_opening_under_price: market?.underPrice ?? null,
    };
  });
  if (featureRows.length !== games.length) throw new Error("NBA feature build did not emit exactly one row per game.");

  const capturedAt = new Date().toISOString();
  const outputDirectory = path.resolve(value("--output") ?? path.join(
    "nba-research",
    "reports",
    NBA_POINT_IN_TIME_FEATURE_RELEASE,
    capturedAt.replace(/[:.]/g, "-"),
  ));
  await mkdir(outputDirectory, { recursive: true });
  const body = `${featureRows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  const outputFile = path.join(outputDirectory, "features.jsonl");
  await writeFile(`${outputFile}.tmp`, body, "utf8");
  await rename(`${outputFile}.tmp`, outputFile);
  const featureNames = Object.keys(featureRows[0] ?? {}).filter((key) =>
    !key.startsWith("target_") && !key.startsWith("evaluation_") && !["release", "game_id", "season", "feature_cutoff", "home_team_id", "away_team_id", "home_team", "away_team"].includes(key));
  const manifest = {
    release: NBA_POINT_IN_TIME_FEATURE_RELEASE,
    builtAt: capturedAt,
    sourceReleases: sourceManifests.map((item) => item.release),
    sourceSeasons: sourceManifests.map((item) => item.season),
    games: games.length,
    playerBoxRows: boxes.length,
    playerAdvancedRows: advanced.length,
    gamesWithAdvancedTeamCoverage,
    advancedTeamCoverageRate: games.length > 0 ? gamesWithAdvancedTeamCoverage / games.length : 0,
    openingOddsRows: openingRows.length,
    openingMoneylineGames: [...openingMarketByGame.values()].filter((market) =>
      market.homeWinProbability !== null).length,
    openingSpreadGames: [...openingMarketByGame.values()].filter((market) =>
      market.homeSpread !== null && market.homeCoverProbability !== null).length,
    openingTotalGames: [...openingMarketByGame.values()].filter((market) =>
      market.total !== null && market.overProbability !== null).length,
    featureCount: featureNames.length,
    featureNames,
    chronologicalContract: "Each feature row is emitted before its own finalized outcome updates state.",
    sha256: createHash("sha256").update(body).digest("hex"),
    file: "features.jsonl",
  };
  const manifestPath = path.join(outputDirectory, "manifest.json");
  await writeFile(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(`${manifestPath}.tmp`, manifestPath);
  console.log(JSON.stringify({ outputDirectory, ...manifest }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
