import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildNflPlayerPropsMarketEvidenceCapture,
  NFL_PLAYER_PROPS_MARKET_EVIDENCE_CAPTURE_RELEASE,
  NFL_PLAYER_PROPS_MARKET_EVIDENCE_MAX_ADDED_BYTES,
  NFL_PLAYER_PROPS_MARKET_EVIDENCE_MAX_BOOKS_PER_IDENTITY,
} from "../lib/services/football/nflPlayerPropsMarketEvidenceCapture";
import {
  buildNflPlayerPropsRuntimeBoard,
  type NflPlayerPropsRuntimeFeatureRow,
} from "../lib/services/football/nflPlayerPropsRuntime";
import type { NflPlayerPropsExactOffer } from "../lib/services/football/nflPlayerPropsMarketBoard";
import {
  buildNflPlayerPropsMemberSnapshot,
  reconcileNflPlayerPropsProductionSnapshot,
} from "../lib/services/football/nflPlayerPropsProductionContract";

const evaluatedAt = "2026-09-02T12:00:00.000Z";
const baseOffer: NflPlayerPropsExactOffer = {
  release: "nfl_player_props_exact_market_board_2026_09_01_r2_cross_line_opening",
  offerKey: "game|player|receptions|4.5|draftkings",
  canonicalGameId: "game",
  provider: "balldontlie",
  providerEventId: "game",
  providerPlayerId: "player",
  playerName: "Test Player",
  playerTeam: "NE",
  sportsbook: "draftkings",
  market: "receptions",
  offerType: "over_under",
  line: 4.5,
  overPrice: -105,
  underPrice: -115,
  yesPrice: null,
  overNoVigProbability: 0.5,
  underNoVigProbability: 0.5,
  observedAt: "2026-09-02T11:59:00.000Z",
  fetchedAt: "2026-09-02T11:59:01.250Z",
  openingObservedAt: "2026-09-01T18:00:00.000Z",
  openingLine: 4.5,
  openingOverPrice: -110,
  openingUnderPrice: -110,
  openingYesPrice: null,
  scheduledStart: "2026-09-10T00:20:00.000Z",
  lockAt: "2026-09-09T23:20:00.000Z",
  state: "unlocked",
  exactPriceComplete: true,
  gradeEligibleMarket: true,
  healthHolds: [],
};

const feature: NflPlayerPropsRuntimeFeatureRow = {
  gameId: "game",
  playerName: "Test Player",
  team: "NE",
  opponent: "NYJ",
  position: "WR",
  featureAsOf: evaluatedAt,
  roleFingerprint: "role",
  scoreEligible: true,
  healthHolds: [],
  teamImpliedPoints: 21,
  teamImpliedTouchdowns: 3,
  expectedQuarterback: {
    name: "Test Quarterback",
    starterStatus: "projected",
    capturedAt: evaluatedAt,
  },
  availability: {
    listed: false,
    status: null,
    detail: null,
    reportedAt: null,
    reportUpdatedAt: evaluatedAt,
    source: "BALLDONTLIE",
  },
  features: {
    is_home: 1,
    position_wr: 1,
    prior_receptions_lag1: 6,
    prior_receptions_avg3: 5.3,
    prior_receptions_avg5: 4.8,
    prior_receptions_ewm: 5.1,
    prior_targets_lag1: 9,
    prior_targets_avg3: 8,
    prior_targets_avg5: 7.6,
    prior_targets_ewm: 7.4,
    prior_target_share_lag1: 0.25,
    prior_target_share_avg3: 0.23,
    prior_target_share_avg5: 0.21,
    prior_target_share_ewm: 0.22,
    prior_offense_snap_pct_lag1: 0.81,
    prior_offense_snap_pct_avg3: 0.79,
    prior_offense_snap_pct_avg5: 0.76,
    prior_offense_snap_pct_ewm: 0.78,
    prior_opponent_allowed_targets_avg3: 30.8,
    prior_opponent_allowed_targets_avg5: 30.5,
    prior_opponent_allowed_targets_ewm: 31.2,
  },
};

const offers = [
  baseOffer,
  {
    ...baseOffer,
    offerKey: "game|player|receptions|4.5|fanduel",
    sportsbook: "fanduel",
    overPrice: -110,
    underPrice: -110,
    observedAt: "2026-09-02T11:58:30.000Z",
    fetchedAt: "2026-09-02T11:58:32.000Z",
  },
];
const baselineBoard = buildNflPlayerPropsRuntimeBoard({
  offers,
  features: [feature],
  evaluatedAt,
  captureMarketEvidence: false,
});
const capturedBoard = buildNflPlayerPropsRuntimeBoard({ offers, features: [feature], evaluatedAt });

assert.equal(NFL_PLAYER_PROPS_MARKET_EVIDENCE_CAPTURE_RELEASE,
  "nfl_player_props_market_evidence_capture_2026_09_02_r1");
assert.equal(NFL_PLAYER_PROPS_MARKET_EVIDENCE_MAX_BOOKS_PER_IDENTITY, 8);
assert.equal(capturedBoard.marketEvidence?.i.length, 1,
  "Over and Under share one complementary economic evidence identity");
assert.equal(new Set(capturedBoard.decisions.map((row) => row.marketEvidenceId)).size, 1);
const identity = capturedBoard.marketEvidence!.i[0]!;
assert.equal(identity[1], "rc");
assert.equal(identity[2].length, 2, "the per-book array is stored once on the identity, not on each side");
const draftKings = identity[2].find((book) => book[0] === "draftkings")!;
const fanDuel = identity[2].find((book) => book[0] === "fanduel")!;
assert.equal(draftKings[14], 1, "the exact Over evaluation book is explicitly identified");
assert.equal(fanDuel[14], 2, "the exact Under evaluation book is explicitly identified");
assert.equal(draftKings[3], baseOffer.observedAt);
assert.equal(draftKings[4], baseOffer.fetchedAt);
assert.equal(draftKings[5], 1_250, "provider observation/fetch skew is exact");
assert.equal(draftKings[6], baseOffer.openingObservedAt);
assert.equal(draftKings[7], baseOffer.openingLine);
assert.equal(identity[3][7], "1", "the target-excluded Over reference truthfully has one comparator");
assert.equal(identity[3][8], "1", "the target-excluded Under reference truthfully has one comparator");
assert.equal(identity[4][0], 0.2, "the incumbent fixed residual coefficient is captured, not changed");
assert.ok(identity[4][2] !== null && identity[4][3] !== null,
  "independent and final point outputs are captured together");

assert.deepEqual(stripAuditMetadata(capturedBoard), baselineBoard,
  "canonical values and counts are byte-identical after removing additive audit metadata");
assert.equal(JSON.stringify(stripAuditMetadata(capturedBoard)), JSON.stringify(baselineBoard));
assert.deepEqual(capturedBoard.counts, baselineBoard.counts);

const baselineProduction = reconcileNflPlayerPropsProductionSnapshot({
  season: 2026,
  week: 1,
  evaluatedAt,
  nextBoard: baselineBoard,
});
const capturedProduction = reconcileNflPlayerPropsProductionSnapshot({
  season: 2026,
  week: 1,
  evaluatedAt,
  nextBoard: capturedBoard,
});
assert.deepEqual(stripAuditMetadata(capturedProduction), baselineProduction,
  "production reconciliation changes only additive market-evidence metadata");
const baselineMember = buildNflPlayerPropsMemberSnapshot(baselineProduction);
const capturedMember = buildNflPlayerPropsMemberSnapshot(capturedProduction);
assert.deepEqual(stripAuditMetadata(capturedMember), baselineMember,
  "member values and counts are byte-identical after removing additive audit metadata");
assert.ok(capturedMember.board.marketEvidence);
assert.equal(capturedMember.memberDecisions[0]?.marketEvidenceId, identity[0]);

const lockedPrior = {
  ...capturedProduction,
  board: {
    ...capturedProduction.board,
    decisions: capturedProduction.board.decisions.map((row) => ({ ...row, state: "locked" as const })),
  },
  memberDecisions: capturedProduction.memberDecisions.map((row) => ({ ...row, state: "locked" as const })),
};
const changedNext = {
  ...capturedBoard,
  decisions: capturedBoard.decisions.map((row) => ({
    ...row,
    americanPrice: 250,
    projection: (row.projection ?? 0) + 99,
    finalProbability: 0.99,
    grade: "Best Angle" as const,
  })),
};
const lockedReconciled = reconcileNflPlayerPropsProductionSnapshot({
  season: 2026,
  week: 1,
  evaluatedAt,
  nextBoard: changedNext,
  previous: lockedPrior,
});
assert.deepEqual(lockedReconciled.board.decisions, lockedPrior.board.decisions,
  "locked decisions preserve their complete prior value and additive evidence reference");
assert.deepEqual(lockedReconciled.board.marketEvidence, lockedPrior.board.marketEvidence,
  "locked identities preserve the exact prior evidence tuple rather than reconstructing it");

const productionAddedBytes = Buffer.byteLength(JSON.stringify(capturedProduction))
  - Buffer.byteLength(JSON.stringify(baselineProduction));
assert.ok(productionAddedBytes > 0);
assert.ok(productionAddedBytes <= NFL_PLAYER_PROPS_MARKET_EVIDENCE_MAX_ADDED_BYTES,
  `full production snapshot adds ${productionAddedBytes} bytes, over the hard cap`);

const incompleteAlternative = {
  ...baseOffer,
  offerKey: "game|player|receptions|4.5|unknown",
  sportsbook: "unknown-book",
  underPrice: null,
  underNoVigProbability: null,
  exactPriceComplete: false,
};
const incompleteCapture = buildNflPlayerPropsMarketEvidenceCapture({
  offers: [baseOffer, incompleteAlternative],
  decisions: baselineBoard.decisions,
  evaluatedAt,
  maximumQuoteAgeHours: 6,
  incumbentCoefficientByMarket: { receptions: 0.2 },
});
assert.equal(incompleteCapture.capture.i[0]?.[3][7], "i",
  "an incomplete alternative is labeled incomplete rather than market consensus");
const missingCapture = buildNflPlayerPropsMarketEvidenceCapture({
  offers: [baseOffer],
  decisions: baselineBoard.decisions,
  evaluatedAt,
  maximumQuoteAgeHours: 6,
  incumbentCoefficientByMarket: { receptions: 0.2 },
});
assert.equal(missingCapture.capture.i[0]?.[3][7], "m",
  "missing comparison evidence remains an explicit neutral missing state");

const manyBooks = Array.from({ length: 14 }, (_, index) => ({
  ...baseOffer,
  offerKey: `game|player|receptions|4.5|book-${index}`,
  sportsbook: index === 0 ? "draftkings" : index === 1 ? "pinnacle" : `book-${index}`,
}));
const boundedBooks = buildNflPlayerPropsMarketEvidenceCapture({
  offers: manyBooks,
  decisions: capturedBoard.decisions,
  evaluatedAt,
  maximumQuoteAgeHours: 6,
  incumbentCoefficientByMarket: { receptions: 0.2 },
});
assert.ok((boundedBooks.capture.i[0]?.[2].length ?? 0) <= 8);
assert.ok(boundedBooks.capture.i[0]?.[2].some((book) => book[0] === "draftkings"),
  "the evaluated book survives bounded comparator retention");
assert.ok(boundedBooks.capture.i[0]?.[2].some((book) => book[0] === "pinnacle"),
  "source-stratified book retention does not first-N away the sharp source");

const supportedMarkets = [
  "anytime_td",
  "passing_attempts",
  "passing_completions",
  "passing_yards",
  "receiving_yards",
  "receptions",
  "rushing_attempts",
  "rushing_yards",
] as const;
const largeOffers = supportedMarkets.flatMap((market, marketIndex) =>
  Array.from({ length: 550 }, (_, identityIndex) => {
    const milestone = market === "anytime_td";
    return {
      ...baseOffer,
      offerKey: `${marketIndex}|${identityIndex}`,
      canonicalGameId: `game-${marketIndex}-${identityIndex}`,
      providerEventId: `game-${marketIndex}-${identityIndex}`,
      providerPlayerId: `player-${marketIndex}-${identityIndex}`,
      playerName: `Player ${marketIndex} ${identityIndex}`,
      market,
      offerType: milestone ? "milestone" as const : "over_under" as const,
      line: milestone ? 0.5 : 4.5,
      overPrice: milestone ? null : -110,
      underPrice: milestone ? null : -110,
      yesPrice: milestone ? 150 : null,
      overNoVigProbability: milestone ? null : 0.5,
      underNoVigProbability: milestone ? null : 0.5,
    };
  }));
const retained = buildNflPlayerPropsMarketEvidenceCapture({
  offers: largeOffers,
  decisions: [],
  evaluatedAt,
  maximumQuoteAgeHours: 6,
  incumbentCoefficientByMarket: Object.fromEntries(supportedMarkets.map((market) => [market, 0.2])),
});
assert.ok(retained.capture.o > 0, "oversized captures exercise deterministic retention");
assert.ok(retained.addedBytes <= NFL_PLAYER_PROPS_MARKET_EVIDENCE_MAX_ADDED_BYTES);
assert.ok(retained.capture.c.every(([, , kept]) => kept > 0),
  "stratified retention preserves every populated supported category");
const reversed = buildNflPlayerPropsMarketEvidenceCapture({
  offers: [...largeOffers].reverse(),
  decisions: [],
  evaluatedAt,
  maximumQuoteAgeHours: 6,
  incumbentCoefficientByMarket: Object.fromEntries(supportedMarkets.map((market) => [market, 0.2])),
});
assert.deepEqual(reversed.capture, retained.capture, "retention is deterministic and input-order independent");

const captureSource = readFileSync("lib/services/football/nflPlayerPropsMarketEvidenceCapture.ts", "utf8");
assert.ok(!/\bfetch\s*\(|createClient\s*\(|\.from\s*\(/.test(captureSource),
  "capture adds no provider or database query path");
const writerSource = readFileSync("lib/services/football/nflPlayerPropsProductionWriter.ts", "utf8");
assert.equal(writerSource.match(/collectNflPlayerPropsObservations\s*\(/g)?.length, 1,
  "the existing provider collection call count remains one");
assert.equal(writerSource.match(/writeNflPlayerPropsSnapshot\s*\(/g)?.length, 1,
  "the existing snapshot DB write count remains one");
assert.equal(writerSource.match(/writeLockedNflPlayerPropsTracking\s*\(/g)?.length, 1,
  "the existing tracking DB write path remains singular");

console.log(JSON.stringify({
  release: NFL_PLAYER_PROPS_MARKET_EVIDENCE_CAPTURE_RELEASE,
  fixtureAddedBytes: productionAddedBytes,
  hardCapBytes: NFL_PLAYER_PROPS_MARKET_EVIDENCE_MAX_ADDED_BYTES,
  boundedRetention: {
    observed: retained.capture.n,
    retained: retained.capture.k,
    omitted: retained.capture.o,
    categories: retained.capture.c,
  },
}, null, 2));

function stripAuditMetadata<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripAuditMetadata) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
    key === "marketEvidence" || key === "marketEvidenceId"
      ? []
      : [[key, stripAuditMetadata(item)]])) as T;
}
