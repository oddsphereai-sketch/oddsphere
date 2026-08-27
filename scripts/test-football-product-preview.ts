import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildFootballPreviewFixture,
  resolveNflPreviewWeek,
} from "../app/dev/football-preview/footballPreviewFixture";
import {
  BALLDONTLIE_NFL_PREVIEW_SLATE_RELEASE,
  __BALLDONTLIE_NFL_PREVIEW_SLATE_TEST__,
  providerWeekForNflPreseason,
  type NflPreviewProviderSlate,
} from "../lib/services/football/balldontlieNflPreviewSlate";
import {
  NFL_LOCAL_SHADOW_FEATURE_RELEASE,
  NFL_LOCAL_SHADOW_MODEL_RELEASE,
  type NflLocalShadowSlate,
} from "../lib/services/football/nflLocalShadowSlate";
import { footballTrackingEligibility } from "../lib/services/football/footballTrackingPolicy";
import {
  deriveNflPreseasonShadowGrade,
  NFL_PRESEASON_SHADOW_GRADE_RELEASE,
} from "../lib/services/football/nflPreseasonShadowGrade";
import { auditNflSharpBrainCard } from "../lib/services/football/nflSharpBrainContract";
import {
  deriveNflPreseasonDryRunDecision,
  NFL_PRESEASON_DRY_RUN_DECISION_RELEASE,
  selectNflPreseasonDryRunActions,
} from "../lib/services/football/nflPreseasonDryRunDecision";
import {
  deriveNflRegularDecision,
  NFL_REGULAR_DECISION_RELEASE,
} from "../lib/services/football/nflRegularDecision";

const pageSource = readFileSync("app/dev/football-preview/page.tsx", "utf8");
const memberPageSource = readFileSync("app/lab/daily-edge/CandidateDailyEdgePage.tsx", "utf8");
const fixtureSource = readFileSync("app/dev/football-preview/footballPreviewFixture.ts", "utf8");
const readerSource = readFileSync("app/dev/experience-preview/ActualDailyEdgePreview.tsx", "utf8");
const localSlateSource = readFileSync("lib/services/football/nflLocalShadowSlate.ts", "utf8");
const regularSlateSource = readFileSync("lib/services/football/nflRegularLocalSlate.ts", "utf8");
const regularScorerSource = readFileSync("scripts/operator/score_current_nfl_regular.py", "utf8");
const trackingRegistryTest = readFileSync("scripts/test-official-tracking-markets.ts", "utf8");

assert.match(pageSource, /process\.env\.NODE_ENV === "production"/);
assert.match(pageSource, /readCurrentNflWeekOneHeldMemberFixture/);
assert.match(memberPageSource, /enrichCachedNflFootballEvidence/, "cached NFL member snapshots must receive the same presentation-only evidence contract");
assert.match(pageSource, /No fallback or fabricated slate is shown/);
assert.match(pageSource, /activePreviewSports=\{\["nfl"\]\}/);
assert.match(pageSource, /same append-only evidence used by the member candidate/);
assert.match(pageSource, /live predictions and exact-price Bet grades/);
assert.match(pageSource, /48 predictions|games\.length \* 3/);
assert.doesNotMatch(pageSource, /evidence:/, "football preview must not insert a custom evidence wall above the shared reader");
assert.doesNotMatch(pageSource, /fetchBalldontlieNflPreviewSlate/);
assert.doesNotMatch(pageSource, /query\.phase|query\.week/);
assert.doesNotMatch(pageSource, /loadNflRegularPipelinePreseasonSlate|loadNflPreseasonLocalSlate/);
assert.match(pageSource, /dynamic = "force-dynamic"/);
assert.doesNotMatch(pageSource, /buildFootballPreviewFixture\(\s*sport/);
assert.match(localSlateSource, /nfl_preseason_current_provider_inputs_2026_08_19_r2/);
assert.match(localSlateSource, /nfl_preseason_real_current_snapshot_2026_08_19_r2/);
assert.match(localSlateSource, /scored\.providerInputSha256 !== providerInputSha256/);
assert.match(localSlateSource, /Object\.keys\(input\.availability\)\.length !== input\.slate\.games\.length/);
assert.match(regularSlateSource, /nfl_regular_pipeline_preseason_rehearsal_snapshot_2026_08_20_r1/);
assert.match(regularSlateSource, /scored\.rosterInputSha256 !== rosterManifest\.sha256/);
assert.match(regularSlateSource, /loadNflRegularPipelinePreseasonSlate/);
assert.match(regularSlateSource, /loadStoredPreseasonPriceHistory/);
assert.match(regularSlateSource, /price-history checksum mismatch/);
assert.match(regularScorerSource, /--phase/);
assert.match(regularScorerSource, /regular_pipeline_preseason_rehearsal/);
assert.match(regularScorerSource, /preseason_permanently_excluded/);
assert.equal((regularScorerSource.match(/def predict_recipe\(/g) ?? []).length, 1, "preseason and regular scoring must share one model implementation");

assert.equal(providerWeekForNflPreseason(1), 2);
assert.equal(providerWeekForNflPreseason(2), 3);
assert.equal(providerWeekForNflPreseason(3), 4);
assert.equal(resolveNflPreviewWeek(2).label, "Preseason Week 2");
assert.equal(resolveNflPreviewWeek(2).startDate, "2026-08-20");

const normalizedGame = __BALLDONTLIE_NFL_PREVIEW_SLATE_TEST__.normalizeGame({
  id: 1393564,
  season: 2026,
  week: 3,
  date: "2026-08-21T00:00:00.000Z",
  status_state: "pre",
  visitor_team: { id: 17, abbreviation: "LV", full_name: "Las Vegas Raiders" },
  home_team: { id: 11, abbreviation: "HOU", full_name: "Houston Texans" },
});
assert.deepEqual(normalizedGame, {
  providerGameId: "1393564",
  providerWeek: 3,
  season: 2026,
  scheduledStart: "2026-08-21T00:00:00.000Z",
  status: "pre",
  away: { id: 17, abbreviation: "LV", name: "Las Vegas Raiders" },
  home: { id: 11, abbreviation: "HOU", name: "Houston Texans" },
});

const normalizedOdds = __BALLDONTLIE_NFL_PREVIEW_SLATE_TEST__.normalizeOdds({
  game_id: 1393564,
  vendor: "fanduel",
  moneyline_home_odds: -102,
  moneyline_away_odds: -116,
  spread_home_value: 1.5,
  spread_home_odds: -110,
  spread_away_value: -1.5,
  spread_away_odds: -110,
  total_value: 37.5,
  total_over_odds: -115,
  total_under_odds: -105,
  updated_at: "2026-08-19T17:53:00.000Z",
});
assert.equal(normalizedOdds?.sportsbook, "fanduel");
assert.equal(normalizedOdds?.spread?.homeLine, 1.5);
assert.equal(normalizedOdds?.total?.line, 37.5);

const providerSlate: NflPreviewProviderSlate = {
  release: BALLDONTLIE_NFL_PREVIEW_SLATE_RELEASE,
  fetchedAt: "2026-08-19T18:00:00.000Z",
  season: 2026,
  productWeek: 2,
  providerWeek: 3,
  games: [normalizedGame!],
  currentOddsByGame: { "1393564": normalizedOdds! },
  openingOddsByGame: {},
  providerRequests: 4,
};
const shadowSlate: NflLocalShadowSlate = {
  modelRelease: NFL_LOCAL_SHADOW_MODEL_RELEASE,
  featureRelease: NFL_LOCAL_SHADOW_FEATURE_RELEASE,
  source: "BALLDONTLIE preseason outcomes + nflverse play-by-play/team state",
  sourceChecksum: "test-checksum",
  sourceFetchedAt: "2026-08-19T13:30:11.274Z",
  generatedAt: providerSlate.fetchedAt,
  history: {
    LV: [{ date: "2025-12-28", opponent: "KC", runsFor: 20, runsAgainst: 17, totalRuns: 37, firstInningRuns: null, won: true }],
    HOU: [{ date: "2025-12-28", opponent: "IND", runsFor: 24, runsAgainst: 14, totalRuns: 38, firstInningRuns: null, won: true }],
  },
  projectionsByGame: {
    "1393564": {
      providerGameId: "1393564",
      release: NFL_LOCAL_SHADOW_MODEL_RELEASE,
      featureRelease: NFL_LOCAL_SHADOW_FEATURE_RELEASE,
      generatedAt: providerSlate.fetchedAt,
      trainedThrough: "2025-12-28T17:00:00.000Z",
      projectedHomeMargin: 2,
      projectedTotal: 41,
      projectedHomeScore: 21.5,
      projectedAwayScore: 19.5,
      homeWinProbability: 0.56,
      homeCoverProbability: 0.58,
      overProbability: 0.57,
      marginStdDev: 15,
      totalStdDev: 12,
      homeRecent: { games: 10, wins: 6, losses: 4, ties: 0, averagePointsFor: 23, averagePointsAgainst: 20, averageMargin: 3, averageGameTotal: 43 },
      awayRecent: { games: 10, wins: 4, losses: 6, ties: 0, averagePointsFor: 19, averagePointsAgainst: 23, averageMargin: -4, averageGameTotal: 42 },
      dataHealthFindings: ["preseason_participation_not_modeled"],
      actionable: false,
    },
  },
  validation: {
    selectionSeasons: [2022, 2023, 2024],
    holdoutSeason: 2025,
    holdoutGames: 49,
    holdoutMarginMae: 10.3235,
    holdoutTotalMae: 10.3842,
    holdoutHomeWinBrier: 0.2645,
    passedPredictiveGate: false,
  },
  localOnly: true,
  actionable: false,
};

const fixture = buildFootballPreviewFixture({ providerSlate, shadowSlate, availability: {} });
assert.equal(fixture.week.week, 2);
assert.equal(fixture.week.providerWeek, 3);
assert.equal(fixture.snapshot.games.length, 1);
assert.equal(fixture.snapshot.games[0]?.awayTeam, "LV");
assert.equal(fixture.snapshot.games[0]?.homeTeam, "HOU");
assert.equal(fixture.snapshot.games[0]?.gameTime, "8:00 PM");
assert.equal(fixture.snapshot.games[0]?.external_id, 1393564);
assert.equal(fixture.tracking.trackingEligible, false);
assert.equal(fixture.provenance.openingCoverageGames, 0);
assert.equal(fixture.provenance.firstObservedCoverageGames, 0);
assert.equal(fixture.provenance.minimumStoredPriceObservations, 0);
assert.equal(fixture.provenance.decisionRelease, NFL_PRESEASON_SHADOW_GRADE_RELEASE);
assert.equal(fixture.snapshot.games[0]!.markets.moneyline.verdict.key, "caution");
assert.equal(fixture.snapshot.games[0]!.markets.total.verdict.key, "watchlist");
assert.equal(fixture.snapshot.games[0]!.markets.first_inning.verdict.key, "caution");
assert.equal(fixture.snapshot.games[0]!.breakdown.verdict.key, "watchlist");
for (const market of Object.values(fixture.snapshot.games[0]!.markets)) {
  assert.equal(market.grade, "model_only");
  assert.deepEqual(market.publicSplits, []);
  assert.equal(market.recommendationDecision?.consensusSplits, null);
  assert.equal(market.recommendationDecision?.sharpBookSplits, null);
  assert.equal(market.oddsTrail?.length, 1);
  assert.equal(market.oddsTrail?.[0]?.source, "current_line");
  assert.equal(market.oddsTrail?.[0]?.sportsbook, "fanduel");
  assert.equal(market.recommendationDecision?.reasonCodes.includes("PRESEASON_NOT_TRACKED"), true);
  assert.equal(market.recommendationDecision?.reasonCodes.includes("SHADOW_GRADE_ONLY"), true);
}

const fixtureWithHistory = buildFootballPreviewFixture({
  providerSlate,
  shadowSlate,
  availability: {},
  priceHistoryByGame: {
    "1393564": [
      { ...normalizedOdds!, observedAt: "2026-08-19T16:53:00.000Z" },
      normalizedOdds!,
    ],
  },
});
assert.equal(fixtureWithHistory.provenance.firstObservedCoverageGames, 1);
assert.equal(fixtureWithHistory.provenance.minimumStoredPriceObservations, 2);
for (const market of Object.values(fixtureWithHistory.snapshot.games[0]!.markets)) {
  assert.equal(market.oddsTrail?.length, 2);
  assert.equal(market.oddsTrail?.[0]?.source, "line_history");
  assert.equal(market.oddsTrail?.[0]?.label, "first");
  assert.equal(market.oddsTrail?.[1]?.source, "current_line");
  assert.equal(market.recommendationDecision?.reasonCodes.includes("FIRST_OBSERVED_HISTORY_CAPTURED"), true);
}

assert.equal(deriveNflPreseasonShadowGrade({ market: "total", modelProbability: 0.58, marketProbability: 0.5, priceAmerican: -110 }).verdict.key, "watchlist");
assert.equal(deriveNflPreseasonShadowGrade({ market: "spread", modelProbability: 0.58, marketProbability: 0.5, priceAmerican: -110 }).verdict.key, "caution");
assert.equal(deriveNflPreseasonShadowGrade({ market: "moneyline", modelProbability: 0.51, marketProbability: 0.49, priceAmerican: -105 }).verdict.key, "no_play");
assert.equal(deriveNflPreseasonShadowGrade({ market: "total", modelProbability: 0.72, marketProbability: 0.5, priceAmerican: -110 }).verdict.key, "caution");
assert.notEqual(deriveNflPreseasonShadowGrade({ market: "total", modelProbability: 0.8, marketProbability: 0.5, priceAmerican: 100 }).verdict.key, "lean");
assert.equal(deriveNflPreseasonShadowGrade({ market: "spread", modelFamily: "regular_candidate", modelProbability: 0.57, marketProbability: 0.52, priceAmerican: -110 }).verdict.key, "watchlist");
assert.equal(deriveNflPreseasonShadowGrade({ market: "spread", modelFamily: "regular_candidate", modelProbability: 0.64, marketProbability: 0.52, priceAmerican: -110 }).verdict.key, "watchlist");
assert.notEqual(deriveNflPreseasonShadowGrade({ market: "moneyline", modelFamily: "regular_candidate", modelProbability: 0.7, marketProbability: 0.5, priceAmerican: 100 }).verdict.key, "lean");

const dryRunCandidate = deriveNflPreseasonDryRunDecision({
  market: "spread",
  coreModelProbability: 0.65,
  phaseComparisonProbability: 0.60,
  marketFairProbability: 0.50,
  priceAmerican: 100,
  verifiedPriceObservations: 3,
  availabilitySnapshotPresent: true,
});
assert.equal(dryRunCandidate.decisionProbability, 0.535);
assert.equal(dryRunCandidate.exactEvPct, 7);
assert.equal(dryRunCandidate.eligibleForWeeklyAction, true);
assert.equal(dryRunCandidate.verdict, "watchlist");
const dryRunDisagreement = deriveNflPreseasonDryRunDecision({
  market: "total",
  coreModelProbability: 0.65,
  phaseComparisonProbability: 0.45,
  marketFairProbability: 0.50,
  priceAmerican: -110,
  verifiedPriceObservations: 3,
  availabilitySnapshotPresent: true,
});
assert.equal(dryRunDisagreement.eligibleForWeeklyAction, false);
assert.equal(dryRunDisagreement.verdict, "no_play");
assert.deepEqual([...selectNflPreseasonDryRunActions([
  { gameId: "g1", market: "spread", exactEvPct: 9, eligible: true },
  { gameId: "g1", market: "moneyline", exactEvPct: 8, eligible: true },
  { gameId: "g2", market: "moneyline", exactEvPct: 7, eligible: true },
  { gameId: "g3", market: "total", exactEvPct: 6, eligible: true },
  { gameId: "g4", market: "spread", exactEvPct: 5, eligible: true },
  { gameId: "g5", market: "moneyline", exactEvPct: 4, eligible: true },
  { gameId: "g6", market: "total", exactEvPct: 3, eligible: true },
])], ["g1:spread", "g2:moneyline", "g3:total", "g4:spread", "g5:moneyline"]);
assert.match(NFL_PRESEASON_DRY_RUN_DECISION_RELEASE, /preseason_dry_run_decision_2026_08_20_r3/);

assert.deepEqual(footballTrackingEligibility({ seasonPhase: "preseason", modelApproved: true, officialRegistryLaunched: true, predictionLocked: true }), {
  eligible: false,
  reason: "preseason_excluded",
  appendToExistingLifetime: false,
});
assert.deepEqual(footballTrackingEligibility({ seasonPhase: "regular", modelApproved: true, officialRegistryLaunched: true, predictionLocked: true }), {
  eligible: true,
  reason: "eligible_regular_or_postseason",
  appendToExistingLifetime: true,
});
assert.deepEqual(footballTrackingEligibility({ seasonPhase: "regular", modelApproved: false, officialRegistryLaunched: false, predictionLocked: false }), {
  eligible: false,
  reason: "model_not_approved",
  appendToExistingLifetime: false,
});
const regularZeroActionAudit = auditNflSharpBrainCard({
  seasonPhase: "regular",
  gameIds: ["game-1"],
  rows: (["moneyline", "spread", "total"] as const).map((market) => ({
    gameId: "game-1",
    market,
    verdict: "watchlist" as const,
    modelProbability: 0.54,
    priceAmerican: -110,
    positiveExpectedValueAtLockedPrice: null,
    priceLockedBeforeKickoff: true,
    projectionRelease: "projection-r1",
    calibrationRelease: "calibration-r1",
    decisionRelease: "decision-r1",
  })),
});
assert.equal(regularZeroActionAudit.ready, false);
assert.equal(regularZeroActionAudit.predictionCount, 3);
assert.deepEqual(regularZeroActionAudit.failures, ["regular_week_has_no_action"]);
const regularActionAudit = auditNflSharpBrainCard({
  seasonPhase: "regular",
  gameIds: ["game-1"],
  rows: (["moneyline", "spread", "total"] as const).map((market) => ({
    gameId: "game-1",
    market,
    verdict: market === "spread" ? "lean" as const : "watchlist" as const,
    modelProbability: 0.56,
    priceAmerican: -110,
    positiveExpectedValueAtLockedPrice: market === "spread" ? true : null,
    priceLockedBeforeKickoff: true,
    projectionRelease: "projection-r1",
    calibrationRelease: "calibration-r1",
    decisionRelease: "decision-r1",
  })),
});
assert.equal(regularActionAudit.ready, true);
assert.equal(regularActionAudit.actionableCount, 1);
assert.match(trackingRegistryTest, /NFL tracks moneyline, total, and spread from the 2026 regular season/);

const regularWatchlist = deriveNflRegularDecision({
  market: "total",
  modelProbability: 0.53,
  marketFairProbability: 0.515,
  priceAmerican: -115,
  verifiedPriceObservations: 2,
  availabilitySnapshotPresent: true,
  weatherSnapshotPresent: false,
  priceObservedAt: "2026-08-20T17:00:00.000Z",
  evaluatedAt: "2026-08-20T17:05:00.000Z",
});
assert.equal(regularWatchlist.verdict.key, "watchlist");
assert.equal(regularWatchlist.actionable, false);
assert.equal(regularWatchlist.actionEvidenceComplete, false);
assert.match(regularWatchlist.reasons.join(" "), /weather snapshot/i);
const regularLean = deriveNflRegularDecision({
  market: "spread",
  modelProbability: 0.55,
  marketFairProbability: 0.53,
  priceAmerican: -118,
  verifiedPriceObservations: 3,
  availabilitySnapshotPresent: true,
  weatherSnapshotPresent: false,
  priceObservedAt: "2026-08-20T17:00:00.000Z",
  evaluatedAt: "2026-08-20T17:05:00.000Z",
});
assert.equal(regularLean.verdict.key, "lean");
assert.equal(regularLean.actionable, true);
assert.equal(regularLean.exactEvPct > 1.5, true);
assert.equal(regularLean.actionEvidenceComplete, true);
const totalWithoutWeather = deriveNflRegularDecision({
  market: "total",
  modelProbability: 0.55,
  marketFairProbability: 0.53,
  priceAmerican: -118,
  verifiedPriceObservations: 3,
  availabilitySnapshotPresent: true,
  weatherSnapshotPresent: false,
  priceObservedAt: "2026-08-20T17:00:00.000Z",
  evaluatedAt: "2026-08-20T17:05:00.000Z",
});
assert.equal(totalWithoutWeather.verdict.key, "watchlist");
assert.equal(totalWithoutWeather.actionable, false);
const totalWithWeather = deriveNflRegularDecision({
  market: "total",
  modelProbability: 0.55,
  marketFairProbability: 0.53,
  priceAmerican: -118,
  verifiedPriceObservations: 3,
  availabilitySnapshotPresent: true,
  weatherSnapshotPresent: true,
  priceObservedAt: "2026-08-20T17:00:00.000Z",
  evaluatedAt: "2026-08-20T17:05:00.000Z",
});
assert.equal(totalWithWeather.verdict.key, "lean");
assert.equal(totalWithWeather.actionable, true);
const staleRegular = deriveNflRegularDecision({
  market: "moneyline",
  modelProbability: 0.60,
  marketFairProbability: 0.50,
  priceAmerican: 100,
  verifiedPriceObservations: 3,
  availabilitySnapshotPresent: true,
  weatherSnapshotPresent: false,
  priceObservedAt: "2026-08-20T08:00:00.000Z",
  evaluatedAt: "2026-08-20T17:05:00.000Z",
});
assert.equal(staleRegular.verdict.key, "no_play");
assert.equal(staleRegular.evidenceComplete, false);
assert.match(NFL_REGULAR_DECISION_RELEASE, /nfl_regular_price_value_decision_shadow_2026_08_20_r2/);

for (const forbidden of [
  "NFL_AVAILABILITY_SAMPLES",
  "openingPriceFromCurrent",
  "splitRows(",
  "Pinnacle",
  "Array.from({ length: 4 }",
]) {
  assert.equal(fixtureSource.includes(forbidden), false, `football product fixture must not contain ${forbidden}`);
}
assert.match(fixtureSource, /consensusSplitRows/);
assert.match(fixtureSource, /PUBLIC_CONSENSUS_SPLITS_CAPTURED_CONTEXT_ONLY/);
assert.match(fixtureSource, /sharpBookSplits: null/);
assert.match(readerSource, /easternDateKey\(game\.gameStartAt\)/);
assert.match(readerSource, /Counts show games containing at least one market with each grade/);
assert.match(readerSource, /a game can appear in more than one grade/);
assert.match(readerSource, /marketsInScope\(\)/);
assert.match(readerSource, /openingLabel: "Opening"/);
assert.match(readerSource, /In preseason, expected participation and coach-managed rest must be verified separately/);

console.log("Football product preview: provider-backed Week 1 prediction/grade reader plus legacy model and tracking boundaries passed");
