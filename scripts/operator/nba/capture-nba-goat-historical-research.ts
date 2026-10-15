/**
 * Capture raw NBA research evidence to ignored local artifacts.
 *
 * Full paid-tier capture:
 *   npx tsx --env-file=.env.local scripts/operator/nba/capture-nba-goat-historical-research.ts --season 2025
 *
 * Trial-safe contract smoke (incomplete and never backtest-eligible):
 *   npx tsx --env-file=.env.local scripts/operator/nba/capture-nba-goat-historical-research.ts \
 *     --season 2025 --datasets games --sample-pages 1 \
 *     --request-interval-ms 12500
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  fetchNbaBdlHistoricalRows,
  NBA_BDL_HISTORICAL_RESEARCH_RELEASE,
  nbaBdlProviderGameId,
  type NbaBdlHistoricalDataset,
  type NbaBdlHistoricalFetch,
  type NbaBdlHistoricalSeasonType,
} from "../../../lib/services/nba/balldontlieNbaHistorical";

type DatasetManifest = {
  file: string;
  rows: number;
  requests: number;
  complete: boolean;
  sha256: string;
  batches?: number;
  reused_batches?: number;
  missing_game_ids?: number[];
  imported_source_sha256?: string;
  exclusions?: Record<string, number>;
  note?: string;
};

const ALL_DATASETS: readonly NbaBdlHistoricalDataset[] = [
  "games",
  "box",
  "advanced",
  "opening_odds",
];
const SEASON_TYPES: readonly NbaBdlHistoricalSeasonType[] = ["regular", "ist"];

function value(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function positiveInteger(name: string, fallback?: number): number {
  const raw = value(name);
  if (raw === undefined && fallback !== undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function selectedDatasets(): NbaBdlHistoricalDataset[] {
  const raw = value("--datasets");
  if (!raw) return [...ALL_DATASETS];
  const selected = raw.split(",").map((item) => item.trim()).filter(Boolean);
  const invalid = selected.filter((item) => !ALL_DATASETS.includes(item as NbaBdlHistoricalDataset));
  if (invalid.length > 0) throw new Error(`Unknown NBA datasets: ${invalid.join(", ")}.`);
  return [...new Set(selected as NbaBdlHistoricalDataset[])];
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function rowIdentity(dataset: NbaBdlHistoricalDataset, row: Record<string, unknown>): string {
  const id = integer(row.id);
  if (id === null) throw new Error(`NBA ${dataset} row is missing its immutable provider id.`);
  return String(id);
}

function stableRows(dataset: NbaBdlHistoricalDataset, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byId = new Map<string, { serialized: string; row: Record<string, unknown> }>();
  for (const row of rows) {
    const id = rowIdentity(dataset, row);
    const serialized = JSON.stringify(row);
    const existing = byId.get(id);
    if (existing && existing.serialized !== serialized) {
      throw new Error(`NBA ${dataset} provider id ${id} returned contradictory rows.`);
    }
    if (!existing) byId.set(id, { serialized, row });
  }
  return [...byId.entries()]
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, item]) => item.row);
}

function isFinalGame(row: Record<string, unknown>): boolean {
  return row.status_state === "final" || row.status === "Final";
}

function isOfficialRegularSeasonGame(row: Record<string, unknown>): boolean {
  // The NBA Cup championship is classified as IST by the provider but does
  // not count in either club's 82-game regular-season record.
  return row.ist_stage !== "Championship" && row.postseason !== true;
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

async function writeAtomicJsonl(
  absolute: string,
  rows: readonly Record<string, unknown>[],
): Promise<{ sha256: string }> {
  const body = rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
  const temporary = `${absolute}.tmp`;
  await writeFile(temporary, body, "utf8");
  await rename(temporary, absolute);
  return { sha256: createHash("sha256").update(body).digest("hex") };
}

async function writeJsonl(args: {
  outputDirectory: string;
  dataset: NbaBdlHistoricalDataset;
  rows: Record<string, unknown>[];
}): Promise<{ file: string; sha256: string }> {
  const filename = `${args.dataset.replace("_", "-")}.jsonl`;
  const result = await writeAtomicJsonl(path.join(args.outputDirectory, filename), args.rows);
  return { file: filename, sha256: result.sha256 };
}

async function readJsonl(absolute: string): Promise<Record<string, unknown>[]> {
  try {
    const body = await readFile(absolute, "utf8");
    if (!body.trim()) return [];
    return body.trim().split("\n").map((line, index) => {
      const parsed = JSON.parse(line) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${absolute}:${index + 1} is not an object.`);
      }
      return parsed as Record<string, unknown>;
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readVerifiedGameIndex(args: {
  absolute: string;
  expectedSha256: string;
  expectedGames: number;
  season: number;
}): Promise<Record<string, unknown>[]> {
  const body = await readFile(args.absolute, "utf8");
  const actualSha256 = createHash("sha256").update(body).digest("hex");
  if (actualSha256 !== args.expectedSha256.toLowerCase()) {
    throw new Error(
      `NBA imported game index checksum mismatch: expected ${args.expectedSha256}, received ${actualSha256}.`,
    );
  }
  const rows = await readJsonl(args.absolute);
  if (rows.length !== args.expectedGames) {
    throw new Error(`NBA imported game index expected ${args.expectedGames} rows, received ${rows.length}.`);
  }
  if (rows.some((row) => integer(row.season) !== args.season)) {
    throw new Error(`NBA imported game index contains a row outside season ${args.season}.`);
  }
  return rows;
}

async function collectGamesBySeasonType(args: {
  season: number;
  maxPages: number;
  requestIntervalMs: number;
}): Promise<{ rows: Record<string, unknown>[]; requests: number; complete: boolean }> {
  const results: NbaBdlHistoricalFetch[] = [];
  for (const seasonType of SEASON_TYPES) {
    results.push(await fetchNbaBdlHistoricalRows({
      dataset: "games",
      season: args.season,
      seasonType,
      maxPages: args.maxPages,
      requestIntervalMs: args.requestIntervalMs,
    }));
  }
  return {
    rows: results.flatMap((result) => result.rows),
    requests: results.reduce((sum, result) => sum + result.requests, 0),
    complete: results.every((result) => result.complete),
  };
}

async function collectExactGameBatches(args: {
  dataset: "box" | "advanced" | "opening_odds";
  gameIds: number[];
  outputDirectory: string;
  batchSize: number;
  maxPages: number;
  requestIntervalMs: number;
  sample: boolean;
  resume: boolean;
}): Promise<{
  rows: Record<string, unknown>[];
  requests: number;
  complete: boolean;
  batches: number;
  reusedBatches: number;
  missingGameIds: number[];
}> {
  const batches = chunk([...args.gameIds].sort((a, b) => a - b), args.batchSize);
  const selectedBatches = args.sample ? batches.slice(0, 1) : batches;
  const checkpointDirectory = path.join(args.outputDirectory, ".capture-checkpoints", args.dataset);
  await mkdir(checkpointDirectory, { recursive: true });
  const rows: Record<string, unknown>[] = [];
  let requests = 0;
  let reusedBatches = 0;
  let allRequestsComplete = true;
  for (let index = 0; index < selectedBatches.length; index += 1) {
    const gameIds = selectedBatches[index] ?? [];
    const identity = createHash("sha256").update(gameIds.join(",")).digest("hex").slice(0, 16);
    const checkpoint = path.join(
      checkpointDirectory,
      `${String(index + 1).padStart(4, "0")}-${identity}.jsonl`,
    );
    let batchRows = args.resume ? await readJsonl(checkpoint) : [];
    let usedCheckpoint = false;
    if (args.resume && batchRows.length > 0) {
      const allowed = new Set(gameIds);
      if (batchRows.some((row) => {
        const gameId = nbaBdlProviderGameId(row);
        return gameId === null || !allowed.has(gameId);
      })) {
        throw new Error(`NBA ${args.dataset} checkpoint ${checkpoint} contains an out-of-batch game.`);
      }
      reusedBatches += 1;
      usedCheckpoint = true;
    } else {
      const result = await fetchNbaBdlHistoricalRows({
        dataset: args.dataset,
        gameIds,
        maxPages: args.maxPages,
        requestIntervalMs: args.requestIntervalMs,
      });
      requests += result.requests;
      allRequestsComplete = allRequestsComplete && result.complete;
      if (!result.complete) {
        throw new Error(
          `NBA ${args.dataset} batch ${index + 1}/${selectedBatches.length} exceeded its page cap.`,
        );
      }
      const allowed = new Set(gameIds);
      batchRows = stableRows(args.dataset, result.rows.filter((row) => {
        const gameId = nbaBdlProviderGameId(row);
        return gameId !== null && allowed.has(gameId);
      }));
      await writeAtomicJsonl(checkpoint, batchRows);
    }
    rows.push(...batchRows);
    console.error(JSON.stringify({
      dataset: args.dataset,
      batch: index + 1,
      batches: selectedBatches.length,
      games: gameIds.length,
      rows: batchRows.length,
      resumed: usedCheckpoint,
    }));
  }
  const stable = stableRows(args.dataset, rows);
  const covered = new Set(stable.map(nbaBdlProviderGameId).filter((gameId): gameId is number => gameId !== null));
  const selectedGameIds = selectedBatches.flat();
  const missingGameIds = selectedGameIds.filter((gameId) => !covered.has(gameId));
  return {
    rows: stable,
    requests,
    complete:
      !args.sample &&
      selectedBatches.length === batches.length &&
      allRequestsComplete &&
      missingGameIds.length === 0,
    batches: selectedBatches.length,
    reusedBatches,
    missingGameIds,
  };
}

async function main(): Promise<void> {
  const season = positiveInteger("--season");
  if (season < 1996 || season > 2100) throw new Error("--season must be from 1996 through 2100.");
  const datasets = selectedDatasets();
  const samplePagesRaw = value("--sample-pages");
  const sample = samplePagesRaw !== undefined;
  if (!sample && (datasets.length !== ALL_DATASETS.length || ALL_DATASETS.some((dataset) => !datasets.includes(dataset)))) {
    throw new Error("A full NBA research capture must include games, box, advanced, and opening_odds.");
  }
  const maxPages = sample ? positiveInteger("--sample-pages") : 1_000;
  const batchSize = positiveInteger("--batch-size", 10);
  if (batchSize > 50) throw new Error("--batch-size must be from 1 through 50.");
  const resume = hasFlag("--resume");
  const importedGamesFile = value("--games-file");
  const importedGamesSha256 = value("--games-sha256");
  const importedExpectedGames = value("--expected-games");
  if (importedGamesFile && (!importedGamesSha256 || !importedExpectedGames)) {
    throw new Error("--games-file requires --games-sha256 and --expected-games.");
  }
  const requestIntervalMs = Number(
    value("--request-interval-ms") ?? process.env.NBA_BDL_REQUEST_INTERVAL_MS ?? "125",
  );
  if (!Number.isInteger(requestIntervalMs) || requestIntervalMs < 0 || requestIntervalMs > 60_000) {
    throw new Error("--request-interval-ms must be an integer from 0 through 60000.");
  }

  const capturedAt = new Date().toISOString();
  const defaultLeaf = sample
    ? `sample-${capturedAt.replace(/[:.]/g, "-")}-${datasets.join("-")}`
    : "complete";
  const outputDirectory = path.resolve(value("--output") ?? path.join(
    "nba-research",
    "raw",
    NBA_BDL_HISTORICAL_RESEARCH_RELEASE,
    String(season),
    defaultLeaf,
  ));
  await mkdir(outputDirectory, { recursive: true });

  const manifests: Partial<Record<NbaBdlHistoricalDataset, DatasetManifest>> = {};
  const importedGames = importedGamesFile
    ? await readVerifiedGameIndex({
        absolute: path.resolve(importedGamesFile),
        expectedSha256: importedGamesSha256 as string,
        expectedGames: positiveInteger("--expected-games"),
        season,
      })
    : null;
  const gameFetch = importedGames
    ? { rows: importedGames, requests: 0, complete: true }
    : await collectGamesBySeasonType({ season, maxPages, requestIntervalMs });
  const rawGames = stableRows("games", gameFetch.rows);
  const finalGames = rawGames.filter((row) => isFinalGame(row) && isOfficialRegularSeasonGame(row));
  const nonfinalGames = rawGames.filter((row) => !isFinalGame(row)).length;
  const nonOfficialRegularGames = rawGames.length - nonfinalGames - finalGames.length;
  if (datasets.includes("games")) {
    const written = await writeJsonl({ outputDirectory, dataset: "games", rows: finalGames });
    manifests.games = {
      ...written,
      rows: finalGames.length,
      requests: gameFetch.requests,
      complete: !sample && gameFetch.complete,
      imported_source_sha256: importedGames ? importedGamesSha256?.toLowerCase() : undefined,
      exclusions: {
        nonfinal_games: nonfinalGames,
        non_official_regular_games: nonOfficialRegularGames,
      },
    };
  }
  if (finalGames.length === 0) throw new Error(`NBA ${season} capture found no completed regular/IST games.`);
  const gameIds = finalGames.map((row) => integer(row.id)).filter((id): id is number => id !== null);

  if (datasets.includes("box")) {
    const result = await collectExactGameBatches({
      dataset: "box", gameIds, outputDirectory, batchSize, maxPages, requestIntervalMs, sample, resume,
    });
    const rows = result.rows;
    const written = await writeJsonl({ outputDirectory, dataset: "box", rows });
    manifests.box = {
      ...written,
      rows: rows.length,
      requests: result.requests,
      complete: result.complete,
      batches: result.batches,
      reused_batches: result.reusedBatches,
      missing_game_ids: result.missingGameIds,
      exclusions: { out_of_scope_rows: 0 },
    };
  }

  if (datasets.includes("advanced")) {
    const result = await collectExactGameBatches({
      dataset: "advanced", gameIds, outputDirectory, batchSize, maxPages, requestIntervalMs, sample, resume,
    });
    const rows = result.rows;
    const written = await writeJsonl({ outputDirectory, dataset: "advanced", rows });
    manifests.advanced = {
      ...written,
      rows: rows.length,
      requests: result.requests,
      complete: result.complete,
      batches: result.batches,
      reused_batches: result.reusedBatches,
      missing_game_ids: result.missingGameIds,
      exclusions: { out_of_scope_rows: 0 },
    };
  }

  if (datasets.includes("opening_odds")) {
    if (season < 2025) {
      manifests.opening_odds = {
        file: "",
        rows: 0,
        requests: 0,
        complete: false,
        sha256: "",
        note: "BALLDONTLIE opening odds are available only from the 2025 season onward.",
      };
    } else {
      const result = await collectExactGameBatches({
        dataset: "opening_odds", gameIds, outputDirectory, batchSize, maxPages, requestIntervalMs, sample, resume,
      });
      const rows = result.rows;
      const written = await writeJsonl({ outputDirectory, dataset: "opening_odds", rows });
      manifests.opening_odds = {
        ...written,
        rows: rows.length,
        requests: result.requests,
        complete: result.complete,
        batches: result.batches,
        reused_batches: result.reusedBatches,
        missing_game_ids: result.missingGameIds,
        exclusions: { out_of_scope_rows: 0 },
      };
    }
  }

  const manifest = {
    release: NBA_BDL_HISTORICAL_RESEARCH_RELEASE,
    capturedAt,
    season,
    sample,
    scoreBacktestEligible: !sample &&
      manifests.games?.complete === true &&
      manifests.box?.complete === true &&
      manifests.advanced?.complete === true,
    exactOpeningPriceBacktestEligible: !sample &&
      manifests.games?.complete === true &&
      manifests.box?.complete === true &&
      manifests.advanced?.complete === true &&
      manifests.opening_odds?.complete === true,
    finalGames: finalGames.length,
    gameIdentitySha256: createHash("sha256").update(gameIds.sort((a, b) => a - b).join(",")).digest("hex"),
    datasets: manifests,
  };
  const manifestPath = path.join(outputDirectory, "manifest.json");
  const temporaryManifest = `${manifestPath}.tmp`;
  await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryManifest, manifestPath);
  console.log(JSON.stringify({ outputDirectory, ...manifest }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
