import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildNflPlayerPropsPrivateTrackingRows,
  decodeNflPlayerPropsPrivateTrackingHistory,
  encodeNflPlayerPropsPrivateTrackingHistory,
  mergeNflPlayerPropsPrivateTrackingRows,
  NFL_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE,
  NFL_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA,
  type NflPlayerPropsPrivateTrackingHistory,
} from "../lib/services/football/nflPlayerPropsPrivateTrackingStore";
import type { NflPlayerPropsProductionSnapshot } from "../lib/services/football/nflPlayerPropsProductionContract";
import {
  favorablePlayerPropLine,
  settlePlayerProp,
  summarizePrivatePlayerPropTracking,
  type PrivatePlayerPropSettledRow,
} from "../lib/services/playerPropsPrivateDiagnostics";
import {
  buildMlbPropsPrivateTrackingGames,
  decodeMlbPropsPrivateTrackingHistory,
  encodeMlbPropsPrivateTrackingHistory,
  mergeMlbPropsPrivateTrackingGames,
  MLB_PROPS_PRIVATE_TRACKING_RELEASE,
  MLB_PROPS_PRIVATE_TRACKING_SCHEMA,
  type MlbPropsPrivateTrackingHistory,
} from "../lib/mlb/props/privateTrackingStore";
import type { PlayerPropPreviewRow } from "../app/mlb/props/components/PlayerPropsDashboard";
import type { PropOddsSnapshot } from "../lib/mlb/props/providers";

const evaluatedAt = "2026-10-12T16:00:00.000Z";
const start = "2026-10-12T18:00:00.000Z";
const lock = "2026-10-12T17:00:00.000Z";

function decision(line: number, side: "over" | "under", projection: number, grade = "No Play") {
  return {
    gameId: "game-1",
    providerPlayerId: "player-1",
    playerName: "Player One",
    team: "BUF",
    opponent: "NYJ",
    scheduledStart: start,
    market: "receptions",
    line,
    side,
    sportsbook: "draftkings",
    provider: "balldontlie",
    americanPrice: -110,
    bookEvidence: [],
    observedAt: lock,
    lockAt: lock,
    state: "locked",
    roleFingerprint: "role",
    projection,
    projectionRange: null,
    forecastContext: {},
    participationProbability: 0.9,
    rawModelProbability: side === "over" ? 0.7 : 0.3,
    marketProbability: side === "over" ? 0.52 : 0.48,
    finalProbability: side === "over" ? 0.56 : 0.44,
    probabilityEdge: 0.04,
    expectedValue: 0.05,
    grade,
    marketMovement: "support",
    healthHolds: [],
    provisional: false,
    modelRelease: "model-r1",
    calibrationRelease: "calibration-r1",
    decisionRelease: "decision-r1",
    projectionEvidence: {
      release: "nfl_player_props_market_coherent_projection_2026_09_03_r2_single_distribution",
      source: "single_posterior_distribution",
      independentProjection: 3.8,
      calibratedOverProbability: 0.7,
    },
  };
}

const snapshot = {
  release: "nfl_player_props_member_2026_10_09_r40_independent_receiving_yards",
  season: 2026,
  week: 6,
  generatedAt: evaluatedAt,
  writerLeaseGroup: "prediction_pipeline:nfl",
  publicationEligible: true,
  trackingEligible: true,
  riskLabel: "forward_monitoring_2025_exact_price_confirmation",
  board: {
    release: "nfl_player_props_board_2026_10_09_r32_independent_receiving_yards",
    generatedAt: evaluatedAt,
    evaluatedAt,
    provisional: false,
    publicationEnabled: true,
    trackingEnabled: true,
    decisions: [
      decision(4.5, "over", 5.2, "Lean"),
      decision(4.5, "under", 5.2),
      decision(5.5, "over", 5.2),
      decision(5.5, "under", 5.2),
    ],
    counts: { "Best Angle": 0, Lean: 1, Watchlist: 0, "No Play": 3, Held: 0, actionable: 1 },
    diagnostics: {},
  },
  memberDecisions: [],
  lifecycle: { recomputedUnlocked: 0, retainedStillFreshUnlocked: 0, frozenAtLock: 4, retainedPreviouslyLocked: 0 },
} as unknown as NflPlayerPropsProductionSnapshot;

const captured = buildNflPlayerPropsPrivateTrackingRows({ snapshot, writerRelease: "writer-r1" });
assert.equal(captured.length, 4, "every locked side and alternate line is privately captured");
assert.equal(captured.filter((row) => row.canonicalMainLine).length, 2, "one complete line is marked canonical");
assert.equal(captured.filter((row) => !row.canonicalMainLine).length, 2, "alternate ladders remain explicit");
assert.equal(captured[0]?.independentProjection, 3.8, "the independent point is retained separately from the published point");

const merged = mergeNflPlayerPropsPrivateTrackingRows({ previous: captured, current: captured });
assert.equal(merged.added, 0);
assert.equal(merged.preserved, 4);
const changed = { ...captured[0]!, finalProbability: 0.99 };
const immutable = mergeNflPlayerPropsPrivateTrackingRows({ previous: captured, current: [changed] });
assert.equal(immutable.conflicts, 1);
assert.equal(immutable.rows.find((row) => row.rowKey === changed.rowKey)?.finalProbability, captured[0]?.finalProbability,
  "a later cycle cannot rewrite a locked private row");

const history: NflPlayerPropsPrivateTrackingHistory = {
  kind: "nfl_player_props_private_tracking_history_v1",
  schema: NFL_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA,
  captureRelease: NFL_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE,
  season: 2026,
  week: 6,
  createdAt: evaluatedAt,
  updatedAt: evaluatedAt,
  rows: captured,
};
const envelope = encodeNflPlayerPropsPrivateTrackingHistory(history);
assert.deepEqual(decodeNflPlayerPropsPrivateTrackingHistory(envelope), history);
assert.equal(decodeNflPlayerPropsPrivateTrackingHistory({ ...envelope, checksum: "bad" }), null);

const settled: PrivatePlayerPropSettledRow[] = captured.map((row) => ({
  sport: "nfl",
  gameId: row.gameId,
  playerName: row.playerName,
  market: row.market,
  line: row.line,
  side: row.side,
  sportsbook: row.sportsbook,
  americanPrice: row.americanPrice,
  canonicalMainLine: row.canonicalMainLine,
  projection: row.projection,
  independentProjection: row.independentProjection,
  rawModelProbability: row.rawModelProbability,
  marketProbability: row.marketProbability,
  finalProbability: row.finalProbability,
  publishedPrediction: null,
  grade: row.grade,
  marketMovement: row.marketMovement,
  decisionRelease: row.decisionRelease,
  lockedAt: row.lockedAt,
  actual: 5,
}));
const report = summarizePrivatePlayerPropTracking(settled);
assert.equal(report.exactOfferRows, 4);
assert.equal(report.canonicalMainLineScopes, 1, "two side prices become one prediction scope");
assert.equal(report.offeredAlternateScopes, 1);
assert.deepEqual(report.byMarket.receptions?.cushions["+1"], {
  records: 1, wins: 1, losses: 0, pushes: 0, hitRate: 1,
});
assert.deepEqual(report.byMarket.receptions?.cushions["+2"], {
  records: 1, wins: 1, losses: 0, pushes: 0, hitRate: 1,
});
assert.equal(report.mainLine.marketReader.corrections, 1,
  "published Over corrects the independent Under on the settled main line");
const probabilityOnly = settled.map((row) => ({
  ...row,
  independentProjection: null,
  rawModelProbability: row.side === "over" ? 0.3 : 0.7,
}));
assert.equal(summarizePrivatePlayerPropTracking(probabilityOnly).mainLine.marketReader.corrections, 1,
  "stored independent probability still identifies correction direction when the independent point is unavailable");
assert.equal(favorablePlayerPropLine("over", 4.5, 1), 3.5);
assert.equal(favorablePlayerPropLine("under", 4.5, 1), 5.5);
assert.equal(settlePlayerProp("under", 5.5, 5), "win");

const writer = readFileSync("lib/services/football/nflPlayerPropsProductionWriter.ts", "utf8");
assert.ok(writer.includes("captureNflPlayerPropsPrivateTrackingSafely"));
assert.ok(writer.lastIndexOf("settleNflPlayerPropsRecords") < writer.lastIndexOf("captureNflPlayerPropsPrivateTrackingSafely"),
  "private research capture stays after authoritative settlement");
assert.ok(writer.includes("NFL_PLAYER_PROPS_PRIVATE_TRACKING_CAPTURE_FAILED"));
const mlbWriter = readFileSync("lib/mlb/props/liveBoard.ts", "utf8");
assert.ok(mlbWriter.lastIndexOf("publishMlbPropsBoardSnapshot") < mlbWriter.lastIndexOf("captureMlbPropsPrivateTracking"));
assert.ok(mlbWriter.lastIndexOf("syncInternalMlbPropsTracking") < mlbWriter.lastIndexOf("captureMlbPropsPrivateTracking"));
assert.ok(mlbWriter.includes("sourceOdds,\n    publishedRows: props"),
  "MLB private capture receives the complete provider ladder rather than the compact member rows alone");

const mlbStart = "2026-10-12T23:00:00.000Z";
const mlbEvaluatedAt = "2026-10-12T20:00:00.000Z";
const mlbBase = {
  id: "main-row",
  player: "Batter One",
  team: "NYY",
  opponent: "BOS",
  gameStartTime: mlbStart,
  market: "batter_hits",
  side: "over",
  line: 0.5,
  odds: -120,
  book: "DraftKings",
  projection: 0.8,
  independentProbability: 0.56,
  marketProbability: 0.545,
  finalProbability: 0.55,
  playGrade: "WATCHLIST",
  providerIds: {
    gameId: "mlbstats-game-99",
    bdlGameId: "bdl-game-9",
    bdlPlayerId: 7,
    mlbStatsPlayerId: "mlbstats-player-77",
  },
} as unknown as PlayerPropPreviewRow;
function mlbOffer(line: number, side: "over" | "under", alternate: boolean): PropOddsSnapshot {
  return {
    marketKey: "batter_hits",
    gameId: "bdl-game-9",
    playerId: "balldontlie-player-7",
    sportsbook: "draftkings",
    side,
    line,
    americanOdds: side === "over" ? -120 : 100,
    decimalOdds: side === "over" ? 1.8333 : 2,
    impliedProbability: side === "over" ? 0.5455 : 0.5,
    asOfTimestamp: mlbEvaluatedAt,
    provider: "balldontlie",
    rawPayload: {
      bdl_game_id: "bdl-game-9",
      bdl_player_id: 7,
      is_alternate_line: alternate,
    },
  };
}
const mlbGames = buildMlbPropsPrivateTrackingGames({
  sourceOdds: [mlbOffer(0.5, "over", false), mlbOffer(0.5, "under", false), mlbOffer(1.5, "over", true), mlbOffer(1.5, "under", true)],
  publishedRows: [mlbBase, { ...mlbBase, id: "main-under", side: "under", odds: 100 }],
  evaluatedAt: mlbEvaluatedAt,
  sourceSnapshotId: "snapshot-1",
  modelRelease: "mlb-r1",
});
assert.equal(mlbGames.length, 1);
assert.equal(mlbGames[0]?.rows.length, 4, "MLB private tracking retains actual offered main and alternate prices");
assert.equal(mlbGames[0]?.rows.filter((row) => row.canonicalMainLine).length, 2);
assert.equal(mlbGames[0]?.rows.filter((row) => row.offeredAlternate).length, 2);
assert.deepEqual(
  mlbGames[0]?.rows.filter((row) => row.canonicalMainLine).map((row) => row.publishedPrediction),
  ["over", "over"],
  "the stored main-line ladder retains the published forecast side on both exact offers",
);
assert.deepEqual(
  mlbGames[0]?.rows.filter((row) => row.offeredAlternate).map((row) => row.publishedPrediction),
  [null, null],
  "alternate offers remain measurements and do not inherit a fabricated published prediction",
);
const advancedMlbGames = buildMlbPropsPrivateTrackingGames({
  sourceOdds: [mlbOffer(0.5, "over", false), mlbOffer(0.5, "under", false)],
  publishedRows: [mlbBase],
  evaluatedAt: "2026-10-12T21:00:00.000Z",
  sourceSnapshotId: "snapshot-2",
  modelRelease: "mlb-r1",
});
const mlbMerged = mergeMlbPropsPrivateTrackingGames({ previous: mlbGames, current: advancedMlbGames });
assert.equal(mlbMerged.advanced, 1, "a closer successful pre-lock MLB ladder advances the private candidate");
const afterCutoffMlbGames = buildMlbPropsPrivateTrackingGames({
  sourceOdds: [mlbOffer(0.5, "over", false)],
  publishedRows: [mlbBase],
  evaluatedAt: "2026-10-12T22:30:00.000Z",
  sourceSnapshotId: "snapshot-after-cutoff",
  modelRelease: "mlb-r1",
});
assert.equal(afterCutoffMlbGames.length, 0, "an after-cutoff MLB refresh cannot replace pre-lock private evidence");
const mlbHistory: MlbPropsPrivateTrackingHistory = {
  kind: "mlb_props_private_tracking_history_v1",
  schema: MLB_PROPS_PRIVATE_TRACKING_SCHEMA,
  captureRelease: MLB_PROPS_PRIVATE_TRACKING_RELEASE,
  slateDate: "2026-10-12",
  createdAt: mlbEvaluatedAt,
  updatedAt: mlbEvaluatedAt,
  games: mlbGames,
};
assert.deepEqual(decodeMlbPropsPrivateTrackingHistory(encodeMlbPropsPrivateTrackingHistory(mlbHistory)), mlbHistory);

const reportScript = readFileSync("scripts/operator/report-private-player-props-tracking.ts", "utf8");
assert.ok(reportScript.includes("const { forecasts, ...summary } = diagnostic"));
assert.ok(reportScript.includes("args.includeRows ? { forecasts, exactOfferRows: loaded.rows } : {}"),
  "the default report stays compact while --include-rows exposes both deduplicated forecasts and exact offers");

console.log("private full-board and alternate-line player-props tracking tests passed.");
