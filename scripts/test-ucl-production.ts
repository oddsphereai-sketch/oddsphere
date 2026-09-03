import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BallDontLieUclProvider, BALLDONTLIE_UCL_API_BASE_URL, type BdlUclMatch } from "../lib/providers/real_api/BallDontLieUclProvider";
import { SHARP_UCL_LEAGUE, uclTeamsMatch } from "../lib/providers/real_api/SharpApiEplMarketProvider";
import { normalizeDoubleChanceSelection, normalizeMatchResultSelection, normalizeSharpApiMarketType, normalizeTotalSelection, normalizeBttsSelection } from "../lib/providers/real_api/_soccerMarketNormalizer";
import { buildUclCompetitionContexts, regulationScore, UCL_COMPETITION, UCL_EXTERNAL_ID_OFFSET, UCL_EXTERNAL_ID_UPPER_BOUND, uclProviderIdFromExternal } from "../lib/services/ucl/uclCompetitionContext";
import { buildUclTravelRestContext, fitAndPredictUcl, joinUclMatchStats, UCL_CALIBRATION_RELEASE, UCL_COHERENT_OUTCOME_RELEASE, UCL_MODEL_RELEASE } from "../lib/services/ucl/uclModel";
import { groupUclMatchweeks, selectUclMatchweek } from "../lib/services/ucl/buildUclSlate";
import { eplPriorRowsBlockWrite } from "../lib/services/epl/eplProductionPipeline";
import { deriveEplMatchResultDecision, deriveEplPreviewGrade } from "../lib/services/epl/eplPreviewGrade";
import { isTrackingRecordEligible, isUclTrackingRecord, trackingDisplaySport } from "../lib/services/trackingAggregateService";
import { getOfficialTrackingMarkets } from "../lib/config/officialTrackingMarkets";
import { evaluateUclPublicationCoverage } from "../lib/services/ucl/uclPublicationReadiness";
import type { PredictionRecordRow } from "../lib/types/domain/Tracking";

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
  return new Response(JSON.stringify({ data: [], meta: { next_cursor: null } }), { status: 200, headers: { "Content-Type": "application/json" } });
});
await provider.listMatches({ season: 2026 });
assert.equal(calls[0]?.url.startsWith(`${BALLDONTLIE_UCL_API_BASE_URL}/matches?`), true);
assert.equal(new URL(calls[0]!.url).searchParams.get("season"), "2026");
assert.equal(new URL(calls[0]!.url).searchParams.has("league"), false);
assert.equal(calls[0]?.auth, "test-ucl-key");
assert.equal(SHARP_UCL_LEAGUE, "uefa_-_champions_league");

// Exact provider/team/event identity and canonical four-market pairing.
assert.equal(uclTeamsMatch("Internazionale Milano", "Inter Milan"), true);
assert.equal(uclTeamsMatch("Paris Saint-Germain", "PSG"), true);
assert.equal(uclTeamsMatch("Slavia Praha", "Slavia Prague"), true);
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
const contexts = buildUclCompetitionContexts([firstLeg, secondLeg, leaguePhase, final]);
assert.deepEqual(contexts.get(10), { ...contexts.get(10), stage: "round_of_16", leg: 1, aggregateBefore: null, neutralVenue: null, regulationTime: true, advancementMarket: false });
assert.equal(contexts.get(11)?.leg, 2);
assert.deepEqual(contexts.get(11)?.aggregateBefore, { home: 1, away: 2 }, "aggregate is oriented to second-leg home/away");
assert.equal(contexts.get(12)?.stage, "league_phase");
assert.equal(contexts.get(13)?.stage, "final");
assert.equal(contexts.get(13)?.neutralVenue, true);

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
const prediction = fitAndPredictUcl({ training, match: target, history, context: buildUclCompetitionContexts([target]).get(34)! });
assert.equal(prediction.release, UCL_MODEL_RELEASE);
assert.equal(prediction.calibrationRelease, UCL_CALIBRATION_RELEASE);
assert.ok(Math.abs(prediction.probabilities.home + prediction.probabilities.draw + prediction.probabilities.away - 1) < 1e-9);
assert.ok(Math.abs(prediction.probabilities.over25 + prediction.probabilities.under25 - 1) < 1e-9);
assert.ok(Math.abs(prediction.probabilities.bttsYes + prediction.probabilities.bttsNo - 1) < 1e-9);
assert.equal(Number.isInteger(prediction.likelyScore.home) && Number.isInteger(prediction.likelyScore.away), true);
assert.equal(prediction.adjustment.strengthPrior, "shared_ucl_cross_league_scale");

// Exact evaluated quote controls EV/grade only; forecast side cannot be swapped.
const decision = deriveEplMatchResultDecision({ model: { home: 0.58, draw: 0.25, away: 0.17 }, market: { home: 0.7, draw: 0.24, away: 0.06 }, prices: { home: -250, draw: 320, away: 1400 }, promotedProxy: false });
assert.equal(decision.forecastSide, "home");
assert.equal(decision.selectedSide, "home");
assert.notEqual(decision.grade.verdict.label, "Lean", "non-positive exact-quote EV cannot remain actionable");
const bttsLean = deriveEplPreviewGrade({ market: "btts", modelProbability: 0.61, edgePp: 3, priceAmerican: 115, coherentMarket: true, promotedProxy: false });
assert.equal(bttsLean.verdict.label, "Lean");
assert.equal(eplPriorRowsBlockWrite([{ model_version: "legacy", locked_at: "2026-09-08T16:45:00Z", held: false, snapshot_json: {} }]), true, "any prior locked row blocks replacement across releases");

// Namespace, official tracking, and release separation.
assert.equal(UCL_COMPETITION, "uefa_champions_league");
assert.equal(uclProviderIdFromExternal(UCL_EXTERNAL_ID_OFFSET + 77), 77);
assert.equal(uclProviderIdFromExternal(UCL_EXTERNAL_ID_UPPER_BOUND), null);
assert.deepEqual(getOfficialTrackingMarkets("ucl"), ["match_result", "total", "btts", "double_chance"]);
const trackingRecord = { sport: "soccer", locked_at: "2026-09-08T16:45:00Z", competition: UCL_COMPETITION, snapshot_json: { competition: UCL_COMPETITION } } as unknown as PredictionRecordRow;
assert.equal(isUclTrackingRecord(trackingRecord), true);
assert.equal(isTrackingRecordEligible(trackingRecord), true);
assert.equal(trackingDisplaySport(trackingRecord), "ucl");
assert.equal(UCL_COHERENT_OUTCOME_RELEASE.startsWith("ucl_"), true);
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
for (const route of [refreshRoute, lockRoute]) {
  assert.match(route, /leaseGroup:\s*"prediction_pipeline"/);
  assert.match(route, /sport:\s*"soccer"/);
}
assert.match(refreshRoute, /writeUclPredictionRecords/);
assert.ok(refreshRoute.indexOf("coverage.errors.length === 0") < refreshRoute.indexOf("writeUclPredictionRecords({"), "refresh prediction writes must be downstream of the coherence/fixture gate");
assert.ok(lockRoute.indexOf("coverage.errors.length === 0") < lockRoute.indexOf("writeUclPredictionRecords({"), "lock prediction writes must be downstream of the coherence/fixture gate");
assert.doesNotMatch(refreshRoute, /createPredictionRecords|new .*PredictionWriter/);
assert.match(memberRoute, /sport === "ucl"[\s\S]*readCurrentUclMemberSnapshot/);
const uclReaderBranch = memberRoute.slice(memberRoute.indexOf('if (sport === "ucl")'), memberRoute.indexOf("// Member reads must never rebuild"));
assert.doesNotMatch(uclReaderBranch, /buildUclSlate|SharpApi|BallDontLie/);
assert.match(page, /ActualDailyEdgePreview/);
assert.match(page, /readCurrentUclMemberSnapshot/);
assert.match(ui, /Champions League/);
assert.match(ui, /Regulation time/);
assert.doesNotMatch(ui, /UclOnly|UCLCard|ChampionsLeagueLayout/);
assert.match(trackingUi, /historical archive[\s\S]*never blended/i);

console.log("UCL production contract tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
