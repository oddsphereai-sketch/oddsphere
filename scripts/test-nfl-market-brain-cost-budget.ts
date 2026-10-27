import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  bindMarketBrainMarginTotalPrior,
  referenceMarketBrainMarginTotalPrior,
} from "../lib/services/marketBrain/marketBrainContract";
import {
  NFL_MARKET_BRAIN_SHADOW_MAX_BYTES,
  NFL_MARKET_BRAIN_SHADOW_MAX_REGULAR_SEASON_RAW_BYTES,
  NFL_MARKET_BRAIN_SHADOW_MAX_WEEK_RAW_BYTES,
} from "../lib/services/football/nflMarketBrainShadow";
import { fixtureMarketBrainPriorInputLineage } from "./fixtures/marketBrainPriorInputLineage";

type Artifact = {
  artifactRelease: string;
  games: Array<{
    providerGameId: string;
    marginDistribution: { values: number[]; probabilities: number[] };
    totalDistribution: { values: number[]; probabilities: number[] };
  }>;
};

const artifact = JSON.parse(readFileSync(path.resolve(
  "lib/services/football/modelArtifacts/nflV1WeekOneOutcome.json",
), "utf8")) as Artifact;
const game = artifact.games[0]!;
const full = bindMarketBrainMarginTotalPrior({
  eventId: game.providerGameId,
  release: artifact.artifactRelease,
  availableAt: "2026-10-27T00:00:00.000Z",
  inputLineage: fixtureMarketBrainPriorInputLineage({
    eventId: game.providerGameId, asOf: "2026-10-27T00:00:00.000Z",
  }),
  marginDistribution: game.marginDistribution,
  totalDistribution: game.totalDistribution,
});
const reference = referenceMarketBrainMarginTotalPrior(full);
const fullBytes = Buffer.byteLength(JSON.stringify(full));
const referenceBytes = Buffer.byteLength(JSON.stringify(reference));
const games = 16;
const capturesPerWeek = 168;
const repeatedBytes = fullBytes * games * capturesPerWeek;
const addressedBytes = fullBytes * games + referenceBytes * games * (capturesPerWeek - 1);
const maximumShadowBytesPerWeek = NFL_MARKET_BRAIN_SHADOW_MAX_BYTES * games * capturesPerWeek;
const maximumShadowBytesPerRegularSeason = maximumShadowBytesPerWeek * 18;

assert.ok(referenceBytes < 1024, "a repeated prior reference must remain under one KiB");
assert.ok(referenceBytes / fullBytes < 0.05, "content addressing must remove at least 95% of repeated prior bytes");
assert.ok(addressedBytes < 2 * 1024 * 1024,
  "a 16-game, hourly seven-day slate must keep the exact-prior component under two MiB");
assert.ok(addressedBytes / repeatedBytes < 0.05,
  "the weekly exact-prior component must remain at least 95% smaller than embedding every PMF");
assert.ok(maximumShadowBytesPerWeek <= NFL_MARKET_BRAIN_SHADOW_MAX_WEEK_RAW_BYTES,
  "the per-tape hard cap must fit the explicit worst-case weekly raw-storage envelope");
assert.ok(maximumShadowBytesPerRegularSeason <= NFL_MARKET_BRAIN_SHADOW_MAX_REGULAR_SEASON_RAW_BYTES,
  "the per-tape hard cap must fit the explicit worst-case regular-season raw-storage envelope");

const shadowSource = readFileSync(path.resolve("lib/services/football/nflMarketBrainShadow.ts"), "utf8");
assert.doesNotMatch(shadowSource, /\bfetch\s*\(|PlaybookReadBroker|fetchSharpApi|fetchBalldontlie/,
  "Market Brain construction must reuse captured evidence and make zero provider requests");

console.log(JSON.stringify({
  marketBrainCostBudget: "passed",
  incrementalProviderRequests: 0,
  fullPriorBytes: fullBytes,
  referenceBytes,
  repeatedPriorMiBPerWeek: Number((repeatedBytes / 1024 / 1024).toFixed(2)),
  contentAddressedPriorMiBPerWeek: Number((addressedBytes / 1024 / 1024).toFixed(2)),
  maximumRawShadowMiBPerWeek: Number((maximumShadowBytesPerWeek / 1024 / 1024).toFixed(2)),
  maximumRawShadowGiBPerRegularSeason: Number((maximumShadowBytesPerRegularSeason / 1024 / 1024 / 1024).toFixed(2)),
  assumptions: "16 games, 168 captures per game per week",
}));
