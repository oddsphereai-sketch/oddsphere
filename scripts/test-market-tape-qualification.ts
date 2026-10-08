import assert from "node:assert/strict";
import {
  qualifyMarketTape,
  type MarketSplitPoint,
  type MarketTapePoint,
  type MarketTapePolicy,
} from "../lib/services/marketTapeQualification";

const policy: MarketTapePolicy = {
  materialMovePp: 1,
  minimumFollowerFamilies: 1,
  followerWindowMinutes: 30,
  minimumPeakRetention: 0.7,
  splitDivergencePp: 10,
  requireSplitCorroboration: true,
};

function point(
  sportsbook: string,
  sourceFamily: string,
  observedAt: string,
  pressurePp: number,
): MarketTapePoint {
  return { eventId: "game-1", market: "moneyline", side: "home", sportsbook, sourceFamily, observedAt, pressurePp };
}

function split(observedAt: string, ticketsPct: number, moneyPct: number): MarketSplitPoint {
  return { eventId: "game-1", market: "moneyline", side: "home", source: "consensus-a", observedAt, ticketsPct, moneyPct };
}

const discovery = qualifyMarketTape({
  decisionAt: "2026-10-08T18:00:00Z",
  policy,
  points: [
    point("circa", "originator-a", "2026-10-08T16:00:00Z", 0),
    point("pinnacle", "originator-b", "2026-10-08T16:00:00Z", 0),
    point("circa", "originator-a", "2026-10-08T16:20:00Z", 1.4),
    point("pinnacle", "originator-b", "2026-10-08T16:31:00Z", 1.2),
    point("circa", "originator-a", "2026-10-08T17:55:00Z", 1.3),
    point("pinnacle", "originator-b", "2026-10-08T17:55:00Z", 1.1),
  ],
  splits: [
    split("2026-10-08T16:00:00Z", 48, 50),
    split("2026-10-08T16:15:00Z", 44, 58),
  ],
});
assert.equal(discovery.pathState, "persistent_discovery");
assert.equal(discovery.splitState, "divergence_precedes_move");
assert.equal(discovery.sequenceQualified, true);
assert.equal(discovery.professionalBettorIdentityKnown, false);
assert.equal(discovery.splitVolumeKnown, false);
assert.ok(discovery.reasons.includes("split_percentages_without_volume_denominators"));

const endpointOnly = qualifyMarketTape({
  decisionAt: "2026-10-08T18:00:00Z",
  policy,
  points: [
    point("retail-a", "retail-family", "2026-10-08T16:00:00Z", 0),
    point("retail-a", "retail-family", "2026-10-08T17:55:00Z", 1.5),
  ],
  splits: [split("2026-10-08T17:50:00Z", 40, 65)],
});
assert.equal(endpointOnly.pathState, "isolated_move");
assert.equal(endpointOnly.splitState, "snapshot_only");
assert.equal(endpointOnly.sequenceQualified, false);

const buyback = qualifyMarketTape({
  decisionAt: "2026-10-08T18:00:00Z",
  policy: { ...policy, requireSplitCorroboration: false },
  points: [
    point("circa", "originator-a", "2026-10-08T16:00:00Z", 0),
    point("pinnacle", "originator-b", "2026-10-08T16:00:00Z", 0),
    point("circa", "originator-a", "2026-10-08T16:20:00Z", 2),
    point("pinnacle", "originator-b", "2026-10-08T16:30:00Z", 1.4),
    point("circa", "originator-a", "2026-10-08T17:55:00Z", 0.4),
  ],
});
assert.equal(buyback.pathState, "buyback");
assert.equal(buyback.sequenceQualified, false);

const reversal = qualifyMarketTape({
  decisionAt: "2026-10-08T18:00:00Z",
  policy: { ...policy, requireSplitCorroboration: false },
  points: [
    point("circa", "originator-a", "2026-10-08T16:00:00Z", 0),
    point("circa", "originator-a", "2026-10-08T16:20:00Z", 1.5),
    point("circa", "originator-a", "2026-10-08T17:55:00Z", -1.1),
  ],
});
assert.equal(reversal.pathState, "reversal");
assert.equal(reversal.sequenceQualified, false);

const supportingSplitArrivesAfterMove = qualifyMarketTape({
  decisionAt: "2026-10-08T18:00:00Z",
  policy,
  points: [
    point("circa", "originator-a", "2026-10-08T16:00:00Z", 0),
    point("pinnacle", "originator-b", "2026-10-08T16:00:00Z", 0),
    point("circa", "originator-a", "2026-10-08T16:20:00Z", 1.4),
    point("pinnacle", "originator-b", "2026-10-08T16:31:00Z", 1.2),
    point("circa", "originator-a", "2026-10-08T17:55:00Z", 1.3),
  ],
  splits: [
    split("2026-10-08T16:10:00Z", 60, 45),
    split("2026-10-08T16:40:00Z", 44, 58),
  ],
});
assert.equal(supportingSplitArrivesAfterMove.splitState, "divergence_follows_move");
assert.equal(supportingSplitArrivesAfterMove.sequenceQualified, false);

const mixedIdentity = qualifyMarketTape({
  decisionAt: "2026-10-08T18:00:00Z",
  policy,
  points: [
    point("circa", "originator-a", "2026-10-08T16:00:00Z", 0),
    { ...point("circa", "originator-a", "2026-10-08T16:20:00Z", 1.5), eventId: "other-game" },
  ],
});
assert.equal(mixedIdentity.pathState, "unavailable");
assert.deepEqual(mixedIdentity.reasons, ["mixed_event_market_or_side_identity"]);

console.log("Market tape qualification: chronology, followers, persistence, buyback, split timing, and identity gates passed.");
