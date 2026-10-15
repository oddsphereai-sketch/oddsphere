/** Build a leakage-safe feature matrix from complete raw NBA research packages. */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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

type ReferenceMarketRow = {
  Date: string;
  Home: string;
  Away: string;
  OU: number;
  Spread: number;
  ML_Home: number;
  ML_Away: number;
};

type ConsensusOpeningRow = {
  date: string;
  home: string;
  away: string;
  homeProbability: number;
  homeSpread: number;
  total: number;
};

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
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
  if (quoted) throw new Error("NBA consensus CSV contains an unterminated quoted field.");
  values.push(value);
  return values;
}

async function consensusOpeningRows(csvPath: string): Promise<{
  rows: ConsensusOpeningRow[];
  sha256: string;
}> {
  const body = await readFile(csvPath, "utf8");
  const lines = body.split(/\r?\n/).filter((line) => line.length > 0);
  const header = parseCsvLine(lines[0] ?? "");
  const required = [
    "date_et",
    "season_type",
    "stage",
    "home_team",
    "away_team",
    "open_home_win_prob",
    "open_spread_home",
    "open_total",
  ];
  const indexes = new Map(required.map((name) => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`NBA consensus CSV is missing ${name}.`);
    return [name, index] as const;
  }));
  const cell = (values: string[], name: string): string => values[indexes.get(name)!] ?? "";
  const rows: ConsensusOpeningRow[] = [];
  for (let lineNumber = 1; lineNumber < lines.length; lineNumber += 1) {
    const values = parseCsvLine(lines[lineNumber]!);
    if (values.length !== header.length) {
      throw new Error(`NBA consensus CSV row ${lineNumber + 1} has ${values.length} fields; expected ${header.length}.`);
    }
    if (cell(values, "season_type").toLowerCase() !== "regular") continue;
    if (cell(values, "stage").toLowerCase() !== "regular season") continue;
    const homeProbability = Number(cell(values, "open_home_win_prob"));
    const homeSpread = Number(cell(values, "open_spread_home"));
    const total = Number(cell(values, "open_total"));
    if (!(homeProbability > 0 && homeProbability < 1) || !Number.isFinite(homeSpread) || !Number.isFinite(total)) {
      throw new Error(`NBA consensus CSV row ${lineNumber + 1} has an invalid opening market.`);
    }
    rows.push({
      date: cell(values, "date_et"),
      home: cell(values, "home_team"),
      away: cell(values, "away_team"),
      homeProbability,
      homeSpread,
      total,
    });
  }
  return { rows, sha256: createHash("sha256").update(body).digest("hex") };
}

function implied(american: number): number {
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

function referenceRows(sqlitePath: string, season: number): ReferenceMarketRow[] {
  const table = season === 2023 ? "2023-24" : season === 2024 ? "2024-25" : null;
  if (!table) return [];
  const body = execFileSync(
    "sqlite3",
    ["-json", sqlitePath, `select Date, Home, Away, OU, Spread, ML_Home, ML_Away from "${table}"`],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  return JSON.parse(body) as ReferenceMarketRow[];
}

function rawGameIdentity(row: Record<string, unknown>): {
  gameId: number;
  date: string;
  home: string;
  away: string;
} {
  const home = row.home_team as Record<string, unknown> | undefined;
  const away = row.visitor_team as Record<string, unknown> | undefined;
  const gameId = Number(row.id);
  const date = String(row.date ?? "");
  const homeName = String(home?.full_name ?? "");
  const awayName = String(away?.full_name ?? "");
  if (!Number.isInteger(gameId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !homeName || !awayName) {
    throw new Error("NBA raw game is missing reference-market identity.");
  }
  return { gameId, date, home: homeName, away: awayName };
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
  const rawIdentityByGame = new Map(rawGames.map((row) => {
    const identity = rawGameIdentity(row);
    return [identity.gameId, identity] as const;
  }));
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
  const referenceSqlite = value("--reference-sqlite");
  const referenceByIdentity = new Map<string, ReferenceMarketRow>();
  if (referenceSqlite) {
    for (const season of new Set(games.map((game) => game.season))) {
      for (const row of referenceRows(path.resolve(referenceSqlite), season)) {
        const key = `${row.Date}::${row.Home}::${row.Away}`;
        if (referenceByIdentity.has(key)) throw new Error(`NBA reference market contains duplicate ${key}.`);
        referenceByIdentity.set(key, row);
      }
    }
  }
  const consensusInputs: { path: string; sha256: string; rows: number }[] = [];
  const consensusByIdentity = new Map<string, ConsensusOpeningRow>();
  for (const rawPath of values("--reference-consensus-csv")) {
    const csvPath = path.resolve(rawPath);
    const parsed = await consensusOpeningRows(csvPath);
    consensusInputs.push({ path: csvPath, sha256: parsed.sha256, rows: parsed.rows.length });
    for (const row of parsed.rows) {
      const key = `${row.date}::${row.home}::${row.away}`;
      if (consensusByIdentity.has(key)) throw new Error(`NBA consensus opening contains duplicate ${key}.`);
      consensusByIdentity.set(key, row);
    }
  }
  let referenceMarketMatches = 0;
  let consensusOpeningMatches = 0;
  let legacyReferenceMatches = 0;
  const featureRows = buildNbaPointInTimeFeatures({ games, boxes, advanced }).map((row) => {
    const market = openingMarketByGame.get(row.game_id);
    const identity = rawIdentityByGame.get(row.game_id);
    const identityKey = identity ? `${identity.date}::${identity.home}::${identity.away}` : null;
    const consensus = identityKey ? consensusByIdentity.get(identityKey) : undefined;
    const reference = identityKey
      ? referenceByIdentity.get(identityKey)
      : undefined;
    if (!market && consensus) consensusOpeningMatches += 1;
    if (!market && !consensus && reference) legacyReferenceMatches += 1;
    if (!market && (consensus || reference)) referenceMarketMatches += 1;
    const home = reference ? implied(Number(reference.ML_Home)) : null;
    const away = reference ? implied(Number(reference.ML_Away)) : null;
    const noVigHome = home !== null && away !== null && home + away > 0 ? home / (home + away) : null;
    return {
      ...row,
      evaluation_market_provenance: market
        ? "balldontlie_timestamped_opening"
        : consensus
          ? "independent_multibook_consensus_documented_opening_snapshot_timestamp_unavailable"
        : reference
          ? "public_pregame_reference_timestamp_unknown"
          : "unavailable",
      evaluation_opening_market_home_probability: market?.homeWinProbability ?? consensus?.homeProbability ?? noVigHome,
      evaluation_opening_moneyline_home_price: market?.homeMoneylinePrice ?? (consensus ? null : reference?.ML_Home) ?? null,
      evaluation_opening_moneyline_away_price: market?.awayMoneylinePrice ?? (consensus ? null : reference?.ML_Away) ?? null,
      evaluation_opening_home_spread: market?.homeSpread ?? consensus?.homeSpread ?? (reference ? -Number(reference.Spread) : null),
      evaluation_opening_home_cover_probability: market?.homeCoverProbability ?? null,
      evaluation_opening_home_spread_price: market?.homeSpreadPrice ?? null,
      evaluation_opening_away_spread_price: market?.awaySpreadPrice ?? null,
      evaluation_opening_total: market?.total ?? consensus?.total ?? reference?.OU ?? null,
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
    referenceMarketMatches,
    consensusOpeningMatches,
    legacyReferenceMatches,
    consensusOpeningInputs: consensusInputs,
    referenceMarketProvenance: referenceSqlite
      ? "public pregame reference; observation timestamp and source book unknown; evaluation only"
      : null,
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
