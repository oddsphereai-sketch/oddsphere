import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { NFL_COMPARABLE_SPORTSBOOKS } from
  "../lib/services/football/balldontlieNflPreviewSlate";
import { FOOTBALL_SHARP_PRICE_CAPTURE_BOOKS } from
  "../lib/services/football/sharpApiFootballSharpOdds";
import { MARKET_BRAIN_BLIND_SPOTS } from
  "../lib/services/marketBrain/marketBrainContract";
import {
  MARKET_BRAIN_EVIDENCE_ROSTERS,
  MARKET_BRAIN_TRUE_PROVIDER_BLIND_SPOTS,
  NFL_MARKET_BRAIN_EVIDENCE_ROSTER,
  assertCompleteMarketBrainEvidenceRosterRegistry,
  assertMarketBrainEvidenceRoster,
} from "../lib/services/marketBrain/marketBrainEvidenceRoster";
import { MARKET_BRAIN_ACTIVE_PRODUCT_KEYS, MARKET_BRAIN_PRODUCT_REGISTRY } from
  "../lib/services/marketBrain/marketBrainProductRegistry";

assert.doesNotThrow(() => assertMarketBrainEvidenceRoster(NFL_MARKET_BRAIN_EVIDENCE_ROSTER));
assert.doesNotThrow(() => assertCompleteMarketBrainEvidenceRosterRegistry());
assert.deepEqual(Object.keys(MARKET_BRAIN_EVIDENCE_ROSTERS).sort(),
  [...MARKET_BRAIN_ACTIVE_PRODUCT_KEYS].sort());
assert.equal(NFL_MARKET_BRAIN_EVIDENCE_ROSTER.coverageStatus, "partial");
for (const product of MARKET_BRAIN_ACTIVE_PRODUCT_KEYS) {
  const roster = MARKET_BRAIN_EVIDENCE_ROSTERS[product];
  assert.deepEqual(
    [...roster.coveredEvidenceFamilies, ...roster.unresolvedEvidenceFamilies].sort(),
    [...MARKET_BRAIN_PRODUCT_REGISTRY[product].expectedEvidenceFamilies].sort(),
    `${product} must account for every expected family even before its roster is implemented`,
  );
  assert.equal(roster.contractStatus, "frozen", `${product} source contract must be frozen`);
  assert.ok(roster.feeds.length > 0, `${product} must enumerate expected feeds before implementation`);
  assert.ok(roster.participantRosters.length > 0,
    `${product} must define explicit or provider-catalog participant discovery`);
  const feedFamilies = new Set(roster.feeds.flatMap((row) => row.evidenceFamilies));
  assert.ok(MARKET_BRAIN_PRODUCT_REGISTRY[product].expectedEvidenceFamilies.every((family) =>
    feedFamilies.has(family)), `${product} feeds must map every evidence family`);
  if (product !== "nfl_daily_edge") {
    assert.equal(roster.coverageStatus, "not_started",
      `${product} implementation must remain blocked even though its source contract is frozen`);
    assert.ok(roster.feeds.every((row) => row.captureStatus === "not_started"),
      `${product} expected feeds must not masquerade as implemented capture`);
  }
}
assert.deepEqual(
  NFL_MARKET_BRAIN_EVIDENCE_ROSTER.priceParticipants
    .filter((row) => row.provider === "balldontlie")
    .map((row) => row.participant),
  [...NFL_COMPARABLE_SPORTSBOOKS],
  "the evidence roster must not silently omit an approved retail sportsbook",
);
const shadowSource = readFileSync(new URL("../lib/services/football/nflMarketBrainShadow.ts", import.meta.url), "utf8");
assert.match(shadowSource, /feed\.evidenceFamilies\.includes\("two_sided_prices"\)/,
  "NFL price expected-input construction must not reinterpret context feeds as price feeds");
assert.deepEqual(
  NFL_MARKET_BRAIN_EVIDENCE_ROSTER.priceParticipants
    .filter((row) => row.provider === "sharpapi")
    .map((row) => row.participant),
  [...FOOTBALL_SHARP_PRICE_CAPTURE_BOOKS],
  "the evidence roster must not silently omit a configured sharp-book capture",
);
assert.deepEqual(
  [...MARKET_BRAIN_TRUE_PROVIDER_BLIND_SPOTS],
  MARKET_BRAIN_BLIND_SPOTS.map((row) => row.id),
  "true provider blind spots must use the canonical case contract rather than a parallel vocabulary",
);
assert.deepEqual(
  NFL_MARKET_BRAIN_EVIDENCE_ROSTER.feeds.map((row) =>
    [row.provider, row.feed, row.participant ?? "all", row.phases.join("+")].join(":"))
    .filter((row) => /opening_odds|current_odds|main_odds/.test(row)),
  [
    "balldontlie:opening_odds:all:provider_opening",
    "balldontlie:current_odds:all:current",
    "sharpapi:main_odds:circa:current",
    "sharpapi:main_odds:pinnacle:current",
  ],
);
for (const product of ["nfl_daily_edge", "cfb_daily_edge", "nba_daily_edge", "wnba_daily_edge",
  "mlb_daily_edge", "nhl_daily_edge"] as const) {
  const splitFeed = MARKET_BRAIN_EVIDENCE_ROSTERS[product].feeds.find((row) =>
    row.evidenceFamilies.includes("identified_splits"));
  assert.equal(splitFeed?.provider, "owls", `${product} named-book split contract must use Owls`);
  assert.equal(splitFeed?.feed, "named_book_splits_canonical");
  assert.equal(splitFeed?.replayMode, "normalized_only",
    `${product} must not claim raw Owls replay before the provider archive is linked`);
}

assert.deepEqual(
  MARKET_BRAIN_EVIDENCE_ROSTERS.ucl_daily_edge.participantRosters[0]?.excludedParticipants,
  ["polymarket", "kalshi"],
  "UCL prediction markets must be explicitly excluded from sportsbook authority",
);
assert.deepEqual(
  MARKET_BRAIN_EVIDENCE_ROSTERS.nfl_player_props.priceParticipants
    .filter((row) => row.provider === "sharpapi").map((row) => row.participant),
  ["pinnacle", "novig"],
  "NFL props target-excluded reference participants must match the implemented collector contract",
);

console.log("Market Brain all-product expected source and participant contracts passed.");
