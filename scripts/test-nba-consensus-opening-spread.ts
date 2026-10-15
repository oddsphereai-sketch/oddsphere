import assert from "node:assert/strict";

import {
  selectNbaConsensusOpeningSpread,
  type NbaMovementHistoryRow,
} from "../lib/services/nba/nbaSameBookMovement";

const row = (
  sportsbook: string,
  line: number,
  observedAt: string,
  side = "home",
): NbaMovementHistoryRow => ({
  externalGameId: 7,
  market: "spread",
  side,
  sportsbook,
  line,
  americanPrice: -110,
  observedAt,
});

const result = selectNbaConsensusOpeningSpread({
  rows: [
    row("pinnacle", -4, "2026-10-20T12:00:00Z"),
    row("pinnacle", -5, "2026-10-20T14:00:00Z"),
    row("draftkings", -3.5, "2026-10-20T12:05:00Z"),
    row("fanduel", 12, "2026-10-20T12:02:00Z"),
    row("betmgm", -4, "2026-10-20T12:03:00Z", "away"),
  ],
  externalGameId: 7,
  acceptedSportsbooks: ["Pinnacle", "DraftKings", "FanDuel"],
  currentObservedAt: "2026-10-20T16:00:00Z",
});

assert.deepEqual(result, {
  spreadHome: -3.75,
  observedAt: "2026-10-20T12:00:00.000Z",
  sportsbooks: ["draftkings", "pinnacle"],
  basis: "first_tracked_per_book_consensus",
});

assert.equal(selectNbaConsensusOpeningSpread({
  rows: [row("pinnacle", -4, "2026-10-20T17:00:00Z")],
  externalGameId: 7,
  acceptedSportsbooks: ["pinnacle"],
  currentObservedAt: "2026-10-20T16:00:00Z",
}), null, "future observations cannot become opening evidence");

console.log("NBA consensus opening-spread tests passed");
