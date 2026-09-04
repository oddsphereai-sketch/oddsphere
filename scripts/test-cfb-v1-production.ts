import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isPublicallyTracked } from "../lib/config/officialTrackingStart";
import { buildCfbMemberFixture as buildCfbMemberFixtureAtTime, selectLatestCfbMemberEvidenceRows } from "../lib/services/football/cfbMemberFixture";
import { cfbTeamIdentity } from "../lib/services/football/cfbTeamIdentity";
import { finalizeDailyEdgeResponseCoherence } from "../app/lab/lib/dailyEdgeResponseCoherence";
import { dailyEdgeOutcomeForecastLabel } from "../app/lab/lib/dailyEdgeOutcomeForecast";
import {
  CFB_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_IDENTITY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_IDENTITY_PREVIOUS_MEMBER_RELEASE,
  CFB_FORWARD_AMBIGUOUS_SCOPE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_CANONICAL_DISCOVERY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_INITIAL_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_LEGACY_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MARKET_SHARP_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_PROVIDER_DISCOVERY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_PRIOR_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_TRANSITION_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MEMBER_RELEASE,
  CFB_FORWARD_PUBLICATION_PREVIOUS_MEMBER_RELEASE,
  buildCfbForwardMarketOutlooks,
  determineCfbForwardCollectionNeed,
  hashCfbForwardEvidencePayload,
  matchesCfbForwardEvidencePayloadHash,
  planCfbForwardEvidenceCaptures,
  type CfbForwardEvidencePayload,
  type CfbForwardStoredEvidence,
} from "../lib/services/football/cfbForwardEvidence";
import { CFB_FORWARD_EVIDENCE_MAX_ROWS, CFB_FORWARD_EVIDENCE_PAGE_SIZE, readCfbForwardEvidence } from "../lib/services/football/cfbForwardEvidenceStore";
import { normalizeCfbPlaybookLine, normalizeCfbPlaybookSplits } from "../lib/services/football/cfbPlaybookEvidence";
import {
  cfbMarketAnchorHealthHolds,
  cfbLockPlanningEvidence,
  cfbTrackingPayloadsForRun,
  publishCfbForwardDecisionBundle,
  trustedCfbSharpEventIdsByGame,
} from "../lib/services/football/cfbForwardEvidenceWriter";
import { resolveCfbCanonicalMarketAnchor } from "../lib/services/football/cfbMarketInformedOutcome";
import {
  CFB_MARKET_SHADOW_WEIGHT,
  CFB_MARKET_SHARP_AWARE_CANDIDATE_RELEASE,
  CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE,
  applyCfbMarketSharpAwareGrades,
  buildCfbMarketSharpAwareForecast,
} from "../lib/services/football/cfbMarketSharpAwareShadow";
import { CFB_SHARP_API_SPLITS_RELEASE } from "../lib/services/football/cfbSharpApiSplits";
import { fetchBalldontlieNcaafQuarterbacks } from "../lib/services/football/balldontlieNcaafQuarterbacks";
import { ingestCfbFinalScores } from "../lib/services/football/cfbScoreIngestService";
import { buildCfbOfficialTrackingRecords } from "../lib/services/football/cfbOfficialTrackingRecord";
import { FOOTBALL_MARKET_SCOPED_T60_TRACKING_RELEASE } from "../lib/services/football/footballMarketScopedTracking";
import {
  CFB_T60_MAX_CAPTURE_LAG_MINUTES,
  CFB_V1_DECISION_RELEASE,
  buildCfbV1DecisionBundle,
  cfbV1LineProbabilities,
  getCfbV1Forecast,
  getCfbV1Forecasts,
} from "../lib/services/football/cfbV1Decision";
import { __BALLDONTLIE_NCAAF_SLATE_TEST__, type NcaafBookOdds, type NcaafGame } from "../lib/services/football/balldontlieNcaafSlate";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildCfbForwardMemberSnapshot,
  CFB_FORWARD_MEMBER_SNAPSHOT_RELEASE,
} from "../lib/services/football/cfbForwardMemberSnapshotStore";

const buildCfbMemberFixture = (
  rows: Parameters<typeof buildCfbMemberFixtureAtTime>[0],
  now = "2026-08-29T15:10:00.000Z",
) => buildCfbMemberFixtureAtTime(rows, now);

async function main(): Promise<void> {
const observedAt = "2026-08-25T15:50:05.583Z";
const lockedAt = "2026-08-29T15:10:00.000Z";
const gameStartAt = "2026-08-29T16:00:00.000Z";
const game: NcaafGame = {
  providerGameId: "457157",
  providerWeek: 1,
  season: 2026,
  scheduledStart: gameStartAt,
  status: "scheduled",
  awayScore: null,
  homeScore: null,
  away: { id: 10, conferenceId: 1, abbreviation: "UNC", name: "North Carolina Tar Heels", fbs: true },
  home: { id: 43, conferenceId: 3, abbreviation: "TCU", name: "TCU Horned Frogs", fbs: true },
};

const currentBooks: NcaafBookOdds[] = [
  book("fanduel", -330, 260, -7.5, -112, -108, 47.5, -105, -115),
  book("draftkings", -310, 250, -7.5, -112, -108, 47.5, -110, -110),
  book("caesars", -325, 255, -7.5, -114, -106, 47.5, -108, -112),
  book("betmgm", -325, 260, -7.5, -115, -105, 47.5, -110, -110),
];

const providerOpening = __BALLDONTLIE_NCAAF_SLATE_TEST__.normalizeOdds({
  game_id: game.providerGameId,
  vendor: "DraftKings",
  opened_at: "2026-08-20T12:00:00.000Z",
  moneyline_home_odds: -300,
  moneyline_away_odds: 240,
  spread_home_value: -7,
  spread_home_odds: -110,
  spread_away_value: 7,
  spread_away_odds: -110,
  total_value: 47,
  total_over_odds: -110,
  total_under_odds: -110,
});
assert.equal(providerOpening?.observedAt, "2026-08-20T12:00:00.000Z", "BALLDONTLIE opening rows use opened_at when updated_at is absent");

const forecasts = getCfbV1Forecasts();
assert.equal(forecasts.length, 8, "launch artifact must contain the exact eight-game opening slate");
for (const forecast of forecasts) {
  const mass = forecast.pmf.reduce((sum, cell) => sum + cell.probability, 0);
  const expectedAway = forecast.pmf.reduce((sum, cell) => sum + cell.away * cell.probability, 0);
  const expectedHome = forecast.pmf.reduce((sum, cell) => sum + cell.home * cell.probability, 0);
  assert.ok(Math.abs(mass - 1) < 1e-9, `${forecast.providerGameId} PMF must sum to one`);
  assert.ok(Math.abs(expectedAway - forecast.expectedAwayPoints) < 1e-9, `${forecast.providerGameId} away mean must come from the PMF`);
  assert.ok(Math.abs(expectedHome - forecast.expectedHomePoints) < 1e-9, `${forecast.providerGameId} home mean must come from the PMF`);
  assert.ok(Math.abs(forecast.representativeScore.away - forecast.expectedAwayPoints) <= 2, `${forecast.providerGameId} representative away score is not central`);
  assert.ok(Math.abs(forecast.representativeScore.home - forecast.expectedHomePoints) <= 2, `${forecast.providerGameId} representative home score is not central`);
  if (Math.abs(forecast.homeWinProbability - 0.5) > 0.005) {
    assert.notEqual(forecast.representativeScore.away, forecast.representativeScore.home, `${forecast.providerGameId} representative score cannot contradict a non-tie winner`);
    assert.equal(forecast.representativeScore.home > forecast.representativeScore.away, forecast.homeWinProbability > 0.5, `${forecast.providerGameId} representative winner must match the PMF winner`);
  }
}

const forecast = getCfbV1Forecast(game.providerGameId);
const probabilities = cfbV1LineProbabilities({ forecast, homeSpread: -7.5, totalLine: 47.5 });
const independentlySummedHomeWin = forecast.pmf.reduce((sum, cell) => sum + (cell.home > cell.away ? cell.probability : cell.home === cell.away ? 0.5 * cell.probability : 0), 0);
assert.ok(Math.abs(probabilities.moneyline.home - independentlySummedHomeWin) < 1e-12);
assert.ok(Math.abs(probabilities.moneyline.home + probabilities.moneyline.away - 1) < 1e-9);
assert.ok(Math.abs(probabilities.spread.home + probabilities.spread.away - 1) < 1e-9);
assert.ok(Math.abs(probabilities.total.over + probabilities.total.under - 1) < 1e-9);

const fullBundle = buildCfbV1DecisionBundle({
  providerGameId: game.providerGameId,
  awayTeam: game.away.abbreviation,
  homeTeam: game.home.abbreviation,
  gameStartsAt: game.scheduledStart,
  comparableCurrentBooks: currentBooks,
  stage: "t60_locked",
  evaluatedAt: lockedAt,
  lockedAt,
});
assert.equal(fullBundle.evaluatedBets.length, 3);
assert.equal(fullBundle.heldMarkets.length, 0);
assert.equal(fullBundle.trackingEnabled, true);
assert.equal(fullBundle.evaluatedBets.every((decision) => decision.decisionRelease === CFB_V1_DECISION_RELEASE), true);
assert.equal(new Set(fullBundle.evaluatedBets.map((decision) => decision.market)).size, 3);
assert.equal(fullBundle.evaluatedBets.every((decision) => decision.consensus.books.every((bookName) => bookName !== decision.evaluatedQuote.sportsbook)), true, "consensus must exclude the evaluated sportsbook");
const totalDecision = fullBundle.evaluatedBets.find((decision) => decision.market === "total");
assert.ok(totalDecision);
const nearTossupTotal = {
  ...totalDecision,
  side: "Under 57.5",
  grade: "No Play" as const,
  forecastProbability: 0.5020019998108759,
  modelProbability: 0.5010009999054379,
  expectedValue: -0.0435,
  evaluatedQuote: { ...totalDecision.evaluatedQuote, line: 57.5 },
};
const publishedNearTossupBundle = publishCfbForwardDecisionBundle(
  {
    ...fullBundle,
    evaluatedBets: fullBundle.evaluatedBets.map((decision) => decision.market === "total" ? nearTossupTotal : decision),
  },
  { provider: "playbook", capturedAt: observedAt, sourceTier: "tier1", homeMoneyline: -330, awayMoneyline: 260, homeSpread: -7.5, awaySpread: 7.5, total: 57.5 },
);
assert.deepEqual(
  publishedNearTossupBundle.evaluatedBets.find((decision) => decision.market === "total"),
  nearTossupTotal,
  "publication must preserve the authoritative near-tossup Total tuple, including its PMF side, probability, exact quote, negative EV, and No Play grade",
);
assert.equal(
  publishedNearTossupBundle.heldMarkets.some((held) => held.market === "total"),
  false,
  "a complete two-sided near-tossup Total cannot be converted into missing evidence",
);

const noMoneylineBooks = currentBooks.map((currentBook) => ({ ...currentBook, moneyline: null }));
const marketScopedBundle = buildCfbV1DecisionBundle({
  providerGameId: game.providerGameId,
  awayTeam: game.away.abbreviation,
  homeTeam: game.home.abbreviation,
  gameStartsAt: game.scheduledStart,
  comparableCurrentBooks: noMoneylineBooks,
  stage: "t60_locked",
  evaluatedAt: lockedAt,
  lockedAt,
});
assert.deepEqual(marketScopedBundle.evaluatedBets.map((decision) => decision.market), ["spread", "total"]);
assert.deepEqual(marketScopedBundle.heldMarkets.map((market) => market.market), ["moneyline"]);
assert.equal(marketScopedBundle.trackingEnabled, true, "one Held market cannot suppress coherent sibling T-60 tuples");
const globalHealthHold = buildCfbV1DecisionBundle({
  providerGameId: game.providerGameId,
  awayTeam: game.away.abbreviation,
  homeTeam: game.home.abbreviation,
  gameStartsAt: game.scheduledStart,
  comparableCurrentBooks: currentBooks,
  stage: "t60_locked",
  evaluatedAt: lockedAt,
  lockedAt,
  healthHolds: ["t60_capture_late"],
});
assert.equal(globalHealthHold.evaluatedBets.length, 0);
assert.equal(globalHealthHold.trackingEnabled, false, "global health failures must remain fail-closed");

const { pmf: _pmf, ...publishedForecast } = fullBundle.forecast;
void _pmf;
const outcomeAnchor = resolveCfbCanonicalMarketAnchor({ books: currentBooks });
assert.ok(outcomeAnchor);
const authoritativeForecast = buildCfbMarketSharpAwareForecast({
  independentForecast: fullBundle.forecast,
  anchor: outcomeAnchor,
  sharpSplits: [],
  playbookLine: { provider: "playbook", capturedAt: observedAt, sourceTier: "tier1", homeMoneyline: -330, awayMoneyline: 260, homeSpread: -7.5, awaySpread: 7.5, total: 47.5 },
  publicSplits: splitSet(),
  evaluatedAt: lockedAt,
});
const productionBundle = applyCfbMarketSharpAwareGrades({
  homeTeam: game.home.abbreviation,
  bundle: buildCfbV1DecisionBundle({
    providerGameId: game.providerGameId,
    awayTeam: game.away.abbreviation,
    homeTeam: game.home.abbreviation,
    gameStartsAt: game.scheduledStart,
    comparableCurrentBooks: currentBooks,
    stage: "t60_locked",
    evaluatedAt: lockedAt,
    lockedAt,
    forecast: authoritativeForecast,
  }),
  sharpSplits: [],
  playbookLine: { provider: "playbook", capturedAt: observedAt, sourceTier: "tier1", homeMoneyline: -330, awayMoneyline: 260, homeSpread: -7.5, awaySpread: 7.5, total: 47.5 },
  publicSplits: splitSet(),
  operationalOpening: { quote: currentBooks[0]! },
});
const { pmf: _authoritativePmf, ...publishedAuthoritativeForecast } = authoritativeForecast;
void _authoritativePmf;
const payload: CfbForwardEvidencePayload = {
  schemaRelease: CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  collectorRelease: CFB_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  memberRelease: CFB_FORWARD_MEMBER_RELEASE,
  runId: "00000000-0000-4000-8000-000000000001",
  season: 2026,
  week: 1,
  slateGameCount: 1,
  stage: "t60",
  captureTiming: "on_time",
  capturedAt: lockedAt,
  cutoffAt: "2026-08-29T15:00:00.000Z",
  t60LagMinutes: 10,
  game,
  market: {
    current: currentBooks[0]!,
    currentBooks,
    providerOpening: null,
    operationalOpening: { provenance: "first_observed", capturedAt: observedAt, quote: currentBooks[0]! },
    playbookLine: { provider: "playbook", capturedAt: observedAt, sourceTier: "tier1", homeMoneyline: -330, awayMoneyline: 260, homeSpread: -7.5, awaySpread: 7.5, total: 47.5 },
    playbookSplits: splitSet(),
    sharpApiOddsRelease: null,
    sharpApiSplits: null,
  },
  quarterbacks: {
    away: quarterback(10, "UNC", "Projected UNC QB"),
    home: quarterback(43, "TCU", "Projected TCU QB"),
  },
  availability: { injuryStatus: "provider_unavailable", weatherStatus: "venue_weather_unavailable", note: "Unavailable and not fabricated." },
  decisions: {
    ...productionBundle,
    forecast: publishedAuthoritativeForecast,
    marketOutlooks: buildCfbForwardMarketOutlooks({
      forecast: authoritativeForecast,
      playbookLine: { provider: "playbook", capturedAt: observedAt, sourceTier: "tier1", homeMoneyline: -330, awayMoneyline: 260, homeSpread: -7.5, awaySpread: 7.5, total: 47.5 },
    }),
  },
  independentForecast: publishedForecast,
  authoritativeForecast: {
    status: "market_sharp_applied",
    release: CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE,
    candidateRelease: CFB_MARKET_SHARP_AWARE_CANDIDATE_RELEASE,
    marketWeight: CFB_MARKET_SHADOW_WEIGHT,
  },
  coverage: { currentOdds: true, comparableCurrentBookCount: 4, currentOddsProviders: ["balldontlie"], sharpApiOddsFallback: false, targetExcludedConsensusReady: true, operationalOpening: true, playbookLine: true, playbookSplits: true, sharpApiSplits: false, activeQuarterbacks: true, injuries: false, weather: false, healthHolds: [], availabilityWarnings: ["quarterback_starter_projected_not_confirmed", "injury_feed_unavailable", "venue_weather_unavailable", "sharpapi_splits_unavailable"] },
  requestBudget: { balldontlieSlate: 3, balldontlieQuarterbacks: 2, playbook: 2, sharpApiOdds: 0, totalMaximum: 7 },
};

assert.equal("pmf" in payload.decisions.forecast, false, "recurring evidence rows must not duplicate the large PMF artifact");
assert.equal(hashCfbForwardEvidencePayload(payload).length, 64);
const optionalFieldPayload = { ...payload, outcomeMarketOutlooks: undefined };
const jsonRoundTrippedPayload = JSON.parse(JSON.stringify(optionalFieldPayload)) as CfbForwardEvidencePayload;
const optionalFieldHash = hashCfbForwardEvidencePayload(optionalFieldPayload);
assert.equal(hashCfbForwardEvidencePayload(jsonRoundTrippedPayload), optionalFieldHash, "the evidence hash must match the exact JSON-serializable payload shape");
assert.equal(matchesCfbForwardEvidencePayloadHash(jsonRoundTrippedPayload, optionalFieldHash), true);
assert.equal(CFB_T60_MAX_CAPTURE_LAG_MINUTES, 20);
assert.equal(isPublicallyTracked("cfb", "2026-08-28"), false);
assert.equal(isPublicallyTracked("cfb", "2026-08-29"), true);

const evidence: CfbForwardStoredEvidence = {
  id: "test-row",
  providerGameId: game.providerGameId,
  stage: "t60",
  capturedAt: lockedAt,
  gameStartAt,
  payloadSha256: hashCfbForwardEvidencePayload(payload),
  payload,
};
const trustedSharpEventId = "ncaaf_northcarolinatarheels_tcuhornedfrogs_2026-08-29_b2";
const trustedSharpPayload = structuredClone(payload);
trustedSharpPayload.market.currentBooks = [{
  ...trustedSharpPayload.market.currentBooks[0]!,
  provider: "sharpapi",
  providerEventId: trustedSharpEventId,
}];
const trustedSharpRow: CfbForwardStoredEvidence = {
  ...evidence,
  id: "trusted-sharp-event-row",
  payloadSha256: hashCfbForwardEvidencePayload(trustedSharpPayload),
  payload: trustedSharpPayload,
};
assert.deepEqual(trustedCfbSharpEventIdsByGame([trustedSharpRow]), { [game.providerGameId]: trustedSharpEventId });
const conflictingTrustedSharpPayload = structuredClone(trustedSharpPayload);
conflictingTrustedSharpPayload.market.currentBooks[0]!.providerEventId = `${trustedSharpEventId}-conflict`;
assert.deepEqual(trustedCfbSharpEventIdsByGame([trustedSharpRow, {
  ...trustedSharpRow,
  id: "conflicting-trusted-sharp-event-row",
  payloadSha256: hashCfbForwardEvidencePayload(conflictingTrustedSharpPayload),
  payload: conflictingTrustedSharpPayload,
}]), {}, "conflicting immutable provider IDs must disable prior-event disambiguation");
const member = buildCfbMemberFixture([evidence]);
const compactMemberSnapshot = buildCfbForwardMemberSnapshot({
  fixture: member,
  season: 2026,
  publishedAt: lockedAt,
});
assert.equal(compactMemberSnapshot.snapshotRelease, CFB_FORWARD_MEMBER_SNAPSHOT_RELEASE);
assert.equal(compactMemberSnapshot.fixture, member, "the fast snapshot preserves the authoritative fixture byte-for-byte");
assert.equal(compactMemberSnapshot.sourceChecksum, member.provenance.sourceChecksum);
assert.equal(member.snapshot.games.length, 1);
assert.equal(member.fixtureRelease, "cfb_v1_member_fixture_2026_09_03_r43_narrow_mean_median_publication");
assert.equal(member.snapshot.games[0]!.collegeFootballScope, "fbs_involved", "the CFB reader must classify every member game for the FBS-first board without changing writer scope");
assert.equal(member.snapshot.games[0]!.awayTeamDisplayName, game.away.name);
assert.equal(member.snapshot.games[0]!.homeTeamDisplayName, game.home.name);
const miamiIdentity = cfbTeamIdentity("MIA");
const houstonIdentity = cfbTeamIdentity("HOU");
assert.equal(miamiIdentity?.displayName, "Miami Hurricanes");
assert.equal(houstonIdentity?.displayName, "Houston Cougars");
assert.match(miamiIdentity?.logoUrl ?? "", /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/ncaa\/500\//);
assert.match(houstonIdentity?.logoUrl ?? "", /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/ncaa\/500\//);
assert.match(miamiIdentity?.primaryColor ?? "", /^#[0-9A-F]{6}$/);
assert.match(houstonIdentity?.primaryColor ?? "", /^#[0-9A-F]{6}$/);
assert.equal(member.snapshot.games[0]!.footballProjection?.expectedAwayPoints, authoritativeForecast.expectedAwayPoints);
assert.equal(member.snapshot.games[0]!.footballProjection?.expectedHomePoints, authoritativeForecast.expectedHomePoints);
assert.deepEqual(member.snapshot.games[0]!.projected, authoritativeForecast.representativeScore);
assert.equal(member.snapshot.games[0]!.footballOnlyProjection?.expectedAwayPoints, forecast.expectedAwayPoints, "the immutable independent PMF remains a diagnostic baseline");
assert.equal(member.snapshot.games[0]!.footballOnlyProjection?.expectedHomePoints, forecast.expectedHomePoints);
assert.equal(member.snapshot.games[0]!.recommendationDecision?.audit.canPublish, true);

const ualbLikeCapturedAt = "2026-09-02T10:39:48.862Z";
const ualbLikeGameStartAt = "2026-09-05T23:30:00.000Z";
const ualbLikeBooks: NcaafBookOdds[] = [
  ["betmgm", 48.5, -102, -118],
  ["betrivers", 48, -113, -110],
  ["caesars", 48.5, -105, -118],
  ["draftkings", 48.5, -108, -112],
  ["fanatics", 48, -110, -110],
  ["fanduel", 48.5, -110, -110],
].map(([sportsbook, line, overPrice, underPrice]) => ({
  providerGameId: "ualb-buf-publication-regression",
  sportsbook: String(sportsbook),
  observedAt: ualbLikeCapturedAt,
  moneyline: null,
  spread: null,
  total: { line: Number(line), overPrice: Number(overPrice), underPrice: Number(underPrice) },
}));
const publishedProductionTotal = payload.decisions.evaluatedBets.find((decision) => decision.market === "total");
assert.ok(publishedProductionTotal);
const ualbLikeDecision = {
  ...publishedProductionTotal,
  providerGameId: "ualb-buf-publication-regression",
  awayTeam: "UALB",
  homeTeam: "BUF",
  gameStartsAt: ualbLikeGameStartAt,
  side: "Under 48.5",
  grade: "No Play" as const,
  forecastProbability: 0.5020019998108759,
  modelProbability: 0.5020019998108759,
  marketFairProbability: 0.5363636363636364,
  edgePercentagePoints: -0.0343616365527605,
  expectedValue: -0.04345181836221879,
  stage: "unlocked" as const,
  evaluatedAt: ualbLikeCapturedAt,
  lockedAt: null,
  evaluatedQuote: {
    ...publishedProductionTotal.evaluatedQuote,
    sportsbook: "betmgm",
    side: "under" as const,
    line: 48.5,
    price: -118,
    observedAt: ualbLikeCapturedAt,
  },
};
const ualbLikeForecast = {
  ...payload.decisions.forecast,
  expectedAwayPoints: 14.5,
  expectedHomePoints: 34.32770674927421,
  expectedTotal: 48.82770674927421,
  representativeScore: { away: 14.5, home: 34.32770674927421 },
};
const ualbLikeSplits = structuredClone(payload.market.playbookSplits!);
ualbLikeSplits.total = {
  ...ualbLikeSplits.total,
  capturedAt: ualbLikeCapturedAt,
  booksUsed: 7,
  overMoneyPct: 53,
  underMoneyPct: 47,
  overBetsPct: 43,
  underBetsPct: 57,
};
const ualbLikePayload = {
  ...payload,
  runId: "00000000-0000-4000-8000-000000000029",
  stage: "unlocked" as const,
  capturedAt: ualbLikeCapturedAt,
  cutoffAt: null,
  t60LagMinutes: null,
  game: {
    ...payload.game,
    providerGameId: "ualb-buf-publication-regression",
    scheduledStart: ualbLikeGameStartAt,
    away: { ...payload.game.away, abbreviation: "UALB", name: "Albany Great Danes", fbs: false },
    home: { ...payload.game.home, abbreviation: "BUF", name: "Buffalo Bulls", fbs: true },
  },
  market: {
    ...payload.market,
    current: ualbLikeBooks[0]!,
    currentBooks: ualbLikeBooks,
    displayBooks: ualbLikeBooks,
    providerOpening: null,
    operationalOpening: { provenance: "first_observed" as const, capturedAt: ualbLikeCapturedAt, quote: ualbLikeBooks[0]! },
    playbookLine: { provider: "playbook" as const, capturedAt: ualbLikeCapturedAt, sourceTier: "tier1", homeMoneyline: null, awayMoneyline: null, homeSpread: null, awaySpread: null, total: 48.5 },
    playbookSplits: ualbLikeSplits,
    sharpApiSplits: null,
    sharpApiSplitsStatus: "event_not_published" as const,
    sharpApiSplitsError: null,
  },
  decisions: {
    ...payload.decisions,
    forecast: ualbLikeForecast,
    evaluatedBets: [ualbLikeDecision],
    heldMarkets: [],
    marketOutlooks: {
      moneyline: null,
      spread: null,
      total: { market: "total" as const, side: "under" as const, line: 48.5, independentProbability: ualbLikeDecision.forecastProbability, source: "authoritative_pmf_at_playbook_line" as const, contextObservedAt: ualbLikeCapturedAt },
    },
    trackingEnabled: false,
  },
  independentForecast: { ...payload.independentForecast!, expectedAwayPoints: 14.5, expectedHomePoints: 34.32770674927421, expectedTotal: 48.82770674927421, representativeScore: { away: 14.5, home: 34.32770674927421 } },
  coverage: { ...payload.coverage, comparableCurrentBookCount: 6, sharpApiSplits: false, healthHolds: [], availabilityWarnings: ["injury_feed_unavailable", "sharpapi_splits_unavailable"] },
} as unknown as CfbForwardEvidencePayload;
const ualbLikeRow: CfbForwardStoredEvidence = {
  ...evidence,
  id: "ualb-buf-publication-regression-row",
  providerGameId: ualbLikePayload.game.providerGameId,
  stage: "unlocked",
  capturedAt: ualbLikeCapturedAt,
  gameStartAt: ualbLikeGameStartAt,
  payloadSha256: hashCfbForwardEvidencePayload(ualbLikePayload),
  payload: ualbLikePayload,
};
const ualbLikeMember = buildCfbMemberFixture([ualbLikeRow], ualbLikeCapturedAt);
const ualbLikeTotal = ualbLikeMember.snapshot.games[0]!.markets.total;
assert.equal(ualbLikeTotal.held, false, "complete UALB-like two-sided Total evidence must remain evaluated when sharp splits are unavailable");
assert.equal(ualbLikeTotal.marketPrediction?.status, "available");
assert.equal(ualbLikeTotal.marketPrediction?.label, "Under 48.5");
assert.equal(ualbLikeTotal.marketPrediction?.probability, ualbLikeDecision.forecastProbability);
assert.equal(ualbLikeTotal.marketPrediction?.line, 48.5);
assert.equal(ualbLikeTotal.pick, "Under 48.5");
assert.equal(ualbLikeTotal.currentPriceSportsbook, "betmgm");
assert.equal(ualbLikeTotal.currentPriceAmerican, -118);
assert.equal(ualbLikeTotal.pinnacleEvPct, ualbLikeDecision.expectedValue * 100);
assert.equal(ualbLikeTotal.verdict.label, "No Play");
assert.equal(ualbLikeTotal.actionabilityLabel, "No Play");
assert.equal(ualbLikeTotal.publicSplits[0]?.moneyPct, 53);
assert.equal(ualbLikeTotal.publicSplits[0]?.betsPct, 43);
assert.equal(ualbLikeTotal.sharpBookAvailability?.status, "pending");
assert.equal(ualbLikeMember.snapshot.games[0]!.footballProjection?.expectedAwayPoints, 14.5);
assert.equal(ualbLikeMember.snapshot.games[0]!.footballProjection?.expectedHomePoints, 34.32770674927421);

const publicationTransitionCapturedAt = "2026-09-02T12:00:00.000Z";
const publicationTransitionStartAt = "2026-09-06T17:00:00.000Z";
const r28UnlockedPayloadRecord = structuredClone(payload) as unknown as Record<string, unknown>;
r28UnlockedPayloadRecord.memberRelease = CFB_FORWARD_PUBLICATION_PREVIOUS_MEMBER_RELEASE;
r28UnlockedPayloadRecord.slateGameCount = 2;
r28UnlockedPayloadRecord.stage = "unlocked";
r28UnlockedPayloadRecord.capturedAt = publicationTransitionCapturedAt;
r28UnlockedPayloadRecord.cutoffAt = null;
r28UnlockedPayloadRecord.t60LagMinutes = null;
const r28UnlockedDecisions = r28UnlockedPayloadRecord.decisions as Record<string, unknown>;
r28UnlockedDecisions.trackingEnabled = false;
r28UnlockedDecisions.evaluatedBets = (r28UnlockedDecisions.evaluatedBets as Array<Record<string, unknown>>).map((decision) => ({
  ...decision,
  stage: "unlocked",
  evaluatedAt: publicationTransitionCapturedAt,
  lockedAt: null,
}));
const r28UnlockedPayload = r28UnlockedPayloadRecord as unknown as CfbForwardEvidencePayload;
const r29PartialPayload = {
  ...payload,
  slateGameCount: 2,
  stage: "unlocked" as const,
  capturedAt: publicationTransitionCapturedAt,
  cutoffAt: null,
  t60LagMinutes: null,
  decisions: {
    ...payload.decisions,
    trackingEnabled: false,
    evaluatedBets: payload.decisions.evaluatedBets.map((decision) => ({
      ...decision,
      stage: "unlocked" as const,
      evaluatedAt: publicationTransitionCapturedAt,
      lockedAt: null,
    })),
  },
};
const r29PartialRow: CfbForwardStoredEvidence = {
  ...evidence,
  id: "r29-first-wave-current",
  providerGameId: "r29-current-game",
  stage: "unlocked",
  capturedAt: publicationTransitionCapturedAt,
  gameStartAt: publicationTransitionStartAt,
  payloadSha256: hashCfbForwardEvidencePayload(r29PartialPayload),
  payload: r29PartialPayload,
};
const r28UnlockedRows: CfbForwardStoredEvidence[] = ["r29-current-game", "r29-missing-game"].map((providerGameId) => ({
  ...evidence,
  id: `r28-unlocked-${providerGameId}`,
  providerGameId,
  stage: "unlocked" as const,
  capturedAt: publicationTransitionCapturedAt,
  gameStartAt: publicationTransitionStartAt,
  payloadSha256: hashCfbForwardEvidencePayload(r28UnlockedPayload),
  payload: r28UnlockedPayload,
}));
const firstR29WaveFallback = selectLatestCfbMemberEvidenceRows(
  [r29PartialRow, ...r28UnlockedRows],
  publicationTransitionCapturedAt,
);
assert.equal(firstR29WaveFallback.length, 2);
assert.equal(
  firstR29WaveFallback.every((row) => String(row.payload.memberRelease) === CFB_FORWARD_PUBLICATION_PREVIOUS_MEMBER_RELEASE),
  true,
  "an incomplete first r29 wave must retain the complete same-schema r28 member wave",
);

const r28LockedPayload = {
  ...payload,
  memberRelease: CFB_FORWARD_PUBLICATION_PREVIOUS_MEMBER_RELEASE,
  slateGameCount: 2,
} as unknown as CfbForwardEvidencePayload;
const r28LockedRow: CfbForwardStoredEvidence = {
  ...evidence,
  id: "r28-immutable-t60",
  providerGameId: "r29-missing-game",
  gameStartAt: publicationTransitionStartAt,
  payloadSha256: hashCfbForwardEvidencePayload(r28LockedPayload),
  payload: r28LockedPayload,
};
const r29ImmutableBoundary = selectLatestCfbMemberEvidenceRows(
  [r29PartialRow, r28UnlockedRows[0]!, r28LockedRow],
  publicationTransitionCapturedAt,
);
assert.equal(r29ImmutableBoundary.length, 2);
assert.equal(r29ImmutableBoundary.find((row) => row.providerGameId === "r29-current-game")?.payload.memberRelease, CFB_FORWARD_MEMBER_RELEASE);
assert.deepEqual(
  r29ImmutableBoundary.find((row) => row.providerGameId === "r29-missing-game"),
  r28LockedRow,
  "the r28 T-60 row must remain byte-for-byte authoritative while the first r29 wave refreshes only unlocked games",
);
const sharpPayload: CfbForwardEvidencePayload = {
  ...payload,
  market: {
    ...payload.market,
    sharpApiSplitsStatus: "matched",
    sharpApiSplitsError: null,
    sharpApiSplits: [{
      release: CFB_SHARP_API_SPLITS_RELEASE,
      providerGameId: game.providerGameId,
      providerEventId: "ncaaf_northcarolinatarheels_tcuhornedfrogs_2026-08-29",
      sportsbook: "circa",
      sourceSemantics: "sharp_adjacent",
      capturedAt: lockedAt,
      moneyline: { away: { ticketsPct: 28, moneyPct: 34 }, home: { ticketsPct: 72, moneyPct: 66 } },
      spread: { awayLine: 7.5, homeLine: -7.5, away: { ticketsPct: 42, moneyPct: 46 }, home: { ticketsPct: 58, moneyPct: 54 } },
      total: { line: 47.5, over: { ticketsPct: 45, moneyPct: 41 }, under: { ticketsPct: 55, moneyPct: 59 } },
    }],
  },
  coverage: { ...payload.coverage, sharpApiSplits: true },
};
const sharpMember = buildCfbMemberFixture([{ ...evidence, id: "sharp-split-row", payloadSha256: hashCfbForwardEvidencePayload(sharpPayload), payload: sharpPayload }]);
assert.equal(sharpMember.snapshot.games[0]!.markets.total.sharpBookAvailability?.status, "complete");
assert.equal(sharpMember.snapshot.games[0]!.markets.total.recommendationDecision?.sharpBookSplits?.label, "Sharp Book Splits");
assert.equal(sharpMember.snapshot.games[0]!.markets.total.recommendationDecision?.sharpBookSplits?.rows[0]?.moneyPct, 41);
assert.equal(sharpMember.snapshot.games[0]!.markets.total.publicSplits[0]?.moneyPct, 27, "Playbook public consensus remains a separate display authority");
const draftKingsSplitPayload = structuredClone(sharpPayload);
draftKingsSplitPayload.market.sharpApiSplits![0]!.sportsbook = "draftkings";
draftKingsSplitPayload.market.sharpApiSplits![0]!.sourceSemantics = "public_recreational";
const draftKingsSplitMember = buildCfbMemberFixture([{
  ...evidence,
  id: "draftkings-split-row",
  payloadSha256: hashCfbForwardEvidencePayload(draftKingsSplitPayload),
  payload: draftKingsSplitPayload,
}]);
assert.equal(draftKingsSplitMember.snapshot.games[0]!.markets.total.sportsbookSplits?.label, "DraftKings Splits");
assert.equal(draftKingsSplitMember.snapshot.games[0]!.markets.total.sportsbookSplits?.rows[0]?.moneyPct, 41);
assert.equal(draftKingsSplitMember.snapshot.games[0]!.markets.total.recommendationDecision?.sharpBookSplits, null);
assert.equal(draftKingsSplitMember.snapshot.games[0]!.markets.total.sharpBookAvailability, null);
assert.equal(draftKingsSplitMember.snapshot.games[0]!.markets.total.publicSplits[0]?.moneyPct, 27, "DraftKings fallback cannot replace Playbook public consensus");
assert.equal(member.snapshot.games[0]!.markets.moneyline.held, false);
assert.equal(member.snapshot.games[0]!.markets.total.publicSplits.length, 2);
assert.equal(member.snapshot.games[0]!.markets.total.publicSplits[0]!.staleAfterMinutes, 390, "early-week CFB splits must honor the six-hour writer cadence plus grace");
assert.equal(member.tracking.trackingEligible, true);
for (const decision of payload.decisions.evaluatedBets) {
  const memberMarket = decision.market === "spread" ? "first_inning" : decision.market;
  assert.equal(member.snapshot.games[0]!.markets[memberMarket].currentPriceObservedAt, decision.evaluatedQuote.observedAt, `${decision.market} member DTO must preserve its exact evaluated tuple timestamp`);
}

const identityPreviousPayloadRecord = structuredClone(payload) as unknown as Record<string, unknown>;
identityPreviousPayloadRecord.schemaRelease = CFB_FORWARD_IDENTITY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE;
identityPreviousPayloadRecord.memberRelease = CFB_FORWARD_IDENTITY_PREVIOUS_MEMBER_RELEASE;
const identityPreviousDecisions = identityPreviousPayloadRecord.decisions as Record<string, unknown>;
identityPreviousDecisions.decisionRelease = "cfb_v1_daily_edge_decision_2026_08_31_r23_authoritative_pmf_calibration";
identityPreviousDecisions.evaluatedBets = (identityPreviousDecisions.evaluatedBets as Array<Record<string, unknown>>).map((decision) => ({
  ...decision,
  decisionRelease: "cfb_v1_daily_edge_decision_2026_08_31_r23_authoritative_pmf_calibration",
}));
const identityPreviousPayload = identityPreviousPayloadRecord as unknown as CfbForwardEvidencePayload;
const identityPreviousMember = buildCfbMemberFixture([{
  ...evidence,
  id: "identity-previous-row",
  payloadSha256: hashCfbForwardEvidencePayload(identityPreviousPayload),
  payload: identityPreviousPayload,
}]);
assert.equal(identityPreviousMember.snapshot.games.length, 1, "the complete r46 wave remains the atomic member fallback during the identity repair rollout");
assert.notEqual(identityPreviousMember.snapshot.games[0]!.footballOnlyProjection, null, "the r46 transition fallback retains the release-separated football baseline");
for (const memberMarket of Object.values(member.snapshot.games[0]!.markets)) {
  assert.equal(memberMarket.keyStats.some((row) => row.label.startsWith("Outcome-model input ·")), true);
  assert.equal(memberMarket.keyStats.some((row) => row.label === "Current context · Expected quarterback"), true);
  assert.equal(memberMarket.keyStats.some((row) => row.label === "Outcome-model input · Frozen sample"), true);
}

const eventPaginationPreviousPayloadRecord = structuredClone(payload) as unknown as Record<string, unknown>;
eventPaginationPreviousPayloadRecord.schemaRelease = CFB_FORWARD_AMBIGUOUS_SCOPE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE;
eventPaginationPreviousPayloadRecord.memberRelease = "cfb_v1_member_release_2026_08_28_r18_event_discovery_pagination";
const eventPaginationPreviousDecisions = eventPaginationPreviousPayloadRecord.decisions as Record<string, unknown>;
eventPaginationPreviousDecisions.decisionRelease = "cfb_v1_daily_edge_decision_2026_08_28_r14_event_discovery_pagination";
eventPaginationPreviousDecisions.evaluatedBets = (eventPaginationPreviousDecisions.evaluatedBets as Array<Record<string, unknown>>).map((decision) => ({
  ...decision,
  decisionRelease: "cfb_v1_daily_edge_decision_2026_08_28_r14_event_discovery_pagination",
}));
const eventPaginationPreviousPayload = eventPaginationPreviousPayloadRecord as unknown as CfbForwardEvidencePayload;
const eventPaginationPreviousMember = buildCfbMemberFixture([{
  ...evidence,
  id: "event-pagination-previous-row",
  payloadSha256: hashCfbForwardEvidencePayload(eventPaginationPreviousPayload),
  payload: eventPaginationPreviousPayload,
}]);
assert.equal(eventPaginationPreviousMember.snapshot.games.length, 1, "the complete r31 wave remains the first atomic fallback during r32 rollout");

const independentPublicPreviousPayloadRecord = structuredClone(payload) as unknown as Record<string, unknown>;
independentPublicPreviousPayloadRecord.schemaRelease = CFB_FORWARD_CANONICAL_DISCOVERY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE;
independentPublicPreviousPayloadRecord.memberRelease = "cfb_v1_member_release_2026_08_28_r17_independent_public_prediction";
const independentPublicPreviousDecisions = independentPublicPreviousPayloadRecord.decisions as Record<string, unknown>;
independentPublicPreviousDecisions.decisionRelease = "cfb_v1_daily_edge_decision_2026_08_28_r13_canonical_price_coverage";
independentPublicPreviousDecisions.evaluatedBets = (independentPublicPreviousDecisions.evaluatedBets as Array<Record<string, unknown>>).map((decision) => ({
  ...decision,
  decisionRelease: "cfb_v1_daily_edge_decision_2026_08_28_r13_canonical_price_coverage",
}));
const independentPublicPreviousPayload = independentPublicPreviousPayloadRecord as unknown as CfbForwardEvidencePayload;
const independentPublicPreviousMember = buildCfbMemberFixture([{
  ...evidence,
  id: "independent-public-previous-row",
  payloadSha256: hashCfbForwardEvidencePayload(independentPublicPreviousPayload),
  payload: independentPublicPreviousPayload,
}]);
assert.equal(independentPublicPreviousMember.snapshot.games.length, 1, "the complete r29 member wave remains the atomic fallback until one complete pagination-repair wave exists");

const canonicalPricePreviousPayload = {
  ...independentPublicPreviousPayload,
  memberRelease: "cfb_v1_member_release_2026_08_28_r16_canonical_price_coverage",
} as unknown as CfbForwardEvidencePayload;
const canonicalPricePreviousMember = buildCfbMemberFixture([{
  ...evidence,
  id: "canonical-price-previous-row",
  payloadSha256: hashCfbForwardEvidencePayload(canonicalPricePreviousPayload),
  payload: canonicalPricePreviousPayload,
}]);
assert.equal(canonicalPricePreviousMember.snapshot.games.length, 1, "the complete r16 member wave remains an older atomic fallback");
assert.equal(canonicalPricePreviousMember.snapshot.games[0]!.footballOnlyProjection, null, "the r29 adapter applies one independent public forecast to the atomic fallback wave");

const providerDiscoveryPreviousPayloadRecord = structuredClone(payload) as unknown as Record<string, unknown>;
providerDiscoveryPreviousPayloadRecord.schemaRelease = CFB_FORWARD_PROVIDER_DISCOVERY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE;
providerDiscoveryPreviousPayloadRecord.memberRelease = "cfb_v1_member_release_2026_08_28_r15_directional_pmf";
const providerDiscoveryPreviousDecisions = providerDiscoveryPreviousPayloadRecord.decisions as Record<string, unknown>;
providerDiscoveryPreviousDecisions.decisionRelease = "cfb_v1_daily_edge_decision_2026_08_28_r12_directional_pmf";
providerDiscoveryPreviousDecisions.evaluatedBets = (providerDiscoveryPreviousDecisions.evaluatedBets as Array<Record<string, unknown>>).map((decision) => ({
  ...decision,
  decisionRelease: "cfb_v1_daily_edge_decision_2026_08_28_r12_directional_pmf",
}));
const providerDiscoveryPreviousPayload = providerDiscoveryPreviousPayloadRecord as unknown as CfbForwardEvidencePayload;
const providerDiscoveryPreviousMember = buildCfbMemberFixture([{
  ...evidence,
  id: "provider-discovery-previous-row",
  payloadSha256: hashCfbForwardEvidencePayload(providerDiscoveryPreviousPayload),
  payload: providerDiscoveryPreviousPayload,
}]);
assert.equal(providerDiscoveryPreviousMember.snapshot.games.length, 1, "the complete r8 wave must remain the atomic member fallback until one complete r9 wave exists");

const currentTransitionPayload = { ...payload, slateGameCount: 2 };
const previousTransitionPayload = { ...providerDiscoveryPreviousPayload, slateGameCount: 2 };
const ambiguousScopeTransitionPayloadRecord = structuredClone(payload) as unknown as Record<string, unknown>;
ambiguousScopeTransitionPayloadRecord.schemaRelease = CFB_FORWARD_AMBIGUOUS_SCOPE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE;
ambiguousScopeTransitionPayloadRecord.memberRelease = "cfb_v1_member_release_2026_08_28_r19_ambiguous_event_scope";
ambiguousScopeTransitionPayloadRecord.slateGameCount = 2;
const ambiguousScopeTransitionDecisions = ambiguousScopeTransitionPayloadRecord.decisions as Record<string, unknown>;
ambiguousScopeTransitionDecisions.decisionRelease = "cfb_v1_daily_edge_decision_2026_08_28_r15_ambiguous_event_scope";
ambiguousScopeTransitionDecisions.evaluatedBets = (ambiguousScopeTransitionDecisions.evaluatedBets as Array<Record<string, unknown>>).map((decision) => ({
  ...decision,
  decisionRelease: "cfb_v1_daily_edge_decision_2026_08_28_r15_ambiguous_event_scope",
}));
const ambiguousScopeTransitionPayload = ambiguousScopeTransitionPayloadRecord as unknown as CfbForwardEvidencePayload;
const currentTransitionRow: CfbForwardStoredEvidence = {
  ...evidence,
  id: "started-game-transition-current-a",
  providerGameId: "future-current-game",
  gameStartAt: "2026-08-29T17:00:00.000Z",
  payloadSha256: hashCfbForwardEvidencePayload(currentTransitionPayload),
  payload: currentTransitionPayload,
};
const previousTransitionRows: CfbForwardStoredEvidence[] = [{
  ...evidence,
  id: "started-game-transition-previous-a",
  providerGameId: "future-current-game",
  gameStartAt: "2026-08-29T17:00:00.000Z",
  payloadSha256: hashCfbForwardEvidencePayload(previousTransitionPayload),
  payload: previousTransitionPayload,
}, {
  ...evidence,
  id: "started-game-transition-previous-b",
  providerGameId: "started-missing-game",
  gameStartAt: "2026-08-29T16:00:00.000Z",
  payloadSha256: hashCfbForwardEvidencePayload(previousTransitionPayload),
  payload: previousTransitionPayload,
}];
const beforeStartedGame = selectLatestCfbMemberEvidenceRows(
  [currentTransitionRow, ...previousTransitionRows.map((row) => ({
    ...row,
    stage: "unlocked" as const,
    payload: { ...row.payload, stage: "unlocked" as const },
  }))],
  "2026-08-29T15:59:59.000Z",
);
assert.equal(beforeStartedGame.length, 2);
assert.equal(
  beforeStartedGame.every((row) => String(row.payload.memberRelease) === "cfb_v1_member_release_2026_08_28_r15_directional_pmf"),
  true,
  "an upcoming game missing from the current release must keep the complete prior wave",
);
const afterStartedGame = selectLatestCfbMemberEvidenceRows(
  [currentTransitionRow, ...previousTransitionRows.map((row) => ({
    ...row,
    stage: "unlocked" as const,
    payload: { ...row.payload, stage: "unlocked" as const },
  }))],
  "2026-08-29T16:00:00.000Z",
);
assert.equal(afterStartedGame.length, 2);
assert.equal(afterStartedGame.find((row) => row.providerGameId === "future-current-game")?.payload.memberRelease, CFB_FORWARD_MEMBER_RELEASE);
assert.equal(afterStartedGame.find((row) => row.providerGameId === "started-missing-game")?.payload.memberRelease, "cfb_v1_member_release_2026_08_28_r15_directional_pmf");
assert.equal(
  afterStartedGame.find((row) => row.providerGameId === "started-missing-game")?.id,
  "started-game-transition-previous-b",
  "the transition must preserve the missing game's exact immutable pregame row",
);
const precedingReleaseRows: CfbForwardStoredEvidence[] = previousTransitionRows.map((row, index) => ({
  ...row,
  id: `immutable-boundary-previous-${index}`,
  stage: index === 1 ? "t60" : "unlocked",
  payloadSha256: hashCfbForwardEvidencePayload({
    ...ambiguousScopeTransitionPayload,
    stage: index === 1 ? "t60" : "unlocked",
  }),
  payload: {
    ...ambiguousScopeTransitionPayload,
    stage: index === 1 ? "t60" : "unlocked",
  },
}));
const immutableBoundarySelection = selectLatestCfbMemberEvidenceRows(
  [currentTransitionRow, ...previousTransitionRows, ...precedingReleaseRows],
  "2026-08-29T15:59:59.000Z",
);
assert.equal(immutableBoundarySelection.length, 2);
assert.equal(immutableBoundarySelection.find((row) => row.providerGameId === "future-current-game")?.payload.memberRelease, CFB_FORWARD_MEMBER_RELEASE);
assert.equal(
  immutableBoundarySelection.find((row) => row.providerGameId === "started-missing-game")?.id,
  "immutable-boundary-previous-1",
  "a future game already frozen at T-60 must retain its exact prior locked row while the new release publishes",
);
const heldBoundaryRows = precedingReleaseRows.map((row, index) => index !== 1 ? row : ({
  ...row,
  id: "held-boundary-previous-1",
  payload: {
    ...row.payload,
    captureTiming: "late_first_observation" as const,
    t60LagMinutes: 54,
    coverage: { ...row.payload.coverage, healthHolds: ["t60_capture_late"] },
    decisions: { ...row.payload.decisions, evaluatedBets: [], trackingEnabled: false },
  },
}));
const heldBoundarySelection = selectLatestCfbMemberEvidenceRows(
  [currentTransitionRow, ...previousTransitionRows, ...heldBoundaryRows],
  "2026-08-29T15:59:59.000Z",
);
assert.equal(
  heldBoundarySelection.some((row) => row.payload.memberRelease === CFB_FORWARD_MEMBER_RELEASE),
  false,
  "a held future T-60 cannot make a partial current wave readable as an immutable boundary transition",
);

const exactPricePayloadRecord = structuredClone(payload) as unknown as Record<string, unknown>;
exactPricePayloadRecord.schemaRelease = CFB_FORWARD_PRIOR_EVIDENCE_SCHEMA_RELEASE;
exactPricePayloadRecord.memberRelease = "cfb_v1_member_release_2026_08_28_r6_exact_paired_market_evidence";
delete exactPricePayloadRecord.outcomeForecast;
delete exactPricePayloadRecord.outcomeMarketOutlooks;
const exactPriceDecisions = exactPricePayloadRecord.decisions as Record<string, unknown>;
exactPriceDecisions.decisionRelease = "cfb_v1_daily_edge_decision_2026_08_28_r10_exact_paired_market_evidence";
exactPriceDecisions.evaluatedBets = (exactPriceDecisions.evaluatedBets as Array<Record<string, unknown>>).map((decision) => ({
  ...decision,
  decisionRelease: "cfb_v1_daily_edge_decision_2026_08_28_r10_exact_paired_market_evidence",
}));
const exactPricePayload = exactPricePayloadRecord as unknown as CfbForwardEvidencePayload;
const exactPriceMember = buildCfbMemberFixture([{ ...evidence, id: "exact-price-transition-row", payloadSha256: hashCfbForwardEvidencePayload(exactPricePayload), payload: exactPricePayload }]);
assert.equal(exactPriceMember.snapshot.games.length, 1, "the r4 exact-price wave remains visible through the bounded release fallbacks");
assert.equal(exactPriceMember.snapshot.games[0]!.footballOnlyProjection, null, "the bounded fallback keeps its original single-axis forecast contract");

const transitionPayload = structuredClone(payload) as unknown as Record<string, unknown>;
transitionPayload.schemaRelease = CFB_FORWARD_TRANSITION_EVIDENCE_SCHEMA_RELEASE;
transitionPayload.memberRelease = "cfb_v1_member_release_2026_08_27_r5_pmf_side_guard";
delete transitionPayload.outcomeForecast;
delete transitionPayload.outcomeMarketOutlooks;
const transitionDecisions = transitionPayload.decisions as Record<string, unknown>;
transitionDecisions.decisionRelease = "cfb_v1_daily_edge_decision_2026_08_27_r9_pmf_side_guard";
transitionDecisions.evaluatedBets = (transitionDecisions.evaluatedBets as Array<Record<string, unknown>>).map((decision) => ({
  ...decision,
  decisionRelease: "cfb_v1_daily_edge_decision_2026_08_27_r9_pmf_side_guard",
}));
const priorReleasePayload = transitionPayload as unknown as CfbForwardEvidencePayload;
const priorReleaseMember = buildCfbMemberFixture([{
  ...evidence,
  id: "prior-release-transition-row",
  payloadSha256: hashCfbForwardEvidencePayload(priorReleasePayload),
  payload: priorReleasePayload,
}]);
assert.equal(priorReleaseMember.snapshot.games.length, 1, "the last complete prior member wave must remain visible until the natural r6 refresh arrives");
assert.equal(priorReleaseMember.snapshot.games[0]!.markets.moneyline.verdict.label, member.snapshot.games[0]!.markets.moneyline.verdict.label);

const priceProvenancePayloadRecord = structuredClone(payload) as unknown as Record<string, unknown>;
priceProvenancePayloadRecord.schemaRelease = CFB_FORWARD_LEGACY_EVIDENCE_SCHEMA_RELEASE;
priceProvenancePayloadRecord.memberRelease = "cfb_v1_member_release_2026_08_26_r4_price_provenance";
delete priceProvenancePayloadRecord.outcomeForecast;
delete priceProvenancePayloadRecord.outcomeMarketOutlooks;
const priceProvenanceDecisions = priceProvenancePayloadRecord.decisions as Record<string, unknown>;
priceProvenanceDecisions.decisionRelease = "cfb_v1_daily_edge_decision_2026_08_26_r7_sharpapi_price_fallback";
priceProvenanceDecisions.evaluatedBets = (priceProvenanceDecisions.evaluatedBets as Array<Record<string, unknown>>).map((decision) => ({
  ...decision,
  decisionRelease: "cfb_v1_daily_edge_decision_2026_08_26_r7_sharpapi_price_fallback",
}));
const priceProvenancePayload = priceProvenancePayloadRecord as unknown as CfbForwardEvidencePayload;
const priceProvenanceMember = buildCfbMemberFixture([{ ...evidence, id: "price-provenance-transition-row", payloadSha256: hashCfbForwardEvidencePayload(priceProvenancePayload), payload: priceProvenancePayload }]);
assert.equal(priceProvenanceMember.snapshot.games.length, 1, "the r2 price-provenance wave remains a bounded transition fallback");

const legacyPayloadRecord = structuredClone(payload) as unknown as Record<string, unknown>;
legacyPayloadRecord.schemaRelease = CFB_FORWARD_INITIAL_EVIDENCE_SCHEMA_RELEASE;
legacyPayloadRecord.memberRelease = "cfb_v1_member_release_2026_08_25_r2_weekly";
delete legacyPayloadRecord.outcomeForecast;
delete legacyPayloadRecord.outcomeMarketOutlooks;
const legacyDecisions = legacyPayloadRecord.decisions as Record<string, unknown>;
legacyDecisions.decisionRelease = "cfb_v1_daily_edge_decision_2026_08_25_r5_weekly";
legacyDecisions.evaluatedBets = (legacyDecisions.evaluatedBets as Array<Record<string, unknown>>).map((decision) => ({ ...decision, decisionRelease: "cfb_v1_daily_edge_decision_2026_08_25_r5_weekly" }));
delete legacyDecisions.marketOutlooks;
const legacyPayload = legacyPayloadRecord as unknown as CfbForwardEvidencePayload;
const legacyMember = buildCfbMemberFixture([{ ...evidence, id: "legacy-transition-row", payloadSha256: hashCfbForwardEvidencePayload(legacyPayload), payload: legacyPayload }]);
assert.equal(legacyMember.snapshot.games.length, 1, "the actual r1 production wave must remain visible until a natural current-release refresh arrives");

const heldBundle = buildCfbV1DecisionBundle({
  providerGameId: game.providerGameId,
  awayTeam: game.away.abbreviation,
  homeTeam: game.home.abbreviation,
  gameStartsAt: game.scheduledStart,
  comparableCurrentBooks: [],
  forecast,
});
assert.deepEqual(cfbMarketAnchorHealthHolds(null), ["authoritative_market_anchor_unavailable"], "a missing canonical anchor must hold only that game's exact-price markets instead of aborting the weekly wave");
assert.deepEqual(cfbMarketAnchorHealthHolds(resolveCfbCanonicalMarketAnchor({ books: currentBooks })), [], "a coherent canonical anchor must not add an availability hold");
const heldPayload: CfbForwardEvidencePayload = {
  ...payload,
  authoritativeForecast: {
    status: "market_anchor_unavailable_hold",
    release: CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE,
    candidateRelease: CFB_MARKET_SHARP_AWARE_CANDIDATE_RELEASE,
    marketWeight: 0,
  },
  stage: "unlocked",
  capturedAt: observedAt,
  cutoffAt: "2026-08-29T15:00:00.000Z",
  t60LagMinutes: null,
  market: {
    ...payload.market,
    current: null,
    currentBooks: [],
    providerOpening: null,
    operationalOpening: null,
  },
  decisions: {
    ...heldBundle,
    forecast: publishedForecast,
    marketOutlooks: buildCfbForwardMarketOutlooks({ forecast, playbookLine: payload.market.playbookLine }),
  },
  coverage: {
    ...payload.coverage,
    currentOdds: false,
    comparableCurrentBookCount: 0,
    targetExcludedConsensusReady: false,
    operationalOpening: false,
  },
};
const heldMember = buildCfbMemberFixture([{
  ...evidence,
  id: "held-row",
  stage: "unlocked",
  capturedAt: observedAt,
  payloadSha256: hashCfbForwardEvidencePayload(heldPayload),
  payload: heldPayload,
}]);
const heldGame = heldMember.snapshot.games[0]!;
const heldProbabilities = cfbV1LineProbabilities({ forecast, homeSpread: -7.5, totalLine: 47.5 });
assert.equal(Object.values(heldGame.markets).every((market) => market.held), true, "missing named-book prices must hold exact-price grades");
assert.ok(Math.abs((heldGame.markets.moneyline.modelProb ?? 0) - heldProbabilities.moneyline.home) < 1e-12, "Held Moneyline must retain its independent winner probability");
assert.ok(Math.abs((heldGame.markets.first_inning.modelProb ?? 0) - heldProbabilities.spread.home) < 1e-12, "Held Spread must retain the same-PMF probability at the Playbook context line");
assert.ok(Math.abs((heldGame.markets.total.modelProb ?? 0) - heldProbabilities.total.over) < 1e-12, "Held Total must retain the same-PMF probability at the Playbook context line");
assert.equal(heldGame.markets.first_inning.line, -7.5);
assert.equal(heldGame.markets.total.line, 47.5);
assert.deepEqual(heldGame.markets.first_inning.marketPrediction, {
  status: "available",
  label: heldProbabilities.spread.home >= heldProbabilities.spread.away ? "TCU -7.5" : "UNC +7.5",
  line: heldProbabilities.spread.home >= heldProbabilities.spread.away ? -7.5 : 7.5,
  probability: Math.max(heldProbabilities.spread.home, heldProbabilities.spread.away),
  source: "model_at_context_line",
  sportsbook: null,
  observedAt,
  freshnessCheckedAt: observedAt,
  reason: "The authoritative joint-score PMF is evaluated at the current context line without turning that context into a sportsbook offer.",
});
assert.equal(
  dailyEdgeOutcomeForecastLabel({ game: heldGame, market: heldGame.markets.first_inning, marketKey: "first_inning", sport: "cfb" }),
  heldGame.markets.first_inning.marketPrediction?.label,
  "a held exact-price Spread must still publish its coherent PMF side at the current market line",
);
assert.equal(heldGame.markets.moneyline.marketFairProb, null);
assert.equal(heldGame.markets.moneyline.priceAmerican, null);
assert.equal(heldGame.markets.moneyline.recommendationConfidence, null);
assert.equal(heldGame.markets.moneyline.pick, null, "MLB-parity Held semantics cannot fabricate a CFB bet selection");
assert.deepEqual(heldGame.markets.moneyline.verdict, { key: "no_play", label: "No Play" }, "CFB member markets must never expose the internal recovery state as a prediction or Bet grade");
assert.equal(heldGame.markets.moneyline.modelProb !== null, true, "Outcome confidence remains independent from an exact-price Bet-grade hold");
assert.match(heldGame.markets.moneyline.displayReason ?? "", /prediction is .* primary outcome PMF.*Bet grade is No Play/);
assert.equal(heldGame.markets.moneyline.sharpBookAvailability?.message, "No verified sharp split is available for this market yet.", "Sharp price recovery cannot be mislabeled as betting-split coverage or expose the upstream source");

const publicHeldSnapshot = structuredClone(heldMember.snapshot);
const publicHeldResponse = finalizeDailyEdgeResponseCoherence(publicHeldSnapshot);
const publicHeldGame = publicHeldSnapshot.games[0]!;
const publicHeldMoneyline = publicHeldGame.markets.moneyline;
assert.equal(publicHeldMoneyline.held, true, "public mapping must preserve the internal recovery flag");
assert.deepEqual(publicHeldMoneyline.verdict, { key: "no_play", label: "No Play" }, "CFB exact-price exceptions must not expose a Held Bet grade");
assert.equal(publicHeldMoneyline.actionabilityLabel, "No Play");
assert.ok(Math.abs((publicHeldMoneyline.modelProb ?? 0) - heldProbabilities.moneyline.home) < 1e-12, "CFB public No Play must retain the independent outcome probability");
assert.deepEqual(publicHeldGame.projected, forecast.representativeScore, "CFB public No Play must retain the independent same-PMF representative score");
assert.equal(publicHeldGame.footballProjection?.expectedAwayPoints, forecast.expectedAwayPoints, "CFB public No Play must retain independent expected away points");
assert.equal(publicHeldGame.footballProjection?.expectedHomePoints, forecast.expectedHomePoints, "CFB public No Play must retain independent expected home points");
assert.equal(publicHeldGame.footballOnlyProjection, null, "CFB must not publish a market-anchor score as a second prediction");
assert.equal(publicHeldMoneyline.pick, null, "an unavailable exact-price tuple must not fabricate a Bet pick");
assert.equal(publicHeldMoneyline.priceAmerican, null);
assert.equal(publicHeldMoneyline.marketFairProb, null);
assert.equal(publicHeldMoneyline.pinnacleEvPct, null);
assert.equal(publicHeldMoneyline.recommendationConfidence, null);
assert.equal(publicHeldResponse.memberPresentation?.counts.operationalExceptions, 3);
assert.equal(publicHeldResponse.memberPresentation?.counts.publicNoPlayMarkets, 3);
for (const marketKey of ["moneyline", "total", "first_inning"] as const) {
  const label = dailyEdgeOutcomeForecastLabel({
    game: publicHeldGame,
    market: publicHeldGame.markets[marketKey],
    marketKey,
    sport: "cfb",
  });
  assert.doesNotMatch(label, /No Play|Held/, `CFB ${marketKey} prediction label cannot reuse its Bet grade or internal health state`);
}

const oneSidedMoneylinePayload: CfbForwardEvidencePayload = {
  ...heldPayload,
  market: {
    ...heldPayload.market,
    playbookLine: {
      ...heldPayload.market.playbookLine!,
      homeMoneyline: -50000,
      awayMoneyline: 1825,
    },
    displayBooks: [
      {
        providerGameId: game.providerGameId,
        sportsbook: "betmgm",
        observedAt,
        provider: "sharpapi",
        providerEventId: "ncaaf_unc_tcu_2026-08-29_b2",
        targetEligible: true,
        marketQuotes: [
          { market: "moneyline", side: "away", line: null, price: 6600, observedAt, marketSelection: "main_line" },
          { market: "spread", side: "home", line: -24.5, price: -110, observedAt, marketSelection: "main_line" },
        ],
        moneyline: null,
        spread: null,
        total: null,
      },
      {
        providerGameId: game.providerGameId,
        sportsbook: "sportzino",
        observedAt,
        provider: "sharpapi",
        providerEventId: "ncaaf_unc_tcu_2026-08-29_b2",
        targetEligible: false,
        marketQuotes: [{ market: "moneyline", side: "away", line: null, price: 2000, observedAt, marketSelection: "main_line" }],
        moneyline: null,
        spread: null,
        total: null,
      },
    ],
  },
};
const oneSidedMoneylineMember = buildCfbMemberFixture([{
  ...evidence,
  id: "one-sided-moneyline-row",
  stage: "unlocked",
  capturedAt: observedAt,
  payloadSha256: hashCfbForwardEvidencePayload(oneSidedMoneylinePayload),
  payload: oneSidedMoneylinePayload,
}]).snapshot.games[0]!.markets.moneyline;
assert.equal(oneSidedMoneylineMember.held, true, "one-sided odds cannot clear the internal exact-price grading safeguard");
assert.deepEqual(oneSidedMoneylineMember.verdict, { key: "no_play", label: "No Play" });
assert.equal(oneSidedMoneylineMember.pick, null, "one-sided context cannot become a Bet selection");
assert.equal(oneSidedMoneylineMember.priceAmerican, null, "one-sided context cannot become a grade price");
assert.equal(oneSidedMoneylineMember.currentPriceAmerican, null, "an opposing one-sided quote cannot be mislabeled as the predicted side's current price");
assert.equal(oneSidedMoneylineMember.marketSource, "sportzino", "a target-book outlier cannot outrank a corroborated representative sportsbook quote");
assert.equal(oneSidedMoneylineMember.opposingOddsTrail?.stops.at(-1)?.american, 2000, "the non-outlier opposing sportsbook quote must remain visible");
assert.match(oneSidedMoneylineMember.displayReason ?? "", /verified one-sided .*\+2000 at sportzino/i);
const contextQuoteSkewedAt = new Date(Date.parse(observedAt) + 2_000).toISOString();
const contextQuoteTooLateAt = new Date(Date.parse(observedAt) + 6_000).toISOString();
const skewedContextPayload = (quoteObservedAt: string): CfbForwardEvidencePayload => ({
  ...oneSidedMoneylinePayload,
  market: {
    ...oneSidedMoneylinePayload.market,
    displayBooks: oneSidedMoneylinePayload.market.displayBooks!.map((book) => ({
      ...book,
      observedAt: quoteObservedAt,
      marketQuotes: book.marketQuotes?.map((quote) => ({ ...quote, observedAt: quoteObservedAt })),
    })),
  },
});
const boundedSkewContextMember = buildCfbMemberFixture([{
  ...evidence,
  id: "bounded-skew-context-row",
  stage: "unlocked",
  capturedAt: observedAt,
  payloadSha256: hashCfbForwardEvidencePayload(skewedContextPayload(contextQuoteSkewedAt)),
  payload: skewedContextPayload(contextQuoteSkewedAt),
}]).snapshot.games[0]!.markets.moneyline;
assert.equal(boundedSkewContextMember.marketSource, "sportzino", "a same-response one-sided quote within five seconds of run start remains visible as context");
assert.equal(boundedSkewContextMember.opposingOddsTrail?.stops.at(-1)?.american, 2000);
assert.equal(boundedSkewContextMember.currentPriceAmerican, null, "bounded timestamp tolerance cannot turn opposing context into a bet price");
const lateContextMember = buildCfbMemberFixture([{
  ...evidence,
  id: "late-context-row",
  stage: "unlocked",
  capturedAt: observedAt,
  payloadSha256: hashCfbForwardEvidencePayload(skewedContextPayload(contextQuoteTooLateAt)),
  payload: skewedContextPayload(contextQuoteTooLateAt),
}]).snapshot.games[0]!.markets.moneyline;
assert.equal(lateContextMember.marketSource, null, "a one-sided quote more than five seconds after run start still fails closed");
assert.equal(lateContextMember.opposingOddsTrail?.stops.length, 0);
const outlierSpreadMember = buildCfbMemberFixture([{
  ...evidence,
  id: "outlier-spread-row",
  stage: "unlocked",
  capturedAt: observedAt,
  payloadSha256: hashCfbForwardEvidencePayload(oneSidedMoneylinePayload),
  payload: oneSidedMoneylinePayload,
}]).snapshot.games[0]!.markets.first_inning;
assert.equal(outlierSpreadMember.currentPriceAmerican, null, "a -24.5 display line cannot represent a market centered at -7.5");
assert.equal(outlierSpreadMember.oddsTrail?.length, 0, "an outlier display line must not enter the movement panel");

const thinBookBundle = buildCfbV1DecisionBundle({
  providerGameId: game.providerGameId,
  awayTeam: game.away.abbreviation,
  homeTeam: game.home.abbreviation,
  gameStartsAt: game.scheduledStart,
  comparableCurrentBooks: [currentBooks[0]!],
  forecast,
  contextLines: { homeSpread: -7.5, totalLine: 47.5 },
  evaluatedAt: observedAt,
});
assert.equal(thinBookBundle.evaluatedBets.length, 0, "one target book cannot become its own grading benchmark");
const thinBookPayload: CfbForwardEvidencePayload = {
  ...heldPayload,
  market: {
    ...heldPayload.market,
    current: currentBooks[0]!,
    currentBooks: [currentBooks[0]!],
  },
  decisions: {
    ...thinBookBundle,
    forecast: publishedForecast,
    marketOutlooks: buildCfbForwardMarketOutlooks({ forecast, playbookLine: payload.market.playbookLine }),
  },
  coverage: {
    ...heldPayload.coverage,
    currentOdds: true,
    comparableCurrentBookCount: 1,
  },
};
const thinBookMember = buildCfbMemberFixture([{
  ...evidence,
  id: "thin-book-row",
  stage: "unlocked",
  capturedAt: observedAt,
  payloadSha256: hashCfbForwardEvidencePayload(thinBookPayload),
  payload: thinBookPayload,
}]);
for (const marketKey of ["moneyline", "total", "first_inning"] as const) {
  const market = thinBookMember.snapshot.games[0]!.markets[marketKey];
  assert.equal(market.held, true, `${marketKey} remains unavailable for exact-price grading`);
  assert.equal(market.pick, null, `${marketKey} cannot turn a context quote into a Bet selection`);
  assert.equal(market.priceAmerican, null, `${marketKey} cannot turn a context quote into a grade price`);
  assert.notEqual(market.currentPriceAmerican, null, `${marketKey} must still surface the real current target-book quote`);
  assert.equal(market.currentPriceSportsbook, "fanduel", `${marketKey} must identify the real current sportsbook`);
  assert.equal(market.oddsTrail?.at(-1)?.sportsbook, "fanduel", `${marketKey} current context trail must stay same-book`);
}

const missingLinePayload = structuredClone(heldPayload);
missingLinePayload.market.playbookLine = null;
missingLinePayload.decisions.marketOutlooks = buildCfbForwardMarketOutlooks({ forecast, playbookLine: null });
const missingLineMember = buildCfbMemberFixture([{
  id: "missing-line-row",
  providerGameId: game.providerGameId,
  gameStartAt,
  stage: "unlocked",
  capturedAt: observedAt,
  payloadSha256: hashCfbForwardEvidencePayload(missingLinePayload),
  payload: missingLinePayload,
}]);
const missingSpreadMarket = missingLineMember.snapshot.games[0]!.markets.first_inning;
assert.equal(missingSpreadMarket.marketPrediction?.status, "market_data_unavailable");
assert.equal(missingSpreadMarket.marketPrediction?.label, null);
assert.equal(
  dailyEdgeOutcomeForecastLabel({ game: missingLineMember.snapshot.games[0]!, market: missingSpreadMarket, marketKey: "first_inning", sport: "cfb" }),
  "Spread prediction unavailable",
  "missing current Spread data must not present projected margin as a line-specific prediction",
);

const noTotalBooks = currentBooks.map((currentBook) => ({ ...currentBook, total: null }));
const noTotalBundle = buildCfbV1DecisionBundle({
  providerGameId: game.providerGameId,
  awayTeam: game.away.abbreviation,
  homeTeam: game.home.abbreviation,
  gameStartsAt: game.scheduledStart,
  comparableCurrentBooks: noTotalBooks,
  forecast,
  contextLines: { homeSpread: -7.5, totalLine: 47.5 },
});
assert.deepEqual(noTotalBundle.evaluatedBets.map((decision) => decision.market), ["moneyline", "spread"], "missing Total prices cannot suppress coherent Moneyline and Spread siblings");
assert.deepEqual(noTotalBundle.heldMarkets.map((row) => row.market), ["total"]);

const noSpreadBooks = currentBooks.map((currentBook) => ({ ...currentBook, spread: null }));
const noSpreadBundle = buildCfbV1DecisionBundle({
  providerGameId: game.providerGameId,
  awayTeam: game.away.abbreviation,
  homeTeam: game.home.abbreviation,
  gameStartsAt: game.scheduledStart,
  comparableCurrentBooks: noSpreadBooks,
  forecast,
  contextLines: { homeSpread: -7.5, totalLine: 47.5 },
});
assert.deepEqual(noSpreadBundle.evaluatedBets.map((decision) => decision.market), ["moneyline", "total"], "missing Spread prices cannot suppress coherent Moneyline and Total siblings when contextual calibration lines exist");
assert.deepEqual(noSpreadBundle.heldMarkets.map((row) => row.market), ["spread"]);

const earlierAt = "2026-08-25T14:50:05.583Z";
const unchangedMiddleAt = "2026-08-25T15:20:05.583Z";
const decisionBooksByMarket = new Map(productionBundle.evaluatedBets.map((decision) => [decision.market, normalizeSportsbook(decision.evaluatedQuote.sportsbook)]));
const earlierBooks = currentBooks.map((currentBook) => {
  const normalized = normalizeSportsbook(currentBook.sportsbook);
  return {
    ...currentBook,
    observedAt: earlierAt,
    moneyline: currentBook.moneyline && decisionBooksByMarket.get("moneyline") === normalized
      ? { homePrice: currentBook.moneyline.homePrice - 15, awayPrice: currentBook.moneyline.awayPrice - 10 }
      : currentBook.moneyline,
    spread: currentBook.spread && decisionBooksByMarket.get("spread") === normalized
      ? { homeLine: currentBook.spread.homeLine + 0.5, awayLine: currentBook.spread.awayLine - 0.5, homePrice: currentBook.spread.homePrice - 5, awayPrice: currentBook.spread.awayPrice + 5 }
      : currentBook.spread,
    total: currentBook.total && decisionBooksByMarket.get("total") === normalized
      ? { line: currentBook.total.line - 0.5, overPrice: currentBook.total.overPrice - 5, underPrice: currentBook.total.underPrice + 5 }
      : currentBook.total,
  } satisfies NcaafBookOdds;
});
const earlierPayload: CfbForwardEvidencePayload = {
  ...payload,
  schemaRelease: CFB_FORWARD_MARKET_SHARP_PREVIOUS_EVIDENCE_SCHEMA_RELEASE as typeof CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  memberRelease: "cfb_v1_member_release_2026_08_25_r1" as typeof CFB_FORWARD_MEMBER_RELEASE,
  runId: "00000000-0000-4000-8000-000000000002",
  stage: "opening",
  captureTiming: "on_time",
  capturedAt: earlierAt,
  cutoffAt: earlierAt,
  t60LagMinutes: null,
  market: {
    ...payload.market,
    current: earlierBooks[0]!,
    currentBooks: earlierBooks,
    operationalOpening: { provenance: "first_observed", capturedAt: earlierAt, quote: earlierBooks[0]! },
    playbookSplits: splitSetAt(earlierAt),
  },
  decisions: { ...payload.decisions, trackingEnabled: false },
};
const earlierEvidence: CfbForwardStoredEvidence = {
  ...evidence,
  id: "test-row-earlier",
  stage: "opening",
  capturedAt: earlierAt,
  payloadSha256: hashCfbForwardEvidencePayload(earlierPayload),
  payload: earlierPayload,
};
const unchangedMiddlePayload: CfbForwardEvidencePayload = {
  ...earlierPayload,
  runId: "00000000-0000-4000-8000-000000000003",
  stage: "unlocked",
  capturedAt: unchangedMiddleAt,
  cutoffAt: unchangedMiddleAt,
  market: {
    ...earlierPayload.market,
    current: { ...earlierBooks[0]!, observedAt: unchangedMiddleAt },
    currentBooks: earlierBooks.map((historicalBook) => ({ ...historicalBook, observedAt: unchangedMiddleAt })),
  },
};
const unchangedMiddleEvidence: CfbForwardStoredEvidence = {
  ...earlierEvidence,
  id: "test-row-unchanged-middle",
  stage: "unlocked",
  capturedAt: unchangedMiddleAt,
  payloadSha256: hashCfbForwardEvidencePayload(unchangedMiddlePayload),
  payload: unchangedMiddlePayload,
};
const movementMember = buildCfbMemberFixture([earlierEvidence, unchangedMiddleEvidence, evidence]);
const movementGame = movementMember.snapshot.games[0]!;
for (const decision of productionBundle.evaluatedBets) {
  const market = decision.market === "spread" ? movementGame.markets.first_inning : movementGame.markets[decision.market];
  const selectedSide = decision.market === "total"
    ? /^over\b/i.test(decision.side) ? "over" : "under"
    : decision.side.startsWith(game.home.abbreviation) ? "home" : "away";
  const opposingSide = selectedSide === "home" ? "away" : selectedSide === "away" ? "home" : selectedSide === "over" ? "under" : "over";
  const earlierBook = earlierBooks.find((candidate) => normalizeSportsbook(candidate.sportsbook) === normalizeSportsbook(decision.evaluatedQuote.sportsbook));
  const currentBook = currentBooks.find((candidate) => normalizeSportsbook(candidate.sportsbook) === normalizeSportsbook(decision.evaluatedQuote.sportsbook));
  assert.ok(earlierBook && currentBook, `${decision.market} must retain its exact evaluated sportsbook`);
  const expectedFirst = selectedQuote(earlierBook, decision.market, selectedSide);
  const expectedCurrent = selectedQuote(currentBook, decision.market, selectedSide);
  const expectedOpposingFirst = selectedQuote(earlierBook, decision.market, opposingSide);
  const expectedOpposingCurrent = selectedQuote(currentBook, decision.market, opposingSide);
  const oddsTrail = market.oddsTrail;
  const opposingTrail = market.opposingOddsTrail?.stops;
  assert.ok(oddsTrail, `${decision.market} must expose its selected-side movement trail`);
  assert.ok(opposingTrail, `${decision.market} must expose its opposing-side movement trail`);
  assert.deepEqual(
    oddsTrail.map((stop) => ({ price: stop.american, line: stop.line, at: stop.observedAt, book: normalizeSportsbook(stop.sportsbook ?? "") })),
    [
      { price: expectedFirst.price, line: expectedFirst.line, at: earlierAt, book: normalizeSportsbook(decision.evaluatedQuote.sportsbook) },
      { price: expectedCurrent.price, line: expectedCurrent.line, at: decision.evaluatedQuote.observedAt, book: normalizeSportsbook(decision.evaluatedQuote.sportsbook) },
    ],
    `${decision.market} must compact the unchanged prior-release capture while preserving exact earlier and current tuples`,
  );
  assert.deepEqual(
    opposingTrail.map((stop) => ({ price: stop.american, line: stop.line, at: stop.observedAt, book: normalizeSportsbook(stop.sportsbook ?? "") })),
    [
      { price: expectedOpposingFirst.price, line: expectedOpposingFirst.line, at: earlierAt, book: normalizeSportsbook(decision.evaluatedQuote.sportsbook) },
      { price: expectedOpposingCurrent.price, line: expectedOpposingCurrent.line, at: decision.evaluatedQuote.observedAt, book: normalizeSportsbook(decision.evaluatedQuote.sportsbook) },
    ],
    `${decision.market} opposing trail must never mix sportsbooks`,
  );
  assert.equal(market.pick, decision.side, `${decision.market} movement display cannot alter the evaluated pick`);
  assert.equal(market.actionabilityLabel, decision.grade, `${decision.market} movement display cannot alter the grade`);
  assert.ok(Date.parse(oddsTrail[0]!.observedAt!) < Date.parse(oddsTrail.at(-1)!.observedAt!), `${decision.market} trail must be chronological`);
}
assert.notEqual(member.provenance.sourceChecksum, movementMember.provenance.sourceChecksum, "historical evidence must contribute to the member checksum");
assert.equal(movementGame.markets.moneyline.moneyPctObservedAt, payload.market.playbookSplits?.moneyline.capturedAt, "split freshness must come from the authoritative latest row");
assert.equal(movementGame.markets.total.moneyPctObservedAt, payload.market.playbookSplits?.total.capturedAt, "Total split freshness must remain market-specific");
assert.equal(movementGame.markets.first_inning.moneyPctObservedAt, payload.market.playbookSplits?.spread.capturedAt, "Spread split freshness must remain market-specific");

const tracking = buildCfbOfficialTrackingRecords({ payload, gameId: 9001 });
assert.equal(tracking.length, 3);
assert.deepEqual(tracking.map((row) => row.market), ["moneyline", "spread", "total"]);
assert.equal(tracking.every((row) => row.locked_at === lockedAt), true);
assert.equal(tracking.every((row) => row.model_version === CFB_V1_DECISION_RELEASE), true);
assert.equal(tracking.every((row) => row.snapshot_json && !("pmf" in (row.snapshot_json.forecast as Record<string, unknown>))), true);
assert.equal(tracking.every((row) => row.snapshot_json?.football_market_scoped_tracking_release === FOOTBALL_MARKET_SCOPED_T60_TRACKING_RELEASE), true);

const marketScopedPayload: CfbForwardEvidencePayload = {
  ...payload,
  decisions: {
    ...applyCfbMarketSharpAwareGrades({
      homeTeam: game.home.abbreviation,
      bundle: buildCfbV1DecisionBundle({
        providerGameId: game.providerGameId,
        awayTeam: game.away.abbreviation,
        homeTeam: game.home.abbreviation,
        gameStartsAt: game.scheduledStart,
        comparableCurrentBooks: noMoneylineBooks,
        stage: "t60_locked",
        evaluatedAt: lockedAt,
        lockedAt,
        forecast: authoritativeForecast,
      }),
      sharpSplits: [],
      playbookLine: payload.market.playbookLine,
      publicSplits: payload.market.playbookSplits,
      operationalOpening: { quote: currentBooks[0]! },
    }),
    forecast: publishedAuthoritativeForecast,
    marketOutlooks: buildCfbForwardMarketOutlooks({
      forecast: authoritativeForecast,
      playbookLine: payload.market.playbookLine,
    }),
  },
};
const marketScopedTracking = buildCfbOfficialTrackingRecords({ payload: marketScopedPayload, gameId: 9001 });
assert.deepEqual(marketScopedTracking.map((row) => row.market), ["moneyline", "spread", "total"]);
assert.equal(marketScopedTracking.every((row) => row.locked_at === lockedAt), true);
const heldMoneylineTracking = marketScopedTracking.find((row) => row.market === "moneyline")!;
assert.equal(heldMoneylineTracking.held, true, "a missing exact Moneyline price must retain the forecast in accuracy tracking");
assert.equal(heldMoneylineTracking.no_bet, true, "a held forecast must remain non-actionable");
assert.equal(heldMoneylineTracking.odds_american, null, "a held forecast must not invent executable economics");
assert.equal(heldMoneylineTracking.side, "home", "held Moneyline tracking must preserve the authoritative forecast side");
assert.equal((heldMoneylineTracking.snapshot_json?.forecast_outlook as { market?: string } | undefined)?.market, "moneyline");
const priorT60Stored: CfbForwardStoredEvidence = {
  id: "71",
  providerGameId: marketScopedPayload.game.providerGameId,
  stage: "t60",
  capturedAt: marketScopedPayload.capturedAt,
  gameStartAt: marketScopedPayload.game.scheduledStart,
  payloadSha256: "tracking-backfill-fixture",
  payload: marketScopedPayload,
};
const ordinaryRefreshPayload = { ...marketScopedPayload, stage: "unlocked" as const, capturedAt: "2026-08-29T15:20:00.000Z" };
assert.deepEqual(
  cfbTrackingPayloadsForRun([priorT60Stored], [ordinaryRefreshPayload]).map((row) => row.game.providerGameId),
  [marketScopedPayload.game.providerGameId],
  "an ordinary collection run must retain prior immutable T-60 payloads for missing-market backfill",
);
assert.throws(
  () => buildCfbOfficialTrackingRecords({ payload: { ...marketScopedPayload, captureTiming: "late_first_observation" }, gameId: 9001 }),
  /eligible on-time T-60 evidence payload/,
);
assert.throws(
  () => buildCfbOfficialTrackingRecords({ payload: { ...marketScopedPayload, decisions: { ...marketScopedPayload.decisions, evaluatedBets: [] } }, gameId: 9001 }),
  /one to three exact-price market decisions/,
);

const openingPlan = planCfbForwardEvidenceCaptures({ games: [game], existing: [], capturedAt: "2026-08-25T16:00:00.000Z" });
assert.deepEqual(openingPlan.map((row) => row.stage), ["opening"]);
assert.equal(determineCfbForwardCollectionNeed({ existing: [], now: observedAt }).reason, "opening_seed");
const farFutureNeed = determineCfbForwardCollectionNeed({ existing: [evidenceAt("opening", "2026-08-25T16:00:00.000Z")], now: "2026-08-25T17:00:00.000Z" });
assert.deepEqual(farFutureNeed, { collect: false, reason: "cadence_not_due", cadenceMinutes: 360 }, "CFB games beyond 48 hours retain the six-hour refresh cadence");
const within48HourlyNeed = determineCfbForwardCollectionNeed({ existing: [evidenceAt("opening", "2026-08-27T19:00:00.000Z")], now: "2026-08-27T20:00:00.000Z" });
assert.deepEqual(within48HourlyNeed, { collect: true, reason: "unlocked_refresh_due", cadenceMinutes: 60 }, "CFB refreshes hourly once kickoff is within 48 hours");
const exact48HourlyNeed = determineCfbForwardCollectionNeed({ existing: [evidenceAt("opening", "2026-08-27T15:00:00.000Z")], now: "2026-08-27T16:00:00.000Z" });
assert.deepEqual(exact48HourlyNeed, { collect: true, reason: "unlocked_refresh_due", cadenceMinutes: 60 }, "the exact 48-hour boundary uses the hourly cadence");
const within24HourlyNeed = determineCfbForwardCollectionNeed({ existing: [evidenceAt("opening", "2026-08-28T19:00:00.000Z")], now: "2026-08-28T20:00:00.000Z" });
assert.deepEqual(within24HourlyNeed, { collect: true, reason: "unlocked_refresh_due", cadenceMinutes: 60 }, "CFB refreshes hourly once kickoff is within 24 hours");
const farGame: NcaafGame = { ...game, providerGameId: "far-game", scheduledStart: "2026-08-31T20:00:00.000Z" };
const farEvidenceBase = evidenceAt("opening", "2026-08-28T19:00:00.000Z");
const farEvidence: CfbForwardStoredEvidence = {
  ...farEvidenceBase,
  id: "far-game-opening",
  providerGameId: farGame.providerGameId,
  gameStartAt: farGame.scheduledStart,
  payload: { ...farEvidenceBase.payload, game: farGame },
};
const mixedCadencePlans = planCfbForwardEvidenceCaptures({
  games: [game, farGame],
  existing: [evidenceAt("opening", "2026-08-28T19:00:00.000Z"), farEvidence],
  capturedAt: "2026-08-28T20:00:00.000Z",
});
assert.deepEqual(mixedCadencePlans.map((plan) => plan.game.providerGameId), [game.providerGameId], "an hourly near game cannot force a game beyond 48 hours onto the hourly provider cadence");
const mixedCollectionNeed = determineCfbForwardCollectionNeed({
  existing: [evidenceAt("opening", "2026-08-28T19:30:00.000Z"), { ...farEvidence, capturedAt: "2026-08-28T13:00:00.000Z", payload: { ...farEvidence.payload, capturedAt: "2026-08-28T13:00:00.000Z" } }],
  now: "2026-08-28T20:00:00.000Z",
});
assert.deepEqual(mixedCollectionNeed, { collect: true, reason: "unlocked_refresh_due", cadenceMinutes: 360 }, "a due distant game cannot be masked by a newer near-game observation");
const lateT60 = planCfbForwardEvidenceCaptures({ games: [game], existing: [evidenceAt("opening", "2026-08-25T16:00:00.000Z")], capturedAt: "2026-08-29T15:21:00.000Z" });
assert.equal(lateT60[0]?.stage, "t60");
assert.equal(lateT60[0]?.t60LagMinutes, 21);
assert.ok((lateT60[0]?.t60LagMinutes ?? 0) > CFB_T60_MAX_CAPTURE_LAG_MINUTES);
assert.deepEqual(determineCfbForwardCollectionNeed({ existing: [evidenceAt("opening", "2026-08-29T14:00:00.000Z")], now: "2026-08-29T15:00:00.000Z" }), { collect: true, reason: "t60_due", cadenceMinutes: null }, "T-60 is an event-triggered lock, not a 15-minute collection cadence");

const legacyHeldT60Base = evidenceAt("t60", "2026-08-29T15:54:00.000Z");
const legacyHeldT60: CfbForwardStoredEvidence = {
  ...legacyHeldT60Base,
  payload: {
    ...legacyHeldT60Base.payload,
    schemaRelease: CFB_FORWARD_AMBIGUOUS_SCOPE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE as typeof CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
    stage: "t60",
    t60LagMinutes: 54,
    coverage: { ...legacyHeldT60Base.payload.coverage, healthHolds: ["t60_capture_late"] },
    decisions: { ...legacyHeldT60Base.payload.decisions, evaluatedBets: [], trackingEnabled: false },
  },
};
const planningWithoutLegacyHold = cfbLockPlanningEvidence([evidenceAt("opening", "2026-08-28T20:00:00.000Z"), legacyHeldT60]);
assert.equal(planningWithoutLegacyHold.some((row) => row.stage === "t60"), false, "a held prior-release T-60 cannot satisfy the active release lock boundary");
assert.equal(planCfbForwardEvidenceCaptures({ games: [game], existing: planningWithoutLegacyHold, capturedAt: "2026-08-29T15:55:00.000Z" })[0]?.stage, "t60");
const validPriorT60: CfbForwardStoredEvidence = {
  ...legacyHeldT60,
  capturedAt: lockedAt,
  payload: {
    ...payload,
    schemaRelease: CFB_FORWARD_AMBIGUOUS_SCOPE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE as typeof CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  },
};
assert.equal(cfbLockPlanningEvidence([validPriorT60]).length, 1, "a genuinely valid immutable prior-release T-60 remains frozen and blocks a replacement lock");
const currentHeldT60: CfbForwardStoredEvidence = {
  ...legacyHeldT60,
  payload: { ...legacyHeldT60.payload, schemaRelease: CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE },
};
assert.equal(cfbLockPlanningEvidence([currentHeldT60]).length, 1, "an active-release held T-60 remains terminal for that release and cannot be appended twice");

const playbookLine = normalizeCfbPlaybookLine({ lineSourceTier: "tier1", lines: { spread: { home: -7.5, away: 7.5 }, total: 47.5, moneyline: { home: -330, away: 260 } } }, observedAt);
assert.deepEqual(playbookLine && { home: playbookLine.homeSpread, away: playbookLine.awaySpread, total: playbookLine.total }, { home: -7.5, away: 7.5, total: 47.5 });
const playbookSplits = normalizeCfbPlaybookSplits(playbookRaw(), observedAt);
assert.equal(playbookSplits?.moneyline.homeMoneyPct, 90);
assert.equal(playbookSplits?.spread.awayBetsPct, 29);
assert.equal(playbookSplits?.total.overMoneyPct, 27);
assert.equal(playbookSplits?.total.underBetsPct, 65);

const requestedUrls: string[] = [];
const qbResult = await fetchBalldontlieNcaafQuarterbacks({
  teams: [{ id: 10, abbreviation: "UNC" }],
  previousSeason: 2025,
  capturedAt: observedAt,
  apiKey: "test",
  fetchImpl: (async (input: URL | RequestInfo) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes("/players/active")) return Response.json({ data: [
      { id: 101, first_name: "Experienced", last_name: "QB", position_abbreviation: "QB", jersey_number: "7", team: { id: 10 } },
      { id: 102, first_name: "Backup", last_name: "QB", position_abbreviation: "QB", jersey_number: "12", team: { id: 10 } },
    ], meta: { next_cursor: null } });
    return Response.json({ data: [
      { player: { id: 101 }, passing_attempts: 310, passing_yards: 2600 },
      { player: { id: 102 }, passing_attempts: 22, passing_yards: 150 },
    ], meta: { next_cursor: null } });
  }) as typeof fetch,
});
assert.equal(qbResult.providerRequests, 2);
assert.equal(qbResult.byTeamId.get(10)?.expectedStartingQuarterback?.name, "Experienced QB");
assert.equal(qbResult.byTeamId.get(10)?.starterStatus, "projected");
assert.equal(requestedUrls.every((url) => url.startsWith("https://api.balldontlie.io/ncaaf/v1/")), true);

const launchTeams = [
  { id: 10, abbreviation: "UNC" },
  { id: 43, abbreviation: "TCU" },
  { id: 101, abbreviation: "SJSU" },
  { id: 63, abbreviation: "USC" },
  { id: 9, abbreviation: "NCSU" },
  { id: 15, abbreviation: "UVA" },
  { id: 68, abbreviation: "JXST" },
  { id: 183, abbreviation: "NDSU" },
  { id: 146, abbreviation: "SAC" },
  { id: 85, abbreviation: "EMU" },
  { id: 97, abbreviation: "HAW" },
  { id: 13, abbreviation: "STAN" },
  { id: 74, abbreviation: "NMSU" },
  { id: 5, abbreviation: "FSU" },
  { id: 22, abbreviation: "MEM" },
  { id: 102, abbreviation: "UNLV" },
];
const launchRosterUrls: string[] = [];
const launchQbs = await fetchBalldontlieNcaafQuarterbacks({
  teams: launchTeams,
  previousSeason: 2025,
  capturedAt: observedAt,
  apiKey: "test",
  fetchImpl: (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    launchRosterUrls.push(url.toString());
    if (url.pathname.endsWith("/players/active")) {
      const requestedTeamIds = url.searchParams.getAll("team_ids[]");
      assert.equal(requestedTeamIds.length, 1, "active roster requests must be scoped to one exact slate team");
      const teamId = Number(requestedTeamIds[0]);
      assert.ok(launchTeams.some((team) => team.id === teamId));
      return Response.json({ data: [{ id: teamId * 100, first_name: `QB${teamId}`, last_name: "Starter", position_abbreviation: "QB", team: { id: teamId } }], meta: { next_cursor: null } });
    }
    const requestedPlayerIds = url.searchParams.getAll("player_ids[]").map(Number);
    assert.equal(requestedPlayerIds.length, launchTeams.length);
    return Response.json({ data: requestedPlayerIds.map((playerId) => ({ player: { id: playerId }, passing_attempts: playerId, passing_yards: playerId * 8 })), meta: { next_cursor: null } });
  }) as typeof fetch,
});
assert.equal(launchQbs.byTeamId.size, 16);
assert.equal(launchQbs.providerRequests, 17, "the exact eight-game launch slate must use 16 team-scoped roster calls plus one QB-stat call when each fits one page");
assert.equal(launchRosterUrls.filter((url) => url.includes("/players/active")).length, 16);
assert.ok(launchQbs.providerRequests <= 34, "the launch slate must remain inside the hard 34-call QB-context budget");

let boundedFailureRequests = 0;
await assert.rejects(
  fetchBalldontlieNcaafQuarterbacks({
    teams: [{ id: 10, abbreviation: "UNC" }],
    previousSeason: 2025,
    capturedAt: observedAt,
    apiKey: "test",
    activeRosterPagesPerTeam: 2,
    statsPageBudget: 1,
    maxProviderRequests: 3,
    fetchImpl: (async () => {
      boundedFailureRequests += 1;
      return Response.json({ data: [{ id: 101, first_name: "QB", last_name: "One", position_abbreviation: "QB", team: { id: 10 } }], meta: { next_cursor: boundedFailureRequests } });
    }) as typeof fetch,
  }),
  /\/players\/active exceeded its pagination budget/,
);
assert.equal(boundedFailureRequests, 2, "team-scoped pagination must fail closed at its declared per-team page limit");

await assert.rejects(
  fetchBalldontlieNcaafQuarterbacks({
    teams: [{ id: 10, abbreviation: "UNC" }],
    previousSeason: 2025,
    capturedAt: observedAt,
    apiKey: "test",
    fetchImpl: (async () => Response.json({ data: [{ id: 999, first_name: "Wrong", last_name: "Team", position_abbreviation: "QB", team: { id: 43 } }], meta: { next_cursor: null } })) as typeof fetch,
  }),
  /returned team 43 for team-scoped request 10/,
);

const writerSource = readFileSync(path.join(process.cwd(), "lib/services/football/cfbForwardEvidenceWriter.ts"), "utf8");
const memberSnapshotStoreSource = readFileSync(path.join(process.cwd(), "lib/services/football/cfbForwardMemberSnapshotStore.ts"), "utf8");
const sharpOddsSource = readFileSync(path.join(process.cwd(), "lib/services/football/cfbSharpApiOdds.ts"), "utf8");
const quarterbackCollectionIndex = writerSource.indexOf("fetchBalldontlieNcaafQuarterbacks");
const sharpFallbackIndex = writerSource.indexOf("fetchSharpApiNcaafOddsFallback");
const sharpSplitsIndex = writerSource.indexOf("fetchCfbSharpApiSplits({ games, apiKey");
const coherenceIndex = writerSource.indexOf("assertFootballCrossMarketCoherence({");
const evidenceAppendIndex = writerSource.lastIndexOf("appendCfbForwardEvidence(");
assert.ok(quarterbackCollectionIndex >= 0 && evidenceAppendIndex > quarterbackCollectionIndex, "the writer must finish bounded QB collection before its sole evidence append");
assert.match(writerSource, /const need = releaseRefreshNeed\(existing, args\.now\) \?\? ordinaryNeed;/, "an incomplete current release must take planning priority over ordinary cadence and T-60 reasons");
assert.ok(sharpFallbackIndex >= 0 && evidenceAppendIndex > sharpFallbackIndex, "the writer must finish bounded SharpAPI exact-event fallback before its sole evidence append");
assert.ok(sharpSplitsIndex >= 0 && evidenceAppendIndex > sharpSplitsIndex, "the sole writer must finish its one league-level strict split read before the all-game append");
assert.ok(coherenceIndex >= 0 && evidenceAppendIndex > coherenceIndex, "the sole CFB writer must pass coherence before its append boundary");
assert.equal((writerSource.match(/assertFootballCrossMarketCoherence\(\{/g) ?? []).length, 1, "the CFB writer must use one shared per-payload coherence gate");
assert.match(writerSource, /requireDecisionSideFromForecast: true/, "the CFB writer must fail closed on an exact-line PMF/decision-side contradiction");
assert.match(writerSource, /publicScoreDirectionTolerancePoints: CFB_PUBLIC_SCORE_DIRECTION_TOLERANCE_POINTS/, "the CFB writer must apply the publication contract's narrow 0.5-point mean/median tolerance");
assert.equal((writerSource.match(/fetchCfbSharpApiSplits\(\{ games, apiKey/g) ?? []).length, 1, "SharpAPI splits must remain one bounded slate request rather than a per-game loop");
assert.match(writerSource, /buildCfbMarketSharpAwareForecast/, "the sole writer must build the bounded market\/sharp-aware authoritative PMF");
assert.match(writerSource, /applyCfbMarketSharpAwareGrades/, "the sole writer must own balanced market\/sharp-aware grade promotion and demotion");
assert.match(sharpOddsSource, /path: "\/events"/, "CFB named-book recovery must discover SharpAPI's canonical events before requesting odds");
assert.match(sharpOddsSource, /league: "ncaaf"/, "canonical event discovery must stay league-scoped");
assert.match(sharpOddsSource, /path: "\/odds"[\s\S]*event_id: eventId[\s\S]*market: "main"/, "canonical event odds must stay exact-event and main-market scoped");
assert.doesNotMatch(sharpOddsSource, /sharpEventIdCandidates|teamSlug\(/, "the writer path must not reconstruct or guess provider event bucket IDs");
assert.equal((writerSource.match(/appendCfbForwardEvidence\(/g) ?? []).length, 1, "the writer must keep one all-payload append and never insert partial game evidence inside the collection loop");
assert.match(writerSource, /refreshCompactMemberSnapshot\(\{ client: args\.client, existing: allExisting, payloads/, "the sole writer must publish the compact member snapshot from the same authoritative evidence rows");
assert.match(writerSource, /memberSnapshotError: error instanceof Error/, "member snapshot publication failure must be isolated from authoritative evidence and tracking writes");
assert.match(memberSnapshotStoreSource, /\.from\("lab_response_snapshots"\)\.upsert/, "CFB must reuse the existing response snapshot table rather than add a writer or table");
assert.match(memberSnapshotStoreSource, /const SNAPSHOT_STALE_MS = 8 \* 60 \* 60 \* 1000/, "the published fixture must retain a bounded eight-hour last-known-good window");
const evidenceStoreSource = readFileSync(path.join(process.cwd(), "lib/services/football/cfbForwardEvidenceStore.ts"), "utf8");
assert.match(evidenceStoreSource, /CFB_FORWARD_PREVIOUS_EVIDENCE_SCHEMA_RELEASE/, "the reader must retain the complete r4 exact-price wave during the natural r5 transition");
assert.match(evidenceStoreSource, /CFB_FORWARD_IDENTITY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE/, "the reader must retain the complete r46 wave during the natural r47 transition");
assert.equal(CFB_FORWARD_EVIDENCE_PAGE_SIZE, 1_000);
assert.equal(CFB_FORWARD_EVIDENCE_MAX_ROWS, 50_000);
assert.match(evidenceStoreSource, /\.order\("captured_at", \{ ascending: true \}\)\s*\.order\("id", \{ ascending: true \}\)\s*\.range\(from, from \+ CFB_FORWARD_EVIDENCE_PAGE_SIZE - 1\)/, "the CFB evidence reader must paginate with a stable timestamp-and-ID order");
assert.match(evidenceStoreSource, /exceeded its bounded.*row season limit/, "the CFB evidence reader must fail explicitly at its hard cap instead of silently truncating a release wave");
const evidenceRanges: Array<[number, number]> = [];
const storedEvidenceRow = {
  id: evidence.id,
  provider_game_id: evidence.providerGameId,
  stage: evidence.stage,
  captured_at: evidence.capturedAt,
  game_start_at: evidence.gameStartAt,
  payload_sha256: evidence.payloadSha256,
  payload: evidence.payload,
};
const pagedEvidenceClient = {
  from() {
    const query = {
      select() { return query; },
      in() { return query; },
      eq() { return query; },
      order() { return query; },
      range(from: number, to: number) {
        evidenceRanges.push([from, to]);
        return Promise.resolve({ data: from === 0 ? Array.from({ length: 1_000 }, () => storedEvidenceRow) : [{ ...storedEvidenceRow, id: "second-page-row" }], error: null });
      },
    };
    return query;
  },
} as unknown as SupabaseClient;
const pagedEvidence = await readCfbForwardEvidence({ client: pagedEvidenceClient, season: 2026 });
assert.equal(pagedEvidence.length, 1_001, "a complete evidence read must include the second Supabase page");
assert.deepEqual(evidenceRanges, [[0, 999], [1_000, 1_999]], "the reader must advance in exact non-overlapping 1,000-row pages");

const scoreReadClient = {
  from(table: string) {
    assert.equal(table, "games");
    const query = {
      select() { return query; },
      eq() { return query; },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(resolve({ data: [{ id: 9001, external_id: 457157, game_date: gameStartAt, status: "scheduled", home_score: null, away_score: null }], error: null }));
      },
    };
    return query;
  },
} as unknown as SupabaseClient;
const scoreProviderUrls: string[] = [];
const scoreIngest = await ingestCfbFinalScores({
  supabase: scoreReadClient,
  slateDate: "2026-08-29",
  apply: false,
  apiKey: "test",
  fetchImpl: (async (input) => {
    scoreProviderUrls.push(input instanceof Request ? input.url : String(input));
    return Response.json({ data: [{
    id: 457157,
    season: 2026,
    week: 1,
    date: gameStartAt,
    status_state: "final",
    home_team_score: 34,
    visitor_team_score: 17,
    home_team: { id: 43, conference: 3, abbreviation: "TCU", full_name: "TCU Horned Frogs" },
    visitor_team: { id: 10, conference: 1, abbreviation: "UNC", full_name: "North Carolina Tar Heels" },
    // Same-date rows that were not requested must never reach settlement.
  }, {
    id: 999999,
    season: 2026,
    week: 1,
    date: gameStartAt,
    status_state: "final",
    home_score: 21,
    away_score: 20,
    home_team: { id: 1, conference: 1, abbreviation: "AAA", full_name: "AAA" },
    visitor_team: { id: 2, conference: 1, abbreviation: "BBB", full_name: "BBB" },
  }], meta: { next_cursor: null } });
  }) as typeof fetch,
});
assert.equal(scoreIngest.providerRequests, 1);
assert.equal(scoreIngest.updatedCount, 1);
assert.equal(scoreIngest.errors.length, 0);
assert.equal(scoreProviderUrls.length, 1);
const scoreProviderUrl = new URL(scoreProviderUrls[0]!);
assert.deepEqual(scoreProviderUrl.searchParams.getAll("dates[]"), ["2026-08-29"], "CFB settlement must use the supported UTC dates filter");
assert.equal(scoreProviderUrl.searchParams.has("game_ids[]"), false, "the NCAAF games collection does not support game_ids[]");

const route = readFileSync(path.resolve("app/api/cron/cfb-forward-evidence/route.ts"), "utf8");
assert.match(route, /member_snapshot_updated: result\.memberSnapshotUpdated/, "the existing CFB cron must report compact snapshot health truthfully");
assert.match(route, /member_snapshot_error: result\.memberSnapshotError/, "the existing CFB cron must expose isolated snapshot publication failures");
assert.match(route, /leaseGroup: "prediction_pipeline"/);
assert.match(route, /requireLease: true/);
assert.match(route, /runCfbForwardEvidenceWriter/);
assert.match(route, /requiredEnv\("SHARPAPI_KEY"\)/);
const writer = readFileSync(path.resolve("lib/services/football/cfbForwardEvidenceWriter.ts"), "utf8");
assert.match(writer, /buildCfbV1DecisionBundle/);
assert.match(writer, /publishCfbForwardDecisionBundle/);
assert.doesNotMatch(writer, /mean_pmf_near_tossup_conflict|shouldHoldCfbNearTossupTotalConflict/, "the writer cannot delete a complete authoritative Total as a near-tossup publication hold");
assert.match(writer, /buildCfbOfficialTrackingRecords/);
assert.match(writer, /buildMarketScopedFootballTrackingPlan/);
assert.doesNotMatch(writer, /eligible\.length \* 3/);
assert.doesNotMatch(writer, /create.*writer|second.*writer/i);
const migration = readFileSync(path.resolve("lib/db/schema-migration-v40-cfb-forward-evidence.sql"), "utf8");
const executableMigration = migration.replace(/--.*$/gm, "");
assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.cfb_forward_evidence_snapshots TO service_role/);
assert.match(migration, /REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER/);
assert.doesNotMatch(executableMigration, /GRANT[^;]*(UPDATE|DELETE)[^;]*cfb_forward_evidence_snapshots/i);
const vercel = JSON.parse(readFileSync(path.resolve("vercel.json"), "utf8")) as { crons: Array<{ path: string }> };
assert.equal(vercel.crons.filter((cron) => cron.path === "/api/cron/cfb-forward-evidence").length, 1);
const reader = readFileSync(path.resolve("app/dev/experience-preview/ActualDailyEdgePreview.tsx"), "utf8");
assert.match(reader, /sport === "nfl" \|\| sport === "cfb" \? "Expected score"/);
assert.match(reader, /Representative final/);
assert.match(reader, /footballExpectedAway\.toFixed\(1\)/);
assert.match(reader, /presentDailyEdgeOperationalNoPlay/, "CFB must pass through the shared operational-health presentation boundary");
assert.match(reader, /dailyEdgeOutcomeForecastLabel/, "CFB prediction surfaces must use the protected-main model-native forecast helper");
assert.doesNotMatch(reader, /market\.pick \?\? "No Play"/, "CFB prediction surfaces cannot reuse a Bet grade as the forecast label");
const outcomeForecast = readFileSync(path.resolve("app/lab/lib/dailyEdgeOutcomeForecast.ts"), "utf8");
assert.match(outcomeForecast, /game\.footballProjection/, "CFB unavailable Moneyline must recover its football-only winner forecast");
assert.match(outcomeForecast, /market\.modelTotal/, "CFB unavailable Total must retain its same-PMF projected total");
const presentation = readFileSync(path.resolve("app/lab/lib/dailyEdgeMarketPresentation.ts"), "utf8");
assert.match(presentation, /No Play — required evidence is incomplete\./, "the public No Play must retain an explicit data-health reason");
assert.match(presentation, /held.{0,20}deliberately remains true/, "the member mapping must preserve internal recovery state");
const sharedTypes = readFileSync(path.resolve("app/lab/lib/labTypes.ts"), "utf8");
assert.match(sharedTypes, /export (?:interface|type) MarketEdgeDto/, "CFB must continue to adapt into the shared Daily Edge market DTO");
assert.match(sharedTypes, /held: boolean/, "shared Held semantics remain a DTO contract rather than a CFB presentation fork");
assert.match(sharedTypes, /footballOnlyProjection\?:/, "the legacy secondary forecast field remains readable while the active CFB contract leaves it null");
const dailyEdgeShell = readFileSync(path.resolve("app/lab/components/daily-edge/DailyEdgeShell.tsx"), "utf8");
assert.match(dailyEdgeShell, /const usesSportOwnedLogo = isSoccer \|\| shellSport === "cfb";/,
  "CFB team abbreviations must never fall through to another sport's ESPN logo namespace");
assert.match(dailyEdgeShell, /if \(usesSportOwnedLogo && !logo\)/,
  "CFB teams without an authoritative sport-owned logo must render the abbreviation fallback");
const trackingRefresh = readFileSync(path.resolve("lib/services/trackingRefreshService.ts"), "utf8");
assert.match(trackingRefresh, /sport === "cfb"/);
assert.match(trackingRefresh, /ingestCfbFinalScores/);
const trackingRoute = readFileSync(path.resolve("app/api/cron/tracking-refresh/route.ts"), "utf8");
assert.match(trackingRoute, /"nfl", "cfb"/);

console.log("CFB v1 production contract: PMF coherence, representative score, exact-price grades, compact evidence, T-60 tracking, provider normalization, one writer, and normal reader passed.");

function book(sportsbook: string, homeMl: number, awayMl: number, homeLine: number, homeSpreadPrice: number, awaySpreadPrice: number, totalLine: number, overPrice: number, underPrice: number): NcaafBookOdds {
  return { providerGameId: game.providerGameId, sportsbook, observedAt, moneyline: { homePrice: homeMl, awayPrice: awayMl }, spread: { homeLine, homePrice: homeSpreadPrice, awayLine: -homeLine, awayPrice: awaySpreadPrice }, total: { line: totalLine, overPrice, underPrice } };
}

function quarterback(teamId: number, team: string, name: string) {
  const player = { playerId: String(teamId * 100), name, position: "QB" as const, jerseyNumber: null, previousSeasonPassingAttempts: 200, previousSeasonPassingYards: 1800 };
  return { provider: "balldontlie" as const, teamId, team, capturedAt: lockedAt, starterStatus: "projected" as const, projectionMethod: "active_roster_previous_season_attempts" as const, expectedStartingQuarterback: player, activeQuarterbacks: [player] };
}

function splitSet() {
  const result = normalizeCfbPlaybookSplits(playbookRaw(), observedAt);
  assert.ok(result);
  return result;
}

function splitSetAt(capturedAt: string) {
  const result = normalizeCfbPlaybookSplits(playbookRaw(), capturedAt);
  assert.ok(result);
  return result;
}

function normalizeSportsbook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function selectedQuote(book: NcaafBookOdds, market: "moneyline" | "spread" | "total", side: "home" | "away" | "over" | "under"): { price: number; line: number | null } {
  if (market === "moneyline" && book.moneyline) return { price: side === "home" ? book.moneyline.homePrice : book.moneyline.awayPrice, line: null };
  if (market === "spread" && book.spread) return { price: side === "home" ? book.spread.homePrice : book.spread.awayPrice, line: side === "home" ? book.spread.homeLine : book.spread.awayLine };
  if (market === "total" && book.total) return { price: side === "over" ? book.total.overPrice : book.total.underPrice, line: book.total.line };
  throw new Error(`Missing ${market} quote for ${book.sportsbook}.`);
}

function playbookRaw() {
  return { splits: {
    moneyline: { bets: { homePercent: 85, awayPercent: 15 }, money: { homePercent: 90, awayPercent: 10 }, source: { booksUsed: 11 } },
    spread: { bets: { homePercent: 71, awayPercent: 29 }, money: { homePercent: 75, awayPercent: 25 }, source: { booksUsed: 11 } },
    total: { bets: { overPercent: 35, underPercent: 65 }, money: { overPercent: 27, underPercent: 73 }, source: { booksUsed: 11 } },
  } };
}

function evidenceAt(stage: "opening" | "unlocked" | "t60", capturedAt: string): CfbForwardStoredEvidence {
  return { ...evidence, id: `${stage}-${capturedAt}`, stage, capturedAt, payload: { ...payload, stage, capturedAt, decisions: { ...payload.decisions, trackingEnabled: stage === "t60" } } };
}
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
