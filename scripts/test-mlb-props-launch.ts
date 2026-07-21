import assert from "node:assert/strict";
import { selectPrimaryPropLines } from "../app/mlb/props/components/PlayerPropsDashboard";
import type { PlayerPropPreviewRow, PlayerPropsDashboardData } from "../app/mlb/props/components/PlayerPropsDashboard";
import {
  decodeMlbPropsBoardSnapshot,
  encodeMlbPropsBoardSnapshot,
  type MlbPropsBoardSnapshot,
} from "../lib/mlb/props/boardSnapshotStore";
import {
  attachMlbPropOddsMovement,
  compareMlbPropsBoardMovement,
  mlbPropsSnapshotIsFresh,
  validateMlbPropsBoardData,
} from "../lib/mlb/props/liveBoard";
import { buildPlayerPropRecentForm } from "../lib/mlb/props/researchEvidence";
import { assessPropPrice } from "../lib/mlb/props/pricePolicy";
import { parseBatterVsPitcherStatsPayload } from "../lib/providers/real_api/_mlbStatsApiClient";
import { evaluateMlbPropsLaunchReadiness } from "../lib/mlb/props/launchReadiness";
import { outsFromInningsPitched, settlePropPick } from "../lib/mlb/props/settlement";
import type { PropOddsSnapshot } from "../lib/mlb/props/providers";
import {
  buildMlbPropsMemberBoardData,
  selectMlbPropsResearchForRows,
} from "../lib/mlb/props/memberPayload";

const asOf = "2026-07-16T16:00:00.000Z";

function row(overrides: Partial<PlayerPropPreviewRow> = {}): PlayerPropPreviewRow {
  return {
    id: "row-1",
    player: "Test Player",
    team: "NYM",
    opponent: "PHI",
    homeAway: "away",
    gameStartTime: "2026-07-16T23:10:00.000Z",
    market: "batter_hits",
    marketLabel: "Batter Hits",
    marketFamily: "batter",
    marketGroup: "Hits/Bases",
    side: "over",
    line: 0.5,
    odds: -115,
    book: "Hard Rock",
    modelProbability: null,
    independentProbability: null,
    marketProbability: 0.51,
    finalProbability: null,
    shrinkageWeight: 0,
    modelEdge: null,
    expectedValue: null,
    fairOdds: null,
    units: 0,
    confidence: 0.7,
    confidenceBucket: "medium",
    playGrade: "RESEARCH",
    source: "live",
    lastUpdated: "2026-07-16T15:55:00.000Z",
    projection: 1.1,
    projectionSource: "recent_form",
    overProbability: null,
    underProbability: null,
    lineupStatus: { status: "posted", battingOrder: 2, position: "SS", source: "BDL", asOfTimestamp: asOf },
    providerIds: { gameId: "mlbstats-game-1", bdlGameId: "10", bdlPropId: "prop-1", bdlPlayerId: 20, mlbStatsPlayerId: "mlbstats-player-30" },
    keyFeatures: ["10 recent games"],
    missingFeatures: [],
    reasonCodes: ["MARKET_RESEARCH_ONLY"],
    oddsSanity: [],
    settlementStatus: "pending",
    clvStatus: "pending",
    ...overrides,
  };
}

function data(props = [row()]): PlayerPropsDashboardData {
  return {
    date: "2026-07-16",
    lastUpdated: asOf,
    slate: {
      practice: false,
      contextStatus: "available",
      matchups: [{
        awayTeam: "NYM",
        homeTeam: "PHI",
        gameStartTime: "2026-07-16T23:10:00.000Z",
        awayProbablePitcher: "Test Player",
        homeProbablePitcher: "Other Pitcher",
        starterStatus: "confirmed",
      }],
    },
    providerStatus: {
      selectedOddsSource: "BDL",
      sharpApi: "fallback",
      bdl: "live",
      publicDisplayEnabled: false,
      paperPersistenceEnabled: false,
      writesToSupabase: true,
    },
    summary: {
      gamesWithProps: 1,
      scoredProps: props.filter((item) => item.finalProbability !== null).length,
      recommendations: 0,
      leans: 0,
      watchlist: 0,
      noPlay: 0,
      pendingData: 0,
      researchOnly: 1,
      booksCovered: 1,
      marketsAvailable: 1,
      averageDataConfidence: 0.7,
    },
    props,
  };
}

function snapshot(props = [row()]): MlbPropsBoardSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: "snapshot-1",
    slateDate: "2026-07-16",
    asOfTimestamp: asOf,
    refreshMode: "full",
    data: data(props),
    validation: {
      publishable: true,
      actionableRows: 0,
      researchRows: props.length,
      mappedRows: props.length,
      sourceRows: props.length,
      staleOddsRows: 0,
      errors: [],
      warnings: [],
    },
    movement: { comparedWith: null, changedPrices: 0, changedLines: 0, addedRows: props.length, removedRows: 0 },
  };
}

const valid = validateMlbPropsBoardData({ data: data(), sourceRows: 1, mappedRows: 1, asOfTimestamp: asOf });
assert.equal(valid.publishable, true, "research-only rows can publish without fake model confidence");

const payloadEvidence = {
  recentForm: null,
  opponentProfile: null,
  pitchArsenal: null,
  pitchMatchup: null,
  matchupHistory: null,
  environment: null,
};
const payloadData = data([{ ...row(), researchKey: "research-1" }]);
payloadData.research = { "research-1": payloadEvidence };
const memberPayload = buildMlbPropsMemberBoardData(payloadData);
assert.deepEqual(memberPayload.props, payloadData.props, "member payload preserves every price, projection, grade, and row field");
assert.deepEqual(memberPayload.summary, payloadData.summary, "member payload preserves board summaries");
assert.equal(memberPayload.research, undefined, "member payload defers only the research dictionary");
assert.deepEqual(
  selectMlbPropsResearchForRows(payloadData, payloadData.props),
  { "research-1": payloadEvidence },
  "player research endpoint returns the exact deferred evidence",
);

const staleResearch = validateMlbPropsBoardData({
  data: data([row({ lastUpdated: "2026-07-16T14:00:00.000Z", oddsSanity: ["STALE_ODDS"] })]),
  sourceRows: 1,
  mappedRows: 1,
  asOfTimestamp: asOf,
});
assert.equal(staleResearch.publishable, false, "stale research rows cannot enter a published snapshot");
assert.ok(staleResearch.errors.includes("STALE_ODDS_PRESENT"));

const staleAction = row({
  playGrade: "LEAN",
  finalProbability: 0.6,
  modelProbability: 0.62,
  modelEdge: 0.09,
  expectedValue: 0.08,
  fairOdds: -150,
  lastUpdated: "2026-07-16T14:00:00.000Z",
  oddsSanity: ["STALE_ODDS"],
});
const blocked = validateMlbPropsBoardData({ data: data([staleAction]), sourceRows: 1, mappedRows: 1, asOfTimestamp: asOf });
assert.equal(blocked.publishable, false, "an actionable stale row must fail the snapshot gate");
assert.ok(blocked.errors.includes("ACTIONABLE_ROWS_FAILED_DATA_GATE"));

const extremePrice = assessPropPrice(-3000);
assert.equal(extremePrice.displayEligible, true, "a conventional extreme price remains available for research");
assert.equal(extremePrice.signalEligible, false, "an extreme price cannot become a positive signal");
assert.equal(extremePrice.band, "extreme_short");
assert.ok(Math.abs((extremePrice.impliedProbability ?? 0) - 0.9677419) < 0.000001);
const extremeAction = row({ playGrade: "LEAN", odds: -3000, finalProbability: 0.98, modelProbability: 0.98, modelEdge: 0.01, expectedValue: 0.01 });
const extremeBlocked = validateMlbPropsBoardData({ data: data([extremeAction]), sourceRows: 1, mappedRows: 1, asOfTimestamp: asOf });
assert.equal(extremeBlocked.publishable, false, "an extreme price cannot be published with an actionable grade");

const mappingFailure = validateMlbPropsBoardData({ data: data(), sourceRows: 20, mappedRows: 10, asOfTimestamp: asOf });
assert.equal(mappingFailure.publishable, false, "low game mapping coverage must fail closed");

const previous = snapshot();
const moved = compareMlbPropsBoardMovement(previous, [row({ line: 1.5, odds: 105 })]);
assert.equal(moved.changedLines, 1);
assert.equal(moved.changedPrices, 1);
assert.equal(moved.addedRows, 0);

const rotatedProviderQuote = compareMlbPropsBoardMovement(previous, [row({
  providerIds: {
    gameId: "mlbstats-game-1",
    bdlGameId: "10",
    bdlPropId: "replacement-provider-quote-id",
    bdlPlayerId: 20,
    mlbStatsPlayerId: "mlbstats-player-30",
  },
})]);
assert.deepEqual(rotatedProviderQuote, {
  comparedWith: "snapshot-1",
  changedPrices: 0,
  changedLines: 0,
  addedRows: 0,
  removedRows: 0,
}, "refresh-scoped provider quote IDs do not create false row turnover");

const rotatedQuoteWithMarketMove = compareMlbPropsBoardMovement(previous, [row({
  book: "FanDuel",
  line: 1.5,
  odds: 105,
  providerIds: {
    gameId: "mlbstats-game-1",
    bdlGameId: "10",
    bdlPropId: "replacement-provider-quote-id",
    bdlPlayerId: 20,
    mlbStatsPlayerId: "mlbstats-player-30",
  },
})]);
assert.equal(rotatedQuoteWithMarketMove.changedLines, 1);
assert.equal(rotatedQuoteWithMarketMove.changedPrices, 1);
assert.equal(rotatedQuoteWithMarketMove.addedRows, 0);
assert.equal(rotatedQuoteWithMarketMove.removedRows, 0);

const openingQuote: PropOddsSnapshot = {
  marketKey: "batter_hits",
  gameId: "balldontlie-game-10",
  playerId: "balldontlie-player-20",
  sportsbook: "hardrock",
  side: "over",
  line: 0.5,
  americanOdds: 105,
  decimalOdds: 2.05,
  impliedProbability: 0.487805,
  asOfTimestamp: "2026-07-16T12:00:00.000Z",
  snapshotRole: "opening",
  provider: "balldontlie",
  rawPayload: { bdl_game_id: "10", bdl_player_id: "20" },
};
const withOpeningMovement = attachMlbPropOddsMovement([row({ odds: -115 })], [openingQuote], null)[0];
assert.equal(withOpeningMovement.oddsMovement?.openingOdds, 105);
assert.equal(withOpeningMovement.oddsMovement?.currentOdds, -115);
assert.equal(withOpeningMovement.oddsMovement?.openingSource, "balldontlie_opening");
assert.equal(withOpeningMovement.oddsMovement?.hasMoved, true);

const previousMovement = snapshot([row({
  oddsMovement: {
    openingLine: 0.5,
    openingOdds: 105,
    openingTimestamp: "2026-07-16T12:00:00.000Z",
    openingSource: "balldontlie_opening",
    previousLine: 0.5,
    previousOdds: -110,
    previousTimestamp: "2026-07-16T15:30:00.000Z",
    currentLine: 0.5,
    currentOdds: -115,
    currentTimestamp: "2026-07-16T15:55:00.000Z",
    lineDelta: 0,
    impliedProbabilityDelta: 0.0474,
    hasMoved: true,
  },
})]);
const inheritedAcrossProviderRotation = attachMlbPropOddsMovement([row({
  book: "FanDuel",
  line: 1.5,
  odds: -120,
  providerIds: {
    gameId: "mlbstats-game-1",
    bdlGameId: "10",
    bdlPropId: "replacement-provider-quote-id",
    bdlPlayerId: 20,
    mlbStatsPlayerId: "mlbstats-player-30",
  },
})], [], previousMovement)[0];
assert.equal(inheritedAcrossProviderRotation.oddsMovement?.openingLine, 0.5);
assert.equal(inheritedAcrossProviderRotation.oddsMovement?.openingOdds, 105);
assert.equal(inheritedAcrossProviderRotation.oddsMovement?.previousLine, 0.5);
assert.equal(inheritedAcrossProviderRotation.oddsMovement?.previousOdds, -115);
assert.equal(inheritedAcrossProviderRotation.oddsMovement?.currentLine, 1.5);
assert.equal(inheritedAcrossProviderRotation.oddsMovement?.currentOdds, -120);

const primaryLines = selectPrimaryPropLines([
  row({ id: "main-over-dk", line: 0.5, side: "over", book: "DraftKings", odds: -115 }),
  row({ id: "main-under-dk", line: 0.5, side: "under", book: "DraftKings", odds: -105 }),
  row({ id: "main-over-fd", line: 0.5, side: "over", book: "FanDuel", odds: -110 }),
  row({ id: "alt-over-fd", line: 1.5, side: "over", book: "FanDuel", odds: 230 }),
]);
assert.equal(primaryLines.length, 3, "main-line selection hides thin alternate ladders by default");
assert.ok(primaryLines.every((item) => item.line === 0.5));

const encoded = encodeMlbPropsBoardSnapshot(previous);
assert.deepEqual(decodeMlbPropsBoardSnapshot(encoded), previous, "snapshot compression must round-trip");
assert.equal(decodeMlbPropsBoardSnapshot({ ...encoded, checksum: "bad" }), null, "checksum mismatch must fail closed");
assert.equal(mlbPropsSnapshotIsFresh(previous, new Date("2026-07-16T16:10:00.000Z")), true);
assert.equal(mlbPropsSnapshotIsFresh(previous, new Date("2026-07-16T17:00:00.000Z")), false);

const sameDayForm = buildPlayerPropRecentForm({
  marketKey: "batter_hits",
  asOfTimestamp: asOf,
  logs: [
    { gameId: "final-game", playerId: "p", teamId: "t", opponentTeamId: "o", gameDate: "2026-07-16", stats: { hits: 2 }, provider: "test", asOfTimestamp: "2026-07-16T15:59:59.999Z" },
    { gameId: "not-final", playerId: "p", teamId: "t", opponentTeamId: "o", gameDate: "2026-07-16", stats: { hits: 4 }, provider: "test" },
  ],
});
assert.deepEqual(sameDayForm?.logs.map((log) => log.gameId), ["final-game"], "only explicitly completed same-day logs may enter research");

const matchup = parseBatterVsPitcherStatsPayload({
  stats: [{
    type: { displayName: "vsPlayerTotal" },
    splits: [{
      stat: { gamesPlayed: 2, plateAppearances: 6, atBats: 5, hits: 0, homeRuns: 0, baseOnBalls: 1, strikeOuts: 0, avg: ".000", obp: ".167", slg: ".000", ops: ".167", numberOfPitches: 23 },
      batter: { id: 656941, fullName: "Kyle Schwarber" },
      pitcher: { id: 690997, fullName: "Nolan McLean" },
    }],
  }],
}, 656941, 690997);
assert.equal(matchup?.plate_appearances, 6);
assert.equal(matchup?.pitcher_name, "Nolan McLean");
const noMatchup = parseBatterVsPitcherStatsPayload({ stats: [{ type: { displayName: "vsPlayerTotal" }, splits: [] }] }, 1, 2);
assert.equal(noMatchup?.plate_appearances, 0, "a verified empty response is distinct from a provider failure");

const trackingHealth = {
  enabled: true,
  settlementEnabled: true,
  tableAvailable: true,
  totalEntries: 0,
  pendingEntries: 0,
  settledEntries: 0,
  actionableEntries: 0,
  latestLockedAt: null,
  latestSettlementRun: null,
  error: null,
};
const modeledPitcherRow = row({
  market: "pitcher_strikeouts",
  marketLabel: "Pitcher Strikeouts",
  marketFamily: "pitcher",
  marketGroup: "Pitcher Strikeouts",
  playGrade: "WATCHLIST",
  finalProbability: 0.58,
  modelProbability: 0.6,
  independentProbability: 0.6,
  modelEdge: 0.07,
  expectedValue: 0.04,
  fairOdds: -138,
  reasonCodes: [],
  recentForm: {
    statLabel: "Strikeouts",
    sampleLabel: "starts",
    source: "MLB Stats",
    asOfTimestamp: asOf,
    coverage: "full_season",
    logs: Array.from({ length: 5 }, (_, index) => ({
      gameId: `game-log-${index}`,
      date: `2026-07-${String(10 - index).padStart(2, "0")}`,
      opponent: "ATL",
      homeAway: "home" as const,
      value: 6,
    })),
  },
  environment: {
    venue: "Citizens Bank Park",
    roofStatus: "outdoor",
    source: "MLB Stats + Baseball Savant + NWS",
    park: { status: "available", runFactor: 104, homeRunFactor: 115, strikeoutFactor: 104, source: "Baseball Savant" },
    weather: { status: "available", temperatureF: 84, conditions: "Clear", windSpeedMph: 6, windDirection: "W", precipitationProbability: 0, source: "NWS" },
    asOfTimestamp: asOf,
    researchOnly: true,
  },
});
const researchOnlyPitcherAltLine = row({
  ...modeledPitcherRow,
  id: "research-only-alt-pitcher-line",
  line: 7.5,
  odds: 310,
  playGrade: "RESEARCH",
  finalProbability: null,
  modelProbability: null,
  independentProbability: null,
  modelEdge: null,
  expectedValue: null,
  fairOdds: null,
  reasonCodes: ["MARKET_RESEARCH_ONLY"],
});
const launchSnapshot = snapshot([modeledPitcherRow, researchOnlyPitcherAltLine]);
const launchSnapshots = [
  { ...launchSnapshot, snapshotId: "snapshot-3", asOfTimestamp: "2026-07-16T16:00:00.000Z" },
  { ...launchSnapshot, snapshotId: "snapshot-2", asOfTimestamp: "2026-07-16T15:50:00.000Z" },
  { ...launchSnapshot, snapshotId: "snapshot-1", asOfTimestamp: "2026-07-16T15:40:00.000Z" },
];
const launchReady = evaluateMlbPropsLaunchReadiness({
  slateDate: "2026-07-16",
  snapshots: launchSnapshots,
  tracking: trackingHealth,
  now: new Date("2026-07-16T16:10:00.000Z"),
  env: {
    ...process.env,
    MLB_PLAYER_PROPS_CRON_ENABLED: "true",
    ODDSPHERE_PROPS_INTERNAL_TRACKING_ENABLED: "true",
    MLB_PLAYER_PROPS_SETTLEMENT_CRON_ENABLED: "true",
    ODDSPHERE_PROPS_DISPLAY_ENABLED: "false",
    ODDSPHERE_PROPS_PUBLIC_API_ENABLED: "false",
    ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED: "false",
  },
});
assert.equal(launchReady.readyToOpen, true, "three valid snapshots plus private tracking satisfy the launch gate");
const trackingBlocked = evaluateMlbPropsLaunchReadiness({
  slateDate: "2026-07-16",
  snapshots: launchSnapshots,
  tracking: { ...trackingHealth, tableAvailable: false },
  now: new Date("2026-07-16T16:10:00.000Z"),
  env: {
    ...process.env,
    MLB_PLAYER_PROPS_CRON_ENABLED: "true",
    ODDSPHERE_PROPS_INTERNAL_TRACKING_ENABLED: "true",
    MLB_PLAYER_PROPS_SETTLEMENT_CRON_ENABLED: "true",
  },
});
assert.equal(trackingBlocked.readyToOpen, false, "launch fails closed when the private ledger is unavailable");
assert.ok(trackingBlocked.blockers.includes("TRACKING_TABLE_AVAILABLE"));

const plusMoneyWin = settlePropPick({
  marketKey: "pitcher_strikeouts",
  playerId: "p",
  gameId: "g",
  line: 5.5,
  side: "over",
  finalStats: { strikeouts: 7 },
  stakeUnits: 0.5,
  americanOdds: 150,
});
assert.deepEqual(plusMoneyWin, { status: "settled", result: "win", resultValue: 7, units: 0.75 }, "settlement uses the locked price instead of flat +1 units");
const favoriteWin = settlePropPick({
  marketKey: "pitcher_outs",
  playerId: "p",
  gameId: "g",
  line: 17.5,
  side: "over",
  finalStats: { outs: 18 },
  stakeUnits: 1,
  americanOdds: -200,
});
assert.deepEqual(favoriteWin, { status: "settled", result: "win", resultValue: 18, units: 0.5 });
assert.equal(outsFromInningsPitched(5 + 2 / 3), 17, "parsed true-decimal innings convert to outs without treating .667 as seven outs");

console.log("MLB props launch tests passed");
