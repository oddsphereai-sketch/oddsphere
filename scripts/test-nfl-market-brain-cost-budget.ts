import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  bindMarketBrainMarginTotalPrior,
  referenceMarketBrainMarginTotalPrior,
} from "../lib/services/marketBrain/marketBrainContract";

type Artifact = {
  artifactRelease: string;
  games: Array<{
    marginDistribution: { values: number[]; probabilities: number[] };
    totalDistribution: { values: number[]; probabilities: number[] };
  }>;
};

const artifact = JSON.parse(readFileSync(path.resolve(
  "lib/services/football/modelArtifacts/nflV1WeekOneOutcome.json",
), "utf8")) as Artifact;
const game = artifact.games[0]!;
const full = bindMarketBrainMarginTotalPrior({
  eventId: "storage-budget-fixture",
  release: artifact.artifactRelease,
  availableAt: "2026-10-27T00:00:00.000Z",
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

assert.ok(referenceBytes < 1024, "a repeated prior reference must remain under one KiB");
assert.ok(referenceBytes / fullBytes < 0.05, "content addressing must remove at least 95% of repeated prior bytes");
assert.ok(addressedBytes < 2 * 1024 * 1024,
  "a 16-game, hourly seven-day slate must keep the exact-prior component under two MiB");
assert.ok(addressedBytes / repeatedBytes < 0.05,
  "the weekly exact-prior component must remain at least 95% smaller than embedding every PMF");

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
  assumptions: "16 games, 168 captures per game per week",
}));
