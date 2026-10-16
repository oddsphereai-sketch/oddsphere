import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { NbaPointInTimeFeatureRow } from "../lib/services/nba/nbaPointInTimeFeatures";
import { buildNbaSpreadKeyStats } from "../lib/services/nba/adaptNbaToDailyEdgeResponse";
import {
  assessNbaNetRatingAgainstSpread,
  buildNbaSpreadReaderStats,
} from "../lib/services/nba/nbaSpreadReaderStats";

const featureRow = Object.freeze({
  release: "nba_point_in_time_features_2026_10_15_r13_season_regime_state",
  game_id: 1,
  season: 2026,
  feature_cutoff: "2026-10-20T23:30:00.000Z",
  home_team_id: 2,
  away_team_id: 1,
  home_team: "NYK",
  away_team: "PHI",
  away_adjusted_offense: 116.25,
  away_adjusted_defense: 113.75,
  home_adjusted_offense: 119.04,
  home_adjusted_defense: 111.22,
}) as unknown as NbaPointInTimeFeatureRow;

const readerStats = buildNbaSpreadReaderStats(featureRow);
assert.deepEqual(readerStats, {
  featureCutoff: "2026-10-20T23:30:00.000Z",
  away: {
    adjustedOffense: 116.25,
    adjustedDefense: 113.75,
    adjustedNetRating: 2.5,
  },
  home: {
    adjustedOffense: 119.04,
    adjustedDefense: 111.22,
    adjustedNetRating: 7.820000000000007,
  },
});

assert.deepEqual(buildNbaSpreadKeyStats(readerStats), [
  {
    label: "Adjusted net rating",
    awayValue: "+2.5 pts / 100",
    homeValue: "+7.8 pts / 100",
    source: "feature_snapshot",
  },
  {
    label: "Adjusted offensive efficiency",
    awayValue: "116.3 scored / 100",
    homeValue: "119.0 scored / 100",
    source: "feature_snapshot",
  },
  {
    label: "Adjusted defensive efficiency",
    awayValue: "113.8 allowed / 100",
    homeValue: "111.2 allowed / 100",
    source: "feature_snapshot",
  },
]);
assert.deepEqual(buildNbaSpreadKeyStats(undefined), []);

assert.equal(
  assessNbaNetRatingAgainstSpread({
    awayNetRating: 8,
    homeNetRating: 7.5,
    selectedSide: "away",
    selectedHandicap: 1.5,
  }).status,
  "support",
  "a selected underdog with a positive rating-plus-points cushion should be supporting context",
);
assert.equal(
  assessNbaNetRatingAgainstSpread({
    awayNetRating: -0.1,
    homeNetRating: 5.8,
    selectedSide: "away",
    selectedHandicap: 5.5,
  }).status,
  "near",
  "a rating gap nearly equal to the handicap must not be called directional support",
);
assert.equal(
  assessNbaNetRatingAgainstSpread({
    awayNetRating: -2,
    homeNetRating: 5,
    selectedSide: "away",
    selectedHandicap: 4.5,
  }).status,
  "challenge",
  "a rating gap larger than the selected handicap should challenge the spread pick",
);

const adapterSource = readFileSync(
  new URL("../lib/services/nba/adaptNbaToDailyEdgeResponse.ts", import.meta.url),
  "utf8",
);
assert.match(
  adapterSource,
  /const spreadAsFi = buildMarketEdgeDto\([\s\S]*?keyStats: buildNbaSpreadKeyStats\(game\.spread_reader_stats\)/,
  "the NBA Spread slot must receive the professional efficiency explanation",
);
assert.doesNotMatch(
  adapterSource.match(/const ml = buildMarketEdgeDto\([\s\S]*?\n  \}\);/)?.[0] ?? "",
  /keyStats:/,
  "NBA moneyline must not duplicate the Spread-only explanation",
);
assert.doesNotMatch(
  adapterSource.match(/const total = buildMarketEdgeDto\([\s\S]*?\n  \}\);/)?.[0] ?? "",
  /keyStats:/,
  "NBA Total must not duplicate the Spread-only explanation",
);

console.log("NBA Spread reader stats tests passed");
