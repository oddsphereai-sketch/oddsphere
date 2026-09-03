import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  PlayerPropPreviewRow,
  PlayerPropsDashboardData,
} from "../app/mlb/props/components/PlayerPropsDashboard";
import {
  attachMlbPropsMarketEvidenceReferences,
  buildMlbPropsMarketEvidenceCapture,
  mergeMlbPropsMarketEvidenceCaptures,
  mlbPropsMarketEvidenceInput,
  MLB_PROPS_MARKET_EVIDENCE_CAPTURE_RELEASE,
  MLB_PROPS_MARKET_EVIDENCE_CANONICAL_TARGET_BYTES,
  MLB_PROPS_MARKET_EVIDENCE_MAX_BOOKS_PER_IDENTITY,
  MLB_PROPS_MARKET_EVIDENCE_MAX_CANONICAL_ADDED_BYTES,
  MLB_PROPS_MARKET_EVIDENCE_MAX_TRANSIENT_LOCK_MERGE_BYTES,
  MLB_PROPS_MARKET_EVIDENCE_MAX_MEMBER_ADDED_BYTES,
  MLB_PROPS_MARKET_EVIDENCE_MEMBER_TARGET_BYTES,
  subsetMlbPropsMarketEvidenceCapture,
  withoutUnretainedMlbPropsEvidenceReference,
  type MlbPropsMarketEvidenceRow,
} from "../lib/mlb/props/marketEvidenceCapture";
import type { MlbPropMarketContext } from "../lib/mlb/props/marketAwareContext";
import { marketContextQuoteKey } from "../lib/mlb/props/marketAwareContext";
import { buildMlbPropsMemberEvidencePayload } from "../lib/mlb/props/memberReadSnapshotStore";
import type { PropOddsSnapshot } from "../lib/mlb/props/providers";

const evaluatedAt = "2026-09-02T12:00:00.000Z";
const baseRow: PlayerPropPreviewRow = {
  id: "row-over-draftkings",
  researchKey: "game|100|batter_hits",
  player: "Test Player",
  headshotUrl: null,
  team: "NYY",
  opponent: "BOS",
  homeAway: "home",
  gameStartTime: "2026-09-02T23:05:00.000Z",
  market: "batter_hits",
  marketLabel: "Batter Hits",
  marketFamily: "batter",
  offerContract: "two_way",
  marketGroup: "Hits/Bases",
  side: "over",
  line: 1.5,
  odds: 115,
  book: "DraftKings",
  modelProbability: 0.54,
  independentProbability: 0.54,
  marketProbability: 0.51,
  finalProbability: 0.53,
  shrinkageWeight: 0.1,
  modelEdge: 0.02,
  expectedValue: 0.1395,
  fairOdds: -113,
  units: 0,
  confidence: 0.72,
  confidenceBucket: "medium",
  playGrade: "WATCHLIST",
  source: "Ball Don't Lie + MLB Stats + NWS + Baseball Savant",
  lastUpdated: evaluatedAt,
  projection: 1.64,
  projectionSource: "model",
  overProbability: 0.53,
  underProbability: 0.47,
  lineupStatus: null,
  providerIds: {
    gameId: "mlbstats-game-1",
    bdlGameId: "1",
    bdlPropId: "p1",
    bdlPlayerId: 100,
    mlbStatsPlayerId: "mlbstats-player-100",
  },
  oddsMovement: null,
  keyFeatures: [],
  missingFeatures: [],
  modelInputWarnings: [],
  marketContext: [],
  recentForm: null,
  opponentProfile: null,
  pitchArsenal: null,
  pitchMatchup: null,
  matchupHistory: null,
  environment: null,
  reasonCodes: [],
  oddsSanity: [],
  settlementStatus: "pending",
  clvStatus: "pending",
};

const context: MlbPropMarketContext = {
  currentOverProbability: 0.51,
  targetExcludedOverProbability: 0.505,
  completePairBooks: 3,
  targetExcludedBooks: 2,
  movementAdjustmentOver: 0.004,
  relatedMovementAdjustmentOver: 0.002,
  splitAdjustmentOver: 0,
  openingBooks: 3,
  relatedMarkets: 2,
  splitEvidenceRows: 0,
};
const rows: MlbPropsMarketEvidenceRow[] = [
  {
    ...baseRow,
    ...mlbPropsMarketEvidenceInput({ independentProjection: 1.51, context }),
  },
  {
    ...baseRow,
    id: "row-under-fanduel",
    side: "under",
    book: "FanDuel",
    odds: -110,
    modelProbability: 0.46,
    independentProbability: 0.46,
    finalProbability: 0.47,
    modelEdge: -0.025,
    expectedValue: -0.1027,
    fairOdds: 113,
    playGrade: "NO_PLAY",
    ...mlbPropsMarketEvidenceInput({ independentProjection: 1.51, context }),
  },
];
const currentOdds = [
  ...pair("draftkings", -115, -105),
  ...pair("fanduel", -110, -110),
  ...pair("pinnacle", -108, -112),
];
const openingOdds = [
  ...pair("draftkings", -110, -110, "opening", "2026-09-02T09:00:00.000Z"),
  ...pair("fanduel", -105, -115, "opening", "2026-09-02T09:01:00.000Z"),
  ...pair("pinnacle", -106, -114, "opening", "2026-09-02T09:02:00.000Z"),
];
const contexts = new Map(currentOdds.map((row) => [marketContextQuoteKey(row), context]));
const built = buildMlbPropsMarketEvidenceCapture({
  currentOdds,
  openingOdds,
  contexts,
  rows,
  evaluatedAt,
  maximumQuoteAgeMinutes: 45,
});
const capturedRows = attachMlbPropsMarketEvidenceReferences(rows, built.retainedIds);

assert.equal(MLB_PROPS_MARKET_EVIDENCE_CAPTURE_RELEASE,
  "mlb_props_market_evidence_capture_2026_09_02_r1");
assert.equal(MLB_PROPS_MARKET_EVIDENCE_MAX_BOOKS_PER_IDENTITY, 8);
assert.equal(built.capture.i.length, 1,
  "complementary Over and Under economics share one evidence identity");
assert.equal(new Set(capturedRows.map((row) => row.marketEvidenceId)).size, 1);
const identity = built.capture.i[0]!;
assert.equal(identity[1], "bh");
assert.equal(identity[2].length, 3, "the book array is serialized once for the complementary pair");
const draftKings = identity[2].find((book) => book[0] === "draftkings")!;
const pinnacle = identity[2].find((book) => book[0] === "pinnacle")!;
assert.equal(draftKings[2], "r");
assert.equal(pinnacle[2], "s");
assert.equal(draftKings[3], evaluatedAt);
assert.equal(draftKings[4], "2026-09-02T11:58:00.000Z");
assert.equal(draftKings[5], 120_000, "provider-change/fetch skew is preserved exactly");
assert.equal(draftKings[6], "2026-09-02T09:00:00.000Z");
assert.equal(draftKings[7], 1.5);
assert.equal(draftKings[8], -115);
assert.equal(draftKings[9], -105);
assert.equal(identity[3][7], 2,
  "minimum comparator breadth excludes each evaluated row's named sportsbook");
assert.equal(identity[3][8], "c");
assert.equal(identity[4][0], 0.51);
assert.equal(identity[4][1], 0.004);
assert.equal(identity[5][0], 1.51, "independent projection is captured before the incumbent market transform");
assert.equal(identity[5][1], 1.64, "published projection is captured without changing it");
assert.equal(identity[5][2], 0.1, "the incumbent independent/model coefficient is captured");
assert.equal(built.capture.sp, "n", "missing verified prop splits remain explicitly neutral");
assert.equal(JSON.stringify(stripAuditMetadata(capturedRows)), JSON.stringify(rows),
  "row values and order are byte-identical after removing additive evidence references");

const movedOpening = openingOdds.map((row) => ({ ...row, line: 0.5 }));
const movedOpeningCapture = buildMlbPropsMarketEvidenceCapture({
  currentOdds,
  openingOdds: movedOpening,
  contexts,
  rows,
  evaluatedAt,
  maximumQuoteAgeMinutes: 45,
});
assert.equal(movedOpeningCapture.capture.i[0]?.[2].find((book) => book[0] === "draftkings")?.[7], 0.5,
  "opening lookup crosses point lines so genuine opening-to-current line movement remains captured");

const splitOdds = currentOdds.map((row) => row.sportsbook === "pinnacle" && row.side === "over"
  ? {
      ...row,
      rawPayload: {
        ...asRecord(row.rawPayload),
        split_source: "circa",
        split_updated_at: "2026-09-02T11:45:00.000Z",
        bet_percentage: 48,
        money_percentage: 61,
      },
    }
  : row);
const splitCapture = buildMlbPropsMarketEvidenceCapture({
  currentOdds: splitOdds,
  openingOdds,
  contexts,
  rows,
  evaluatedAt,
  maximumQuoteAgeMinutes: 45,
});
assert.equal(splitCapture.capture.sp, "v");
assert.deepEqual(splitCapture.capture.i[0]?.[2].find((book) => book[0] === "pinnacle")?.[12], [
  ["o", "c", "2026-09-02T11:45:00.000Z", 0.48, 0.61],
]);

const incompleteOdds = [
  ...pair("draftkings", -115, -105),
  odds("unknown", "over", 120),
];
const incomplete = buildMlbPropsMarketEvidenceCapture({
  currentOdds: incompleteOdds,
  openingOdds: [],
  contexts: new Map(),
  rows: rows.slice(0, 1),
  evaluatedAt,
  maximumQuoteAgeMinutes: 45,
});
assert.equal(incomplete.capture.i[0]?.[3][7], 0);
assert.equal(incomplete.capture.i[0]?.[3][8], "i",
  "an incomplete alternative is distinguished from missing evidence");

const manyBooks = Array.from({ length: 14 }, (_, index) =>
  pair(index === 0 ? "draftkings" : index === 1 ? "pinnacle" : `book-${index}`, -110, -110)).flat();
const boundedBooks = buildMlbPropsMarketEvidenceCapture({
  currentOdds: manyBooks,
  openingOdds: [],
  contexts: new Map(),
  rows,
  evaluatedAt,
  maximumQuoteAgeMinutes: 45,
});
assert.ok((boundedBooks.capture.i[0]?.[2].length ?? 0) <= 8);
assert.ok(boundedBooks.capture.i[0]?.[2].some((book) => book[0] === "pinnacle"),
  "source-stratified retention cannot first-N away the sharp source");

const supportedMarkets = [
  "pitcher_strikeouts", "pitcher_outs", "pitcher_hits_allowed", "pitcher_walks",
  "pitcher_earned_runs", "batter_strikeouts", "batter_hits", "batter_total_bases",
  "batter_home_runs", "batter_rbis", "batter_runs_scored", "batter_hits_runs_rbis",
  "batter_singles", "batter_doubles", "batter_triples", "batter_walks",
  "batter_stolen_bases",
] as const;
const largeRows: MlbPropsMarketEvidenceRow[] = [];
const largeOdds: PropOddsSnapshot[] = [];
for (const [marketIndex, market] of supportedMarkets.entries()) {
  for (let identityIndex = 0; identityIndex < 500; identityIndex += 1) {
    const playerId = 10_000_000 + marketIndex * 1_000 + identityIndex;
    const row = {
      ...baseRow,
      id: `${marketIndex}-${identityIndex}`,
      player: `Player ${marketIndex} ${identityIndex}`,
      market,
      providerIds: { ...baseRow.providerIds!, bdlPlayerId: playerId },
      ...mlbPropsMarketEvidenceInput({ independentProjection: 1.234567, context }),
    };
    largeRows.push(row);
    largeOdds.push(
      { ...odds("draftkings", "over", -110), playerId: `balldontlie-player-${playerId}`, marketKey: market },
      { ...odds("draftkings", "under", -110), playerId: `balldontlie-player-${playerId}`, marketKey: market },
    );
  }
}
const retained = buildMlbPropsMarketEvidenceCapture({
  currentOdds: largeOdds,
  openingOdds: [],
  contexts: new Map(),
  rows: largeRows,
  evaluatedAt,
  maximumQuoteAgeMinutes: 45,
});
assert.ok(retained.capture.o > 0, "oversized capture exercises bounded retention");
assert.ok(retained.addedBytes <= MLB_PROPS_MARKET_EVIDENCE_CANONICAL_TARGET_BYTES);
assert.ok(retained.addedBytes < MLB_PROPS_MARKET_EVIDENCE_MAX_CANONICAL_ADDED_BYTES);
assert.ok(retained.capture.c.every(([, , kept]) => kept > 0),
  "deterministic category stratification retains every supported category");
const reversed = buildMlbPropsMarketEvidenceCapture({
  currentOdds: [...largeOdds].reverse(),
  openingOdds: [],
  contexts: new Map(),
  rows: [...largeRows].reverse(),
  evaluatedAt,
  maximumQuoteAgeMinutes: 45,
});
assert.deepEqual(reversed.capture, retained.capture,
  "capture and category retention are input-order independent");

const retainedRows = attachMlbPropsMarketEvidenceReferences(largeRows, retained.retainedIds);
const memberRows = retainedRows.filter((row) => row.marketEvidenceId).slice(0, 600);
const memberSubset = subsetMlbPropsMarketEvidenceCapture({ capture: retained.capture, rows: memberRows });
assert.ok(memberSubset.capture);
assert.ok(memberSubset.addedBytes <= MLB_PROPS_MARKET_EVIDENCE_MEMBER_TARGET_BYTES);
assert.ok(memberSubset.addedBytes < MLB_PROPS_MARKET_EVIDENCE_MAX_MEMBER_ADDED_BYTES);
const memberData = dashboardData(memberRows);
const member = buildMlbPropsMemberEvidencePayload({ marketEvidence: retained.capture }, memberData);
const capturedMember = {
  schemaVersion: 1,
  data: member.data,
  ...(member.marketEvidence ? { marketEvidence: member.marketEvidence } : {}),
};
assert.equal(JSON.stringify(stripAuditMetadata(capturedMember)),
  JSON.stringify({ schemaVersion: 1, data: stripAuditMetadata(memberData) }),
  "member output values/counts/order are byte-identical apart from additive audit metadata");
assert.ok(member.addedBytes < MLB_PROPS_MARKET_EVIDENCE_MAX_MEMBER_ADDED_BYTES);

const clonedIdentities = retained.capture.i.map((identity, index) => {
  const id = createHash("sha256").update(`locked-clone-${index}`).digest("hex").slice(0, 16);
  return [id, identity[1], identity[2], identity[3], identity[4], identity[5]] as const;
});
const clonedCapture = { ...retained.capture, i: clonedIdentities };
const lockedUnionRows = [
  ...retained.capture.i.map((identity, index) => ({
    ...baseRow,
    id: `locked-original-${index}`,
    marketEvidenceId: identity[0],
    lockStatus: { status: "locked" as const, lockedAt: "2026-09-02T11:00:00.000Z" },
  })),
  ...clonedIdentities.map((identity, index) => ({
    ...baseRow,
    id: `locked-clone-${index}`,
    marketEvidenceId: identity[0],
    lockStatus: { status: "locked" as const, lockedAt: "2026-09-02T11:00:00.000Z" },
  })),
];
assert.throws(() => mergeMlbPropsMarketEvidenceCaptures({
  captures: [retained.capture, clonedCapture],
  rows: lockedUnionRows,
}), /required identities exceed 1048576 bytes/,
"stored-capture merge retains the canonical 1 MiB hard cap");
const transientLockedUnion = mergeMlbPropsMarketEvidenceCaptures({
  captures: [retained.capture, clonedCapture],
  rows: lockedUnionRows,
  allowTransientLockedOverflow: true,
});
assert.ok(transientLockedUnion.capture);
assert.ok(transientLockedUnion.addedBytes > MLB_PROPS_MARKET_EVIDENCE_MAX_CANONICAL_ADDED_BYTES,
  "the fixture proves lock reconciliation can require more than the stored canonical cap");
assert.ok(transientLockedUnion.addedBytes < MLB_PROPS_MARKET_EVIDENCE_MAX_TRANSIENT_LOCK_MERGE_BYTES);
const boundedLockedRows = lockedUnionRows.slice(0, 200);
const boundedLockedMember = subsetMlbPropsMarketEvidenceCapture({
  capture: transientLockedUnion.capture,
  rows: boundedLockedRows,
});
assert.ok(boundedLockedMember.capture);
assert.ok(boundedLockedMember.addedBytes < MLB_PROPS_MARKET_EVIDENCE_MAX_MEMBER_ADDED_BYTES,
  "the transient union is subset back under the unchanged member hard cap before persistence");
assert.deepEqual(
  boundedLockedRows.map((row) => withoutUnretainedMlbPropsEvidenceReference(row, boundedLockedMember.retainedIds)),
  boundedLockedRows,
  "member subsetting preserves every selected immutable locked evidence reference",
);

const priorOdds = currentOdds.map((row) => ({ ...row, americanOdds: row.americanOdds - 7 }));
const prior = buildMlbPropsMarketEvidenceCapture({
  currentOdds: priorOdds,
  openingOdds,
  contexts,
  rows,
  evaluatedAt,
  maximumQuoteAgeMinutes: 45,
});
const priorRows = attachMlbPropsMarketEvidenceReferences(rows, prior.retainedIds).map((row) => ({
  ...row,
  lockStatus: { status: "locked" as const, lockedAt: "2026-09-02T11:00:00.000Z" },
}));
const merged = mergeMlbPropsMarketEvidenceCaptures({
  captures: [built.capture, prior.capture],
  rows: priorRows,
});
assert.deepEqual(merged.capture?.i[0], prior.capture.i[0],
  "a locked row resolves to its exact prior evidence tuple, not the newer current tuple");
assert.deepEqual(priorRows.map((row) => withoutUnretainedMlbPropsEvidenceReference(row, merged.retainedIds)), priorRows,
  "locked rows remain byte/value immutable during evidence retention");

const captureSource = readFileSync("lib/mlb/props/marketEvidenceCapture.ts", "utf8");
assert.ok(!/\bfetch\s*\(|createClient\s*\(|\.from\s*\(/.test(captureSource),
  "capture introduces no provider or database query path");
const liveBoardSource = readFileSync("lib/mlb/props/liveBoard.ts", "utf8");
assert.equal(liveBoardSource.match(/oddsClient\.getPropOdds\s*\(/g)?.length, 1,
  "the existing current-odds provider call remains singular");
assert.equal(liveBoardSource.match(/oddsClient\.getOpeningPropOdds\s*\(/g)?.length, 1,
  "the existing opening-odds provider call remains singular");
const memberWriterSource = readFileSync("lib/mlb/props/memberReadSnapshotStore.ts", "utf8");
assert.equal(memberWriterSource.match(/\.upsert\s*\(/g)?.length, 2,
  "member snapshot database write statements are unchanged");
const boardSnapshotStoreSource = readFileSync("lib/mlb/props/boardSnapshotStore.ts", "utf8");
assert.equal(boardSnapshotStoreSource.match(/allowTransientLockedOverflow: true/g)?.length, 1,
  "only display-lock reconciliation opts into the bounded transient union");
assert.ok(!memberWriterSource.includes("allowTransientLockedOverflow"),
  "persisted member writers cannot opt out of their existing per-payload evidence cap");

console.log(JSON.stringify({
  release: MLB_PROPS_MARKET_EVIDENCE_CAPTURE_RELEASE,
  fixtureAddedCanonicalBytes: built.addedBytes,
  canonicalTargetBytes: MLB_PROPS_MARKET_EVIDENCE_CANONICAL_TARGET_BYTES,
  canonicalHardCapBytes: MLB_PROPS_MARKET_EVIDENCE_MAX_CANONICAL_ADDED_BYTES,
  memberTargetBytes: MLB_PROPS_MARKET_EVIDENCE_MEMBER_TARGET_BYTES,
  memberHardCapBytes: MLB_PROPS_MARKET_EVIDENCE_MAX_MEMBER_ADDED_BYTES,
  boundedRetention: {
    observed: retained.capture.n,
    retained: retained.capture.k,
    omitted: retained.capture.o,
    addedBytes: retained.addedBytes,
    categories: retained.capture.c,
  },
}, null, 2));

function odds(
  sportsbook: string,
  side: "over" | "under",
  americanOdds: number,
  snapshotRole: "opening" | "current" = "current",
  asOfTimestamp = evaluatedAt,
): PropOddsSnapshot {
  return {
    marketKey: "batter_hits",
    gameId: "balldontlie-game-1",
    playerId: "balldontlie-player-100",
    sportsbook,
    side,
    line: 1.5,
    americanOdds,
    decimalOdds: americanOdds > 0 ? 1 + americanOdds / 100 : 1 + 100 / Math.abs(americanOdds),
    impliedProbability: americanOdds > 0 ? 100 / (americanOdds + 100) : Math.abs(americanOdds) / (Math.abs(americanOdds) + 100),
    asOfTimestamp,
    snapshotRole,
    provider: "balldontlie",
    rawPayload: {
      bdl_game_id: "1",
      bdl_player_id: "100",
      updated_at: "2026-09-02T11:58:00.000Z",
    },
  };
}

function pair(
  sportsbook: string,
  over: number,
  under: number,
  snapshotRole: "opening" | "current" = "current",
  asOfTimestamp = evaluatedAt,
): PropOddsSnapshot[] {
  return [
    odds(sportsbook, "over", over, snapshotRole, asOfTimestamp),
    odds(sportsbook, "under", under, snapshotRole, asOfTimestamp),
  ];
}

function dashboardData(props: PlayerPropPreviewRow[]): PlayerPropsDashboardData {
  return {
    date: "2026-09-02",
    lastUpdated: evaluatedAt,
    providerStatus: {
      selectedOddsSource: "balldontlie",
      sharpApi: "unavailable",
      bdl: "available",
      publicDisplayEnabled: true,
      paperPersistenceEnabled: true,
      writesToSupabase: true,
    },
    summary: {
      gamesWithProps: 1,
      scoredProps: props.length,
      recommendations: props.filter((row) => row.playGrade === "BEST_ANGLE").length,
      leans: props.filter((row) => row.playGrade === "LEAN").length,
      watchlist: props.filter((row) => row.playGrade === "WATCHLIST").length,
      noPlay: props.filter((row) => row.playGrade === "NO_PLAY").length,
      pendingData: props.filter((row) => row.playGrade === "PENDING_DATA").length,
      researchOnly: props.filter((row) => row.playGrade === "RESEARCH").length,
      booksCovered: new Set(props.map((row) => row.book)).size,
      marketsAvailable: new Set(props.map((row) => row.market)).size,
      averageDataConfidence: 0.72,
    },
    props,
  };
}

function stripAuditMetadata<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripAuditMetadata) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
    key === "marketEvidence" || key === "marketEvidenceId"
      ? []
      : [[key, stripAuditMetadata(item)]])) as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
