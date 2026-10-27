import assert from "node:assert/strict";

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
  if (product !== "nfl_daily_edge") {
    assert.equal(roster.coverageStatus, "not_started",
      `${product} must remain mechanically blocked until its provider roster is implemented`);
  }
}
assert.deepEqual(
  NFL_MARKET_BRAIN_EVIDENCE_ROSTER.priceParticipants
    .filter((row) => row.provider === "balldontlie")
    .map((row) => row.participant),
  [...NFL_COMPARABLE_SPORTSBOOKS],
  "the evidence roster must not silently omit an approved retail sportsbook",
);
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
    [row.provider, row.feed, row.participant ?? "all", row.phases.join("+")].join(":")),
  [
    "balldontlie:opening_odds:all:provider_opening",
    "balldontlie:current_odds:all:current",
    "sharpapi:main_odds:circa:current",
    "sharpapi:main_odds:pinnacle:current",
  ],
);

console.log("Market Brain NFL expected evidence roster and canonical provider blind spots passed.");
