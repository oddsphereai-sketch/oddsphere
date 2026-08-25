import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EPL_SHADOW_MODEL_RELEASE, fitEplShadowModel, predictEplMatch, type EplTrainingMatch } from "../lib/services/epl/eplShadowModel";
import { bdlMoneylineRead, canonicalEplLineHistoryTimestamp, compactEplStoredPriceHistory, earliestEplMarketQuote, forecastAnchoredDoubleChanceSide, hydrateEplStoredPriceHistory, trackedPrice } from "../lib/services/epl/buildEplDailyEdgePreview";
import { deriveEplMatchResultDecision, deriveEplPreviewGrade, EPL_PREVIEW_GRADE_RELEASE } from "../lib/services/epl/eplPreviewGrade";
import { calibratedEplGoalProjection, calibratedEplTotalOverProbability, EPL_MATCH_RESULT_SCORE_READER_RELEASE, exactLockedEplScoreOutlook, impliedEplBttsYesProbability, impliedEplGoalsMarketDistribution, impliedEplMatchResultScoreOutlook } from "../lib/services/epl/eplDerivedMarketForecast";
import { eplTeamsMatch, normalizeEplSplits } from "../lib/providers/real_api/SharpApiEplMarketProvider";
import { recentComparableEplMatches } from "../lib/services/epl/eplEvidence";
import { eplSnapshotGamesNeedingLock, preserveLockedEplGames } from "../lib/services/epl/eplLockedSnapshot";
import { eplEmergencySnapshotIsUsable } from "../lib/services/epl/eplMemberSnapshotContinuity";
import { evaluateEplPublicationCoverage } from "../lib/services/epl/eplPublicationReadiness";
import { selectEplDefaultRound } from "../lib/services/epl/eplSlateLifecycle";
import type { DailyEdgeGameDto, DailyEdgeResponse } from "../app/lab/lib/labTypes";

const completeMarket = {
  currentPriceAmerican: -110,
  soccerPriceBoard: { rows: [{}, {}, {}] },
};
const activeCoverage = evaluateEplPublicationCoverage(
  {
    matches: [
      { id: 1, status: "final" },
      { id: 2, status: "scheduled" },
    ],
  } as never,
  {
    games: [
      {
        external_id: "1",
        markets: { moneyline: { currentPriceAmerican: null }, total: { currentPriceAmerican: null }, first_inning: { currentPriceAmerican: null } },
        soccerDoubleChanceMarket: { currentPriceAmerican: null },
      },
      {
        external_id: "2",
        markets: { moneyline: completeMarket, total: { ...completeMarket, soccerPriceBoard: { rows: [{}, {}] } }, first_inning: { ...completeMarket, soccerPriceBoard: { rows: [{}, {}] } } },
        soccerDoubleChanceMarket: completeMarket,
      },
    ],
  } as never,
);
assert.deepEqual(
  activeCoverage,
  { activeFixtures: 1, selectedCurrent: 4, selectedExpected: 4, outcomeCurrent: 10, outcomeExpected: 10, errors: [] },
  "EPL publication coverage must ignore full-time fixtures after sportsbooks remove their prices",
);

const emergencySnapshot = {
  games: [{ gameStartAt: "2026-08-24T19:00:00.000Z" }],
} as DailyEdgeResponse;
assert.equal(
  eplEmergencySnapshotIsUsable(emergencySnapshot, "2026-08-23T14:30:00.000Z", new Date("2026-08-24T14:45:00.000Z")),
  true,
  "a recently expired weekly snapshot remains readable when it contains today's upcoming EPL match",
);
assert.equal(
  eplEmergencySnapshotIsUsable(emergencySnapshot, "2026-08-10T14:30:00.000Z", new Date("2026-08-24T14:45:00.000Z")),
  false,
  "an old EPL snapshot cannot remain visible indefinitely",
);
const roundLifecycleMatches = [
  { id: 1, date: "2026-08-24T19:00:00.000Z", round_number: 2, status_state: "final" },
  { id: 2, date: "2026-08-28T19:00:00.000Z", round_number: 3, status_state: "scheduled" },
] as never;
assert.equal(
  selectEplDefaultRound(roundLifecycleMatches, new Date("2026-08-24T21:00:00.000Z")),
  2,
  "the EPL writer keeps today's completed fixture round selected until board rollover",
);
assert.equal(
  selectEplDefaultRound(roundLifecycleMatches, new Date("2026-08-25T06:00:00.000Z")),
  3,
  "after the 2 a.m. Eastern rollover the EPL writer advances to the next unfinished round",
);

function match(id: number, date: string, home: number, away: number, homeScore: number, awayScore: number, homeXg = homeScore, awayXg = awayScore): EplTrainingMatch {
  return { id, season: 2025, home_team_id: home, away_team_id: away, date, name: `${away} at ${home}`, short_name: `${away} @ ${home}`, status: "STATUS_FULL_TIME", status_state: "final", status_detail: "FT", home_score: homeScore, away_score: awayScore, venue_name: "Test Ground", venue_city: "London", round_number: id, home_xg: homeXg, away_xg: awayXg };
}

const training = [
  match(1, "2025-08-01T14:00:00Z", 1, 2, 3, 0, 2.5, 0.4),
  match(2, "2025-08-08T14:00:00Z", 2, 1, 0, 2, 0.6, 1.8),
  match(3, "2025-08-15T14:00:00Z", 1, 3, 2, 0, 2.0, 0.5),
  match(4, "2025-08-22T14:00:00Z", 3, 1, 1, 2, 0.8, 1.7),
  match(5, "2025-08-29T14:00:00Z", 2, 3, 1, 1, 1.0, 1.1),
  match(6, "2025-09-05T14:00:00Z", 3, 2, 2, 1, 1.6, 0.9),
];

const comparableHistory = recentComparableEplMatches([
  { ...match(90, "2024-05-01T14:00:00Z", 9, 1, 1, 0), season: 2024 },
  match(91, "2025-05-01T14:00:00Z", 9, 1, 2, 0),
  { ...match(92, "2026-08-15T14:00:00Z", 1, 9, 1, 1), season: 2026 },
], 9);
assert.deepEqual(comparableHistory.map((row) => row.id), [92, 91], "reader evidence must exclude stale EPL seasons for returning clubs");

const fit = fitEplShadowModel(training, "2026-01-01T00:00:00Z");
assert.equal(fit.release, EPL_SHADOW_MODEL_RELEASE);
assert.equal(fit.trainingMatches, training.length);
assert.ok(fit.trainedThrough.startsWith("2025-09-05"));

const prediction = predictEplMatch(fit, 1, 2);
const resultSum = prediction.probabilities.home + prediction.probabilities.draw + prediction.probabilities.away;
assert.ok(Math.abs(resultSum - 1) < 1e-9, `1X2 probabilities sum to ${resultSum}`);
assert.ok(Math.abs(prediction.probabilities.over25 + prediction.probabilities.under25 - 1) < 1e-9);
assert.ok(Math.abs(prediction.probabilities.bttsYes + prediction.probabilities.bttsNo - 1) < 1e-9);
assert.ok(prediction.rawDerivedProbabilities.over25 > 0 && prediction.rawDerivedProbabilities.over25 < 1);
assert.ok(prediction.rawDerivedProbabilities.bttsYes > 0 && prediction.rawDerivedProbabilities.bttsYes < 1);
assert.equal(prediction.probabilities.over25 >= 0.5, prediction.rawDerivedProbabilities.over25 >= 0.5, "Total calibration must preserve the score-distribution side");
assert.equal(prediction.probabilities.bttsYes >= 0.5, prediction.rawDerivedProbabilities.bttsYes >= 0.5, "BTTS calibration must preserve the score-distribution side");
assert.ok(prediction.lambdaHome > prediction.lambdaAway, "stronger synthetic home club should project more goals");
assert.ok(Number.isInteger(prediction.likelyScore.home) && Number.isInteger(prediction.likelyScore.away), "modal scoreline must use integer goals");
assert.ok(Number.isInteger(prediction.medianTotal));
assert.ok(Number.isInteger(prediction.mostLikelyTotal));
if (prediction.representativeScore) {
  const representative = prediction.representativeScore;
  const resultSide = prediction.probabilities.home >= prediction.probabilities.draw && prediction.probabilities.home >= prediction.probabilities.away ? "home" : prediction.probabilities.away >= prediction.probabilities.draw ? "away" : "draw";
  assert.equal(resultSide === "home" ? representative.home > representative.away : resultSide === "away" ? representative.away > representative.home : representative.home === representative.away, true);
  assert.equal(representative.home + representative.away > 2.5, prediction.probabilities.over25 >= 0.5);
  assert.equal(representative.home > 0 && representative.away > 0, prediction.probabilities.bttsYes >= 0.5);
}

const outcomeKeys = ["home", "draw", "away", "over", "under", "yes", "no"] as const;
for (const [index, side] of outcomeKeys.entries()) {
  const key = `test:independent-trail:${side}`;
  const first = trackedPrice(key, 100 + index, "testbook", "2026-08-18T12:00:00Z", side === "over" || side === "under" ? 2.5 : null, null, "2026-08-18T12:00:00Z") ?? [];
  const duplicateRender = trackedPrice(key, 100 + index, "testbook", "2026-08-18T12:00:00Z", side === "over" || side === "under" ? 2.5 : null, null, "2026-08-18T12:05:00Z") ?? [];
  const secondObservation = trackedPrice(key, 100 + index, "testbook", "2026-08-18T12:15:00Z", side === "over" || side === "under" ? 2.5 : null, null, "2026-08-18T12:15:00Z") ?? [];
  const realMove = trackedPrice(key, 110 + index, "testbook", "2026-08-18T12:30:00Z", side === "over" || side === "under" ? 2.5 : null, null, "2026-08-18T12:30:00Z") ?? [];
  const flatAfterMove = trackedPrice(key, 110 + index, "testbook", "2026-08-18T12:45:00Z", side === "over" || side === "under" ? 2.5 : null, null, "2026-08-18T12:45:00Z") ?? [];
  assert.equal(first.length, 1, `${side} starts its own trail`);
  assert.equal(duplicateRender.length, 1, `${side} must not manufacture a move from a page render`);
  assert.equal(secondObservation.length, 1, `${side} must not manufacture a move from a provider freshness timestamp`);
  assert.equal(realMove.length, 2, `${side} records a genuine economic quote change`);
  assert.equal(flatAfterMove.length, 2, `${side} must not append or retimestamp a flat quote after a genuine move`);
  assert.equal(flatAfterMove.at(-1)?.observedAt, "2026-08-18T12:30:00Z", `${side} preserves the first timestamp of the current economic quote`);
}
assert.equal(
  canonicalEplLineHistoryTimestamp("2026-08-19T12:10:00.123456789Z"),
  canonicalEplLineHistoryTimestamp("2026-08-19T12:10:00.123456+00:00"),
  "database timestamp normalization must not manufacture duplicate trail stops",
);
const flatSeed = { providerId: 779, market: "match_result" as const, side: "away", line: null, american: 169, sportsbook: "pinnacle", recordedAt: "2026-08-19T13:25:05.767579Z", isOpener: true };
const compactedFlat = compactEplStoredPriceHistory([
  flatSeed,
  { ...flatSeed, recordedAt: "2026-08-19T13:25:05.767579+00:00", isOpener: false },
  { ...flatSeed, recordedAt: "2026-08-19T22:04:22.601Z", isOpener: false },
  { ...flatSeed, recordedAt: "2026-08-19T22:34:22.601Z", isOpener: false },
]);
assert.deepEqual(compactedFlat.map((row) => row.recordedAt), ["2026-08-19T13:25:05.767579Z", "2026-08-19T22:04:22.601Z"], "same-timestamp legacy duplicates count once while a later capture verifies flat");
hydrateEplStoredPriceHistory([{ providerId: 777, market: "match_result", side: "home", line: null, american: -700, sportsbook: "fanduel", recordedAt: "2026-08-18T13:00:00Z", isOpener: false }]);
const restored = trackedPrice("777:match_result:home", -700, "fanduel", "2026-08-18T13:00:00Z", null, null, "2026-08-18T13:05:00Z") ?? [];
assert.equal(restored.length, 1, "a durable flat quote remains one economic observation");
hydrateEplStoredPriceHistory([
  { providerId: 778, market: "match_result", side: "away", line: null, american: 169, sportsbook: "pinnacle", recordedAt: "2026-08-18T13:00:00Z", isOpener: true },
  { providerId: 778, market: "match_result", side: "away", line: null, american: 169, sportsbook: "pinnacle", recordedAt: "2026-08-18T13:30:00Z", isOpener: false },
]);
const verifiedFlat = trackedPrice("778:match_result:away", 169, "pinnacle", null, null, null, "2026-08-18T13:35:00Z") ?? [];
assert.deepEqual(verifiedFlat.map((stop) => stop.american), [169, 169], "two durable same-book captures verify a genuinely flat quote");
assert.deepEqual(verifiedFlat.map((stop) => stop.label), ["first", "current"], "a verified flat trail exposes first and current without inventing movement");
hydrateEplStoredPriceHistory(Array.from({ length: 10 }, (_, index) => ({
  providerId: 780,
  market: "total" as const,
  side: "over",
  line: 2.5,
  american: -170 - index,
  sportsbook: "pinnacle",
  recordedAt: new Date(Date.UTC(2026, 7, 18, 13, index * 5)).toISOString(),
  isOpener: index === 0,
})));
const boundedTotal = trackedPrice("780:total:over:2.5", -179, "pinnacle", null, 2.5, null, "2026-08-18T14:00:00Z") ?? [];
assert.equal(boundedTotal.length, 8, "long soccer trails remain bounded to eight economic observations");
assert.equal(boundedTotal[0]?.label, "first", "the first retained stop remains the bounded trail opening");
assert.equal(boundedTotal[0]?.american, -170, "bounding preserves the actual first captured same-book quote");
assert.equal(boundedTotal.at(-1)?.label, "current", "the latest retained stop remains current after bounding");
const changed = trackedPrice("777:match_result:home", -650, "fanduel", "2026-08-18T14:00:00Z", null, null, "2026-08-18T14:00:00Z") ?? [];
assert.deepEqual(changed.map((stop) => stop.american), [-700, -650], "a later changed quote appends to restored durable history");
const fanduelOnly = trackedPrice("888:match_result:home", -650, "fanduel", null, null, null, "2026-08-18T15:00:00Z") ?? [];
const circaOnly = trackedPrice("888:match_result:home", -600, "circa", null, null, null, "2026-08-18T15:05:00Z") ?? [];
const fanduelRestored = trackedPrice("888:match_result:home", -650, "fanduel", null, null, null, "2026-08-18T15:10:00Z") ?? [];
assert.deepEqual(fanduelOnly.map((stop) => stop.american), [-650]);
assert.deepEqual(circaOnly.map((stop) => stop.american), [-600], "a sportsbook change starts an independent economic trail");
assert.deepEqual(fanduelRestored.map((stop) => stop.american), [-650], "returning to a sportsbook restores only that book's trail");
hydrateEplStoredPriceHistory([
  { providerId: 889, market: "match_result", side: "home", line: null, american: -700, sportsbook: "fanduel", recordedAt: "2026-08-19T13:22:18Z", isOpener: false },
  { providerId: 889, market: "match_result", side: "home", line: null, american: -600, sportsbook: "circa", recordedAt: "2026-08-19T21:07:48Z", isOpener: false },
  { providerId: 889, market: "match_result", side: "home", line: null, american: -555, sportsbook: "circa", recordedAt: "2026-08-21T08:07:37Z", isOpener: false },
]);
assert.deepEqual(
  earliestEplMarketQuote("889:match_result:home"),
  { american: -700, sportsbook: "fanduel", observed_at: "2026-08-19T13:22:18Z" },
  "the earliest cross-book capture remains visible without merging it into the current book's movement trail",
);

const promoted = predictEplMatch(fit, 99, 1);
assert.equal(promoted.homeStrengthSource, "promoted_proxy");
assert.equal(promoted.confidence, "limited");

const chronology = fitEplShadowModel([...training, match(7, "2026-02-01T14:00:00Z", 1, 2, 9, 0, 8, 0)], "2026-01-01T00:00:00Z");
assert.equal(chronology.trainingMatches, training.length, "future results must not enter the fit");
assert.equal(chronology.strengths.get(1)?.homeAttack, fit.strengths.get(1)?.homeAttack);

const missingPrice = deriveEplPreviewGrade({ market: "match_result", edgePp: null, priceAmerican: null, coherentMarket: false, promotedProxy: false });
assert.equal(missingPrice.verdict.label, "No Play");
const candidate = deriveEplPreviewGrade({ market: "match_result", edgePp: 6, priceAmerican: 130, coherentMarket: true, promotedProxy: false });
assert.equal(candidate.candidateTier, "lean_candidate");
assert.equal(candidate.verdict.key, "watchlist", "failed final holdout must cap a Lean candidate at Watchlist");
assert.equal(candidate.release, EPL_PREVIEW_GRADE_RELEASE);
const heavyChalk = deriveEplPreviewGrade({ market: "match_result", edgePp: 5, priceAmerican: -310, coherentMarket: true, promotedProxy: false });
assert.equal(heavyChalk.verdict.label, "No Play");
const totalResearchOnly = deriveEplPreviewGrade({ market: "total", edgePp: 8, priceAmerican: -105, coherentMarket: true, promotedProxy: false });
assert.equal(totalResearchOnly.verdict.label, "No Play");
assert.equal(totalResearchOnly.recommendationScore, 25);
const strongDerivedMonitor = deriveEplPreviewGrade({ market: "btts", modelProbability: 0.61, edgePp: 3, priceAmerican: 115, coherentMarket: true, promotedProxy: false });
assert.equal(strongDerivedMonitor.verdict.label, "Lean", "validated BTTS confidence may surface as an actionable prediction-first Lean");
assert.equal(calibratedEplTotalOverProbability(0.6, 0.52), 0.54);
const impliedBtts = impliedEplBttsYesProbability({ home: 0.68, draw: 0.2, away: 0.12, over: 0.62 });
assert.ok(impliedBtts !== null && impliedBtts > 0 && impliedBtts < 1);
const impliedGoals = impliedEplGoalsMarketDistribution({ home: 0.68, draw: 0.2, away: 0.12, over: 0.62 });
assert.ok(impliedGoals !== null && impliedGoals.homeLambda > impliedGoals.awayLambda);
const publishedGoals = calibratedEplGoalProjection(1.8, 0.9, impliedGoals);
assert.ok(publishedGoals.home > publishedGoals.away, "published goals must retain the fitted favorite direction");
assert.ok(Math.abs(publishedGoals.home - (0.3 * 1.8 + 0.7 * impliedGoals.homeLambda)) < 1e-9, "published goals use the validation-selected 30/70 blend");
const lockedManCityOutlook = impliedEplMatchResultScoreOutlook({ home: 0.661, draw: 0.19, away: 0.149 });
assert.equal(EPL_MATCH_RESULT_SCORE_READER_RELEASE, "epl_match_result_exact_locked_score_2026_08_23_r2");
const exactManCityLock = exactLockedEplScoreOutlook({
  locked: true,
  expectedGoals: { away: 1.0419136028115643, home: 2.322859921925649 },
  likelyScore: { away: 1, home: 2 },
  likelyScoreProbability: 0.09723989573670938,
  medianTotal: 3,
  mostLikelyTotal: 3,
});
assert.deepEqual(exactManCityLock?.expectedGoals, { away: 1.0419136028115643, home: 2.322859921925649 }, "the exact Man City score stored at lock must remain byte-for-byte preferred");
assert.deepEqual(exactManCityLock?.likelyScore, { away: 1, home: 2 });
assert.equal(exactLockedEplScoreOutlook({ locked: false, expectedGoals: { away: 1.04, home: 2.32 }, likelyScore: { away: 1, home: 2 }, likelyScoreProbability: 0.1, medianTotal: 3, mostLikelyTotal: 3 }), null, "unlocked rows cannot enter the immutable legacy-lock path");
assert.ok(lockedManCityOutlook !== null, "locked 1X2 probabilities must recover their own Dixon-Coles score head");
assert.ok(lockedManCityOutlook.expectedGoals.home > lockedManCityOutlook.expectedGoals.away, "recovered Man City score head must agree with the locked home-win forecast");
assert.ok(Math.abs(lockedManCityOutlook.expectedGoals.home - 2.5) < 0.02);
assert.ok(Math.abs(lockedManCityOutlook.expectedGoals.away - 1.145) < 0.02);
assert.ok(lockedManCityOutlook.fitLoss < 0.00005, "reader reconstruction must fail closed unless it closely reproduces the locked 1X2 probabilities");
const lockedNewcastleOutlook = impliedEplMatchResultScoreOutlook({ home: 0.428, draw: 0.233, away: 0.339 });
assert.ok(lockedNewcastleOutlook !== null && lockedNewcastleOutlook.expectedGoals.home > lockedNewcastleOutlook.expectedGoals.away, "legacy reconstruction must preserve Newcastle's locked favorite direction");
const valueBestAngle = deriveEplMatchResultDecision({ model: { home: 0.58, draw: 0.25, away: 0.17 }, market: { home: 0.7, draw: 0.24, away: 0.06 }, prices: { home: -250, draw: 320, away: 1400 }, promotedProxy: false });
assert.equal(valueBestAngle.forecastSide, "home");
assert.equal(valueBestAngle.valueSide, "away", "the price-adjusted value side remains visible as secondary context");
assert.equal(valueBestAngle.selectedSide, "home", "price must never replace the most likely result as the headline prediction");
assert.equal(valueBestAngle.grade.verdict.label, "Lean", "market-aligned forecast confidence may remain actionable even when another side has better price value");
const alignedValueBestAngle = deriveEplMatchResultDecision({ model: { home: 0.58, draw: 0.25, away: 0.17 }, market: { home: 0.5, draw: 0.3, away: 0.2 }, prices: { home: 110, draw: 250, away: 400 }, promotedProxy: false });
assert.equal(alignedValueBestAngle.selectedSide, "home");
assert.equal(alignedValueBestAngle.grade.verdict.label, "Best Angle", "value can promote a forecast only when it supports the predicted outcome");
const drawBestAngle = deriveEplMatchResultDecision({ model: { home: 0.34, draw: 0.38, away: 0.28 }, market: { home: 0.48, draw: 0.3, away: 0.22 }, prices: { home: 115, draw: 275, away: 340 }, promotedProxy: false });
assert.equal(drawBestAngle.forecastSide, "draw");
assert.equal(drawBestAngle.selectedSide, "draw", "draw is a first-class Match Result outcome");
assert.equal(drawBestAngle.grade.verdict.label, "Best Angle");
assert.equal(forecastAnchoredDoubleChanceSide("home", { home: 0.72, draw: 0.19, away: 0.09 }), "home_or_draw", "a home forecast must be covered by home or draw");
assert.equal(forecastAnchoredDoubleChanceSide("away", { home: 0.18, draw: 0.24, away: 0.58 }), "away_or_draw", "an away forecast must be covered by away or draw");
assert.equal(forecastAnchoredDoubleChanceSide("draw", { home: 0.34, draw: 0.38, away: 0.28 }), "home_or_draw", "a draw forecast should pair with the more likely club");
assert.equal(forecastAnchoredDoubleChanceSide("draw", { home: 0.27, draw: 0.4, away: 0.33 }), "away_or_draw", "a draw forecast should pair with the more likely club");
assert.equal(EPL_SHADOW_MODEL_RELEASE, "epl_goals_coherent_2026_08_20_r16");
assert.equal(EPL_PREVIEW_GRADE_RELEASE, "epl_grade_policy_2026_08_20_v21");
const lockedMarkets = { moneyline: { pick: "ARS" }, total: { pick: "Over" }, first_inning: { pick: "No" } } as unknown as DailyEdgeGameDto["markets"];
const refreshedMarkets = { moneyline: { pick: "COV" }, total: { pick: "Under" }, first_inning: { pick: "Yes" } } as unknown as DailyEdgeGameDto["markets"];
const lockedGame = {
  id: "soccer-epl-1",
  external_id: 1,
  lockState: "locked",
  lockedAt: "2026-08-21T18:00:00Z",
  gameStartAt: "2026-08-21T19:00:00Z",
  markets: lockedMarkets,
  projected: { away: 0.6, home: 2.5 },
  soccerProjection: { expectedGoals: { away: 0.6, home: 2.5 } },
  result: null,
} as unknown as DailyEdgeGameDto;
const refreshedGame = {
  ...lockedGame,
  lockState: "locking",
  lockedAt: null,
  gameStartAt: "2026-08-21T19:05:00Z",
  scheduledLockAt: "2026-08-21T18:05:00Z",
  markets: refreshedMarkets,
  projected: { away: 1.4, home: 1.3 },
  soccerProjection: { expectedGoals: { away: 1.4, home: 1.3 } },
  result: { finalScore: { away: 0, home: 3 }, markets: { moneyline: { pickResult: null, gradeUnits: null }, total: { pickResult: null, gradeUnits: null }, first_inning: { pickResult: null, gradeUnits: null } } },
} as unknown as DailyEdgeGameDto;
const responseShell = (games: DailyEdgeGameDto[]) => ({ games } as unknown as DailyEdgeResponse);
const lockSafe = preserveLockedEplGames(responseShell([lockedGame]), responseShell([refreshedGame])).games[0]!;
assert.strictEqual(lockSafe.markets, lockedMarkets, "ordinary refresh cannot replace locked EPL markets or grades");
assert.deepEqual(lockSafe.projected, lockedGame.projected, "ordinary refresh cannot replace the locked projection");
assert.strictEqual(lockSafe.soccerProjection, lockedGame.soccerProjection, "ordinary refresh cannot reinterpret or replace the complete locked soccer projection payload");
assert.equal(lockSafe.lockState, "locked");
assert.equal(lockSafe.lockedAt, lockedGame.lockedAt);
assert.equal(lockSafe.gameStartAt, refreshedGame.gameStartAt, "official fixture metadata may update after lock");
assert.deepEqual(lockSafe.result, refreshedGame.result, "official final score may update outside the frozen betting snapshot");
const finalLockedGame = { ...lockedGame, result: refreshedGame.result } as DailyEdgeGameDto;
const resultSafe = preserveLockedEplGames(responseShell([finalLockedGame]), responseShell([{ ...refreshedGame, result: null }])).games[0]!;
assert.deepEqual(resultSafe.result, refreshedGame.result, "a provider regression cannot clear an already stored final result");
const openGame = { ...refreshedGame, external_id: 2, lockState: "open", lockedAt: null } as DailyEdgeGameDto;
assert.strictEqual(preserveLockedEplGames(responseShell([openGame]), responseShell([{ ...openGame, markets: refreshedMarkets }])).games[0]!.markets, refreshedMarkets, "unlocked games continue updating normally");
const nextRoundGame = { ...openGame, external_id: 3, gameStartAt: "2026-08-28T19:00:00Z" } as DailyEdgeGameDto;
const retainedSameDay = preserveLockedEplGames(
  { ...responseShell([lockedGame]), date: "2026-08-21" },
  { ...responseShell([nextRoundGame]), date: "2026-08-28" },
  new Date("2026-08-21T23:30:00Z"),
);
assert.deepEqual(retainedSameDay.games.map((game) => game.external_id), [1, 3], "a locked EPL game remains ahead of the next round until the soccer day rolls");
assert.equal(retainedSameDay.date, "2026-08-21", "same-day retention keeps the board anchored to today's soccer date");
const rolledSameDay = preserveLockedEplGames(
  { ...responseShell([lockedGame]), date: "2026-08-21" },
  { ...responseShell([nextRoundGame]), date: "2026-08-28" },
  new Date("2026-08-22T06:00:00Z"),
);
assert.deepEqual(rolledSameDay.games.map((game) => game.external_id), [3], "the retained game rolls off at the existing 2 a.m. Eastern boundary");
assert.equal(rolledSameDay.date, "2026-08-28", "after rollover the board resumes the incoming weekly date");
assert.deepEqual(eplSnapshotGamesNeedingLock(responseShell([openGame]), new Date("2026-08-21T18:06:00Z")), [2], "a due member snapshot remains eligible when the database writer locked first");
assert.deepEqual(eplSnapshotGamesNeedingLock(responseShell([lockedGame]), new Date("2026-08-21T18:06:00Z")), [], "a published locked snapshot is terminal and does not trigger repeat provider calls");
const confidenceLean = deriveEplMatchResultDecision({ model: { home: 0.54, draw: 0.27, away: 0.19 }, market: { home: 0.52, draw: 0.27, away: 0.21 }, prices: { home: -120, draw: 270, away: 340 }, promotedProxy: false });
assert.equal(confidenceLean.selectedSide, "home");
assert.equal(confidenceLean.grade.verdict.label, "Lean");
const heavyFavorite = deriveEplMatchResultDecision({ model: { home: 0.75, draw: 0.16, away: 0.09 }, market: { home: 0.78, draw: 0.15, away: 0.07 }, prices: { home: -450, draw: 500, away: 1100 }, promotedProxy: false });
assert.equal(heavyFavorite.grade.verdict.label, "Lean", "a high-confidence winner can be surfaced without masquerading as standalone value");
assert.match(heavyFavorite.grade.reasons.join(" "), /not standalone value/);
const promotedOpponentHeavyFavorite = deriveEplMatchResultDecision({ model: { home: 0.72, draw: 0.18, away: 0.1 }, market: { home: 0.8, draw: 0.13, away: 0.07 }, prices: { home: -625, draw: 650, away: 1400 }, promotedProxy: true });
assert.equal(promotedOpponentHeavyFavorite.grade.verdict.label, "Lean");
assert.match(promotedOpponentHeavyFavorite.grade.reasons.join(" "), /promoted-team proxy/);
const ordinaryHeavyFavorite = deriveEplMatchResultDecision({ model: { home: 0.58, draw: 0.25, away: 0.17 }, market: { home: 0.6, draw: 0.24, away: 0.16 }, prices: { home: -350, draw: 400, away: 800 }, promotedProxy: false });
assert.equal(ordinaryHeavyFavorite.grade.verdict.label, "Watchlist");
assert.equal(eplTeamsMatch("Crystal Palace", "C Palace"), true);
assert.equal(eplTeamsMatch("Tottenham", "Spurs"), true);
const genericSplits = normalizeEplSplits([{ timestamp: "2026-08-18T12:00:00Z", markets: [{ key: "moneyline", outcomes: [{ name: "Arsenal", bet_percent: 70, money_percent: 75 }, { name: "Draw", bet_percent: 20, money_percent: 18 }, { name: "Coventry", bet_percent: 10, money_percent: 7 }] }] }], { home: "Arsenal", away: "Coventry" });
assert.equal(genericSplits[0]?.moneyline?.bets_pct?.draw, 20);
assert.equal(genericSplits[0]?.moneyline?.handle_pct?.home, 75);
const genericBttsSplits = normalizeEplSplits([{ markets: [{ key: "both_teams_to_score", outcomes: [{ name: "Yes", bet_percent: 58, money_percent: 61 }, { name: "No", bet_percent: 42, money_percent: 39 }] }] }], { home: "Arsenal", away: "Coventry" });
assert.equal(genericBttsSplits[0]?.btts?.bets_pct?.yes, 58);
const bdlFallback = bdlMoneylineRead([
  { id: 1, match_id: 10, vendor: "DraftKings", moneyline_home_odds: -200, moneyline_draw_odds: 350, moneyline_away_odds: 550, updated_at: "2026-08-19T12:00:00Z" },
]);
assert.equal(bdlFallback?.provider, "balldontlie");
assert.equal(bdlFallback?.prices.draw, 350);
assert.ok(Math.abs((bdlFallback?.probabilities.home ?? 0) + (bdlFallback?.probabilities.draw ?? 0) + (bdlFallback?.probabilities.away ?? 0) - 1) < 1e-9);
assert.equal(bdlMoneylineRead([{ id: 2, match_id: 10, vendor: "DraftKings", moneyline_home_odds: -200, moneyline_draw_odds: null, moneyline_away_odds: 550, updated_at: null }]), null, "BDL fallback must never mix or infer a missing three-way outcome");

const previewPage = readFileSync("app/dev/premier-league-preview/page.tsx", "utf8");
const previewAdapter = readFileSync("lib/services/epl/buildEplDailyEdgePreview.ts", "utf8");
const eplLineHistoryStore = readFileSync("lib/services/epl/eplLineHistoryStore.ts", "utf8");
const previewReader = readFileSync("app/dev/experience-preview/ActualDailyEdgePreview.tsx", "utf8");
const slateBuilder = readFileSync("lib/services/epl/buildEplShadowSlate.ts", "utf8");
const slateLifecycle = readFileSync("lib/services/epl/eplSlateLifecycle.ts", "utf8");
const sharpProvider = readFileSync("lib/providers/real_api/SharpApiEplMarketProvider.ts", "utf8");
const productionPipeline = readFileSync("lib/services/epl/eplProductionPipeline.ts", "utf8");
const refreshRoute = readFileSync("app/api/cron/epl-daily-refresh/route.ts", "utf8");
const lockRoute = readFileSync("app/api/cron/epl-pregame-lock/route.ts", "utf8");
const memberStore = readFileSync("lib/services/epl/eplMemberSnapshotStore.ts", "utf8");
const publicationReadiness = readFileSync("lib/services/epl/eplPublicationReadiness.ts", "utf8");
const foundationStore = readFileSync("lib/services/epl/eplHistoricalFoundationStore.ts", "utf8");
const candidatePage = readFileSync("app/lab/daily-edge/CandidateDailyEdgePage.tsx", "utf8");
const dailyEdgeSports = readFileSync("app/lab/lib/dailyEdgeSports.ts", "utf8");
const refreshStatusRoute = readFileSync("app/api/lab/refresh-status/route.ts", "utf8");
const vercelConfig = readFileSync("vercel.json", "utf8");
const readerSurfaceSource = previewReader.slice(previewReader.indexOf("function ReaderSurface"), previewReader.indexOf("function ReaderEvidence"));
const quickReadSource = previewReader.slice(previewReader.indexOf("function QuickRead"), previewReader.indexOf("function SoccerTotalForecast"));
assert.match(previewPage, /ProductAppFrame/);
assert.match(previewPage, /ActualDailyEdgePreview/);
assert.doesNotMatch(previewPage, /PremierLeagueShadowBoard/);
assert.match(previewAdapter, /deriveEplPreviewGrade/);
assert.match(previewAdapter, /recommendationConfidence: input\.gradeDecision\.recommendationScore/);
assert.match(previewAdapter, /const operationalOpening = input\.opening\?\.price \?\? sameBookTrail\[0\]\?\.american \?\? input\.price/);
assert.match(previewAdapter, /lineOpenAmerican: operationalOpening/);
assert.match(previewAdapter, /eplTeamLogo/);
assert.match(previewAdapter, /soccerPriceBoard:/);
assert.match(previewAdapter, /soccerAvailability:/);
assert.match(previewAdapter, /goalOutlookProbabilities:/, "EPL snapshots must expose reader-only goal-outlook marginals");
assert.match(previewAdapter, /matchResultOutlook:/, "EPL snapshots must expose the score distribution that actually supplies Match Result probabilities");
assert.doesNotMatch(previewAdapter, /label: "Lineup \/ availability"|label: "Injury report"/, "availability must use the structured reader panel instead of compressed stat rows");
assert.doesNotMatch(previewReader, /Complete price board/, "soccer must reuse the Daily Edge movement module instead of adding a separate price-board design");
assert.match(previewReader, /All outcomes use the same Daily Edge movement timeline/);
assert.match(previewReader, /label: "Opening"/);
assert.match(previewReader, /label: "Prior"/);
assert.doesNotMatch(previewReader, /Provider pending|Provider open|First tracked|First captured|Prior captured/);
assert.match(previewReader, /Consensus and sharp-book split data are unavailable for this market/);
assert.match(previewReader, /Market-informed goal outlook/);
assert.match(previewReader, /Context · separate heads/);
assert.match(previewReader, /Same model · Match Result/);
assert.match(previewReader, /Recovered from Match Result head/);
assert.match(previewReader, /projection\.matchResultOutlook\s*\?\?\s*lockedLegacyScoreOutlook\(game\)\s*\?\?/, "an immutable legacy lock score must win before a probability reconstruction");
assert.match(previewReader, /Exact value stored at lock/);
assert.match(previewReader, /This is the exact score projection stored in the immutable member snapshot at lock/);
assert.match(previewReader, /Snapshot refreshing/);
assert.match(previewReader, /conflicting goals context withheld/);
assert.match(previewReader, /Dedicated Over\/Under probabilities/);
assert.match(previewReader, /Dedicated Yes\/No probabilities/);
assert.doesNotMatch(previewReader, /Team scoring probabilities and BTTS are derived from the same regulation score distribution\./);
for (const nonstandardGrade of ["Research Only", "Market-Aligned", "Price Caution", "Model\/Market Caution"]) {
  assert.doesNotMatch(previewAdapter, new RegExp(nonstandardGrade), `EPL public grade must not include ${nonstandardGrade}`);
}
assert.doesNotMatch(previewAdapter, /epl_splits_pending/);
assert.doesNotMatch(previewAdapter, /supabase|prediction_records|\.upsert\(|\.insert\(/i);
assert.match(eplLineHistoryStore, /HISTORY_PAGE_SIZE/);
assert.match(eplLineHistoryStore, /\.order\("recorded_at", \{ ascending: true \}\)/);
assert.match(eplLineHistoryStore, /\.range\(from, from \+ HISTORY_PAGE_SIZE - 1\)/);
assert.doesNotMatch(eplLineHistoryStore, /\.limit\(12000\)/, "EPL history must not discard an opener behind a newest-N cap");
assert.match(sharpProvider, /query: \{ sport: "soccer", league: SHARP_EPL_LEAGUE, limit: 200 \}/);
assert.match(previewAdapter, /bdlMoneylineRead\(match\.currentMoneylineOdds\)/);
assert.match(sharpProvider, /deltaMinutes > 90/);
assert.match(sharpProvider, /eventsByDate/);
assert.match(sharpProvider, /MAX_FALLBACK_MARKET_CALLS_PER_FIXTURE = 4/);
assert.match(sharpProvider, /let fallbackOddsBudget = MAX_FALLBACK_MARKET_CALLS_PER_FIXTURE/);
assert.match(sharpProvider, /for \(let attempt = 0; attempt < 2; attempt\+\+\)/);
assert.doesNotMatch(sharpProvider, /private fallbackOddsBudget/, "fallback quota must be fixture-scoped so concurrent workers cannot starve later games");
assert.match(sharpProvider, /leagueSplitsPromise/);
assert.match(sharpProvider, /"match_result", "double_chance", "total", "btts"/);
assert.match(sharpProvider, /crystalpalace: \["cpalace", "palace"\]/);
assert.match(sharpProvider, /spurs: \["tottenhamhotspur", "tottenham"\]/);
assert.match(previewAdapter, /Math\.min\(3, slate\.matches\.length\)/);
assert.match(previewAdapter, /5 \* 60_000/);
assert.match(previewAdapter, /MAX_FIXTURE_RECOVERY_LOADS = 4/);
assert.match(previewAdapter, /mergeRecoveredFixture/);
assert.match(previewAdapter, /result: match\.status === "final"/, "completed EPL matches must remain on the weekly slate with a final result");
assert.match(previewReader, /Final ·/, "completed EPL cards must be visibly distinct from upcoming betting cards");
assert.match(slateLifecycle, /match\.status_state !== "final"/, "the default round advances to the next unfinished gameweek only after the soccer-day retention check");
assert.match(slateLifecycle, /currentSoccerBoardDate/, "provider final status cannot advance the EPL board before its member-facing day rolls");
assert.match(previewAdapter, /complete\.size < 4/);
assert.match(slateBuilder, /SLATE_CACHE_TTL_MS = 5 \* 60 \* 1000/);
assert.match(slateBuilder, /completedCurrentMatches/);
assert.match(slateBuilder, /CURRENT_FOUNDATION_CACHE_TTL_MS = 15 \* 60 \* 1000/);
assert.match(productionPipeline, /EPL_EXTERNAL_ID_OFFSET = 20_000_000/);
assert.doesNotMatch(productionPipeline, /EPL_EXTERNAL_ID_OFFSET \+ 1_000_000/, "T-60 discovery must not assume provider fixture IDs fit in a one-million-wide namespace");
assert.match(productionPipeline, /\.eq\("model_version", EPL_SHADOW_MODEL_RELEASE\)[\s\S]{0,100}\.is\("locked_at", null\)/, "T-60 discovery must scope candidates through current EPL release records");
assert.match(productionPipeline, /\.in\("id", gameIds\)/, "T-60 discovery must resolve due fixtures from the release-owned game IDs");
assert.match(productionPipeline, /scheduled_lock_at: lockAt/);
assert.match(productionPipeline, /locked_at: shouldLock \? input\.now\.toISOString\(\) : null/);
assert.match(productionPipeline, /trackedMarket: "match_result"/);
assert.match(productionPipeline, /trackedMarket: "double_chance"/);
assert.match(productionPipeline, /trackedMarket: "total"/);
assert.match(productionPipeline, /trackedMarket: "btts"/);
for (const route of [refreshRoute, lockRoute]) {
  assert.match(route, /leaseGroup: "prediction_pipeline"/);
  assert.match(route, /requireLease: true/);
}
assert.match(refreshRoute, /EPL_PUBLICATION_ENABLED/);
assert.match(refreshRoute, /evaluateEplPublicationCoverage/);
assert.match(publicationReadiness, /selected current-price coverage/);
assert.match(publicationReadiness, /outcome price-board coverage/);
assert.match(publicationReadiness, /match\.status !== "final"/, "completed EPL fixtures must not block publication after books remove their prices");
assert.match(lockRoute, /findEplGamesEnteringLock/);
assert.match(memberStore, /current-week/);
assert.match(memberStore, /readLatestLabResponseSnapshot/, "EPL reads need a bounded emergency fallback when a valid weekly snapshot outlives its cache deadline");
assert.match(memberStore, /epl_member_snapshot_lifecycle_2026_08_24_r2/, "EPL continuity behavior must carry its own immutable lifecycle release");
assert.match(foundationStore, /historical-foundation::through-2025/);
assert.match(slateBuilder, /EPL_FOUNDATION_CACHE_WRITES_ENABLED/);
assert.match(candidatePage, /PREMIER_LEAGUE_DAILY_EDGE_ENABLED/);
assert.match(dailyEdgeSports, /key: "ucl", label: "UCL", memberAvailable: true, inSeason: false/, "UCL must be available with an honest no-games state");
assert.match(previewReader, /weeklySlate \? "30-minute board" : "hourly board"/, "EPL cadence copy must match its production refresh schedule");
assert.match(previewReader, /Choose a soccer competition/, "the new soccer league switcher must explain its navigation level");
assert.match(previewReader, /Viewing ·/, "the active soccer competition must be explicit");
assert.match(previewReader, /Selected ·/, "the selected competition tab must carry a plain-language active state");
assert.match(dailyEdgeSports, /DAILY_EDGE_TOP_LEVEL_SPORT_KEYS/);
assert.match(dailyEdgeSports, /sport !== "ucl"/, "UCL must remain a data key without appearing as a competing top-level sport");
assert.match(previewReader, /sport=soccer&league=ucl/, "Champions League must remain beneath the Soccer route");
assert.match(previewReader, /sport=soccer&league=world-cup/, "World Cup must remain beneath the Soccer route");
assert.match(previewReader, /alt=\{`\$\{item\.label\} logo`\}/, "competition marks must be visible, named content rather than decorative empty slots");
assert.match(previewReader, /unoptimized/, "local SVG competition marks must render directly without image-optimizer ambiguity");
assert.match(previewReader, /Choose a soccer competition/, "the second navigation level must give users a direct instruction");
assert.match(candidatePage, /sourceSport === "ucl" \|\| requestedLeague === "ucl"/, "legacy UCL URLs must normalize beneath Soccer");
assert.match(candidatePage, /const sport: Sport = soccerRequested \? "soccer" : sourceSport/, "every soccer competition must keep the Soccer top-level tab active");
assert.match(previewReader, /function SoccerMarketEvidence/, "soccer must use a dedicated market-specific evidence hierarchy");
assert.doesNotMatch(readerSurfaceSource, /SoccerDecisionSummary/, "the soccer decision summary must not consume a full-width reader row");
assert.match(quickReadSource, /SoccerDecisionSummary/, "the soccer decision summary must fill the Forecast column beneath the projection");
assert.match(previewReader, /Match Result evidence/);
assert.match(previewReader, /Totals evidence/);
assert.match(previewReader, /BTTS evidence/);
assert.match(previewReader, /More supporting stats/, "secondary soccer stats must remain available without crowding the primary reader");
assert.match(previewReader, /function SoccerFormSequence/, "recent form must use a dedicated accessible W-D-L sequence");
assert.match(previewReader, /Newest first/, "recent-form chronology must be explicit");
assert.match(previewReader, /text-emerald-200/);
assert.match(previewReader, /text-amber-200/);
assert.match(previewReader, /text-rose-200/);
assert.match(previewReader, /function SoccerCompoundStat/, "compound soccer stats must not remain an unexplained slash-delimited value");
assert.match(previewReader, /Forecast probabilities remain in the Forecast panel above/, "evidence must explain the forecast instead of duplicating its probability output");
assert.match(refreshStatusRoute, /data_source: "epl_daily_refresh", per_sport: true, cadence_minutes: 30, frontline: true/, "soccer freshness must follow the active EPL writer");
assert.match(vercelConfig, /\/api\/cron\/epl-daily-refresh/);
assert.match(vercelConfig, /\/api\/cron\/epl-pregame-lock/);

console.log("EPL production candidate: all focused tests passed");
