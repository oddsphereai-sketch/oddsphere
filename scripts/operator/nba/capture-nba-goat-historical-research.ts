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
import { mkdir, rename, writeFile } from "node:fs/promises";
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

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

async function writeJsonl(args: {
  outputDirectory: string;
  dataset: NbaBdlHistoricalDataset;
  rows: Record<string, unknown>[];
}): Promise<{ file: string; sha256: string }> {
  const filename = `${args.dataset.replace("_", "-")}.jsonl`;
  const absolute = path.join(args.outputDirectory, filename);
  const body = args.rows.length > 0 ? `${args.rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
  const temporary = `${absolute}.tmp`;
  await writeFile(temporary, body, "utf8");
  await rename(temporary, absolute);
  return { file: filename, sha256: createHash("sha256").update(body).digest("hex") };
}

async function collectBySeasonType(args: {
  dataset: "games" | "box";
  season: number;
  maxPages: number;
  requestIntervalMs: number;
}): Promise<{ rows: Record<string, unknown>[]; requests: number; complete: boolean }> {
  const results: NbaBdlHistoricalFetch[] = [];
  for (const seasonType of SEASON_TYPES) {
    results.push(await fetchNbaBdlHistoricalRows({
      dataset: args.dataset,
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

async function collectOpeningOdds(args: {
  gameIds: number[];
  maxPages: number;
  requestIntervalMs: number;
  sample: boolean;
}): Promise<{ rows: Record<string, unknown>[]; requests: number; complete: boolean }> {
  const batches = chunk(args.gameIds, 50);
  const selectedBatches = args.sample ? batches.slice(0, 1) : batches;
  const results: NbaBdlHistoricalFetch[] = [];
  for (const gameIds of selectedBatches) {
    results.push(await fetchNbaBdlHistoricalRows({
      dataset: "opening_odds",
      gameIds,
      maxPages: args.maxPages,
      requestIntervalMs: args.requestIntervalMs,
    }));
  }
  return {
    rows: results.flatMap((result) => result.rows),
    requests: results.reduce((sum, result) => sum + result.requests, 0),
    complete: !args.sample && selectedBatches.length === batches.length && results.every((result) => result.complete),
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
  const gameFetch = await collectBySeasonType({ dataset: "games", season, maxPages, requestIntervalMs });
  const rawGames = stableRows("games", gameFetch.rows);
  const finalGames = rawGames.filter(isFinalGame);
  const nonfinalGames = rawGames.length - finalGames.length;
  if (datasets.includes("games")) {
    const written = await writeJsonl({ outputDirectory, dataset: "games", rows: finalGames });
    manifests.games = {
      ...written,
      rows: finalGames.length,
      requests: gameFetch.requests,
      complete: !sample && gameFetch.complete,
      exclusions: { nonfinal_games: nonfinalGames },
    };
  }
  if (finalGames.length === 0) throw new Error(`NBA ${season} capture found no completed regular/IST games.`);
  const gameIds = finalGames.map((row) => integer(row.id)).filter((id): id is number => id !== null);
  const requestedGameIds = new Set(gameIds);

  if (datasets.includes("box")) {
    const result = await collectBySeasonType({ dataset: "box", season, maxPages, requestIntervalMs });
    const inScope = result.rows.filter((row) => {
      const gameId = nbaBdlProviderGameId(row);
      return gameId !== null && requestedGameIds.has(gameId);
    });
    const rows = stableRows("box", inScope);
    const written = await writeJsonl({ outputDirectory, dataset: "box", rows });
    manifests.box = {
      ...written,
      rows: rows.length,
      requests: result.requests,
      complete: !sample && result.complete,
      exclusions: { out_of_scope_rows: result.rows.length - inScope.length },
    };
  }

  if (datasets.includes("advanced")) {
    const result = await fetchNbaBdlHistoricalRows({
      dataset: "advanced",
      season,
      maxPages,
      requestIntervalMs,
    });
    const inScope = result.rows.filter((row) => {
      const gameId = nbaBdlProviderGameId(row);
      return gameId !== null && requestedGameIds.has(gameId);
    });
    const rows = stableRows("advanced", inScope);
    const written = await writeJsonl({ outputDirectory, dataset: "advanced", rows });
    manifests.advanced = {
      ...written,
      rows: rows.length,
      requests: result.requests,
      complete: !sample && result.complete,
      exclusions: { out_of_scope_rows: result.rows.length - inScope.length },
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
      const result = await collectOpeningOdds({ gameIds, maxPages, requestIntervalMs, sample });
      const inScope = result.rows.filter((row) => {
        const gameId = nbaBdlProviderGameId(row);
        return gameId !== null && requestedGameIds.has(gameId);
      });
      const rows = stableRows("opening_odds", inScope);
      const written = await writeJsonl({ outputDirectory, dataset: "opening_odds", rows });
      manifests.opening_odds = {
        ...written,
        rows: rows.length,
        requests: result.requests,
        complete: result.complete,
        exclusions: { out_of_scope_rows: result.rows.length - inScope.length },
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
