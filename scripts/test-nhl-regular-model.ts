import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NHL_REGULAR_CALIBRATION_RELEASE,
  NHL_REGULAR_DECISION_RELEASE,
  NHL_REGULAR_MODEL_RELEASE,
  calibrateNhlTotalConfidence,
  nhlRegularModelV1,
  resolveNhlPriceAwareVerdict,
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
import {
  __NHL_FEATURE_SNAPSHOT_TEST__,
  selectMainNhlPuckLinePair,
  selectSameBookNhlMovement,
} from "../lib/services/nhl/featureSnapshot";
import { aggregateNhlRosterPrior, normalizeNhlPlayerName } from "../lib/automodel/nhlRosterPrior2026";
import { normalizeNhlTeamName } from "../lib/providers/nhl/_teamNameNormalizer";
import { sportsInSeasonToday } from "../lib/cron/seasons";
import type { PredictionRecordRow } from "../lib/types/domain/Tracking";
import {
  __NHL_SPLITS_SYNC_TEST__,
  matchPlaybookSplitsToSlateGames,
} from "../lib/services/syncPublicSplitsObservations";
import { replayNhlRegularState } from "../lib/automodel/nhlRegularState";
import { replayNhlOpponentAdjustedState } from "../lib/services/nhl/loadNhlOpponentAdjustedState";
import { buildNhlTwoSidedPriceTrail } from "../lib/services/nhl/nhlPriceTrail";
import {
  canonicalizeNhlLineRows,
  resolveNhlLockedPriceQuote,
  selectNhlBestPriceQuote,
} from "../lib/services/nhl/nhlLineBoard";
import { assessNhlLockCoherence } from "../lib/services/nhl/nhlLockCoherence";
import { __NHL_ADAPTER_TEST__ } from "../lib/services/nhl/adaptNhlToDailyEdgeResponse";
import {
  buildNhlRegularMarketAwareForecast,
  buildNhlTargetExcludedTotalRead,
} from "../lib/services/nhl/nhlTargetExcludedTotalMarket";

assert.equal(resolveNhlPriceAwareVerdict("moneyline", "best_angle", -175, 0.70), "best_angle");
assert.equal(resolveNhlPriceAwareVerdict("moneyline", "best_angle", -110, 0.69), "lean", "Moneyline Best Angle requires 70% outcome confidence");
assert.equal(resolveNhlPriceAwareVerdict("moneyline", "best_angle", -190, 0.70), "lean", "Moneyline Best Angle also requires 5pp exact-price edge");
assert.equal(resolveNhlPriceAwareVerdict("total", "best_angle", -110, 0.64), "lean", "Total Best Angle requires 65% calibrated outcome confidence");
assert.equal(resolveNhlPriceAwareVerdict("total", "best_angle", -155, 0.65), "lean", "Total Best Angle also requires 5pp exact-price edge");
assert.equal(resolveNhlPriceAwareVerdict("total", "best_angle", -110, 0.65), "best_angle", "a qualified Total remains a Best Angle");
assert.equal(resolveNhlPriceAwareVerdict("moneyline", "best_angle", -200, 0.70), "lean", "a price in the -200s cannot be an NHL Best Angle");
assert.equal(resolveNhlPriceAwareVerdict("moneyline", "lean", -230, 0.72), "lean", "a short likely winner remains actionable as a Lean");
assert.equal(resolveNhlPriceAwareVerdict("moneyline", "lean", -899, 0.90), "lean");
assert.equal(resolveNhlPriceAwareVerdict("moneyline", "lean", -900, 0.92), "pass", "an extreme negative price is not actionable");
assert.equal(resolveNhlPriceAwareVerdict("moneyline", "best_angle", null, 0.70), "pass", "a missing exact price is not actionable");
assert.equal(resolveNhlPriceAwareVerdict("spread", "watchlist", 120, 0.60), "lean", "a validated 5pp puck-line exact-price edge provides the paired promotion");
assert.equal(resolveNhlPriceAwareVerdict("spread", "watchlist", -120, 0.58), "watchlist", "a puck-line promotion still requires its exact-price edge");
assert.equal(resolveNhlPriceAwareVerdict("moneyline", "watchlist", 120, 0.60), "watchlist", "the puck-line promotion cannot leak into Moneylines");

assert.deepEqual(
  __NHL_ADAPTER_TEST__.buildPublicSplits(
    "total",
    false,
    true,
    {
      spread: {
        bets_pct: { away: 0.42, home: 0.58 },
        handle_pct: { away: 0.35, home: 0.65 },
      },
    },
    "TOR",
    "NYI",
  ),
  [],
  "a missing NHL Total split must not borrow the puck-line split pair",
);

const namedBookFallbackSplits: NonNullable<Parameters<typeof __NHL_ADAPTER_TEST__.buildPublicSplits>[3]> = {
  spread: {
    bets_pct: { away: 0.67, home: 0.33 },
    handle_pct: { away: 0.2, home: 0.8 },
  },
  internal_resolution: {
    spread: {
      source: "sharpapi",
      agreement: "single_source",
      confidence: "medium",
      providerGapPct: null,
    },
  },
};
assert.deepEqual(
  __NHL_ADAPTER_TEST__.buildPublicSplits("puckline", false, false, namedBookFallbackSplits, "TOR", "NYI"),
  [],
  "a SharpAPI named-book fallback must not also populate Public Consensus",
);
const independentConsensusSplits = structuredClone(namedBookFallbackSplits);
independentConsensusSplits.internal_resolution!.spread!.source = "playbook";
assert.deepEqual(
  __NHL_ADAPTER_TEST__.buildPublicSplits("puckline", false, false, independentConsensusSplits, "TOR", "NYI"),
  [
    { side: "away", label: "NYI", moneyPct: 20, betsPct: 67 },
    { side: "home", label: "TOR", moneyPct: 80, betsPct: 33 },
  ],
  "an independent Playbook consensus remains available beside Sharp Book Splits",
);

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
    ml_split_source: "playbook",
    ml_split_confidence: "high",
    total_split_source: "sharpapi",
    total_split_confidence: "medium",
  },
  series: { series_abbrev: null, game_number_in_series: 0, is_elimination_game: false },
  game_type: 2,
  feature_season: 2026,
  provider_feature_season: 2025,
};

const result = nhlRegularModelV1(base);
const targetExcludedRead = {
  exact_line: 6.5,
  over_probability: 0.59,
  complete_book_count: 4,
  named_book_count: 2,
  excluded_sportsbook: "DraftKings",
  excluded_sportsbook_family: "draftkings",
  included_sportsbook_families: ["betmgm", "circa", "pinnacle", "fanduel"],
  stable_sequence_direction: null,
  stable_sequence_source_class: "none" as const,
  stable_sequence_sources: [],
};
const reconciledTotal = nhlRegularModelV1({
  ...base,
  market: { ...base.market, target_excluded_total_read: targetExcludedRead },
});
assert.notEqual(reconciledTotal.expected_total_goals, result.expected_total_goals, "qualified target-excluded Total prices move the final score mean");
assert.ok(Math.abs(reconciledTotal.moneyline.probability - result.moneyline.probability) < 1e-12, "Total reconciliation preserves the incumbent Moneyline probability exactly");
assert.equal(reconciledTotal.moneyline.pick, result.moneyline.pick, "Total reconciliation cannot invent a different winner");
assert.ok(Math.abs(reconciledTotal.projected_home_goals + reconciledTotal.projected_away_goals - reconciledTotal.expected_total_goals) < 1e-12);
assert.ok(Math.abs(reconciledTotal.projected_home_goals - reconciledTotal.projected_away_goals - reconciledTotal.expected_goal_diff) < 1e-12);
assert.equal(reconciledTotal.layers.total_market_authority, 1, "a named-book pair gives the qualified Total board full authority");
const opposedTotalSequence = nhlRegularModelV1({
  ...base,
  market: {
    ...base.market,
    target_excluded_total_read: {
      ...targetExcludedRead,
      stable_sequence_direction: "under",
      stable_sequence_source_class: "named",
      stable_sequence_sources: ["circa", "pinnacle"],
    },
  },
});
assert.equal(opposedTotalSequence.layers.total_market_authority, 0.65, "stable opposing sequence reduces rather than vetoes endpoint authority");
const retailOnlyTotal = nhlRegularModelV1({
  ...base,
  market: {
    ...base.market,
    target_excluded_total_read: { ...targetExcludedRead, named_book_count: 0 },
  },
});
assert.equal(retailOnlyTotal.layers.total_market_authority, 0.8, "broad retail-only confirmation retains graduated authority");
const strongRosterPrior = {
  gameScore: 1.9,
  ixg: 0.8,
  points: 1.8,
  onIceXgDiff: 0.1,
  knownSkaters: 18,
  totalSkaters: 20,
  coverage: 0.9,
  release: "nhl_roster_player_priors_2026_09_30_r1" as const,
};
const weakRosterPrior = {
  ...strongRosterPrior,
  gameScore: 1.1,
  ixg: 0.4,
  points: 1.0,
};
const corroboratedFlip = nhlRegularModelV1({
  ...base,
  home: {
    ...base.home,
    opponent_adjusted_attack: null,
    opponent_adjusted_defense_weakness: null,
    roster_prior: strongRosterPrior,
  },
  away: {
    ...base.away,
    opponent_adjusted_attack: null,
    opponent_adjusted_defense_weakness: null,
    roster_prior: weakRosterPrior,
  },
  market: {
    ...base.market,
    market_home_prob: 0.44,
    market_open_home_prob: 0.47,
    same_book_home_prob_move: -0.03,
    market_book_count: 5,
    ml_home_bets_pct: 38,
    ml_home_money_pct: 34,
    ml_split_confidence: "high",
  },
});
assert.equal(corroboratedFlip.layers.roster_prior_active, true, "opening-week forecast consumes the current roster prior");
assert.equal(corroboratedFlip.layers.market_decision, "flipped", "corroborated price, movement and splits can fully correct the independent side");
assert.equal(corroboratedFlip.moneyline.pick, "BOS ML");
assert.ok(Math.abs(corroboratedFlip.projected_home_goals + corroboratedFlip.projected_away_goals - corroboratedFlip.expected_total_goals) < 1e-12);
assert.ok(Math.abs(corroboratedFlip.projected_home_goals - corroboratedFlip.projected_away_goals - corroboratedFlip.expected_goal_diff) < 1e-12);

const uncorroboratedConflict = nhlRegularModelV1({
  ...base,
  home: { ...base.home, opponent_adjusted_attack: null, opponent_adjusted_defense_weakness: null, roster_prior: strongRosterPrior },
  away: { ...base.away, opponent_adjusted_attack: null, opponent_adjusted_defense_weakness: null, roster_prior: weakRosterPrior },
  market: {
    ...base.market,
    market_home_prob: 0.44,
    market_open_home_prob: 0.47,
    same_book_home_prob_move: 0.01,
    market_book_count: 5,
    ml_home_bets_pct: 38,
    ml_home_money_pct: 34,
    ml_split_confidence: "high",
  },
});
assert.equal(uncorroboratedConflict.layers.market_decision, "independent", "a conflicting but unconfirmed market cannot drag or flip the score");
assert.equal(uncorroboratedConflict.moneyline.pick, "FLA ML");
assert.equal(uncorroboratedConflict.expected_goal_diff, uncorroboratedConflict.independent_goal_diff);

const currentSeasonState = nhlRegularModelV1({
  ...base,
  provider_feature_season: base.feature_season,
  home: { ...base.home, opponent_adjusted_attack: null, opponent_adjusted_defense_weakness: null, roster_prior: strongRosterPrior, current_season_games: 12 },
  away: { ...base.away, opponent_adjusted_attack: null, opponent_adjusted_defense_weakness: null, roster_prior: weakRosterPrior, current_season_games: 12 },
});
assert.equal(currentSeasonState.layers.roster_prior_active, false, "current-season team evidence supersedes the opening roster prior automatically");
const futureSeasonFlip = nhlRegularModelV1({
  ...base,
  provider_feature_season: base.feature_season,
  home: {
    ...base.home,
    opponent_adjusted_attack: null,
    opponent_adjusted_defense_weakness: null,
    roster_prior: strongRosterPrior,
    current_season_games: 12,
  },
  away: {
    ...base.away,
    opponent_adjusted_attack: null,
    opponent_adjusted_defense_weakness: null,
    roster_prior: weakRosterPrior,
    current_season_games: 12,
  },
  market: {
    ...base.market,
    market_home_prob: 0.44,
    market_open_home_prob: 0.47,
    same_book_home_prob_move: -0.03,
    market_book_count: 5,
    ml_home_bets_pct: 38,
    ml_home_money_pct: 34,
    ml_split_confidence: "high",
  },
});
assert.equal(futureSeasonFlip.layers.roster_prior_active, false);
assert.equal(futureSeasonFlip.layers.market_decision, "flipped", "the discrete market reader remains active after the opening roster window");
assert.equal(futureSeasonFlip.moneyline.pick, "BOS ML");

const aggregatedRoster = aggregateNhlRosterPrior([
  { fullName: "A.J. Greer", positionCode: "L" },
  { fullName: "Aaron Ekblad", positionCode: "D" },
  ...Array.from({ length: 8 }, (_, index) => ({ fullName: `Unknown Skater ${index}`, positionCode: "C" })),
  { fullName: "Goalie Example", positionCode: "G" },
]);
assert.ok(aggregatedRoster);
assert.equal(aggregatedRoster.totalSkaters, 10);
assert.equal(aggregatedRoster.knownSkaters, 2);
assert.equal(normalizeNhlPlayerName("  A.J. Gréér "), "a j greer");

const goalieRows = [
  { player_external_id: 1, player_name: "Departed Goalie", team_abbr: "PIT", season: 2025, season_type: "regular", situation: "all", games_played: 50, ice_time: 1, x_goals: 1, goals: 1 },
  { player_external_id: 2, player_name: "Current Goalie", team_abbr: "PIT", season: 2025, season_type: "regular", situation: "all", games_played: 20, ice_time: 1, x_goals: 1, goals: 1 },
] satisfies Parameters<typeof __NHL_FEATURE_SNAPSHOT_TEST__.selectGoalieByDefault>[0];
assert.equal(
  __NHL_FEATURE_SNAPSHOT_TEST__.selectGoalieByDefault(
    goalieRows,
    "PIT",
    2026,
    2,
    new Set([normalizeNhlPlayerName("Current Goalie")]),
  )?.player_name,
  "Current Goalie",
  "default goalie history is restricted to a verified current-roster goalie",
);
assert.equal(
  __NHL_FEATURE_SNAPSHOT_TEST__.selectGoalieByDefault(goalieRows, "PIT", 2026, 2, new Set()),
  null,
  "an unverifiable current goalie falls back to neutral instead of a departed player",
);
const runtimeParity = nhlRegularModelV1({
  ...base,
  home: {
    ...base.home,
    pp_x_goals_for_per_60: 8.62,
    pk_x_goals_against_per_60: 7.48,
    pp_x_goals_for_per_game: base.home.pp_x_goals_for_per_60,
    pk_x_goals_against_per_game: base.home.pk_x_goals_against_per_60,
  },
  away: {
    ...base.away,
    pp_x_goals_for_per_60: 7.48,
    pk_x_goals_against_per_60: 8.56,
    pp_x_goals_for_per_game: base.away.pp_x_goals_for_per_60,
    pk_x_goals_against_per_game: base.away.pk_x_goals_against_per_60,
  },
});
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
const strongFavorite = nhlRegularModelV1({
  ...base,
  home: {
    ...base.home,
    xgoals_pct: 0.64,
    x_goals_for_per_60: 4.1,
    x_goals_against_per_60: 2.0,
    five_x_goals_for_per_60: 3.3,
    five_x_goals_against_per_60: 1.7,
    goalie_xgsaa_per_60: 0.28,
    calibrated_state: { elo: 1700, goalsFor: 4.1, goalsAgainst: 2.0 },
  },
  away: {
    ...base.away,
    xgoals_pct: 0.38,
    x_goals_for_per_60: 2.0,
    x_goals_against_per_60: 4.0,
    five_x_goals_for_per_60: 1.6,
    five_x_goals_against_per_60: 3.4,
    goalie_xgsaa_per_60: -0.3,
    calibrated_state: { elo: 1320, goalsFor: 2.0, goalsAgainst: 4.1 },
  },
  market: {
    ...base.market,
    market_home_prob: 0.8,
    best_home_ml_prob: 0.77,
    best_away_ml_prob: 0.24,
    same_book_home_prob_move: 0.08,
    market_home_puck_prob: 0.55,
    market_away_puck_prob: 0.49,
  },
});
assert.equal(strongFavorite.puck_line.pick, "FLA -1.5", "a supported favorite margin can select -1.5 without a quota or side restriction");
assert.ok(Math.abs(result.moneyline.probability - legacyFallback.moneyline.probability) < 1e-12, "opponent-adjusted Total preserves the validated r5 Moneyline probability exactly");
assert.equal(result.moneyline.pick, legacyFallback.moneyline.pick, "Total repair cannot flip the Moneyline winner");
assert.notEqual(result.independent_total_goals, legacyFallback.independent_total_goals, "complete matchup state activates the new Total component");
assert.ok(
  Math.abs(runtimeParity.independent_total_goals - result.independent_total_goals) < 1e-12,
  "production special-teams per-60 evidence cannot replace the per-game units used by the released score fit",
);
assert.ok(Math.abs(legacyFallback.expected_goal_diff - ((legacyFallback.projected_home_goals - legacyFallback.projected_away_goals))) < 1e-12, "feed fallback remains one coherent r5 score pair");

const pairedTrail = buildNhlTwoSidedPriceTrail({
  market: "moneyline",
  selectedSide: "home",
  opposingSide: "away",
  selectedLine: null,
  opposingLine: null,
  preferredBook: "pinnacle",
  history: [
    { market_type: "moneyline", sportsbook: "pinnacle", side: "home", line_value: null, odds_american: -130, observed_at: "2026-09-29T10:00:00.000Z" },
    { market_type: "moneyline", sportsbook: "pinnacle", side: "away", line_value: null, odds_american: 115, observed_at: "2026-09-29T10:00:00.000Z" },
    { market_type: "moneyline", sportsbook: "pinnacle", side: "home", line_value: null, odds_american: -135, observed_at: "2026-09-29T12:00:00.000Z" },
    { market_type: "moneyline", sportsbook: "pinnacle", side: "away", line_value: null, odds_american: 120, observed_at: "2026-09-29T12:00:00.000Z" },
  ],
  live: [
    { market_type: "moneyline", sportsbook: "pinnacle", side: "home", line_value: null, odds_american: -140, observed_at: "2026-09-29T14:00:00.000Z" },
    { market_type: "moneyline", sportsbook: "pinnacle", side: "away", line_value: null, odds_american: 125, observed_at: "2026-09-29T14:00:00.000Z" },
  ],
});
assert.equal(pairedTrail.sportsbook, "pinnacle", "two-sided price board stays on one complete book");
assert.deepEqual(pairedTrail.selected.map((stop) => stop.american), [-130, -135, -140]);
assert.deepEqual(pairedTrail.opposing.map((stop) => stop.american), [115, 120, 125]);
assert.equal(pairedTrail.selected.at(-1)?.label, "current");
assert.equal(pairedTrail.opposing.at(-1)?.label, "current");

const canonicalLines = canonicalizeNhlLineRows([
  { game_id: 1, market_type: "moneyline", sportsbook: "pinnacle", side: "home", line_value: null, odds_american: -145, source_timestamp: "2026-09-29T12:00:00.000Z" },
  { game_id: 1, market_type: "moneyline", sportsbook: "pinnacle", side: "away", line_value: null, odds_american: 125, source_timestamp: "2026-09-29T12:00:00.000Z" },
  { game_id: 1, market_type: "moneyline", sportsbook: "pinnacle", side: "home", line_value: null, odds_american: -140, source_timestamp: "2026-09-29T14:00:00.000Z" },
  { game_id: 1, market_type: "moneyline", sportsbook: "pinnacle", side: "away", line_value: null, odds_american: 120, source_timestamp: "2026-09-29T14:00:00.000Z" },
  { game_id: 1, market_type: "total", sportsbook: "circa", side: "over", line_value: 6.5, odds_american: -105, source_timestamp: "2026-09-29T14:00:00.000Z" },
  { game_id: 1, market_type: "total", sportsbook: "circa", side: "under", line_value: 6.5, odds_american: -115, source_timestamp: "2026-09-29T14:00:00.000Z" },
  { game_id: 1, market_type: "spread", sportsbook: "saba", side: "home", line_value: -1.5, odds_american: 130, source_timestamp: "2026-09-29T14:00:00.000Z" },
  { game_id: 1, market_type: "moneyline", sportsbook: "onexbet", side: "home", line_value: null, odds_american: 106, source_timestamp: "2026-09-29T14:00:00.000Z" },
  { game_id: 1, market_type: "moneyline", sportsbook: "onexbet", side: "away", line_value: null, odds_american: 212, source_timestamp: "2026-09-29T14:00:00.000Z" },
]);
assert.deepEqual(
  canonicalLines.filter((row) => row.market_type === "moneyline").map((row) => row.odds_american).sort((a, b) => a! - b!),
  [-140, 120],
  "the current complete two-sided observation replaces older same-book prices",
);
assert.equal(canonicalLines.filter((row) => row.market_type === "total").length, 2, "a complete exact-line total pair is retained");
assert.equal(canonicalLines.filter((row) => row.market_type === "spread").length, 0, "an incomplete one-sided refresh cannot enter the price board");
assert.equal(canonicalLines.filter((row) => row.sportsbook === "onexbet").length, 0, "a mislabeled three-way/regulation pair cannot become a full-game NHL price");
const exactQuote = selectNhlBestPriceQuote({
  rows: [
    { game_id: 2, market_type: "total", sportsbook: "pinnacle", side: "over", line_value: 6.5, odds_american: -108, observed_at: "2026-10-08T20:00:00.000Z" },
    { game_id: 2, market_type: "total", sportsbook: "pinnacle", side: "under", line_value: 6.5, odds_american: -112, observed_at: "2026-10-08T20:00:00.000Z" },
    { game_id: 2, market_type: "total", sportsbook: "circa", side: "over", line_value: 6.5, odds_american: -105, observed_at: "2026-10-08T20:00:00.000Z" },
    { game_id: 2, market_type: "total", sportsbook: "circa", side: "under", line_value: 6.5, odds_american: -115, observed_at: "2026-10-08T20:00:00.000Z" },
    { game_id: 2, market_type: "total", sportsbook: "promo", side: "over", line_value: 6.5, odds_american: 160, observed_at: "2026-10-08T20:00:00.000Z" },
    { game_id: 2, market_type: "total", sportsbook: "promo", side: "under", line_value: 6.5, odds_american: -300, observed_at: "2026-10-08T20:00:00.000Z" },
  ],
  market: "total",
  side: "over",
  line: 6.5,
});
assert.deepEqual(
  exactQuote,
  {
    market_type: "total",
    sportsbook: "circa",
    side: "over",
    line_value: 6.5,
    odds_american: -105,
    observed_at: "2026-10-08T20:00:00.000Z",
  },
  "writer and reader share one exact quote selector and reject an isolated promotional price",
);
const targetExcludedRows = [
  { market_type: "total", sportsbook: "DraftKings", side: "over", line_value: 6.5, odds_american: 110, observed_at: "2026-10-09T18:00:00.000Z" },
  { market_type: "total", sportsbook: "DraftKings", side: "under", line_value: 6.5, odds_american: 110, observed_at: "2026-10-09T18:00:00.000Z" },
  { market_type: "total", sportsbook: "Circa", side: "over", line_value: 6.5, odds_american: -125, observed_at: "2026-10-09T18:00:00.000Z" },
  { market_type: "total", sportsbook: "Circa", side: "under", line_value: 6.5, odds_american: 105, observed_at: "2026-10-09T18:00:00.000Z" },
  { market_type: "total", sportsbook: "Pinnacle", side: "over", line_value: 6.5, odds_american: -120, observed_at: "2026-10-09T18:00:00.000Z" },
  { market_type: "total", sportsbook: "Pinnacle", side: "under", line_value: 6.5, odds_american: 100, observed_at: "2026-10-09T18:00:00.000Z" },
  { market_type: "total", sportsbook: "Kalshi", side: "over", line_value: 6.5, odds_american: 100, observed_at: "2026-10-09T18:00:00.000Z" },
  { market_type: "total", sportsbook: "Kalshi", side: "under", line_value: 6.5, odds_american: 100, observed_at: "2026-10-09T18:00:00.000Z" },
];
const pureTotalRead = buildNhlTargetExcludedTotalRead({
  currentRows: targetExcludedRows,
  historyRows: [],
  totalLine: 6.5,
  excludedSportsbook: "DraftKings",
});
assert.equal(pureTotalRead?.complete_book_count, 2, "the evaluated sportsbook family is removed before consensus is formed");
assert.equal(pureTotalRead?.named_book_count, 2);
assert.ok(!pureTotalRead?.included_sportsbook_families.includes("kalshi"), "blocked exchange rows cannot influence Total consensus");
assert.ok((pureTotalRead?.over_probability ?? 0) > 0.5, "both Total prices, not only the posted number, determine market direction");
assert.equal(buildNhlTargetExcludedTotalRead({
  currentRows: targetExcludedRows.slice(0, 4),
  historyRows: [],
  totalLine: 6.5,
  excludedSportsbook: "DraftKings",
}), null, "one remaining sportsbook is not professional consensus");
const twoPassForecast = buildNhlRegularMarketAwareForecast({
  snapshot: base,
  currentRows: targetExcludedRows,
  historyRows: [],
});
assert.equal(twoPassForecast.targetExcludedTotalRead?.excluded_sportsbook_family, "pinnacle", "the final price target is excluded after a side change moves the guarded best quote");
assert.equal(twoPassForecast.snapshot.market.target_excluded_total_read, twoPassForecast.targetExcludedTotalRead);
assert.ok(Math.abs(twoPassForecast.model.moneyline.probability - twoPassForecast.seedModel.moneyline.probability) < 1e-12);
const sideChangingTargetRows = [
  { market_type: "total", sportsbook: "sx_bet", side: "over", line_value: 6.5, odds_american: -140, observed_at: "2026-10-09T18:00:00.000Z" },
  { market_type: "total", sportsbook: "sx_bet", side: "under", line_value: 6.5, odds_american: 115, observed_at: "2026-10-09T18:00:00.000Z" },
  { market_type: "total", sportsbook: "betonline", side: "over", line_value: 6.5, odds_american: -105, observed_at: "2026-10-09T18:00:00.000Z" },
  { market_type: "total", sportsbook: "betonline", side: "under", line_value: 6.5, odds_american: -115, observed_at: "2026-10-09T18:00:00.000Z" },
  { market_type: "total", sportsbook: "circa", side: "over", line_value: 6.5, odds_american: -135, observed_at: "2026-10-09T18:00:00.000Z" },
  { market_type: "total", sportsbook: "circa", side: "under", line_value: 6.5, odds_american: 115, observed_at: "2026-10-09T18:00:00.000Z" },
  { market_type: "total", sportsbook: "pinnacle", side: "over", line_value: 6.5, odds_american: -130, observed_at: "2026-10-09T18:00:00.000Z" },
  { market_type: "total", sportsbook: "pinnacle", side: "under", line_value: 6.5, odds_american: 110, observed_at: "2026-10-09T18:00:00.000Z" },
];
const fixedPointForecast = buildNhlRegularMarketAwareForecast({
  snapshot: base,
  currentRows: sideChangingTargetRows,
  historyRows: [],
});
assert.notEqual(fixedPointForecast.seedModel.total.pick, fixedPointForecast.model.total.pick, "a qualified exact-price board can flip the Total side");
assert.equal(fixedPointForecast.targetExclusionStatus, "stable");
const fixedPointSide = fixedPointForecast.model.total.pick.startsWith("OVER") ? "over" : "under";
const fixedPointQuote = selectNhlBestPriceQuote({
  rows: sideChangingTargetRows,
  market: "total",
  side: fixedPointSide,
  line: 6.5,
});
assert.equal(
  fixedPointQuote?.sportsbook.toLowerCase().replace(/[^a-z0-9]/g, ""),
  fixedPointForecast.targetExcludedTotalRead?.excluded_sportsbook_family,
  "a changed Total side is recomputed until its final evaluated sportsbook is the excluded target",
);
const immutableLockedQuote = resolveNhlLockedPriceQuote({
  market: "moneyline",
  side: "home",
  line: null,
  price: -133,
  lockedAt: "2026-10-08T22:00:00.000Z",
  evaluatedQuote: null,
  frozenLines: [
    { market_type: "moneyline", sportsbook: "novig", side: "home", line_value: null, odds_american: -133, observed_at: "2026-10-08T21:59:00.000Z" },
    { market_type: "moneyline", sportsbook: "novig", side: "away", line_value: null, odds_american: 118, observed_at: "2026-10-08T21:59:00.000Z" },
  ],
});
assert.equal(immutableLockedQuote?.odds_american, -133, "the stored locked price remains authoritative");
assert.equal(immutableLockedQuote?.sportsbook, "novig", "legacy locks recover book identity only from their own frozen snapshot");
assert.equal(resolveNhlLockedPriceQuote({
  market: "moneyline",
  side: "home",
  line: null,
  price: -133,
  lockedAt: "2026-10-08T22:00:00.000Z",
  evaluatedQuote: null,
  frozenLines: [
    { market_type: "moneyline", sportsbook: "novig", side: "home", line_value: null, odds_american: -133 },
    { market_type: "moneyline", sportsbook: "polymarket", side: "home", line_value: null, odds_american: -133 },
  ],
})?.sportsbook, "", "an unstored ambiguous legacy sportsbook is not fabricated");
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
assert.ok(Math.abs(result.expected_total_goals - result.independent_total_goals) <= 0.59, "same-book movement conditions rather than replaces the independent total");

const differentPublicSplits = nhlRegularModelV1({
  ...base,
  market: {
    ...base.market,
    ml_home_bets_pct: 81,
    ml_home_money_pct: 19,
    total_over_bets_pct: 18,
    total_over_money_pct: 82,
    ml_split_source: "sharpapi",
    ml_split_confidence: "medium",
    total_split_source: "playbook",
    total_split_confidence: "high",
  },
});
assert.equal(
  differentPublicSplits.expected_goal_diff,
  result.expected_goal_diff,
  "public-consensus splits remain visible evidence but cannot impersonate named sharp-book movement",
);
assert.equal(
  differentPublicSplits.expected_total_goals,
  result.expected_total_goals,
  "unvalidated public-consensus totals cannot rewrite the independent Total",
);

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
assert.notEqual(result.expected_goal_diff, noMarket.expected_goal_diff, "no-vig price and same-book movement alter the bounded final margin");
assert.notEqual(result.expected_total_goals, noMarket.expected_total_goals, "same-book Total movement alters the bounded final total");

const coherentRows = ([
  ["moneyline", result.moneyline.pick],
  ["total", result.total.pick],
  ["spread", result.puck_line.pick],
] as const).map(([market, pick]) => ({
  game_id: 101,
  market,
  pick,
  model_version: NHL_REGULAR_MODEL_RELEASE,
  locked_at: null,
  snapshot_json: { model_output: result, feature_inputs: base },
}));
assert.deepEqual(assessNhlLockCoherence({ gameIds: [101], rows: coherentRows }).coherentGameIds, [101]);
assert.deepEqual(
  assessNhlLockCoherence({
    gameIds: [101],
    rows: coherentRows.map((row) => row.market === "spread" ? { ...row, pick: "BOS -1.5" } : row),
  }).blockedGameIds,
  [101],
  "T-60 lock fails closed when a stored pick disagrees with the unified score output",
);

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
assert.equal(isTrackingRecordEligible({
  ...trackingBase,
  model_version: "nhl_regular_2026_r7_runtime_parity",
  calibration_version: "nhl_regular_calibration_2026_r7_runtime_parity",
}), true, "locked r7 rows remain in public accuracy during the r10 transition");
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
  [{ id: 1, key: "BOS@FLA", gameDate: "2026-09-29T23:00:00.000Z" }],
  [{
    gameId: "playbook-nhl-1",
    awayTeamName: "Boston Bruins",
    homeTeamName: "Florida Panthers",
    startTime: "2026-09-29T23:00:00.000Z",
  }],
  "nhl",
);
assert.equal(matchedPlaybookNhl.get(1)?.gameId, "playbook-nhl-1", "NHL DB abbreviations match Playbook full team names through the canonical NHL identity");

const writer = readFileSync(new URL("../lib/services/nhl/buildNhlPredictionRecords.ts", import.meta.url), "utf8");
const reader = readFileSync(new URL("../lib/services/nhl/buildNhlDailyEdgeAdapted.ts", import.meta.url), "utf8");
const cron = readFileSync(new URL("../app/api/cron/nhl-daily-refresh/route.ts", import.meta.url), "utf8");
const pregameSweep = readFileSync(new URL("../app/api/cron/pregame-sweep/route.ts", import.meta.url), "utf8");
const linesProvider = readFileSync(new URL("../lib/providers/nhl/_sharpApiNhlClient.ts", import.meta.url), "utf8");
const bdlProvider = readFileSync(new URL("../lib/providers/nhl/_ballDontLieNhlClient.ts", import.meta.url), "utf8");
const linesRefresh = readFileSync(new URL("../lib/services/nhl/refreshNhlLinesService.ts", import.meta.url), "utf8");
assert.match(writer, /nhlGameTypeFromExternalId\(game\.external_id\) === 2/);
assert.match(reader, /nhlGameTypeFromExternalId\(game\.external_id\) === 2/);
assert.match(reader, /selectNhlBestPriceQuote\(\{ rows: quoteRows, market: "total", side: totalSide, line: marketTotalLine \}\)/, "reader prices the exact predicted total line through the shared quote selector");
assert.match(reader, /selectNhlBestPriceQuote\(\{ rows: quoteRows, market: "spread", side: plSide, line: predictedPuckLine \}\)/, "reader prices the exact predicted puck line through the shared quote selector");
assert.match(reader, /predictionPayloadByGame/, "reader preserves the writer-owned active-release tuple before and after lock");
assert.match(reader, /writerVerdictsByGame/, "reader carries the price-aware writer decision for every NHL market");
assert.match(reader, /nhlVerdictFromStoredDecision/, "reader maps the writer's immutable storage token instead of recomputing the grade");
assert.match(reader, /NHL_REGULAR_TRANSITION_MODEL_RELEASES/, "reader preserves an already-locked prior-release tuple during deployment");
assert.match(reader, /nhl_daily_edge_reader_2026_10_09_r13_target_excluded_total_reconciliation/, "reader release records the target-excluded fallback while preserving immutable NHL price mapping");
assert.match(reader, /resolveNhlLockedPriceQuote/, "reader renders the stored locked price tuple instead of mutable current odds");
assert.match(writer, /evaluated_quotes/, "writer freezes the selected price, book, side, and line together");
assert.match(pregameSweep, /externalIdsFilter:\s*externalIds/, "T-60 writer refreshes only the games entering the lock window");
assert.match(pregameSweep, /deferLock:\s*true/, "T-60 writer defers locking until the coherence gate passes");
assert.match(reader, /incoherentPayloadReleaseGames/, "reader quarantines incoherence by release instead of hiding a valid prior lock");
assert.match(reader, /const marketAware = storedPayload \? null : buildNhlRegularMarketAwareForecast/, "reader fallback uses the same target-excluded NHL model path as the sole writer");
assert.match(reader, /incoherentPayloadReleaseGames/, "reader rejects internally inconsistent sibling market snapshots");
assert.ok(cron.indexOf("syncPublicSplitsObservations") < cron.indexOf("writeNhlPredictionRecords({"), "persistent splits refresh precedes the only NHL writer");
assert.match(cron, /leaseGroup: "prediction_pipeline"/);
assert.match(cron, /refreshDailyEdgeResponseSnapshot/);
assert.match(writer, /NHL_REGULAR_TRANSITION_MODEL_RELEASES/, "writer cannot duplicate an already-locked prior-release tuple");
assert.doesNotMatch(writer, /\.maybeSingle\(\)/, "writer supports multiple transition-release rows when checking for locks");
assert.match(writer, /\.from\("prediction_grades"\)[\s\S]*?\.eq\("result", "pending"\)[\s\S]*?\.eq\("win", false\)[\s\S]*?\.eq\("loss", false\)[\s\S]*?\.eq\("push", false\)/, "writer retires only verified pending grade children before superseded unlocked rows");
assert.match(writer, /\.is\("locked_at", null\)[\s\S]*?\.in\("model_version", \[\.\.\.supersededReleases\]\)/, "writer never retires a locked transition row");
assert.match(linesProvider, /fetchSharpNhlEvents/, "NHL resolves exact events before fetching odds");
assert.match(linesProvider, /event_id: eventId/, "NHL odds retrieval is event-scoped instead of scanning an incomplete league slice");
assert.match(linesProvider, /Promise\.all\(NHL_GAME_MARKETS\.map/, "all three full-game NHL market scopes are fetched directly");
assert.doesNotMatch(linesProvider, /presentGameMarkets/, "one stray book can no longer masquerade as complete NHL market coverage");
assert.match(linesRefresh, /incomplete SharpAPI \$\{market\} coverage/, "a refresh cannot silently call an incomplete five-game board healthy");
assert.match(bdlProvider, /searchParams\.append\("seasons\[\]", String\(season\)\)/, "NHL roster fetch uses the provider's documented season-array filter");
assert.match(writer, /fetchBdlNhlRosters\([\s\S]*for \(const g of games\)/, "current rosters are loaded once at slate scope before the per-game writer loop");

console.log("NHL regular-season model, tracking boundary, split fallback, and writer safety tests passed.");
