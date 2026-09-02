import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { CfbForwardEvidencePayload } from "../lib/services/football/cfbForwardEvidence";
import {
  buildCfbForwardContextCapture,
  CFB_FORWARD_CONTEXT_CAPTURE_MAX_FAMILIES_PER_MARKET,
  CFB_FORWARD_CONTEXT_CAPTURE_MAX_GAME_BYTES,
  CFB_FORWARD_CONTEXT_CAPTURE_MAX_MARKET_BYTES,
  CFB_FORWARD_CONTEXT_CAPTURE_MAX_PROVENANCE_RECORDS_PER_MARKET,
  cfbForwardContextCaptureAddedBytes,
} from "../lib/services/football/cfbForwardEvidenceCapture";
import type { CfbV1Forecast } from "../lib/services/football/cfbV1Decision";

const capturedAt = "2026-09-01T23:00:00.000Z";
const openedAt = "2026-09-01T12:00:00.000Z";
const sportsbooks = [
  "FanDuel", "Circa", "DraftKings", "BetMGM", "BetRivers", "Caesars",
  "Fanatics", "Hard Rock Bet", "ESPN BET", "bet365", "BetOnline", "Bovada",
];

const forecast: CfbV1Forecast = {
  providerGameId: "cfb-cap-1",
  awayTeam: "UALB",
  homeTeam: "BUF",
  gameStartsAt: "2026-09-02T00:00:00.000Z",
  expectedAwayPoints: 15,
  expectedHomePoints: 35,
  expectedMarginHome: 20,
  expectedTotal: 50,
  homeWinProbability: 1,
  representativeScore: { away: 14, home: 34 },
  interval80: { away: [10, 20], home: [28, 42], marginHome: [10, 30], total: [42, 58] },
  pmf: [
    { away: 14, home: 34, probability: 0.5 },
    { away: 16, home: 36, probability: 0.5 },
  ],
};

function book(sportsbook: string, observedAt: string, index: number) {
  return {
    providerGameId: "cfb-cap-1",
    sportsbook,
    observedAt,
    provider: sportsbook === "Circa" ? "sharpapi" as const : "balldontlie" as const,
    targetEligible: true,
    marketSelection: { moneyline: "main_line" as const, spread: "main_line" as const, total: "main_line" as const },
    marketObservedAt: { moneyline: observedAt, spread: observedAt, total: observedAt },
    moneyline: { awayPrice: 650 + index, homePrice: -900 - index },
    spread: { awayLine: 20.5, awayPrice: -105 - index, homeLine: -20.5, homePrice: -115 + index },
    total: { line: 48.5 + (index % 2) * 0.5, overPrice: -102 - index, underPrice: -118 + index },
  };
}

function decision(market: "moneyline" | "spread" | "total", side: string, line: number | null, price: number) {
  return {
    schemaRelease: "cfb_v1_exact_price_decision_tuple_2026_09_01_r19_coherent_movement_evidence",
    providerGameId: "cfb-cap-1", market, side, grade: "No Play", probabilityGrade: "No Play",
    independentProbability: 0.52, forecastProbability: 0.52, calibratedProbability: 0.52,
    modelProbability: 0.52, pushProbability: 0, marketFairProbability: 0.54,
    edgePercentagePoints: -2, expectedValue: -0.03,
    evaluatedQuote: {
      provider: "balldontlie", sportsbook: "FanDuel", line, price,
      observedAt: capturedAt, marketSelection: "main_line",
    },
    consensus: { source: "target_excluded_same_line_named_books", books: ["Circa", "DraftKings"], fairProbability: 0.53 },
    stage: "t60_locked", evaluatedAt: capturedAt,
    gameStartsAt: "2026-09-02T00:00:00.000Z", lockedAt: capturedAt,
    modelRelease: "cfb_v1_market_sharp_score_model_2026_09_01_r11_coherent_movement_evidence",
    distributionRelease: "cfb_v1_market_sharp_joint_distribution_2026_09_01_r9_coherent_movement_evidence",
    probabilityRelease: "cfb_v1_market_sharp_joint_probability_2026_09_01_r10_coherent_movement_evidence",
    calibrationRelease: "cfb_v1_market_sharp_exact_price_calibration_2026_09_01_r8_coherent_pmf_identity",
    calibrationFamily: "test", policyRelease: "cfb_v1_composite_grade_policy_2026_09_01_r7_coherent_pmf_economics",
    decisionRelease: "cfb_v1_daily_edge_decision_2026_09_01_r26_coherent_movement_evidence",
    gradeAdjustment: null,
  } as const;
}

function payload(gameIndex = 0): CfbForwardEvidencePayload {
  const gameId = `cfb-cap-${gameIndex + 1}`;
  const currentBooks = sportsbooks.map((name, index) => ({ ...book(name, capturedAt, index), providerGameId: gameId }));
  const openingBooks = sportsbooks.map((name, index) => ({ ...book(name, openedAt, index + 2), providerGameId: gameId }));
  const split = {
    provider: "playbook", capturedAt, booksUsed: 12,
    homeMoneyPct: 60, awayMoneyPct: 40, homeBetsPct: 58, awayBetsPct: 42,
    overMoneyPct: 53, underMoneyPct: 47, overBetsPct: 43, underBetsPct: 57,
  } as const;
  const sharp = (sportsbook: "circa" | "draftkings", sourceSemantics: "sharp_adjacent" | "public_recreational") => ({
    release: "cfb_sharpapi_splits_2026_08_30_r2_full_week_capacity" as const,
    providerGameId: gameId, providerEventId: `sharp-${sportsbook}-${gameIndex + 1}`,
    sportsbook, sourceSemantics, capturedAt,
    moneyline: { away: { ticketsPct: 44, moneyPct: 40 }, home: { ticketsPct: 56, moneyPct: 60 } },
    spread: {
      awayLine: 20.5, homeLine: -20.5,
      away: { ticketsPct: 55, moneyPct: 52 }, home: { ticketsPct: 45, moneyPct: 48 },
    },
    total: {
      line: 48.5, over: { ticketsPct: 43, moneyPct: 53 }, under: { ticketsPct: 57, moneyPct: 47 },
    },
  });
  const quarterbacks = (team: string, teamId: number) => ({
    provider: "balldontlie", teamId, team, capturedAt, starterStatus: "projected",
    projectionMethod: "active_roster_previous_season_attempts",
    expectedStartingQuarterback: {
      playerId: `qb-${team}`, name: `${team} Quarterback`, position: "QB", jerseyNumber: "1",
      previousSeasonPassingAttempts: 250, previousSeasonPassingYards: 2500,
    }, activeQuarterbacks: [],
  });
  const decisionForecast = { ...forecast, providerGameId: gameId };
  return {
    schemaRelease: "cfb_forward_evidence_snapshot_2026_09_01_r19_coherent_movement_evidence",
    collectorRelease: "cfb_forward_evidence_collector_2026_09_01_r26_coherent_movement_evidence",
    memberRelease: "cfb_v1_member_release_2026_09_02_r29_total_publication_coherence",
    runId: "capture-test", season: 2026, week: 1, slateGameCount: 87,
    stage: "t60", captureTiming: "on_time", capturedAt, cutoffAt: capturedAt, t60LagMinutes: 0,
    game: {
      providerGameId: gameId, providerWeek: 1, season: 2026,
      scheduledStart: "2026-09-02T00:00:00.000Z", status: "Scheduled", neutralSite: false,
      awayScore: null, homeScore: null,
      away: { id: 1, abbreviation: "UALB", name: "Albany", fbs: false },
      home: { id: 2, abbreviation: "BUF", name: "Buffalo", fbs: true },
    },
    market: {
      current: currentBooks[0]!, currentBooks, displayBooks: currentBooks,
      providerOpening: openingBooks[0]!,
      operationalOpening: { provenance: "provider_opening", capturedAt: openedAt, quote: openingBooks[0]! },
      playbookLine: null, playbookSplits: { moneyline: split, spread: split, total: split },
      sharpApiOddsRelease: null,
      sharpApiSplits: [sharp("draftkings", "public_recreational"), sharp("circa", "sharp_adjacent")],
      sharpApiSplitsStatus: "matched", sharpApiSplitsError: null,
    },
    quarterbacks: { away: quarterbacks("UALB", 1), home: quarterbacks("BUF", 2) },
    availability: {
      injuryStatus: "provider_unavailable", weatherStatus: "forecast_available",
      weather: {
        release: "cfb_kickoff_weather_2026_08_31_r1_exact_venue_game_time",
        venueSource: "playbook", forecastSource: "openweather", venueTeam: "BUF",
        venueName: "UB Stadium", latitude: 43, longitude: -78.8, roofType: "open_air",
        status: "forecast_available", capturedAt, reused: false, forecast: null,
        independentTotalAdjustmentPoints: 0, adjustmentReasons: [],
      },
      note: "Timestamped NCAAF injury reports remain unavailable.",
    },
    decisions: {
      providerGameId: gameId,
      forecast: {
        providerGameId: gameId, awayTeam: "UALB", homeTeam: "BUF",
        gameStartsAt: decisionForecast.gameStartsAt, expectedAwayPoints: 15, expectedHomePoints: 35,
        expectedMarginHome: 20, expectedTotal: 50, homeWinProbability: 1,
        representativeScore: { away: 14, home: 34 }, interval80: decisionForecast.interval80,
      },
      evaluatedBets: [
        decision("moneyline", "BUF", null, -900),
        decision("spread", "UALB +20.5", 20.5, -105),
        decision("total", "Under 48.5", 48.5, -118),
      ],
      heldMarkets: [], publicationEnabled: true, trackingEnabled: true,
      modelRelease: "cfb_v1_market_sharp_score_model_2026_09_01_r11_coherent_movement_evidence",
      decisionRelease: "cfb_v1_daily_edge_decision_2026_09_01_r26_coherent_movement_evidence",
      policyRelease: "cfb_v1_composite_grade_policy_2026_09_01_r7_coherent_pmf_economics",
    },
    independentForecast: null,
    authoritativeForecast: {
      status: "market_sharp_applied", release: "authoritative-release", candidateRelease: "candidate-release",
      marketWeight: 0.75,
    },
    coverage: {
      currentOdds: true, comparableCurrentBookCount: 12, currentOddsProviders: ["balldontlie", "sharpapi"],
      sharpApiOddsFallback: true, targetExcludedConsensusReady: true, operationalOpening: true,
      playbookLine: true, playbookSplits: true, sharpApiSplits: true, activeQuarterbacks: true,
      injuries: false, weather: true, healthHolds: [], availabilityWarnings: ["injury_feed_unavailable"],
    },
    requestBudget: {
      balldontlieSlate: 1, balldontlieQuarterbacks: 1, playbook: 3, sharpApiOdds: 1,
      sharpApiSplits: 1, weather: 1, totalMaximum: 8,
    },
    _openingBooksForTest: openingBooks,
  } as unknown as CfbForwardEvidencePayload;
}

function openingBooksFor(row: CfbForwardEvidencePayload) {
  return (row as unknown as { _openingBooksForTest: ReturnType<typeof book>[] })._openingBooksForTest;
}

const base = payload();
const before = JSON.stringify(base);
const capture = buildCfbForwardContextCapture({
  payload: base, independentForecast: forecast, independentRelease: "pre-market-weekly-artifact",
  authoritativeForecast: forecast, openingBooks: openingBooksFor(base),
});
assert.ok(capture, "valid capture must be retained");
assert.equal(JSON.stringify(base), before, "capture must not mutate the authoritative or locked payload");
assert.equal(capture.authoritative.decisions.find((row) => row.market === "moneyline")?.side, "h");
assert.equal(capture.authoritative.decisions.find((row) => row.market === "spread")?.side, "a");
assert.equal(capture.authoritative.decisions.find((row) => row.market === "total")?.side, "u");

for (const market of Object.values(capture.markets)) {
  assert.equal(market.coverage.completeObserved, sportsbooks.length);
  assert.equal(market.coverage.completeRetained, CFB_FORWARD_CONTEXT_CAPTURE_MAX_FAMILIES_PER_MARKET);
  assert.equal(market.coverage.completeOmitted, sportsbooks.length - CFB_FORWARD_CONTEXT_CAPTURE_MAX_FAMILIES_PER_MARKET);
  assert.equal(market.families.length, CFB_FORWARD_CONTEXT_CAPTURE_MAX_FAMILIES_PER_MARKET);
  assert.equal(market.coverage.chronologyPairsRetained, CFB_FORWARD_CONTEXT_CAPTURE_MAX_FAMILIES_PER_MARKET);
  assert.ok(!market.targetExcludedFamilies.includes("fanduel"), "evaluated family must be target-excluded");
  assert.ok(market.public && market.sharp, "one authentic public and one Circa record are retained");
  assert.equal(market.sharp?.[1], "circa", "Circa wins the bounded sharp provenance slot");
  assert.ok(Number(Boolean(market.public)) + Number(Boolean(market.sharp)) <=
    CFB_FORWARD_CONTEXT_CAPTURE_MAX_PROVENANCE_RECORDS_PER_MARKET);
  assert.ok(market.bytes <= CFB_FORWARD_CONTEXT_CAPTURE_MAX_MARKET_BYTES);
}

const attached = { ...base, contextualEvidenceCapture: capture };
const { contextualEvidenceCapture: stripped, ...strippedPayload } = attached;
assert.ok(stripped);
assert.deepEqual(strippedPayload, base, "stripping the additive field must reproduce the incumbent payload exactly");
const singleAddedBytes = cfbForwardContextCaptureAddedBytes(capture);
assert.ok(singleAddedBytes <= CFB_FORWARD_CONTEXT_CAPTURE_MAX_GAME_BYTES);

const missing = payload();
missing.market.playbookSplits = null;
missing.market.sharpApiSplits = null;
missing.market.currentBooks = [missing.market.current!];
const missingCapture = buildCfbForwardContextCapture({
  payload: missing, independentForecast: forecast, independentRelease: "pre-market-weekly-artifact",
  authoritativeForecast: forecast, openingBooks: openingBooksFor(missing),
});
assert.ok(missingCapture, "missing optional evidence and singleton pricing must not erase capture");
for (const market of Object.values(missingCapture.markets)) {
  assert.equal(market.public, null);
  assert.equal(market.sharp, null);
  assert.equal(market.coverage.targetExcludedObserved, 0);
}
assert.deepEqual(missingCapture.authoritative.decisions, capture.authoritative.decisions,
  "missing evidence must not change the authoritative downstream decisions");

const stress = Array.from({ length: 87 }, (_, index) => {
  const row = payload(index);
  const outcome = { ...forecast, providerGameId: row.game.providerGameId };
  const result = buildCfbForwardContextCapture({
    payload: row, independentForecast: outcome, independentRelease: "pre-market-weekly-artifact",
    authoritativeForecast: outcome, openingBooks: openingBooksFor(row),
  });
  assert.ok(result);
  return { row, result };
});
const baselineSlateBytes = Buffer.byteLength(JSON.stringify(stress.map(({ row }) => row)));
const capturedSlateBytes = Buffer.byteLength(JSON.stringify(stress.map(({ row, result }) => ({
  ...row, contextualEvidenceCapture: result,
}))));
const actualSlateAddedBytes = capturedSlateBytes - baselineSlateBytes;
assert.ok(actualSlateAddedBytes <= 87 * CFB_FORWARD_CONTEXT_CAPTURE_MAX_GAME_BYTES);

const circular: { self?: unknown } = {};
circular.self = circular;
const invalid = payload();
(invalid.availability.weather as unknown as { forecast: unknown }).forecast = circular;
assert.equal(buildCfbForwardContextCapture({
  payload: invalid, independentForecast: forecast, independentRelease: "pre-market-weekly-artifact",
  authoritativeForecast: forecast, openingBooks: openingBooksFor(invalid),
}), null, "capture serialization failure must be isolated as omission");

const helperSource = readFileSync("lib/services/football/cfbForwardEvidenceCapture.ts", "utf8");
assert.doesNotMatch(helperSource, /\b(?:fetch|insert|upsert|delete)\s*\(|\.from\s*\(/,
  "capture helper must not add a query, provider call, or write path");
const writerSource = readFileSync("lib/services/football/cfbForwardEvidenceWriter.ts", "utf8");
assert.equal((writerSource.match(/appendCfbForwardEvidence\s*\(/g) ?? []).length, 1,
  "capture must preserve the sole existing append call");

console.log(JSON.stringify({
  cfbForwardEvidenceCapture: "ok",
  perGameAddedBytes: singleAddedBytes,
  maxMarketBytes: Math.max(...Object.values(capture.markets).map((market) => market.bytes)),
  eightySevenGameActualAddedBytes: actualSlateAddedBytes,
  hourlySlateBytes: actualSlateAddedBytes,
  hourlySlateMiB: actualSlateAddedBytes / 1024 / 1024,
  hourlyDayMiB: actualSlateAddedBytes * 24 / 1024 / 1024,
  sixHourDayMiB: actualSlateAddedBytes * 4 / 1024 / 1024,
}));
