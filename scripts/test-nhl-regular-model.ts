import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NHL_REGULAR_CALIBRATION_RELEASE,
  NHL_REGULAR_DECISION_RELEASE,
  NHL_REGULAR_MODEL_RELEASE,
  calibrateNhlTotalConfidence,
  nhlRegularModelV1,
  type NhlFeatureSnapshot,
} from "../lib/automodel/nhlRegularModelV1";
import { isOfficiallyTrackedMarket } from "../lib/config/officialTrackingMarkets";
import { isPublicallyTracked } from "../lib/config/officialTrackingStart";
import { resolvePublicSplit } from "../lib/services/publicSplitsResolver";
import { isTrackingRecordEligible } from "../lib/services/trackingAggregateService";
import {
  nhlGameTypeFromExternalId,
  nhlSeasonStartYearFromExternalId,
} from "../lib/services/nhl/nhlScheduleIdentity";
import { selectMainNhlPuckLinePair, selectSameBookNhlMovement } from "../lib/services/nhl/featureSnapshot";
import { normalizeNhlTeamName } from "../lib/providers/nhl/_teamNameNormalizer";
import { sportsInSeasonToday } from "../lib/cron/seasons";
import type { PredictionRecordRow } from "../lib/types/domain/Tracking";
import {
  __NHL_SPLITS_SYNC_TEST__,
  matchPlaybookSplitsToSlateGames,
} from "../lib/services/syncPublicSplitsObservations";
import { replayNhlRegularState } from "../lib/automodel/nhlRegularState";
import { replayNhlOpponentAdjustedState } from "../lib/services/nhl/loadNhlOpponentAdjustedState";

const base: NhlFeatureSnapshot = {
  home: {
    abbreviation: "FLA",
    xgoals_pct: 0.54,
    x_goals_for_per_60: 3.12,
    x_goals_against_per_60: 2.68,
    five_x_goals_for_per_60: 2.42,
    five_x_goals_against_per_60: 2.08,
    pp_x_goals_for_per_60: 0.62,
    pk_x_goals_against_per_60: 0.48,
    pp_xgoals_pct: 0.23,
    pk_xgoals_pct: 0.82,
    goalie_xgsaa_per_60: 0.09,
    rest_days: 2,
    series_wins: 0,
    is_home: true,
    provider_metrics: {
      team: "FLA", season: 2025, goalsForPerGame: 3.25, goalsAgainstPerGame: 2.72,
      shotsForPerGame: 31.4, shotsAgainstPerGame: 28.1, powerPlayPct: 0.24,
      penaltyKillPct: 0.81, pointsPct: 0.64, fetchedAt: "2026-09-23T00:00:00.000Z",
    },
    calibrated_state: { elo: 1540, goalsFor: 3.30, goalsAgainst: 2.80 },
    opponent_adjusted_attack: 0.03,
    opponent_adjusted_defense_weakness: 0.12,
  },
  away: {
    abbreviation: "BOS",
    xgoals_pct: 0.49,
    x_goals_for_per_60: 2.82,
    x_goals_against_per_60: 2.91,
    five_x_goals_for_per_60: 2.12,
    five_x_goals_against_per_60: 2.31,
    pp_x_goals_for_per_60: 0.48,
    pk_x_goals_against_per_60: 0.56,
    pp_xgoals_pct: 0.20,
    pk_xgoals_pct: 0.79,
    goalie_xgsaa_per_60: 0.01,
    rest_days: 1,
    series_wins: 0,
    is_home: false,
    provider_metrics: {
      team: "BOS", season: 2025, goalsForPerGame: 2.91, goalsAgainstPerGame: 3.02,
      shotsForPerGame: 29.8, shotsAgainstPerGame: 30.2, powerPlayPct: 0.20,
      penaltyKillPct: 0.79, pointsPct: 0.51, fetchedAt: "2026-09-23T00:00:00.000Z",
    },
    calibrated_state: { elo: 1490, goalsFor: 2.90, goalsAgainst: 3.10 },
    opponent_adjusted_attack: 0.00,
    opponent_adjusted_defense_weakness: 0.11,
  },
  market: {
    market_home_prob: 0.58,
    best_home_ml_prob: 0.56,
    best_away_ml_prob: 0.46,
    market_open_home_prob: 0.55,
    market_total_line: 6.5,
    market_open_total_line: 6,
    same_book_home_prob_move: 0.03,
    same_book_total_move: 0.5,
    market_home_puck_line: -1.5,
    market_away_puck_line: 1.5,
    market_home_puck_prob: 0.36,
    market_away_puck_prob: 0.68,
    market_book_count: 8,
    ml_home_bets_pct: 48,
    ml_home_money_pct: 62,
    total_over_bets_pct: 43,
    total_over_money_pct: 57,
  },
  series: { series_abbrev: null, game_number_in_series: 0, is_elimination_game: false },
  game_type: 2,
  feature_season: 2026,
  provider_feature_season: 2025,
};

const result = nhlRegularModelV1(base);
const legacyFallback = nhlRegularModelV1({
  ...base,
  home: { ...base.home, opponent_adjusted_attack: null, opponent_adjusted_defense_weakness: null },
  away: { ...base.away, opponent_adjusted_attack: null, opponent_adjusted_defense_weakness: null },
});
assert.equal(result.model_version, NHL_REGULAR_MODEL_RELEASE);
assert.equal(result.calibration_version, NHL_REGULAR_CALIBRATION_RELEASE);
assert.equal(result.decision_version, NHL_REGULAR_DECISION_RELEASE);
assert.ok(Math.abs(result.projected_home_goals + result.projected_away_goals - result.expected_total_goals) < 1e-9);
assert.ok(Math.abs(result.projected_home_goals - result.projected_away_goals - result.expected_goal_diff) < 1e-9);
assert.ok(Number.isFinite(result.independent_goal_diff), "professional independent margin is finite");
assert.ok(result.independent_total_goals >= 4.5 && result.independent_total_goals <= 8, "professional independent total remains inside the trained support");
assert.ok(result.puck_line.pick.includes("1.5"));
assert.ok(Math.abs(result.moneyline.probability - legacyFallback.moneyline.probability) < 1e-12, "opponent-adjusted Total preserves the validated r5 Moneyline probability exactly");
assert.equal(result.moneyline.pick, legacyFallback.moneyline.pick, "Total repair cannot flip the Moneyline winner");
assert.notEqual(result.independent_total_goals, legacyFallback.independent_total_goals, "complete matchup state activates the new Total component");
assert.ok(Math.abs(legacyFallback.expected_goal_diff - ((legacyFallback.projected_home_goals - legacyFallback.projected_away_goals))) < 1e-12, "feed fallback remains one coherent r5 score pair");
assert.equal(normalizeNhlTeamName("MTL Canadiens"), "MTL");
assert.equal(normalizeNhlTeamName("NYR Rangers"), "NYR");
assert.deepEqual(selectMainNhlPuckLinePair([
  { market_type: "spread", sportsbook: "saba", side: "home", line_value: -1.5 },
  { market_type: "spread", sportsbook: "saba", side: "away", line_value: 1.5 },
]), { home: -1.5, away: 1.5 });
assert.deepEqual(selectMainNhlPuckLinePair([
  { market_type: "spread", sportsbook: "saba", side: "home", line_value: 0 },
  { market_type: "spread", sportsbook: "saba", side: "away", line_value: 0 },
  { market_type: "spread", sportsbook: "saba", side: "home", line_value: -1.5 },
  { market_type: "spread", sportsbook: "saba", side: "away", line_value: 1.5 },
  { market_type: "spread", sportsbook: "saba", side: "home", line_value: 0 },
]), { home: -1.5, away: 1.5 }, "multiple same-book rows cannot erase the actual quoted puck-line pair");
assert.deepEqual(selectSameBookNhlMovement([
  { market_type: "moneyline", sportsbook: "Circa", side: "home", line_value: null, odds_american: -140, implied_probability: null },
  { market_type: "moneyline", sportsbook: "Circa", side: "away", line_value: null, odds_american: 120, implied_probability: null },
  { market_type: "total", sportsbook: "Circa", side: "over", line_value: 6.5, odds_american: -110, implied_probability: null },
], [
  { market_type: "moneyline", sportsbook: "Circa", side: "home", line_value: null, odds_american: -120, implied_probability: null },
  { market_type: "moneyline", sportsbook: "Circa", side: "away", line_value: null, odds_american: 100, implied_probability: null },
  { market_type: "total", sportsbook: "Circa", side: "over", line_value: 6, odds_american: -110, implied_probability: null },
]).totalMove, 0.5, "market reading uses a continuous same-book trail");
const pickemQuotedLine = nhlRegularModelV1({
  ...base,
  home: { ...base.home, abbreviation: "TOR" },
  away: { ...base.away, abbreviation: "MTL" },
  market: { ...base.market, market_home_prob: 0.4989, market_home_puck_line: -1.5, market_away_puck_line: 1.5 },
});
assert.notEqual(pickemQuotedLine.puck_line.pick, "TOR +1.5", "puck-line output must be one of the actually quoted sides");
assert.ok(["TOR -1.5", "MTL +1.5"].includes(pickemQuotedLine.puck_line.pick));
assert.ok(sportsInSeasonToday(new Date("2026-09-29T12:00:00.000Z")).includes("nhl"), "opening-night minute lock includes NHL");
assert.ok(result.moneyline.probability >= 0.5 && result.moneyline.probability <= 0.8);
assert.ok(result.total.probability >= 0.5 && result.total.probability <= 1);
assert.ok(Math.abs(calibrateNhlTotalConfidence(0.647456) - 0.5914807818317462) < 1e-12);
assert.ok(calibrateNhlTotalConfidence(0.688847) < 0.688847, "total confidence is release-pure calibrated rather than raw Poisson certainty");
assert.ok(Math.abs(result.expected_total_goals - result.independent_total_goals) <= 0.59, "movement and split reading condition rather than replace the independent total");

const noMarket = nhlRegularModelV1({
  ...base,
  market: {
    ...base.market,
    market_home_prob: null,
    market_open_home_prob: null,
    market_total_line: null,
    market_open_total_line: null,
    same_book_home_prob_move: null,
    same_book_total_move: null,
    ml_home_bets_pct: null,
    ml_home_money_pct: null,
    total_over_bets_pct: null,
    total_over_money_pct: null,
  },
});
assert.notEqual(result.expected_goal_diff, noMarket.expected_goal_diff, "market movement and sharp splits alter the bounded final margin");
assert.notEqual(result.expected_total_goals, noMarket.expected_total_goals, "market total and sharp splits alter the bounded final total");

const totalLineOnlyA = nhlRegularModelV1({
  ...base,
  market: {
    ...base.market,
    market_total_line: 5.5,
    market_open_total_line: 5.5,
    same_book_total_move: 0,
    total_over_bets_pct: null,
    total_over_money_pct: null,
  },
});
const totalLineOnlyB = nhlRegularModelV1({
  ...base,
  market: {
    ...base.market,
    market_total_line: 7.5,
    market_open_total_line: 7.5,
    same_book_total_move: 0,
    total_over_bets_pct: null,
    total_over_money_pct: null,
  },
});
assert.equal(totalLineOnlyA.expected_total_goals, totalLineOnlyB.expected_total_goals, "the posted Total line evaluates the forecast but never anchors its score mean");
assert.ok(totalLineOnlyA.total.pick.startsWith("OVER"));
assert.ok(totalLineOnlyB.total.pick.startsWith("UNDER"));
assert.notEqual(totalLineOnlyA.total.verdict, "pass", "confidence calibration does not silently flatten the Over grade path");
assert.notEqual(totalLineOnlyB.total.verdict, "pass", "confidence calibration does not silently flatten the Under grade path");

assert.equal(nhlGameTypeFromExternalId(2026010001), 1);
assert.equal(nhlGameTypeFromExternalId(2026020001), 2);
assert.equal(nhlGameTypeFromExternalId(2026030001), 3);
assert.equal(nhlSeasonStartYearFromExternalId(2026020001), 2026);
assert.equal(isOfficiallyTrackedMarket("nhl", "spread"), true);
assert.equal(isPublicallyTracked("nhl", "2026-09-28"), false);
assert.equal(isPublicallyTracked("nhl", "2026-09-29"), true);
assert.equal(__NHL_SPLITS_SYNC_TEST__.sharpPct(0.62), 62);
assert.equal(__NHL_SPLITS_SYNC_TEST__.sharpPct(62), 62);
assert.equal(__NHL_SPLITS_SYNC_TEST__.sharpPct(1), null, "unverifiable 100% endpoints never masquerade as 1%");
const stateBefore = replayNhlRegularState([]).get("BOS")!;
const stateAfter = replayNhlRegularState([{ externalId: 2026020001, startTime: "2026-09-29T23:00:00Z", homeTeam: "BOS", awayTeam: "FLA", homeScore: 4, awayScore: 2 }]).get("BOS")!;
assert.notEqual(stateAfter.elo, stateBefore.elo);
assert.notEqual(stateAfter.goalsFor, stateBefore.goalsFor);
const openingAdjusted = replayNhlOpponentAdjustedState([], "2026-09-29");
const replayedAdjusted = replayNhlOpponentAdjustedState([
  { game_id: 2026020001, season: 2026, game_date: "20260929", team_abbr: "BOS", opponent_abbr: "FLA", home_or_away: "HOME", x_goals_for: 4.2 },
  { game_id: 2026020001, season: 2026, game_date: "20260929", team_abbr: "FLA", opponent_abbr: "BOS", home_or_away: "AWAY", x_goals_for: 1.8 },
], "2026-09-30");
const noLeakAdjusted = replayNhlOpponentAdjustedState([
  { game_id: 2026020001, season: 2026, game_date: "20260929", team_abbr: "BOS", opponent_abbr: "FLA", home_or_away: "HOME", x_goals_for: 4.2 },
  { game_id: 2026020001, season: 2026, game_date: "20260929", team_abbr: "FLA", opponent_abbr: "BOS", home_or_away: "AWAY", x_goals_for: 1.8 },
], "2026-09-29");
assert.equal(replayedAdjusted.gamesApplied, 1);
assert.notDeepEqual(replayedAdjusted.states.get("BOS"), openingAdjusted.states.get("BOS"));
assert.deepEqual(noLeakAdjusted.states.get("BOS"), openingAdjusted.states.get("BOS"), "same-day outcomes never leak into a pregame slate");

const trackingBase = {
  sport: "nhl",
  locked_at: "2026-09-29T22:00:00.000Z",
  external_id: 2026020001,
  model_version: NHL_REGULAR_MODEL_RELEASE,
  calibration_version: NHL_REGULAR_CALIBRATION_RELEASE,
} as PredictionRecordRow;
assert.equal(isTrackingRecordEligible(trackingBase), true);
assert.equal(isTrackingRecordEligible({ ...trackingBase, external_id: 2026010001 }), false, "preseason never enters public NHL accuracy");
assert.equal(isTrackingRecordEligible({ ...trackingBase, model_version: "nhl_v0_2026_finals" }), false, "retired release never enters new regular-season record");

const stalePlaybook = {
  provider: "playbook" as const,
  public_betting_pct: 44,
  public_money_pct: 61,
  books_used: 9,
  observed_at: "2026-09-01T00:00:00.000Z",
};
const freshSharp = {
  provider: "sharpapi" as const,
  public_betting_pct: 49,
  public_money_pct: 55,
  observed_at: "2026-09-23T12:00:00.000Z",
};
const lkg = resolvePublicSplit({ playbook: stalePlaybook, sharpapi: freshSharp, now: new Date("2026-09-23T12:01:00.000Z"), staleAfterMinutes: Number.POSITIVE_INFINITY });
assert.equal(lkg.displaySource, "playbook", "NHL retains the latest complete preferred provider without expiring the section");
const fallback = resolvePublicSplit({ playbook: { ...stalePlaybook, public_money_pct: null }, sharpapi: freshSharp, now: new Date("2026-09-23T12:01:00.000Z"), staleAfterMinutes: Number.POSITIVE_INFINITY });
assert.equal(fallback.displaySource, "sharpapi", "a complete fallback silently replaces an incomplete preferred source");
const matchedPlaybookNhl = matchPlaybookSplitsToSlateGames(
  [{ id: 1, key: "bruins@panthers", gameDate: "2026-09-29T23:00:00.000Z" }],
  [{
    gameId: "playbook-nhl-1",
    awayTeamName: "Boston Bruins",
    homeTeamName: "Florida Panthers",
    startTime: "2026-09-29T23:00:00.000Z",
  }],
  "nhl",
);
assert.equal(matchedPlaybookNhl.get(1)?.gameId, "playbook-nhl-1", "NHL Playbook rows match via the generic team-name fallback");

const writer = readFileSync(new URL("../lib/services/nhl/buildNhlPredictionRecords.ts", import.meta.url), "utf8");
const reader = readFileSync(new URL("../lib/services/nhl/buildNhlDailyEdgeAdapted.ts", import.meta.url), "utf8");
const cron = readFileSync(new URL("../app/api/cron/nhl-daily-refresh/route.ts", import.meta.url), "utf8");
const linesProvider = readFileSync(new URL("../lib/providers/nhl/_sharpApiNhlClient.ts", import.meta.url), "utf8");
const linesRefresh = readFileSync(new URL("../lib/services/nhl/refreshNhlLinesService.ts", import.meta.url), "utf8");
assert.match(writer, /nhlGameTypeFromExternalId\(game\.external_id\) === 2/);
assert.match(reader, /nhlGameTypeFromExternalId\(game\.external_id\) === 2/);
assert.match(reader, /bestPriceFor\("total", totalSide, marketTotalLine\)/, "reader prices the exact predicted total line");
assert.match(reader, /Math\.abs\(l\.line_value - predictedPuckLine\) < 0\.01/, "reader prices the exact predicted puck line");
assert.match(reader, /lockedPayloadByGame/, "reader preserves the writer-owned locked model tuple");
assert.ok(cron.indexOf("syncPublicSplitsObservations") < cron.indexOf("writeNhlPredictionRecords({"), "persistent splits refresh precedes the only NHL writer");
assert.match(cron, /leaseGroup: "prediction_pipeline"/);
assert.match(cron, /refreshDailyEdgeResponseSnapshot/);
assert.match(linesProvider, /fetchSharpNhlEvents/, "NHL resolves exact events before fetching odds");
assert.match(linesProvider, /event_id: eventId/, "NHL odds retrieval is event-scoped instead of scanning an incomplete league slice");
assert.match(linesProvider, /recovered \$\{market\}/, "an event-scoped missing market gets a targeted recovery call");
assert.match(linesRefresh, /incomplete SharpAPI \$\{market\} coverage/, "a refresh cannot silently call an incomplete five-game board healthy");

console.log("NHL regular-season model, tracking boundary, split fallback, and writer safety tests passed.");
