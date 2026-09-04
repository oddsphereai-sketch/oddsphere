import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BallDontLieUclProvider, BALLDONTLIE_UCL_API_BASE_URL, type BdlUclMatch, type UclHistoryFetchTelemetry } from "../lib/providers/real_api/BallDontLieUclProvider";
import { SHARP_UCL_LEAGUE, uclTeamsMatch } from "../lib/providers/real_api/SharpApiEplMarketProvider";
import { normalizeDoubleChanceSelection, normalizeMatchResultSelection, normalizeSharpApiMarketType, normalizeTotalSelection, normalizeBttsSelection } from "../lib/providers/real_api/_soccerMarketNormalizer";
import { buildUclCompetitionContexts, regulationScore, UCL_COMPETITION, UCL_EXTERNAL_ID_OFFSET, UCL_EXTERNAL_ID_UPPER_BOUND, uclProviderIdFromExternal } from "../lib/services/ucl/uclCompetitionContext";
import { buildUclTravelRestContext, fitAndPredictUcl, joinUclMatchStats, UCL_CALIBRATION_RELEASE, UCL_COHERENT_OUTCOME_RELEASE, UCL_MODEL_RELEASE } from "../lib/services/ucl/uclModel";
import { groupUclMatchweeks, selectUclMatchweek, visibleUclMatchweekFixtures } from "../lib/services/ucl/buildUclSlate";
import { eplPriorRowsBlockWrite } from "../lib/services/epl/eplProductionPipeline";
import { deriveUclMatchResultDecision, deriveUclPreviewGrade } from "../lib/services/ucl/uclPreviewGrade";
import { resolveUclFeatureFlags, resolveUclSettlementGradingPlan, resolveUclTrackingVisibility } from "../lib/services/ucl/uclFeatureFlags";
import { isCurrentUclTrackingRelease, isTrackingRecordEligible, isUclTrackingRecord, trackingDisplaySport } from "../lib/services/trackingAggregateService";
import { getOfficialTrackingMarkets } from "../lib/config/officialTrackingMarkets";
import { evaluateUclPublicationCoverage, mergeVerifiedUclLocksIntoLastKnownGood, uclPriceCollapseIsRecovered } from "../lib/services/ucl/uclPublicationReadiness";
import { canonicalUclOpeningOdds } from "../lib/services/ucl/uclOpeningOddsEvaluation";
import type { PredictionRecordRow } from "../lib/types/domain/Tracking";
import {
  assertFrozenUclChronologicalManifest,
  assertFrozenUclHistoricalStats,
  assertFrozenUclHistoryTelemetry,
  assertUclHistoricalStatsIdentity,
  uclHistoricalStatsManifestDigest,
  UCL_CHRONOLOGICAL_MANIFEST,
} from "../lib/services/ucl/uclChronologicalManifest";
import { UCL_TEAM_ASSETS, uclTeamAsset, uclTeamLogo } from "../lib/services/ucl/uclTeamAssets";
import { buildEplPreviewCacheKey } from "../lib/services/epl/buildEplDailyEdgePreview";

function match(overrides: Partial<BdlUclMatch> & Pick<BdlUclMatch, "id" | "home_team_id" | "away_team_id" | "date">): BdlUclMatch {
  return {
    season: 2026,
    name: "Away at Home",
    short_name: "AWY @ HOM",
    status: "STATUS_SCHEDULED",
    status_state: "scheduled",
    status_detail: null,
    home_score: null,
    away_score: null,
    venue_name: "Test Ground",
    venue_city: "London",
    round_number: null,
    ...overrides,
  };
}

async function main() {

// Provider product/auth identity: dedicated UCL v1, no invented league id.
const calls: Array<{ url: string; auth: string | null }> = [];
const provider = new BallDontLieUclProvider("test-ucl-key", async (input, init) => {
  calls.push({ url: String(input), auth: new Headers(init?.headers).get("Authorization") });
  return new Response(JSON.stringify({ data: [{ id: 1, season: 2026 }], meta: { next_cursor: null } }), { status: 200, headers: { "Content-Type": "application/json" } });
});
await provider.listCurrentSeasonMatches(2026);
assert.equal(calls[0]?.url.startsWith(`${BALLDONTLIE_UCL_API_BASE_URL}/matches?`), true);
assert.deepEqual(new URL(calls[0]!.url).searchParams.getAll("seasons[]"), []);
assert.equal(new URL(calls[0]!.url).searchParams.get("season"), "2026");
assert.equal(new URL(calls[0]!.url).searchParams.has("league"), false);
assert.equal(calls[0]?.auth, "test-ucl-key");
const contaminated = new BallDontLieUclProvider("test-ucl-key", async () =>
  new Response(JSON.stringify({ data: [{ id: 99, season: 2026 }], meta: { next_cursor: null } }), { status: 200 }));
await assert.rejects(() => contaminated.listCurrentSeasonMatches(2025), /outside requested seasons/);
const emptyCurrent = new BallDontLieUclProvider("test-ucl-key", async () =>
  new Response(JSON.stringify({ data: [], meta: { next_cursor: null } }), { status: 200 }));
await assert.rejects(() => emptyCurrent.listCurrentSeasonMatches(2026), /returned no matches/);
const conflictingCurrent = new BallDontLieUclProvider("test-ucl-key", async () =>
  new Response(JSON.stringify({ data: [
    match({ id: 98, season: 2026, home_team_id: 1, away_team_id: 2, date: "2026-09-01T20:00:00Z" }),
    match({ id: 98, season: 2026, home_team_id: 1, away_team_id: 3, date: "2026-09-01T20:00:00Z" }),
  ], meta: { next_cursor: null } }), { status: 200 }));
await assert.rejects(() => conflictingCurrent.listCurrentSeasonMatches(2026), /conflicting duplicate match 98/);
const duplicateCurrentRow = match({ id: 96, season: 2026, home_team_id: 1, away_team_id: 2, date: "2026-09-02T20:00:00Z" });
const duplicateCurrent = new BallDontLieUclProvider("test-ucl-key", async () =>
  new Response(JSON.stringify({ data: [duplicateCurrentRow, duplicateCurrentRow], meta: { next_cursor: null } }), { status: 200 }));
assert.deepEqual((await duplicateCurrent.listCurrentSeasonMatches(2026)).map((row) => row.id), [96], "current-season pagination dedupes exact provider IDs");
const historyCalls: string[] = [];
const historyProvider = new BallDontLieUclProvider("test-ucl-key", async (input) => {
  const url = new URL(String(input));
  historyCalls.push(url.toString());
  const season = Number(url.searchParams.get("season"));
  if (season === 2024 && !url.searchParams.has("cursor")) {
    return new Response(JSON.stringify({ data: [match({ id: 91, season: 2024, home_team_id: 1, away_team_id: 2, date: "2024-07-09T20:00:00Z", status: "STATUS_FINAL", status_state: "final", home_score: 1, away_score: 0 })], meta: { next_cursor: 7 } }), { status: 200 });
  }
  if (season === 2024) {
    return new Response(JSON.stringify({ data: [
      match({ id: 91, season: 2024, home_team_id: 1, away_team_id: 2, date: "2024-07-09T20:00:00Z", status: "STATUS_FINAL", status_state: "final", home_score: 1, away_score: 0 }),
      match({ id: 92, season: 2024, home_team_id: 3, away_team_id: 4, date: "2025-05-31T19:00:00Z", status: "STATUS_FINAL", status_state: "final", home_score: 2, away_score: 1 }),
    ], meta: { next_cursor: null } }), { status: 200 });
  }
  return new Response(JSON.stringify({ data: [match({ id: 93, season: 2025, home_team_id: 5, away_team_id: 6, date: "2026-05-30T19:00:00Z", status: "STATUS_FINAL", status_state: "final", home_score: 1, away_score: 1 })], meta: { next_cursor: null } }), { status: 200 });
});
const providerHistory = await historyProvider.listHistoricalMatches([2024, 2025]);
assert.deepEqual(providerHistory.matches.map((row) => row.id), [91, 92, 93], "per-season history pagination dedupes match IDs");
assert.equal(providerHistory.telemetry.strategy, "singular_season_provider_deviation");
assert.equal(providerHistory.telemetry.status, "ready", "validated singular cohorts are usable despite the visible contract deviation");
assert.deepEqual(providerHistory.telemetry.rowsBySeason, { "2024": 2, "2025": 1 });
assert.equal(historyCalls.filter((value) => new URL(value).searchParams.get("season") === "2024").length, 2, "singular cohort read paginates through next_cursor");
for (const value of historyCalls) {
  const query = new URL(value).searchParams;
  assert.equal(query.has("season"), true, "history uses one empirically verified singular cohort request");
  assert.equal(query.has("seasons[]"), false, "history never retries the known-bad plural filter");
  assert.equal(query.has("start_date"), false, "history never retries the known-bad date filter");
  assert.equal(query.has("end_date"), false);
}
const invalidHistory = new BallDontLieUclProvider("test-ucl-key", async () =>
  new Response(JSON.stringify({ data: [match({ id: 94, season: 2026, home_team_id: 1, away_team_id: 2, date: "2026-09-01T20:00:00Z" })], meta: { next_cursor: null } }), { status: 200 }));
await assert.rejects(() => invalidHistory.listHistoricalMatches([2024]), /outside requested seasons/);
const partialHistory = new BallDontLieUclProvider("test-ucl-key", async (input) => {
  const url = new URL(String(input));
  const data = url.searchParams.get("season") === "2025"
    ? []
    : [match({ id: 97, season: 2024, home_team_id: 1, away_team_id: 2, date: "2025-01-01T20:00:00Z", status: "STATUS_FINAL", status_state: "final", home_score: 1, away_score: 0 })];
  return new Response(JSON.stringify({ data, meta: { next_cursor: null } }), { status: 200 });
});
await assert.rejects(() => partialHistory.listHistoricalMatches([2024, 2025]), /no regulation-final rows.*2025/);
assert.equal(SHARP_UCL_LEAGUE, "uefa_-_champions_league");

// The complete current UCL field has the same deterministic crest/color
// treatment as EPL. Assets are presentation-only and never affect the model.
const currentUclClubs = [
  "AEK", "ARS", "ATM", "AVL", "BAR", "BET", "BODO", "BRU", "COMO",
  "DOR", "FCP", "FEN", "FEY", "GAL", "INT", "LAS", "LILL", "LIV",
  "MAN", "MNC", "MUN", "NAP", "PSG", "PSV", "RBL", "RCL", "RMA",
  "ROMA", "SAB", "SCP", "SHK", "SLB", "SLP", "VFB", "VIK", "VIL",
] as const;
assert.deepEqual(Object.keys(UCL_TEAM_ASSETS).sort(), [...currentUclClubs].sort());
for (const abbreviation of currentUclClubs) {
  const asset = uclTeamAsset(abbreviation);
  assert.ok(asset, `${abbreviation} must have an explicit UCL identity asset`);
  assert.match(asset.primaryColor, /^#[0-9A-F]{6}$/);
  assert.equal(uclTeamLogo(abbreviation), `https://a.espncdn.com/i/teamlogos/soccer/500/${asset.espnId}.png`);
}
assert.equal(uclTeamAsset("unknown"), null);
assert.equal(uclTeamLogo("unknown"), null);

const previewCacheSlate = {
  round: 1,
  modelRelease: UCL_MODEL_RELEASE,
  matches: [{ id: 101, kickoff: "2026-09-08T17:45:00Z" }],
};
const previewAuthority = {
  gradeRelease: UCL_CALIBRATION_RELEASE,
  deriveCoherentOutcome: (() => null) as never,
  deriveMatchResultDecision: (() => null) as never,
  derivePreviewGrade: (() => null) as never,
};
const firstDayCacheKey = buildEplPreviewCacheKey(previewCacheSlate as never, {
  cacheNamespace: "ucl",
  cacheIdentity: "2026-09-08:101@2026-09-08T17:45:00Z",
  authorities: previewAuthority,
});
const nextDayCacheKey = buildEplPreviewCacheKey({
  ...previewCacheSlate,
  matches: [{ id: 102, kickoff: "2026-09-09T19:00:00Z" }],
} as never, {
  cacheNamespace: "ucl",
  cacheIdentity: "2026-09-09:102@2026-09-09T19:00:00Z",
  authorities: previewAuthority,
});
const nextGradeCacheKey = buildEplPreviewCacheKey(previewCacheSlate as never, {
  cacheNamespace: "ucl",
  cacheIdentity: "2026-09-08:101@2026-09-08T17:45:00Z",
  authorities: { ...previewAuthority, gradeRelease: `${UCL_CALIBRATION_RELEASE}_next` },
});
assert.notEqual(firstDayCacheKey, nextDayCacheKey, "a multi-day UCL round cannot reuse the prior ET-day fixture cache");
assert.notEqual(firstDayCacheKey, nextGradeCacheKey, "a UCL grade authority release cannot reuse a prior release cache");

// Historical opening 1X2 canonicalization is exact-vendor, complete, no-vig,
// outcome-blind, and stable under duplicates.
const openingBoards = canonicalUclOpeningOdds([
  { id: 500, match_id: 91, vendor: "fanduel", moneyline_home_odds: 125, moneyline_draw_odds: 230, moneyline_away_odds: 220, opened_at: "2025-01-01T12:00:00Z", updated_at: "2025-01-01T12:00:00Z" },
  { id: 500, match_id: 91, vendor: "fanduel", moneyline_home_odds: 125, moneyline_draw_odds: 230, moneyline_away_odds: 220, opened_at: "2025-01-01T12:00:00Z", updated_at: "2025-01-01T12:00:00Z" },
  { id: 501, match_id: 91, vendor: "fanduel", moneyline_home_odds: 120, moneyline_draw_odds: 225, moneyline_away_odds: 215, opened_at: "2025-01-01T13:00:00Z", updated_at: "2025-01-01T13:00:00Z" },
  { id: 502, match_id: 91, vendor: "draftkings", moneyline_home_odds: null, moneyline_draw_odds: 225, moneyline_away_odds: 215, opened_at: "2025-01-01T11:00:00Z", updated_at: "2025-01-01T11:00:00Z" },
]);
assert.equal(openingBoards.get(91)?.length, 1, "incomplete vendor boards and duplicate provider IDs are excluded");
assert.equal(openingBoards.get(91)?.[0]?.id, 500, "earliest complete same-vendor opening is canonical");
const noVig = openingBoards.get(91)?.[0]?.noVig;
assert.ok(noVig && Math.abs(noVig.home + noVig.draw + noVig.away - 1) < 1e-12);
assert.throws(() => canonicalUclOpeningOdds([
  { id: 700, match_id: 91, vendor: "fanduel", moneyline_home_odds: 125, moneyline_draw_odds: 230, moneyline_away_odds: 220, opened_at: null, updated_at: "2025-01-01T12:00:00Z" },
  { id: 700, match_id: 91, vendor: "fanduel", moneyline_home_odds: 130, moneyline_draw_odds: 230, moneyline_away_odds: 220, opened_at: null, updated_at: "2025-01-01T12:00:00Z" },
]), /conflicting duplicate/);
assert.deepEqual(
  { train: UCL_CHRONOLOGICAL_MANIFEST.train, calibration: UCL_CHRONOLOGICAL_MANIFEST.calibration, holdout: UCL_CHRONOLOGICAL_MANIFEST.holdout, cutoff: UCL_CHRONOLOGICAL_MANIFEST.cutoff },
  { train: 185, calibration: 126, holdout: 63, cutoff: "2026-01-28T20:00:00.000Z" },
);
assert.throws(() => assertFrozenUclChronologicalManifest([match({ id: 1, season: 2024, home_team_id: 1, away_team_id: 2, date: "2024-09-01T20:00:00Z", status_state: "final", home_score: 1, away_score: 0 })]), /manifest mismatch/);
const statsIdentityMatch = match({ id: 2, season: 2024, home_team_id: 10, away_team_id: 20, date: "2024-09-02T20:00:00Z", status_state: "final", home_score: 1, away_score: 0 });
const statsIdentityRow = { match_id: 2, team_id: 10, possession_pct: 51, shots: 9, shots_on_target: 4, expected_goals: 1.21, big_chances: 2, red_cards: 0 };
assert.doesNotThrow(() => assertUclHistoricalStatsIdentity([statsIdentityMatch], [statsIdentityRow]));
assert.throws(() => assertUclHistoricalStatsIdentity([statsIdentityMatch], [statsIdentityRow, statsIdentityRow]), /duplicate identity/);
assert.throws(() => assertUclHistoricalStatsIdentity([statsIdentityMatch], [{ ...statsIdentityRow, team_id: 30 }]), /does not belong/);
assert.throws(() => assertUclHistoricalStatsIdentity([statsIdentityMatch], [{ ...statsIdentityRow, match_id: 999 }]), /unknown match/);
assert.notEqual(uclHistoricalStatsManifestDigest([statsIdentityRow]), uclHistoricalStatsManifestDigest([{ ...statsIdentityRow, expected_goals: 1.22 }]));
assert.throws(() => assertFrozenUclHistoricalStats([statsIdentityMatch], []), /team-stat manifest mismatch/, "an empty cached stat input fails closed");
assert.throws(() => assertFrozenUclHistoricalStats([statsIdentityMatch], [{ ...statsIdentityRow, expected_goals: 1.22 }]), /team-stat manifest mismatch/, "mutated cached xG cannot keep the frozen release");
const providerTelemetry: UclHistoryFetchTelemetry = {
  status: "ready",
  strategy: "singular_season_provider_deviation",
  requestedSeasons: [2024, 2025],
  providerContractDeviation: "plural/date filters ignored; separately validated singular season requests",
  rowsBySeason: { "2024": 189, "2025": 189 },
  rows: 378,
};
assert.doesNotThrow(() => assertFrozenUclHistoryTelemetry(providerTelemetry));
assert.throws(() => assertFrozenUclHistoryTelemetry({ ...providerTelemetry, status: "degraded" } as never), /telemetry mismatch/, "a degraded cached provider status is rejected");
assert.throws(() => assertFrozenUclHistoryTelemetry({ ...providerTelemetry, rowsBySeason: { "2024": 189, "2025": 188 }, rows: 377 }), /telemetry mismatch/, "partial cached season telemetry is rejected");

// Exact provider/team/event identity and canonical four-market pairing.
assert.equal(uclTeamsMatch("Internazionale Milano", "Inter Milan"), true);
assert.equal(uclTeamsMatch("Paris Saint-Germain", "PSG"), true);
assert.equal(uclTeamsMatch("Slavia Praha", "Slavia Prague"), true);
assert.equal(uclTeamsMatch("Inter", "Inter Club d’Escaldes"), false, "UCL identity never accepts arbitrary substring clubs");
assert.equal(uclTeamsMatch("", "Inter"), false, "blank futures shells cannot match a fixture");
assert.equal(uclTeamsMatch("Inter", "AC Milan"), false);
assert.equal(normalizeSharpApiMarketType("moneyline"), "match_result");
assert.equal(normalizeSharpApiMarketType("double_chance"), "double_chance");
assert.equal(normalizeSharpApiMarketType("total_goals"), "total");
assert.equal(normalizeSharpApiMarketType("both_teams_to_score"), "btts");
assert.equal(normalizeMatchResultSelection("Draw", { home_team: "Inter", away_team: "PSG" }), "draw");
assert.equal(normalizeDoubleChanceSelection("Inter or Draw", { home_team: "Inter", away_team: "PSG" }), "home_or_draw");
assert.equal(normalizeTotalSelection("Over 2.5"), "over");
assert.equal(normalizeBttsSelection("Yes"), "yes");

// League phase, reciprocal legs, aggregate orientation, final/neutral context.
const firstLeg = match({ id: 10, home_team_id: 1, away_team_id: 2, date: "2027-03-03T20:00:00Z", status: "STATUS_FINAL", status_state: "final", status_detail: "FT", home_score: 2, away_score: 1 });
const secondLeg = match({ id: 11, home_team_id: 2, away_team_id: 1, date: "2027-03-10T20:00:00Z" });
const leaguePhase = match({ id: 12, home_team_id: 3, away_team_id: 4, date: "2026-09-08T17:45:00Z" });
const final = match({ id: 13, home_team_id: 5, away_team_id: 6, date: "2027-05-29T19:00:00Z" });
const qualifier = match({ id: 16, home_team_id: 7, away_team_id: 8, date: "2026-08-12T19:00:00Z", round_number: 4 });
const contexts = buildUclCompetitionContexts([firstLeg, secondLeg, leaguePhase, final, qualifier]);
assert.deepEqual(contexts.get(10), { ...contexts.get(10), stage: "round_of_16", leg: 1, aggregateBefore: null, neutralVenue: null, regulationTime: true, advancementMarket: false });
assert.equal(contexts.get(11)?.leg, 2);
assert.deepEqual(contexts.get(11)?.aggregateBefore, { home: 1, away: 2 }, "aggregate is oriented to second-leg home/away");
assert.equal(contexts.get(12)?.stage, "league_phase");
assert.equal(contexts.get(13)?.stage, "final");
assert.equal(contexts.get(13)?.neutralVenue, true);
assert.equal(contexts.get(16)?.stage, "qualifying");
assert.equal(contexts.get(16)?.source, "schedule_topology", "unmapped provider round numbers are not claimed as stage provenance");

// Regulation-time settlement: never grade post-90' AET/penalty totals.
const aet = match({ id: 20, home_team_id: 1, away_team_id: 2, date: "2026-03-01T20:00:00Z", status: "STATUS_FINAL_AET", status_state: "final", status_detail: "AET", home_score: 5, away_score: 0, first_half_home_score: 1, first_half_away_score: 0, second_half_home_score: 2, second_half_away_score: 0 });
assert.deepEqual(regulationScore(aet), { score: { home: 3, away: 0 }, source: "period_components" });
const pens = match({ id: 21, home_team_id: 1, away_team_id: 2, date: "2026-03-02T20:00:00Z", status: "STATUS_FINAL_PEN", status_state: "final", status_detail: "FT-Pens", home_score: 5, away_score: 4, first_half_home_score: 0, first_half_away_score: 1, second_half_home_score: 1, second_half_away_score: 0 });
assert.deepEqual(regulationScore(pens).score, { home: 1, away: 1 });
assert.deepEqual(regulationScore({ ...aet, first_half_home_score: null }), { score: null, source: "unavailable_special_final" });
assert.deepEqual(regulationScore(firstLeg).score, { home: 2, away: 1 });

// Kickoff grouping and timezone-safe instants retain provider UTC exactly.
const weeks = groupUclMatchweeks([
  leaguePhase,
  match({ id: 14, home_team_id: 7, away_team_id: 8, date: "2026-09-10T20:00:00Z" }),
  match({ id: 15, home_team_id: 9, away_team_id: 10, date: "2026-10-13T17:45:00Z" }),
]);
assert.deepEqual(weeks.map((week) => week.length), [2, 1]);
assert.equal(selectUclMatchweek(weeks, new Date("2026-09-03T12:00:00Z")), 1);
assert.equal(new Date(leaguePhase.date).toISOString(), "2026-09-08T17:45:00.000Z");

const lifecycleRounds = groupUclMatchweeks([
  match({ id: 141, home_team_id: 1, away_team_id: 2, date: "2026-09-08T17:45:00Z", status_state: "final", home_score: 2, away_score: 0 }),
  match({ id: 142, home_team_id: 3, away_team_id: 4, date: "2026-09-09T19:00:00Z", status_state: "final", home_score: 1, away_score: 1 }),
  match({ id: 151, home_team_id: 5, away_team_id: 6, date: "2026-09-29T17:45:00Z" }),
  match({ id: 152, home_team_id: 7, away_team_id: 8, date: "2026-09-30T19:00:00Z" }),
]);
assert.deepEqual(lifecycleRounds.map((round) => round.map((row) => row.id)), [[141, 142], [151, 152]], "multi-day UCL rounds keep their complete fixture sets");
assert.equal(selectUclMatchweek(lifecycleRounds, new Date("2026-09-08T15:00:00Z")), 1, "the complete current round is populated before kickoff");
assert.equal(selectUclMatchweek(lifecycleRounds, new Date("2026-09-08T20:30:00Z")), 1, "a round remains immediately after a final whistle on its ET slate day");
assert.equal(selectUclMatchweek(lifecycleRounds, new Date("2026-09-10T03:59:59Z")), 1, "the complete round remains through the last second of its final ET slate day");
assert.equal(selectUclMatchweek(lifecycleRounds, new Date("2026-09-10T04:00:00Z")), 2, "ET midnight rolls a completed round off the board");
assert.equal(selectUclMatchweek(lifecycleRounds, new Date("2026-09-09T12:00:00Z")), 1, "the second day of a multi-day round retains fixtures from both days");
assert.deepEqual(visibleUclMatchweekFixtures(lifecycleRounds[0]!, new Date("2026-09-08T20:30:00Z")).map((row) => row.id), [141, 142], "the current ET day's completed fixture stays beside upcoming round fixtures");
assert.deepEqual(visibleUclMatchweekFixtures(lifecycleRounds[0]!, new Date("2026-09-09T12:00:00Z")).map((row) => row.id), [142], "a completed prior-day fixture falls off while the future fixture in its round remains");
assert.deepEqual(visibleUclMatchweekFixtures(lifecycleRounds[0]!, new Date("2026-09-10T03:59:59Z")).map((row) => row.id), [142], "the final fixture remains through the last second of its ET slate day");
const populatedNextRound = lifecycleRounds[selectUclMatchweek(lifecycleRounds, new Date("2026-09-10T04:00:00Z")) - 1];
assert.deepEqual(populatedNextRound?.map((row) => row.id), [151, 152], "rollover populates the complete upcoming round");

// One adjusted score PMF remains coherent across MR/DC/Total/BTTS and score.
const history = [
  match({ id: 30, season: 2025, home_team_id: 1, away_team_id: 2, date: "2025-09-01T20:00:00Z", status: "STATUS_FINAL", status_state: "final", status_detail: "FT", home_score: 2, away_score: 0, venue_latitude: 51.5, venue_longitude: -0.1 }),
  match({ id: 31, season: 2025, home_team_id: 2, away_team_id: 1, date: "2025-09-10T20:00:00Z", status: "STATUS_FINAL", status_state: "final", status_detail: "FT", home_score: 1, away_score: 1, venue_latitude: 48.8, venue_longitude: 2.3 }),
  match({ id: 32, season: 2025, home_team_id: 1, away_team_id: 3, date: "2025-10-01T20:00:00Z", status: "STATUS_FINAL", status_state: "final", status_detail: "FT", home_score: 3, away_score: 1 }),
  match({ id: 33, season: 2025, home_team_id: 3, away_team_id: 2, date: "2025-10-10T20:00:00Z", status: "STATUS_FINAL", status_state: "final", status_detail: "FT", home_score: 0, away_score: 2 }),
];
const training = joinUclMatchStats(history, []);
const target = match({ id: 34, home_team_id: 1, away_team_id: 2, date: "2026-09-08T17:45:00Z", venue_latitude: 51.5, venue_longitude: -0.1 });
const travel = buildUclTravelRestContext(target, history);
assert.equal(travel.evidenceScope, "ucl_schedule_only");
assert.ok(travel.awayTravelKm !== null && travel.awayTravelKm > 300);
assert.deepEqual(buildUclTravelRestContext(target, [...history, history[0]!, history[1]!]), travel, "duplicate match IDs cannot inflate travel/rest congestion");
const prediction = fitAndPredictUcl({ training, match: target, history, context: buildUclCompetitionContexts([target]).get(34)! });
assert.equal(prediction.release, UCL_MODEL_RELEASE);
assert.equal(prediction.calibrationRelease, UCL_CALIBRATION_RELEASE);
assert.ok(Math.abs(prediction.probabilities.home + prediction.probabilities.draw + prediction.probabilities.away - 1) < 1e-9);
assert.ok(Math.abs(prediction.probabilities.over25 + prediction.probabilities.under25 - 1) < 1e-9);
assert.ok(Math.abs(prediction.probabilities.bttsYes + prediction.probabilities.bttsNo - 1) < 1e-9);
assert.equal(Number.isInteger(prediction.likelyScore.home) && Number.isInteger(prediction.likelyScore.away), true);
assert.equal(prediction.adjustment.strengthPrior, "shared_ucl_cross_league_scale");

// Exact evaluated quote controls EV/grade only; forecast side cannot be swapped.
const decision = deriveUclMatchResultDecision({ model: { home: 0.58, draw: 0.25, away: 0.17 }, market: { home: 0.7, draw: 0.24, away: 0.06 }, prices: { home: -250, draw: 320, away: 1400 }, promotedProxy: false });
assert.equal(decision.forecastSide, "home");
assert.equal(decision.selectedSide, "home");
assert.notEqual(decision.grade.verdict.label, "Lean", "non-positive exact-quote EV cannot remain actionable");
const bttsLean = deriveUclPreviewGrade({ market: "btts", modelProbability: 0.61, edgePp: 3, priceAmerican: 115, coherentMarket: true, promotedProxy: false });
assert.equal(bttsLean.verdict.label, "Lean", "the UCL-owned EPL transfer can promote a positive-EV forecast-side tuple");
const bttsNegativeEv = deriveUclPreviewGrade({ market: "btts", modelProbability: 0.61, edgePp: 3, priceAmerican: -180, coherentMarket: true, promotedProxy: false });
assert.equal(bttsNegativeEv.verdict.label, "Watchlist", "a transferred confidence floor never bypasses exact-price EV");
const missingPriceHold = deriveUclPreviewGrade({ market: "total", modelProbability: 0.64, edgePp: null, priceAmerican: null, coherentMarket: false, promotedProxy: false });
assert.equal(missingPriceHold.candidateTier, "data_hold");
assert.equal(missingPriceHold.verdict.label, "No Play");
const bestAngleDecision = deriveUclMatchResultDecision({ model: { home: 0.58, draw: 0.24, away: 0.18 }, market: { home: 0.5, draw: 0.28, away: 0.22 }, prices: { home: 110, draw: 260, away: 340 }, promotedProxy: false });
assert.equal(bestAngleDecision.selectedSide, "home");
assert.equal(bestAngleDecision.grade.verdict.label, "Best Angle");
assert.equal(eplPriorRowsBlockWrite([{ model_version: "legacy", locked_at: "2026-09-08T16:45:00Z", held: false, snapshot_json: {} }]), true, "any prior locked row blocks replacement across releases");

// Namespace, official tracking, and release separation.
assert.equal(UCL_COMPETITION, "uefa_champions_league");
assert.equal(uclProviderIdFromExternal(UCL_EXTERNAL_ID_OFFSET + 77), 77);
assert.equal(uclProviderIdFromExternal(UCL_EXTERNAL_ID_UPPER_BOUND), null);
assert.deepEqual(getOfficialTrackingMarkets("ucl"), ["match_result", "total", "btts", "double_chance"]);
const trackingRecord = { sport: "soccer", locked_at: "2026-09-08T16:45:00Z", held: false, model_version: UCL_MODEL_RELEASE, calibration_version: UCL_CALIBRATION_RELEASE, competition: UCL_COMPETITION, snapshot_json: { competition: UCL_COMPETITION } } as unknown as PredictionRecordRow;
assert.equal(isUclTrackingRecord(trackingRecord), true);
assert.equal(isTrackingRecordEligible(trackingRecord), true);
assert.equal(isTrackingRecordEligible({ ...trackingRecord, held: true }), false, "held UCL lock-manifest rows never enter public W/L");
assert.equal(isCurrentUclTrackingRelease(trackingRecord), true);
assert.equal(isCurrentUclTrackingRelease({ ...trackingRecord, model_version: "ucl_prior_release" }), false);
assert.equal(trackingDisplaySport(trackingRecord), "ucl");
assert.equal(UCL_COHERENT_OUTCOME_RELEASE.startsWith("ucl_"), true);
for (const master of [undefined, "false"] as const) {
  const flags = resolveUclFeatureFlags({
    UCL_PIPELINE_ENABLED: master, UCL_DB_WRITES_ENABLED: "true", UCL_CRON_ENABLED: "true",
    UCL_LOCK_CRON_ENABLED: "true", UCL_PUBLICATION_ENABLED: "true",
    CHAMPIONS_LEAGUE_DAILY_EDGE_ENABLED: "true", UCL_FOUNDATION_CACHE_WRITES_ENABLED: "true",
  });
  assert.deepEqual(flags, { enabled: false, refresh: false, lock: false, writes: false, publication: false, settlement: false, member: false, foundationWrites: false });
}
const enabledFlags = resolveUclFeatureFlags({
  UCL_PIPELINE_ENABLED: "true", UCL_DB_WRITES_ENABLED: "true", UCL_CRON_ENABLED: "true",
  UCL_LOCK_CRON_ENABLED: "true", UCL_PUBLICATION_ENABLED: "true",
  CHAMPIONS_LEAGUE_DAILY_EDGE_ENABLED: "true", UCL_FOUNDATION_CACHE_WRITES_ENABLED: "true",
});
assert.equal(Object.values(enabledFlags).every(Boolean), true);
assert.deepEqual(resolveUclSettlementGradingPlan("soccer", false), { excludeFromGeneric: UCL_COMPETITION, runExactUclPass: false }, "master-off settlement always excludes UCL from the generic soccer grader");
assert.deepEqual(resolveUclSettlementGradingPlan("soccer", true), { excludeFromGeneric: UCL_COMPETITION, runExactUclPass: true });
assert.deepEqual(resolveUclTrackingVisibility("ucl", false), { directUclDenied: true, mayReadStoredSnapshot: false, includeUcl: false });
assert.deepEqual(resolveUclTrackingVisibility(undefined, false), { directUclDenied: false, mayReadStoredSnapshot: false, includeUcl: false }, "all-sport tracking bypasses stored UCL-bearing snapshots while disabled");
assert.deepEqual(resolveUclTrackingVisibility("mlb", false), { directUclDenied: false, mayReadStoredSnapshot: true, includeUcl: false });
const subKeys = ["UCL_DB_WRITES_ENABLED", "UCL_CRON_ENABLED", "UCL_LOCK_CRON_ENABLED", "UCL_PUBLICATION_ENABLED", "CHAMPIONS_LEAGUE_DAILY_EDGE_ENABLED", "UCL_FOUNDATION_CACHE_WRITES_ENABLED"] as const;
for (let mask = 0; mask < 2 ** subKeys.length; mask++) {
  const env = Object.fromEntries(subKeys.map((key, index) => [key, mask & (1 << index) ? "true" : "false"]));
  const off = resolveUclFeatureFlags(env);
  assert.equal(Object.values(off).every((value) => value === false), true, `master-off mask ${mask} must fail closed`);
  const on = resolveUclFeatureFlags({ ...env, UCL_PIPELINE_ENABLED: "true" });
  assert.equal(on.publication, on.writes && on.member && env.UCL_PUBLICATION_ENABLED === "true");
}
const heldMarket = { held: true, currentPriceAmerican: null, soccerPriceBoard: null };
const pricedMarket = { held: false, currentPriceAmerican: -110, soccerPriceBoard: { rows: [{}, {}, {}] } };
const coverage = evaluateUclPublicationCoverage(
  { matches: [{ id: 1, status: "scheduled" }] } as never,
  { games: [{ external_id: 1, soccerProjection: { goalOutlookProbabilities: { home: 0.4, draw: 0.3, away: 0.3, over25: 0.55, under25: 0.45, bttsYes: 0.52, bttsNo: 0.48 } }, markets: { moneyline: pricedMarket, total: heldMarket, first_inning: heldMarket }, soccerDoubleChanceMarket: heldMarket }] } as never,
);
assert.deepEqual(coverage.errors, [], "complete coherent forecasts publish even while unavailable exact quotes remain held");
assert.equal(coverage.heldMarkets, 3);
assert.equal(coverage.nonpositiveEvActionables, 0);
assert.equal(coverage.warnings.length, 2);
const collapsedPriceCoverage = evaluateUclPublicationCoverage(
  { matches: [{ id: 1, status: "scheduled" }] } as never,
  { games: [{ external_id: 1, soccerProjection: { goalOutlookProbabilities: { home: 0.4, draw: 0.3, away: 0.3, over25: 0.55, under25: 0.45, bttsYes: 0.52, bttsNo: 0.48 } }, markets: { moneyline: heldMarket, total: heldMarket, first_inning: heldMarket }, soccerDoubleChanceMarket: heldMarket }] } as never,
  { games: [{ external_id: 1, markets: { moneyline: pricedMarket, total: pricedMarket, first_inning: pricedMarket }, soccerDoubleChanceMarket: pricedMarket }] } as never,
);
assert.match(collapsedPriceCoverage.errors.join(";"), /current-price coverage collapsed 4->0.*last-known-good/i, "a transient all-price outage cannot replace a priced UCL member snapshot");
assert.equal(collapsedPriceCoverage.priceCollapse, true);
assert.deepEqual(collapsedPriceCoverage.hardErrors, [], "price collapse alone still permits the T60 writer/verifier path");
const priorPriceCard = { external_id: 1, awayTeam: "AWY", homeTeam: "HOM", markets: { moneyline: pricedMarket, total: pricedMarket, first_inning: pricedMarket }, soccerDoubleChanceMarket: pricedMarket };
const freshHeldCard = { ...priorPriceCard, markets: { moneyline: heldMarket, total: heldMarket, first_inning: heldMarket }, soccerDoubleChanceMarket: heldMarket };
const verifiedLockedCard = { ...priorPriceCard, lockState: "locked", lockedAt: "2026-09-08T16:45:00Z" };
const mergedCollapsedLock = mergeVerifiedUclLocksIntoLastKnownGood({
  fresh: { date: "2026-09-08", requested_date: "2026-09-08", generatedAt: "fresh", model: "ucl", games: [freshHeldCard, { ...freshHeldCard, external_id: 2 }] } as never,
  previous: { date: "2026-09-08", requested_date: "2026-09-08", generatedAt: "prior", model: "ucl", games: [priorPriceCard, { ...priorPriceCard, external_id: 2 }] } as never,
  verified: { date: "2026-09-08", requested_date: "2026-09-08", generatedAt: "fresh", model: "ucl", games: [verifiedLockedCard, { ...freshHeldCard, external_id: 2 }] } as never,
  dueProviderIds: [1],
});
assert.equal(mergedCollapsedLock.games[0]?.lockState, "locked", "a fully verified due card advances to its immutable T60 tuple");
assert.equal(mergedCollapsedLock.games[1]?.markets.moneyline.currentPriceAmerican, -110, "a non-due collapsed card retains its priced LKG tuple");
assert.equal(uclPriceCollapseIsRecovered({ coverage: collapsedPriceCoverage, dueProviderIds: [1], incompleteProviderIds: [] }), true, "complete due lock verification permits the LKG merge");
assert.equal(uclPriceCollapseIsRecovered({ coverage: collapsedPriceCoverage, dueProviderIds: [1], incompleteProviderIds: [1] }), false, "partial due lock verification remains unpublished");
assert.equal(uclPriceCollapseIsRecovered({ coverage: collapsedPriceCoverage, dueProviderIds: [], incompleteProviderIds: [] }), false, "ordinary non-due price collapse remains unpublished");
const degradedCoverage = evaluateUclPublicationCoverage(
  { matches: [], providerHealth: { uclHistory: { status: "degraded", strategy: "unavailable", rows: 0, error: "cohort rejected", contractDeviation: null } } } as never,
  { games: [] },
);
assert.match(degradedCoverage.errors[0] ?? "", /provider history degraded.*cohort rejected.*last-known-good/i);
const deviationCoverage = evaluateUclPublicationCoverage(
  { matches: [], providerHealth: { uclHistory: { status: "ready", strategy: "singular_season_provider_deviation", rows: 378, error: null, contractDeviation: "plural filter ignored" } } } as never,
  { games: [] },
);
assert.match(deviationCoverage.warnings[0] ?? "", /provider contract deviation.*plural filter ignored/i);
const unsafeCoverage = evaluateUclPublicationCoverage(
  { matches: [{ id: 1, status: "scheduled" }] } as never,
  { games: [{ external_id: 1, soccerProjection: { goalOutlookProbabilities: { home: 0.4, draw: 0.3, away: 0.3, over25: 0.55, under25: 0.45, bttsYes: 0.52, bttsNo: 0.48 } }, markets: { moneyline: { ...pricedMarket, verdict: { key: "lean" }, pinnacleEvPct: 0 }, total: heldMarket, first_inning: heldMarket }, soccerDoubleChanceMarket: heldMarket }] } as never,
);
assert.equal(unsafeCoverage.nonpositiveEvActionables, 1);
assert.match(unsafeCoverage.errors.join(";"), /positive-EV actionable coverage/);

// Integration contracts: one shared writer/lease, snapshot-only member route,
// shared UI, and release-separated legacy archive.
const refreshRoute = readFileSync("app/api/cron/ucl-daily-refresh/route.ts", "utf8");
const lockRoute = readFileSync("app/api/cron/ucl-pregame-lock/route.ts", "utf8");
const memberRoute = readFileSync("app/api/lab/daily-edge/route.ts", "utf8");
const page = readFileSync("app/lab/daily-edge/CandidateDailyEdgePage.tsx", "utf8");
const ui = readFileSync("app/dev/experience-preview/ActualDailyEdgePreview.tsx", "utf8");
const trackingUi = readFileSync("app/lab/tracking/TrackingClient.tsx", "utf8");
const legacyTrackingRoute = readFileSync("app/api/lab/tracking/route.ts", "utf8");
const trackingFoundationRoute = readFileSync("app/api/lab/tracking-foundation/route.ts", "utf8");
const experiencePage = readFileSync("app/dev/experience-preview/page.tsx", "utf8");
const foundationStore = readFileSync("lib/services/ucl/uclHistoricalFoundationStore.ts", "utf8");
const slateBuilder = readFileSync("lib/services/ucl/buildUclSlate.ts", "utf8");
const uclModelSource = readFileSync("lib/services/ucl/uclModel.ts", "utf8");
const uclPreviewSource = readFileSync("lib/services/ucl/buildUclDailyEdgePreview.ts", "utf8");
const uclTransferredGradeSource = readFileSync("lib/services/ucl/uclTransferredGrade.ts", "utf8");
const uclOpeningEvaluationSource = readFileSync("lib/services/ucl/uclOpeningOddsEvaluation.ts", "utf8");
const uclOpeningOperatorSource = readFileSync("scripts/operator/evaluate-ucl-opening-odds.ts", "utf8");
const trackingRefreshSource = readFileSync("lib/services/trackingRefreshService.ts", "utf8");
const sharedSoccerWriter = readFileSync("lib/services/epl/eplProductionPipeline.ts", "utf8");
const uclPipeline = readFileSync("lib/services/ucl/uclProductionPipeline.ts", "utf8");
const sharedSoccerBuilder = readFileSync("lib/services/epl/buildEplDailyEdgePreview.ts", "utf8");
for (const route of [refreshRoute, lockRoute]) {
  assert.match(route, /leaseGroup:\s*"prediction_pipeline"/);
  assert.match(route, /sport:\s*"soccer"/);
}
assert.match(refreshRoute, /writeUclPredictionRecords/);
assert.match(refreshRoute, /provider_history:\s*slate\.providerHealth\.uclHistory/);
assert.match(refreshRoute, /historyWritable = coverage\.hardErrors\.length === 0[\s\S]*writeUclPredictionRecords[\s\S]*verifyUclRefreshAllMarketLocks[\s\S]*uclPriceCollapseIsRecovered[\s\S]*writeCurrentUclMemberSnapshot\(\{ response: publicationResponse/, "a price collapse still reaches the T60 writer/verifier and publishes only the verified LKG merge");
assert.match(refreshRoute, /writeCurrentUclMemberSnapshot\(\{[^}]*boardDate:\s*slate\.boardDate/, "refresh publication carries the ET day frozen during slate selection");
assert.match(lockRoute, /writeCurrentUclMemberSnapshot\(\{[^}]*boardDate:\s*slate\.boardDate/, "lock publication carries the ET day frozen during slate selection");
assert.match(lockRoute, /provider_history:\s*slate\.providerHealth\.uclHistory/);
assert.ok(refreshRoute.indexOf("coverage.hardErrors.length === 0") < refreshRoute.indexOf("writeUclPredictionRecords({"), "refresh prediction writes must be downstream of hard history/PMF coverage gates while allowing T60 price-collapse repair");
assert.ok(lockRoute.indexOf("coverage.errors.length === 0") < lockRoute.indexOf("writeUclPredictionRecords({"), "lock prediction writes must be downstream of the coherence/fixture gate");
assert.ok(refreshRoute.indexOf("coverage.hardErrors.length === 0") < refreshRoute.indexOf("seedUclSlate({"), "degraded history blocks all refresh DB writes, including slate seeding");
assert.ok(refreshRoute.indexOf("coverage.hardErrors.length === 0") < refreshRoute.indexOf("persistUclLineHistory({"), "degraded history blocks refresh line-history writes");
assert.ok(lockRoute.indexOf("coverage.errors.length === 0") < lockRoute.indexOf("persistUclLineHistory({"), "degraded history blocks lock line-history writes");
assert.doesNotMatch(refreshRoute, /createPredictionRecords|new .*PredictionWriter/);
assert.match(memberRoute, /sport === "ucl"[\s\S]*readCurrentUclMemberSnapshot/);
const uclReaderBranch = memberRoute.slice(memberRoute.indexOf('if (sport === "ucl")'), memberRoute.indexOf("// Member reads must never rebuild"));
assert.doesNotMatch(uclReaderBranch, /buildUclSlate|SharpApi|BallDontLie/);
assert.ok(uclReaderBranch.indexOf("resolveUclFeatureFlags") < uclReaderBranch.indexOf("readCurrentUclMemberSnapshot"));
assert.doesNotMatch(uclModelSource, /fitEplShadowModel|predictEplMatch|joinEplMatchStats|EPL_SHADOW_DEFAULT_CONFIG/);
assert.match(uclPreviewSource, /deriveUclCoherentMarketOutcome/);
assert.match(uclPreviewSource, /deriveUclMatchResultDecision/);
assert.match(uclPreviewSource, /deriveUclPreviewGrade/);
assert.doesNotMatch(uclTransferredGradeSource, /deriveEplPreviewGrade|deriveEplMatchResultDecision|from ["'].*eplPreviewGrade/, "the transferred UCL grade authority is frozen and cannot drift with EPL runtime edits");
assert.match(uclTransferredGradeSource, /positive exact forecast-side expected value/, "actionable transfers retain exact-price EV gating");
assert.match(uclPreviewSource, /awayTeamLogo:\s*uclTeamLogo\(game\.awayTeam\)[\s\S]*awayTeamPrimaryColor:\s*awayAsset\?\.primaryColor/);
assert.match(uclPreviewSource, /homeTeamLogo:\s*uclTeamLogo\(game\.homeTeam\)[\s\S]*homeTeamPrimaryColor:\s*homeAsset\?\.primaryColor/);
assert.match(uclPreviewSource, /competitionLabel:\s*"Champions League"/, "the shared builder receives competition-specific copy without a UCL-only layout");
assert.match(sharedSoccerBuilder, /No recent \$\{competitionLabel\} sample[\s\S]*no \$\{competitionLabel\} split rows/, "shared soccer evidence copy uses the active competition label");
assert.match(sharedSoccerBuilder, /buildEplPreviewCacheKey[\s\S]*options\.authorities\?\.gradeRelease \?\? EPL_PREVIEW_GRADE_RELEASE[\s\S]*options\.cacheIdentity \?\? fixtureIdentity/, "UCL grade releases and deterministic fixtures own their shared-preview cache identity");
assert.match(ui, /soccerCompetitionLabel\(game\)[\s\S]*Completed \$\{competitionLabel\} form only/, "expanded soccer evidence uses the game competition instead of hard-coded EPL copy");
assert.ok(uclOpeningEvaluationSource.indexOf("if (!coverageQualified)") < uclOpeningEvaluationSource.indexOf("const calibrationRows"), "opening-odds coverage must fail before any outcome evaluation");
assert.ok(uclOpeningEvaluationSource.indexOf("if (!selected)") < uclOpeningEvaluationSource.indexOf("const holdoutRows"), "holdout outcomes remain untouched until a calibration candidate is frozen");
assert.ok(uclOpeningOperatorSource.indexOf("if (!preOutcomeCoverage.coverageQualified)") < uclOpeningOperatorSource.indexOf("listTeamMatchStats"), "coverage rejection makes zero stats/outcome-feature requests");
assert.match(page, /ActualDailyEdgePreview/);
assert.match(page, /readCurrentUclMemberSnapshot/);
assert.match(page, /eplEnabled[\s\S]*league=epl[\s\S]*uclEnabled[\s\S]*league=ucl/, "Soccer routes to an enabled competition when EPL is off and UCL is on");
assert.match(page, /sport === "soccer"[\s\S]*active: "world_cup"/, "the shared chooser remains reachable on a disabled direct competition route");
assert.match(ui, /Champions League/);
assert.match(ui, /Regulation time/);
assert.match(ui, /uefa_champions_league[\s\S]*uclTeamAsset\(abbreviation\)[\s\S]*uclTeamLogo\(abbreviation\)/, "the shared member cards resolve UCL colors and crests even before a refreshed snapshot arrives");
assert.doesNotMatch(ui, /UclOnly|UCLCard|ChampionsLeagueLayout/);
assert.match(trackingUi, /historical archive[\s\S]*never blended/i);
assert.match(legacyTrackingRoute, /english_premier_league" \|\| r\.snapshot_json\?\.competition === "uefa_champions_league"/, "legacy World Cup tracking excludes UCL current-release rows");
assert.match(trackingFoundationRoute, /ucl \? "soccer" : sportKey[\s\S]*competition:\s*ucl \? "uefa_champions_league"/, "UCL tracking reads shared soccer rows through an exact competition filter");
const trackingGetBody = trackingFoundationRoute.slice(trackingFoundationRoute.indexOf("export async function GET"));
assert.ok(trackingGetBody.indexOf("visibility.directUclDenied") < trackingGetBody.indexOf("readLabResponseSnapshot"), "disabled direct UCL tracking fails before fresh/stale snapshot reads");
assert.match(trackingFoundationRoute, /visibility\.mayReadStoredSnapshot[\s\S]*snapshotBypass/, "disabled all-sport tracking cannot reuse an enabled-state stored snapshot");
assert.match(trackingFoundationRoute, /ucl-\$\{includeUcl \? "on" : "off"\}/, "enabled and disabled tracking memory caches are isolated");
assert.match(trackingRefreshSource, /excludeCompetition:\s*uclGrading\.excludeFromGeneric[\s\S]*if \(uclGrading\.runExactUclPass\)/, "generic soccer always excludes UCL and only the exact master-gated pass can grade it");
assert.match(experiencePage, /teamsQuery = teamsQuery\.eq\("league", competition\)/, "soccer recent form is competition-scoped before abbreviation mapping");
assert.match(page, /uclRequested \? "uefa_champions_league"[\s\S]*eplRequested \? "english_premier_league"/, "member history passes the exact club competition namespace");
assert.match(slateBuilder, /contractDeviation:\s*UCL_HISTORY_PROVIDER_CONTRACT_DEVIATION/, "degraded history retains provider-deviation telemetry alongside its validation error");
assert.match(sharedSoccerWriter, /config\.preservePriorPricedTupleOnMissingLock[\s\S]*row\.locked_at && row\.held/, "prior-priced-tuple recovery is an explicit competition capability");
assert.match(uclPipeline, /preservePriorPricedTupleOnMissingLock:\s*true[\s\S]*returnPreservedLockedRecordIds:\s*true/, "only the UCL pipeline opts into immutable lock repair");
assert.doesNotMatch(sharedSoccerWriter.slice(sharedSoccerWriter.indexOf("export const EPL_PIPELINE_CONFIG"), sharedSoccerWriter.indexOf("export type EplLockCandidate")), /preservePriorPricedTupleOnMissingLock|returnPreservedLockedRecordIds/, "EPL keeps its reviewed T-60 behavior");
assert.match(foundationStore, /validateCompleteUclHistoryCohort[\s\S]*assertFrozenUclHistoricalInputs/, "cached history revalidates season coverage and every frozen model-material input");
assert.match(foundationStore, /schemaVersion:\s*6[\s\S]*historyMatches[\s\S]*teamStats[\s\S]*providerHistory/);
const persistedShape = foundationStore.slice(foundationStore.indexOf("export type UclHistoricalFoundationPayload"), foundationStore.indexOf("export type UclHistoricalFoundation ="));
assert.doesNotMatch(persistedShape, /trainingMatches/, "derived joined training rows are not a persisted cache authority");
assert.match(foundationStore, /assertFrozenUclHistoricalInputs\([\s\S]*joinUclMatchStats\(payload\.historyMatches, payload\.teamStats\)/, "cache reads authenticate raw inputs and deterministically rebuild training rows");
assert.ok(slateBuilder.indexOf("listTeamMatchStats(historyMatches") < slateBuilder.indexOf("assertFrozenUclHistoricalInputs({ matches: historyMatches, stats: teamStats"), "fresh stats are authenticated before training");
assert.ok(slateBuilder.indexOf("assertFrozenUclHistoricalInputs({ matches: historyMatches, stats: teamStats") < slateBuilder.indexOf("joinUclMatchStats(historyMatches, teamStats)"), "fresh stats manifest passes before joined model input");
assert.match(slateBuilder, /provider\.listCurrentSeasonMatches\(UCL_CURRENT_SEASON\)/, "production fixture discovery uses the validated singular-season method");
assert.doesNotMatch(slateBuilder, /listMatches\(\{ seasons: \[UCL_CURRENT_SEASON\]/, "production never retries the known-bad plural current-season filter");
assert.match(slateBuilder, /default:\$\{computeSlateDate\("soccer", selectionNow\)\}/, "the default board cache is keyed by the ET calendar day");

console.log("UCL production contract tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
