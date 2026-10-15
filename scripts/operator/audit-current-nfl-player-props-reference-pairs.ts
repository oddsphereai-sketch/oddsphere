#!/usr/bin/env tsx

/** Read-only provider-shape audit for the bounded NFL player-prop reference lane. */

import { loadEnvConfig } from "@next/env";
import { collectNflPlayerPropsObservations } from "../../lib/services/football/nflPlayerPropsCollector";
import { buildNflPlayerPropsExactBoard } from "../../lib/services/football/nflPlayerPropsMarketBoard";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
const season = Number(argument("season") ?? "2026");
const week = Number(argument("week") ?? "6");
const collection = await collectNflPlayerPropsObservations({
  season,
  week,
  phase: "regular",
  includeOpenings: false,
  includeReferenceResearch: true,
});
const rows = collection.referenceResearchObservations;
const snapshotGameIds = new Set(collection.snapshot.games.map((game) => game.providerGameId));
const exactOffers = buildNflPlayerPropsExactBoard({
  snapshots: [{ ...collection.snapshot, observations: [...rows] }],
  evaluatedAt: new Date().toISOString(),
  referenceOfferPairing: "same_fetch_player_name",
});
const groups = new Map<string, Set<string>>();
const byBook: Record<string, number> = {};
const byMarket: Record<string, number> = {};
const sideCounts: Record<string, Record<string, number>> = {};
for (const row of rows) {
  const book = normalize(row.sportsbook);
  byBook[book] = (byBook[book] ?? 0) + 1;
  byMarket[row.market] = (byMarket[row.market] ?? 0) + 1;
  sideCounts[book] ??= {};
  sideCounts[book]![row.side] = (sideCounts[book]![row.side] ?? 0) + 1;
  const key = [book, row.canonicalGameId, normalize(row.playerName ?? ""), row.market, row.line].join("|");
  const sides = groups.get(key) ?? new Set<string>();
  sides.add(row.side);
  groups.set(key, sides);
}
const completePairs: Record<string, number> = {};
const oneSided: Record<string, number> = {};
for (const [key, sides] of groups) {
  const book = key.split("|")[0]!;
  if (sides.has("over") && sides.has("under")) completePairs[book] = (completePairs[book] ?? 0) + 1;
  else oneSided[book] = (oneSided[book] ?? 0) + 1;
}
process.stdout.write(`${JSON.stringify({
  release: "nfl_player_props_reference_pair_shape_2026_10_15_r1",
  readOnly: true,
  providerWrites: 0,
  season,
  week,
  rows: rows.length,
  byBook,
  byMarket,
  sideCounts,
  completePairs,
  oneSided,
  exactOffers: exactOffers.length,
  completeExactOffers: exactOffers.filter((offer) => offer.exactPriceComplete).length,
  exactOffersByBook: Object.fromEntries([...new Set(exactOffers.map((offer) => normalize(offer.sportsbook)))].sort()
    .map((book) => [book, exactOffers.filter((offer) => normalize(offer.sportsbook) === book).length])),
  completeExactOffersByBook: Object.fromEntries([...new Set(exactOffers.map((offer) => normalize(offer.sportsbook)))].sort()
    .map((book) => [book, exactOffers.filter((offer) => normalize(offer.sportsbook) === book && offer.exactPriceComplete).length])),
  observedRange: rows.length ? {
    minimum: rows.map((row) => row.observedAt).sort()[0],
    maximum: rows.map((row) => row.observedAt).sort().at(-1),
  } : null,
  fetchedRange: rows.length ? {
    minimum: rows.map((row) => row.fetchedAt).sort()[0],
    maximum: rows.map((row) => row.fetchedAt).sort().at(-1),
  } : null,
  referenceCanonicalGames: new Set(rows.map((row) => row.canonicalGameId).filter(Boolean)).size,
  referenceRowsMatchingSnapshotGameId: rows.filter((row) => row.canonicalGameId !== null && snapshotGameIds.has(row.canonicalGameId)).length,
  snapshotGameIds: [...snapshotGameIds].sort(),
  referenceCanonicalGameIds: [...new Set(rows.map((row) => row.canonicalGameId).filter(Boolean))].sort(),
  healthFindings: collection.snapshot.healthFindings,
}, null, 2)}\n`);
}

function argument(name: string): string | null {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
