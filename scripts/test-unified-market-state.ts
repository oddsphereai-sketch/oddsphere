import assert from "node:assert/strict";
import {
  assembleUnifiedMarketState,
  derivePairedNoVigQuote,
  observationsAtOrBeforeDecision,
  type PriceObservation,
} from "../lib/services/dailyEdge/unifiedMarketState";

function price(overrides: Partial<PriceObservation>): PriceObservation {
  return {
    provider: "test-provider",
    providerEventId: "event-1",
    sportsbook: "test-book",
    bookClass: "high_limit_reference",
    market: "moneyline",
    outcomeKey: "away",
    lineValue: null,
    americanPrice: -120,
    providerObservedAt: "2026-08-14T16:00:00.000Z",
    fetchedAt: "2026-08-14T16:00:01.000Z",
    sourceQuality: "high",
    availability: { status: "available" },
    ...overrides,
  };
}

const away = price({ outcomeKey: "away", americanPrice: -120 });
const home = price({ outcomeKey: "home", americanPrice: +110 });
const paired = derivePairedNoVigQuote(away, home);

assert.ok(Math.abs(paired.firstNoVigProbability + paired.secondNoVigProbability - 1) < 1e-12);
assert.ok(paired.overround > 0);

const swapped = derivePairedNoVigQuote(home, away);
assert.equal(swapped.firstNoVigProbability, paired.secondNoVigProbability);
assert.equal(swapped.secondNoVigProbability, paired.firstNoVigProbability);
assert.equal(swapped.overround, paired.overround);

assert.throws(
  () => derivePairedNoVigQuote(away, price({ providerEventId: "other", outcomeKey: "home" })),
  /different events/,
);
assert.throws(
  () => derivePairedNoVigQuote(away, price({ outcomeKey: "home", lineValue: 1.5 })),
  /different events/,
);

const pointInTimeRows = [
  { id: "past", observedAt: "2026-08-14T15:59:59.000Z" },
  { id: "equal", observedAt: "2026-08-14T16:00:00.000Z" },
  { id: "future", observedAt: "2026-08-14T16:00:00.001Z" },
  { id: "missing", observedAt: null },
];
assert.deepEqual(
  observationsAtOrBeforeDecision(
    pointInTimeRows,
    "2026-08-14T16:00:00.000Z",
    (row) => row.observedAt,
  ).map((row) => row.id),
  ["past", "equal"],
);

console.log("unified market state contract: PASS");

const identity = {
  sport: "mlb",
  league: "mlb",
  slateDate: "2026-08-14",
  gameId: "game-1",
  providerEventIds: { test: "event-1" },
  awayTeam: "AWAY",
  homeTeam: "HOME",
  venue: null,
  scheduledStart: "2026-08-14T17:00:00.000Z",
  decisionTimestamp: "2026-08-14T16:00:00.000Z",
  lockedAt: null,
  releases: {
    projectionRelease: null,
    calibrationRelease: null,
    decisionRelease: null,
    ruleBundleRelease: null,
    gradePolicyRelease: null,
    writerRelease: null,
  },
};
const assembled = assembleUnifiedMarketState({
  identity,
  assembledAt: "2026-08-14T18:00:00.000Z",
  sourceSnapshotIds: ["b", "a", "b"],
  priceObservations: [
    away,
    home,
    price({ outcomeKey: "away", providerObservedAt: "2026-08-14T16:00:00.001Z" }),
  ],
});
assert.equal(assembled.priceObservations.length, 2);
assert.equal(assembled.integrityFindings.filter((finding) => finding.code === "future_observation").length, 1);
assert.deepEqual(assembled.provenance.sourceSnapshotIds, ["a", "b"]);
assert.deepEqual(
  assembleUnifiedMarketState({
    identity,
    assembledAt: "2026-08-14T18:00:00.000Z",
    sourceSnapshotIds: ["b", "a", "b"],
    priceObservations: [away, home],
  }),
  assembleUnifiedMarketState({
    identity,
    assembledAt: "2026-08-14T18:00:00.000Z",
    sourceSnapshotIds: ["a", "b"],
    priceObservations: [away, home],
  }),
);

console.log("unified market state assembler: PASS");
