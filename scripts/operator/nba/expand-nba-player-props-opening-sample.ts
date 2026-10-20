/**
 * Extends the immutable NBA props research dataset with genuine archived
 * opening quotes for the later selection and confirmation games.
 *
 * Local research only: no database, member, grade, stake, lock, or production
 * writes. The output is create-only and receives a new immutable-input hash.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchNbaBdlOpeningPlayerPropsHistory } from "../../../lib/services/nba/nbaPlayerPropsHistorical";
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
  immutableInputsSha256: string;
  [key: string]: unknown;
};

function value(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const input = path.resolve(value("--input") ?? "");
  const output = path.resolve(value("--output") ?? "");
  if (!value("--input") || !value("--output")) throw new Error("--input and --output are required.");
  const laterGames = Number(value("--later-games") ?? "144");
  const requestCeiling = Number(value("--request-ceiling") ?? "144");
  if (!Number.isInteger(laterGames) || laterGames < 1 || laterGames > 360) throw new Error("--later-games must be from 1 through 360.");
  if (!Number.isInteger(requestCeiling) || requestCeiling < 1 || requestCeiling > 180) throw new Error("--request-ceiling must be from 1 through 180.");
  const dataset = JSON.parse(await readFile(input, "utf8")) as Dataset;
  if (!Array.isArray(dataset.projectionGames) || !Array.isArray(dataset.openingObservations)) {
    throw new Error("NBA props expansion input is missing projection games or opening observations.");
  }
  const targetGames = dataset.projectionGames.slice(-laterGames);
  const covered = new Set(dataset.openingObservations.map((row) => Number(row.providerEventId)));
  const missing = targetGames.filter((game) => !covered.has(game.gameId));
  if (missing.length === 0) throw new Error("NBA props expansion has no missing later-game opening quotes.");
  if (missing.length > requestCeiling) {
    throw new Error(`NBA props expansion requires ${missing.length} requests, above ceiling ${requestCeiling}.`);
  }
  const events = Object.fromEntries(missing.map((game) => [String(game.gameId), {
    canonicalGameId: `nba-bdl:${game.gameId}`,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    scheduledStart: game.startTime,
  }]));
  const fetched = await fetchNbaBdlOpeningPlayerPropsHistory({
    gameIds: missing.map((game) => game.gameId),
    events,
    requestIntervalMs: 125,
    // This research operator promises a hard request ceiling. Disable provider
    // retries here so transient failures cannot silently spend beyond it; a
    // failed game can be retried explicitly in a later bounded invocation.
    maxRetries: 0,
  });
  if (fetched.requests > requestCeiling) {
    throw new Error(`NBA props expansion spent ${fetched.requests} requests, above ceiling ${requestCeiling}.`);
  }
  const canonicalized = fetched.rows.map((row) => ({
    ...row,
    canonicalPlayerId: row.providerPlayerId ? `nba-bdl-player:${row.providerPlayerId}` : null,
  }));
  const observations = [...new Map([...dataset.openingObservations, ...canonicalized]
    .map((row) => [row.providerObservationId, row])).values()]
    .sort((left, right) => left.providerObservationId.localeCompare(right.providerObservationId));
  const immutableInputsSha256 = createHash("sha256").update(JSON.stringify({
    sourceImmutableInputsSha256: dataset.immutableInputsSha256,
    openingObservationIds: observations.map((row) => row.providerObservationId),
  })).digest("hex");
  const expanded = {
    ...dataset,
    release: "nba_player_props_historical_research_dataset_2026_10_20_r3_full_exact_prices",
    openingObservations: observations,
    immutableInputsSha256,
    openingExpansion: {
      sourceDatasetRelease: dataset.release,
      sourceImmutableInputsSha256: dataset.immutableInputsSha256,
      targetLaterGames: targetGames.length,
      previouslyCoveredGames: targetGames.length - missing.length,
      requestedGames: missing.length,
      gamesWithProps: fetched.gamesWithProps,
      providerRequests: fetched.requests,
      requestCeiling,
      capturedAt: fetched.capturedAt,
    },
  };
  await writeFile(output, `${JSON.stringify(expanded, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({
    mode: expanded.mode,
    actionable: expanded.actionable,
    output,
    release: expanded.release,
    immutableInputsSha256,
    openingExpansion: expanded.openingExpansion,
    openingObservations: observations.length,
  }, null, 2));
}

void main();
