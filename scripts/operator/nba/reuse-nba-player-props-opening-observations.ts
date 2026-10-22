/**
 * Reattaches an already captured immutable opening-price archive to a newly
 * derived feature dataset. This is strictly an offline research operation: it
 * performs no provider requests and no database, member, lock, grade, or stake
 * writes.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NbaPlayerPropPriceObservation } from "../../../lib/services/nba/nbaPlayerPropsContract";

type Game = {
  gameId: number;
  startTime: string;
  homeTeam: string;
  awayTeam: string;
};

type Dataset = {
  release: string;
  mode: "offline_research_only";
  actionable: false;
  projectionGames: Game[];
  openingObservations: NbaPlayerPropPriceObservation[];
  featureRows?: Array<{ release?: string }>;
  projectionFeatureRows?: Array<{ release?: string }>;
  immutableInputsSha256: string;
  [key: string]: unknown;
};

function value(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function gameIdentity(game: Game): string {
  return `${game.gameId}|${game.startTime}|${game.awayTeam}|${game.homeTeam}`;
}

async function main(): Promise<void> {
  const featureInputValue = value("--feature-input");
  const openingInputValue = value("--opening-input");
  const outputValue = value("--output");
  if (!featureInputValue || !openingInputValue || !outputValue) {
    throw new Error("--feature-input, --opening-input, and --output are required.");
  }
  const featureInput = path.resolve(featureInputValue);
  const openingInput = path.resolve(openingInputValue);
  const output = path.resolve(outputValue);
  const [featureDataset, openingDataset] = await Promise.all([
    readFile(featureInput, "utf8").then((raw) => JSON.parse(raw) as Dataset),
    readFile(openingInput, "utf8").then((raw) => JSON.parse(raw) as Dataset),
  ]);
  for (const [name, dataset] of [["feature", featureDataset], ["opening", openingDataset]] as const) {
    if (dataset.mode !== "offline_research_only" || dataset.actionable !== false) {
      throw new Error(`${name} dataset is not an offline, non-actionable research artifact.`);
    }
    if (!Array.isArray(dataset.projectionGames) || !Array.isArray(dataset.openingObservations)) {
      throw new Error(`${name} dataset is missing projection games or opening observations.`);
    }
  }
  const featureGames = featureDataset.projectionGames.map(gameIdentity).sort();
  const openingGames = openingDataset.projectionGames.map(gameIdentity).sort();
  if (featureGames.length !== openingGames.length
    || featureGames.some((identity, index) => identity !== openingGames[index])) {
    throw new Error("Feature and opening datasets do not describe the same chronological game population.");
  }
  const validGameIds = new Set(featureDataset.projectionGames.map((game) => game.gameId));
  const openingObservations = [...openingDataset.openingObservations]
    .filter((row) => row.isOpening && validGameIds.has(Number(row.providerEventId)))
    .sort((left, right) => left.providerObservationId.localeCompare(right.providerObservationId));
  const observationIds = new Set(openingObservations.map((row) => row.providerObservationId));
  if (observationIds.size !== openingObservations.length) {
    throw new Error("Opening-price archive contains duplicate provider observation identifiers.");
  }
  const coveredGames = new Set(openingObservations.map((row) => Number(row.providerEventId)));
  if (coveredGames.size !== validGameIds.size) {
    throw new Error(`Opening-price coverage is incomplete: ${coveredGames.size}/${validGameIds.size} games.`);
  }
  const release = "nba_player_props_historical_research_dataset_2026_10_22_r6_active_role_integrity_exact_prices";
  const derivedFeatureReleases = [...new Set([
    ...(featureDataset.featureRows ?? []).map((row) => row.release),
    ...(featureDataset.projectionFeatureRows ?? []).map((row) => row.release),
  ].filter((candidate): candidate is string => typeof candidate === "string"))].sort();
  if (derivedFeatureReleases.length !== 1) {
    throw new Error(`Expected one derived feature release, received ${derivedFeatureReleases.length}.`);
  }
  const immutableInputsSha256 = createHash("sha256").update(JSON.stringify({
    featureDatasetRelease: featureDataset.release,
    featureImmutableInputsSha256: featureDataset.immutableInputsSha256,
    openingDatasetRelease: openingDataset.release,
    openingImmutableInputsSha256: openingDataset.immutableInputsSha256,
    derivedFeatureReleases,
    openingObservationIds: openingObservations.map((row) => row.providerObservationId),
  })).digest("hex");
  const combined = {
    ...featureDataset,
    release,
    openingObservations,
    immutableInputsSha256,
    openingReuse: {
      providerRequests: 0,
      featureDatasetRelease: featureDataset.release,
      featureImmutableInputsSha256: featureDataset.immutableInputsSha256,
      openingDatasetRelease: openingDataset.release,
      openingImmutableInputsSha256: openingDataset.immutableInputsSha256,
      derivedFeatureReleases,
      coveredGames: coveredGames.size,
      openingObservations: openingObservations.length,
    },
  };
  await writeFile(output, `${JSON.stringify(combined, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    release,
    output,
    immutableInputsSha256,
    ...combined.openingReuse,
  }, null, 2)}\n`);
}

void main();
