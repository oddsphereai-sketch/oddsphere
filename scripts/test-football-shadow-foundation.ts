import assert from "node:assert/strict";
import {
  NCAAF_SHADOW_MODEL_RELEASE,
  NFL_SHADOW_MODEL_RELEASE,
  shadowModelReleaseFor,
  type FootballMarketObservation,
  type FootballSplitObservation,
} from "../lib/services/football/footballModelContract";
import {
  classifyReverseLineMovement,
  deriveFootballMovement,
  deriveFootballPublicRead,
  removeFootballVig,
} from "../lib/services/football/footballMarketMath";

function price(overrides: Partial<FootballMarketObservation> = {}): FootballMarketObservation {
  return {
    provider: "provider-a",
    sourceKey: "draftkings",
    sportsbook: "DraftKings",
    sourceType: "sportsbook",
    providerEventId: "game-1",
    market: "spread",
    side: "home",
    lineValue: -2.5,
    americanPrice: -110,
    observedAt: "2026-08-19T12:00:00Z",
    fetchedAt: "2026-08-19T12:00:01Z",
    isOpening: true,
    isClosing: false,
    ...overrides,
  };
}

assert.equal(shadowModelReleaseFor("nfl"), NFL_SHADOW_MODEL_RELEASE);
assert.equal(shadowModelReleaseFor("ncaaf"), NCAAF_SHADOW_MODEL_RELEASE);

const vig = removeFootballVig(
  price(),
  price({ side: "away", lineValue: 2.5 }),
);
assert.ok(Math.abs(vig.firstNoVigProbability - 0.5) < 1e-12);
assert.ok(Math.abs(vig.secondNoVigProbability - 0.5) < 1e-12);
assert.throws(
  () => removeFootballVig(price(), price({ provider: "provider-b", side: "away", lineValue: 2.5 })),
  /same-source/,
);

const towardHome = deriveFootballMovement({
  first: price(),
  current: price({ lineValue: -3.5, observedAt: "2026-08-19T14:00:00Z", isOpening: false }),
  keyNumbers: [3, 7, 10, 14],
});
assert.equal(towardHome.valid, true);
assert.equal(towardHome.direction, "toward_home");
assert.deepEqual(towardHome.crossedKeyNumbers, [3]);

const mismatched = deriveFootballMovement({
  first: price(),
  current: price({ sourceKey: "fanduel", sportsbook: "FanDuel", observedAt: "2026-08-19T14:00:00Z" }),
  keyNumbers: [3, 7],
});
assert.equal(mismatched.valid, false);
assert.equal(mismatched.reason, "source_or_market_identity_mismatch");

const splits: FootballSplitObservation[] = [
  { provider: "splits-a", sourceKey: "consensus", sourceType: "multi_book_consensus", sportsbook: null, booksUsed: 8, providerEventId: "game-1", market: "spread", side: "home", lineValue: -2.5, ticketsPct: 72, moneyPct: 65, observedAt: "2026-08-19T13:00:00Z", sourceUpdatedAt: "2026-08-19T12:59:00Z", fetchedAt: "2026-08-19T13:00:01Z" },
  { provider: "splits-a", sourceKey: "consensus", sourceType: "multi_book_consensus", sportsbook: null, booksUsed: 8, providerEventId: "game-1", market: "spread", side: "away", lineValue: 2.5, ticketsPct: 28, moneyPct: 35, observedAt: "2026-08-19T13:00:00Z", sourceUpdatedAt: "2026-08-19T12:59:00Z", fetchedAt: "2026-08-19T13:00:01Z" },
];
const publicRead = deriveFootballPublicRead(splits, 65);
assert.equal(publicRead.publicSide, "home");
assert.equal(publicRead.moneyTicketGap, -7);
assert.equal(publicRead.attribution?.booksUsed, 8);
const rlm = classifyReverseLineMovement({
  publicRead,
  movement: deriveFootballMovement({
    first: price(),
    current: price({ lineValue: -1.5, observedAt: "2026-08-19T14:00:00Z", isOpening: false }),
    keyNumbers: [3, 7],
  }),
});
assert.equal(rlm.status, "candidate");

const noHeavyPublic = deriveFootballPublicRead(splits, 75);
assert.equal(noHeavyPublic.publicSide, null);
assert.equal(classifyReverseLineMovement({ publicRead: noHeavyPublic, movement: towardHome }).status, "unavailable");
assert.throws(
  () => deriveFootballPublicRead([splits[0], { ...splits[1], providerEventId: "game-2" }], 65),
  /one attributed provider/,
  "split rows from different events must never form one public read",
);
assert.throws(() => deriveFootballPublicRead(splits, 49), /between 50 and 100/);
assert.throws(
  () => deriveFootballPublicRead([splits[0], { ...splits[1], provider: "other-provider" }], 65),
  /one attributed provider/,
  "split providers must never be blended inside one public read",
);
assert.equal(
  deriveFootballPublicRead(splits.map((row) => ({ ...row, moneyPct: null })), 65).moneyTicketGap,
  null,
  "ticket-only splits remain ticket-only",
);
assert.equal(
  deriveFootballPublicRead([splits[0], { ...splits[1], ticketsPct: 20 }], 65).availability,
  "unavailable",
  "non-complementary split pairs fail closed",
);
assert.throws(
  () => deriveFootballPublicRead([splits[0], { ...splits[1], observedAt: "not-a-time" }], 65),
  /provenance timestamps/,
);

console.log("Football shadow foundation: all focused tests passed");
