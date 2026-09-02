import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { NflForwardEvidencePayload } from "../lib/services/football/nflForwardEvidence";
import {
  buildNflForwardContextCapture,
  NFL_FORWARD_CONTEXT_CAPTURE_MAX_FAMILIES_PER_MARKET,
  NFL_FORWARD_CONTEXT_CAPTURE_MAX_GAME_BYTES,
  NFL_FORWARD_CONTEXT_CAPTURE_MAX_MARKET_BYTES,
  NFL_FORWARD_CONTEXT_CAPTURE_MAX_PROVENANCE_RECORDS_PER_MARKET,
  nflForwardContextCaptureAddedBytes,
} from "../lib/services/football/nflForwardEvidenceCapture";
import type { NflV1WeekOneOutcomeForecast } from "../lib/services/football/nflV1WeekOneOutcome";

const capturedAt = "2026-09-09T20:00:00.000Z";
const openedAt = "2026-09-09T12:00:00.000Z";
const sportsbooks = [
  "FanDuel", "Circa", "DraftKings", "BetMGM", "BetRivers", "Caesars",
  "Fanatics", "Hard Rock Bet", "ESPN BET", "bet365", "BetOnline", "Bovada",
];

const forecast: NflV1WeekOneOutcomeForecast = {
  providerGameId: "nfl-cap-1",
  awayTeam: "NE",
  homeTeam: "SEA",
  expectedAwayScore: 21.75,
  expectedHomeScore: 23.25,
  representativeAwayScore: 21,
  representativeHomeScore: 24,
  representativeScoreProbability: 0.1,
  awayWinProbability: 0.25,
  homeWinProbability: 0.75,
  tieProbability: 0,
  marginDistribution: { values: [-3, 3], probabilities: [0.25, 0.75] },
  totalDistribution: { values: [43, 47], probabilities: [0.5, 0.5] },
  sourceExpectedAwayScore: 21.75,
  sourceExpectedHomeScore: 23.25,
};

function book(sportsbook: string, observedAt: string, index: number) {
  return {
    providerGameId: "nfl-cap-1",
    sportsbook,
    observedAt,
    moneyline: { awayPrice: 155 + index, homePrice: -180 - index },
    spread: { awayLine: 3.5, awayPrice: -105 - index, homeLine: -3.5, homePrice: -115 + index },
    total: { line: 44.5 + (index % 2) * 0.5, overPrice: -108 - index, underPrice: -112 + index },
  };
}

function decision(market: "moneyline" | "spread" | "total", side: string, line: number | null, price: number) {
  return {
    schemaRelease: "nfl_regular_evaluated_decision_tuple_2026_08_21_r2",
    decisionKind: "exact_price_bet",
    providerGameId: "nfl-cap-1",
    market,
    side,
    modelProbability: 0.52,
    marketFairProbability: 0.54,
    evaluatedQuote: { sportsbook: "FanDuel", line, price, observedAt: capturedAt },
    expectedValue: -0.03,
    grade: "No Play",
    stage: "t60_locked",
    evaluatedAt: capturedAt,
    gameStartsAt: "2026-09-09T21:00:00.000Z",
    modelRelease: "model-release",
    calibrationRelease: "calibration-release",
    decisionRelease: "decision-release",
    lockedAt: capturedAt,
  } as const;
}

function payload(gameIndex = 0): NflForwardEvidencePayload {
  const currentBooks = sportsbooks.map((name, index) => book(name, capturedAt, index));
  const openingBooks = sportsbooks.map((name, index) => book(name, openedAt, index + 2));
  const split = {
    provider: "playbook", capturedAt, booksUsed: 12,
    homeMoneyPct: 77, awayMoneyPct: 23, homeBetsPct: 76, awayBetsPct: 24,
    overMoneyPct: 53, underMoneyPct: 47, overBetsPct: 43, underBetsPct: 57,
  } as const;
  const sharp = {
    provider: "sharpapi", providerGameId: `nfl-cap-${gameIndex + 1}`,
    sourceEventId: `sharp-${gameIndex + 1}`, sourceSportsbook: "Circa", capturedAt,
    providerFetchedAt: capturedAt, homeMoneyPct: 55, awayMoneyPct: 45,
    homeBetsPct: 49, awayBetsPct: 51, overMoneyPct: 48, underMoneyPct: 52,
    overBetsPct: 55, underBetsPct: 45,
  } as const;
  const depth = (team: string) => ({
    provider: "balldontlie", team, capturedAt, sourceSnapshotId: `depth-${team}`,
    starterStatus: "confirmed", expectedStartingQuarterback: {
      playerId: `qb-${team}`, name: `${team} Quarterback`, position: "QB", depth: "QB1",
      depthRank: 1, injuryStatus: null, explicitStarter: true,
    }, quarterbackDepth: [], roster: [],
  });
  const gameId = `nfl-cap-${gameIndex + 1}`;
  return {
    schemaRelease: "nfl_forward_evidence_snapshot_2026_09_01_r6_forecast_value_separation",
    collectorRelease: "nfl_forward_evidence_collector_2026_09_01_r6_forecast_value_separation",
    runId: "capture-test", season: 2026, week: 1, slateGameCount: 16,
    stage: "t60", captureTiming: "on_time", capturedAt, cutoffAt: capturedAt, t60LagMinutes: 0,
    game: {
      providerGameId: gameId, providerWeek: 1, season: 2026,
      scheduledStart: "2026-09-09T21:00:00.000Z", status: "Scheduled",
      away: { id: 1, abbreviation: "NE", name: "New England Patriots" },
      home: { id: 2, abbreviation: "SEA", name: "Seattle Seahawks" },
    },
    market: {
      current: currentBooks[0]!, currentBooks, comparableCurrentBooks: currentBooks,
      providerOpening: openingBooks[0]!, providerOpeningBooks: openingBooks,
      comparableProviderOpeningBooks: openingBooks,
      operationalOpening: { provenance: "provider_opening", capturedAt: openedAt, quote: openingBooks[0]! },
      playbookLine: null, playbookSplits: { moneyline: split, spread: split, total: split },
      sharpApiSplits: { moneyline: sharp, spread: sharp, total: sharp },
    },
    startersAndDepth: { away: depth("NE"), home: depth("SEA") },
    injuries: {
      eventId: gameId, awayTeam: "NE", homeTeam: "SEA", source: "BALLDONTLIE",
      sourceLabel: "BALLDONTLIE NFL injuries", sourceUrl: null, reportUpdatedAt: capturedAt,
      teams: [
        { abbreviation: "NE", teamName: "New England Patriots", players: [] },
        { abbreviation: "SEA", teamName: "Seattle Seahawks", players: [] },
      ],
    },
    weather: {
      venueTeam: "SEA", venueName: "Lumen Field", roofType: "outdoor",
      status: "forecast_available", capturedAt, forecast: null,
    },
    outcomeForecast: { ...forecast, providerGameId: gameId },
    decisions: {
      evaluatedBets: [
        decision("moneyline", "SEA", null, -180),
        decision("spread", "NE +3.5", 3.5, -105),
        decision("total", "Under 44.5", 44.5, -112),
      ],
      outcomeConfidence: [], modelPromotionStatus: "nfl_v1_member_release_2026_09_01_r11_forecast_value_separation",
      publicationEnabled: true, trackingEnabled: true,
    },
    coverage: {
      currentOdds: true, currentBookCount: 12, comparableCurrentBookCount: 12,
      multibookConsensusReady: true, operationalOpening: true, rosterAndDepth: true,
      expectedQuarterbacks: true, injuries: true, playbookSplits: true,
      sharpApiSplits: true, weather: true, healthHolds: [],
    },
    requestBudget: {
      balldontlieSlate: 1, balldontlieRoster: 1, balldontlieInjuriesMaximum: 4,
      playbook: 2, sharpApi: 1, weather: 1, totalMaximum: 10,
    },
  } as unknown as NflForwardEvidencePayload;
}

const base = payload();
const before = JSON.stringify(base);
const capture = buildNflForwardContextCapture({
  payload: base, independentForecast: forecast, independentTargetFree: true,
  independentRelease: "target-free-artifact", authoritativeForecast: forecast,
});
assert.ok(capture, "valid capture must be retained");
assert.equal(JSON.stringify(base), before, "capture must not mutate the authoritative or locked payload");
assert.deepEqual({ ...base, contextualEvidenceCapture: undefined }, { ...base, contextualEvidenceCapture: undefined });
assert.equal(capture.authoritative.decisions.find((row) => row.market === "moneyline")?.side, "h");
assert.equal(capture.authoritative.decisions.find((row) => row.market === "spread")?.side, "a");
assert.equal(capture.authoritative.decisions.find((row) => row.market === "total")?.side, "u");

for (const market of Object.values(capture.markets)) {
  assert.equal(market.coverage.completeObserved, sportsbooks.length);
  assert.equal(market.coverage.completeRetained, NFL_FORWARD_CONTEXT_CAPTURE_MAX_FAMILIES_PER_MARKET);
  assert.equal(market.coverage.completeOmitted, sportsbooks.length - NFL_FORWARD_CONTEXT_CAPTURE_MAX_FAMILIES_PER_MARKET);
  assert.equal(market.families.length, NFL_FORWARD_CONTEXT_CAPTURE_MAX_FAMILIES_PER_MARKET);
  assert.equal(market.coverage.chronologyPairsRetained, NFL_FORWARD_CONTEXT_CAPTURE_MAX_FAMILIES_PER_MARKET);
  assert.ok(!market.targetExcludedFamilies.includes("fanduel"), "evaluated family must be target-excluded");
  assert.ok(market.public && market.sharp, "one authentic public and one authentic sharp record are retained");
  assert.ok(Number(Boolean(market.public)) + Number(Boolean(market.sharp)) <=
    NFL_FORWARD_CONTEXT_CAPTURE_MAX_PROVENANCE_RECORDS_PER_MARKET);
  assert.ok(market.bytes <= NFL_FORWARD_CONTEXT_CAPTURE_MAX_MARKET_BYTES);
}

const attached = { ...base, contextualEvidenceCapture: capture };
const { contextualEvidenceCapture: stripped, ...strippedPayload } = attached;
assert.ok(stripped);
assert.deepEqual(strippedPayload, base, "stripping the additive field must reproduce the incumbent payload exactly");
const singleAddedBytes = nflForwardContextCaptureAddedBytes(capture);
assert.ok(singleAddedBytes <= NFL_FORWARD_CONTEXT_CAPTURE_MAX_GAME_BYTES);

const missing = payload();
missing.market.playbookSplits = null;
missing.market.sharpApiSplits = null;
missing.market.comparableCurrentBooks = [missing.market.current];
const missingCapture = buildNflForwardContextCapture({
  payload: missing, independentForecast: forecast, independentTargetFree: false,
  independentRelease: "weekly-market-fallback", authoritativeForecast: forecast,
});
assert.ok(missingCapture, "missing optional evidence and singleton pricing must not erase capture");
assert.equal(missingCapture.prior.status, "unavailable");
for (const market of Object.values(missingCapture.markets)) {
  assert.equal(market.public, null);
  assert.equal(market.sharp, null);
  assert.equal(market.coverage.targetExcludedObserved, 0);
}
assert.deepEqual(missingCapture.authoritative.decisions, capture.authoritative.decisions,
  "missing evidence must not change the authoritative downstream decisions");

const stress = Array.from({ length: 16 }, (_, index) => {
  const row = payload(index);
  const outcome = { ...forecast, providerGameId: row.game.providerGameId };
  const result = buildNflForwardContextCapture({
    payload: row, independentForecast: outcome, independentTargetFree: true,
    independentRelease: "target-free-artifact", authoritativeForecast: outcome,
  });
  assert.ok(result);
  return { row, result };
});
const baselineSlateBytes = Buffer.byteLength(JSON.stringify(stress.map(({ row }) => row)));
const capturedSlateBytes = Buffer.byteLength(JSON.stringify(stress.map(({ row, result }) => ({
  ...row, contextualEvidenceCapture: result,
}))));
const actualSlateAddedBytes = capturedSlateBytes - baselineSlateBytes;
assert.ok(actualSlateAddedBytes <= 16 * NFL_FORWARD_CONTEXT_CAPTURE_MAX_GAME_BYTES);

const circular: { self?: unknown } = {};
circular.self = circular;
const invalid = payload();
(invalid.weather as unknown as { forecast: unknown }).forecast = circular;
assert.equal(buildNflForwardContextCapture({
  payload: invalid, independentForecast: forecast, independentTargetFree: true,
  independentRelease: "target-free-artifact", authoritativeForecast: forecast,
}), null, "capture serialization failure must be isolated as omission");

const helperSource = readFileSync("lib/services/football/nflForwardEvidenceCapture.ts", "utf8");
assert.doesNotMatch(helperSource, /\b(?:fetch|insert|upsert|delete)\s*\(|\.from\s*\(/,
  "capture helper must not add a query, provider call, or write path");
const writerSource = readFileSync("lib/services/football/nflForwardEvidenceWriter.ts", "utf8");
assert.equal((writerSource.match(/appendNflForwardEvidence\s*\(/g) ?? []).length, 1,
  "capture must preserve the sole existing append call");

console.log(JSON.stringify({
  nflForwardEvidenceCapture: "ok",
  perGameAddedBytes: singleAddedBytes,
  maxMarketBytes: Math.max(...Object.values(capture.markets).map((market) => market.bytes)),
  sixteenGameActualAddedBytes: actualSlateAddedBytes,
  hourlySlateBytes: actualSlateAddedBytes,
  hourlySlateMiB: actualSlateAddedBytes / 1024 / 1024,
  hourlyDayMiB: actualSlateAddedBytes * 24 / 1024 / 1024,
  sixHourDayMiB: actualSlateAddedBytes * 4 / 1024 / 1024,
}));
