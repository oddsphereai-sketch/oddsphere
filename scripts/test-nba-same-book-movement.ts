import assert from "node:assert/strict";
import {
  selectNbaComparableOpening,
  type NbaMovementHistoryRow,
} from "../lib/services/nba/nbaSameBookMovement";

const rows: NbaMovementHistoryRow[] = [
  { externalGameId: 1, market: "spread", side: "home", sportsbook: "draftkings", line: -4.5, americanPrice: -115, observedAt: "2026-10-20T12:00:00Z" },
  { externalGameId: 1, market: "spread", side: "home", sportsbook: "draftkings", line: -4.5, americanPrice: -108, observedAt: "2026-10-20T15:00:00Z" },
  { externalGameId: 1, market: "spread", side: "home", sportsbook: "betmgm", line: -4.5, americanPrice: -105, observedAt: "2026-10-20T11:00:00Z" },
  { externalGameId: 1, market: "spread", side: "home", sportsbook: "draftkings", line: -3.5, americanPrice: -110, observedAt: "2026-10-20T10:00:00Z" },
];

assert.deepEqual(selectNbaComparableOpening({
  rows,
  externalGameId: 1,
  market: "spread",
  side: "home",
  sportsbook: "DraftKings",
  line: -4.5,
}), {
  americanPrice: -115,
  sportsbook: "draftkings",
  line: -4.5,
  observedAt: "2026-10-20T12:00:00.000Z",
});
assert.equal(selectNbaComparableOpening({
  rows,
  externalGameId: 1,
  market: "spread",
  side: "home",
  sportsbook: "fanduel",
  line: -4.5,
}), null, "a different sportsbook may not donate an opener");
assert.equal(selectNbaComparableOpening({
  rows,
  externalGameId: 1,
  market: "spread",
  side: "home",
  sportsbook: "draftkings",
  line: -5.5,
}), null, "a different spread number may not donate an opener");

console.log("NBA same-book exact-line movement boundary tests passed.");
