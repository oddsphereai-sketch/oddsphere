import assert from "node:assert/strict";
import {
  buildNbaMovementHistoryFromCanonicalPrices,
  selectNbaComparableOpening,
  type NbaMovementHistoryRow,
} from "../lib/services/nba/nbaSameBookMovement";

const canonical = buildNbaMovementHistoryFromCanonicalPrices({
  rowsByExternalGameId: new Map([[1, [
    { sportsbook: "draftkings", market: "spread" as const, selectionKey: "1:spread:home", americanPrice: -115, line: -4.5, providerTimestamp: "2026-10-20T12:00:00Z", fetchedAt: "2026-10-20T12:01:00Z" },
    { sportsbook: "draftkings", market: "spread" as const, selectionKey: "1:spread:away", americanPrice: -105, line: 4.5, providerTimestamp: null, fetchedAt: "2026-10-20T12:01:00Z" },
    { sportsbook: "draftkings", market: "spread" as const, selectionKey: "1:spread:over", americanPrice: -110, line: -4.5, providerTimestamp: null, fetchedAt: "2026-10-20T12:01:00Z" },
  ]]])
});
assert.equal(canonical.length, 2, "canonical chronology keeps only market-valid sides");
assert.equal(canonical[0]?.observedAt, "2026-10-20T12:00:00Z", "verified provider time has precedence");
assert.equal(canonical[1]?.observedAt, "2026-10-20T12:01:00Z", "capture time is the bounded fallback");

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
  currentObservedAt: "2026-10-20T16:00:00Z",
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
  currentObservedAt: "2026-10-20T16:00:00Z",
}), null, "a different sportsbook may not donate an opener");
assert.equal(selectNbaComparableOpening({
  rows,
  externalGameId: 1,
  market: "spread",
  side: "home",
  sportsbook: "draftkings",
  line: -5.5,
  currentObservedAt: "2026-10-20T16:00:00Z",
}), null, "a different spread number may not donate an opener");
assert.equal(selectNbaComparableOpening({
  rows,
  externalGameId: 1,
  market: "spread",
  side: "home",
  sportsbook: "draftkings",
  line: -4.5,
  currentObservedAt: "2026-10-20T12:00:00Z",
}), null, "the current observation cannot also masquerade as an earlier opener");

console.log("NBA same-book exact-line movement boundary tests passed.");
