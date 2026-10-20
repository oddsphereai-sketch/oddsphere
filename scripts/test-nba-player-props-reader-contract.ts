import assert from "node:assert/strict";
import { buildNbaPlayerPropsReaderResearchView } from "../lib/services/nba/nbaPlayerPropsReaderContract";
import type { NbaPlayerPropFeatureRow } from "../lib/services/nba/nbaPlayerPropsPointInTimeFeatures";
import type { NbaPlayerPropsIndependentProjection } from "../lib/services/nba/nbaPlayerPropsIndependentModel";

const feature = new Proxy({
  player_id: 1,
  player_name: "Verified Player",
  team_id: 10,
  opponent_team_id: 20,
  minutes_mean_3: 34.2,
  minutes_mean_10: 33.1,
  participation_rate_10: 0.9,
  usage_mean_5: 0.28,
  points_per_minute_10: 0.7,
  fga_per_minute_10: 0.51,
  fg3a_per_minute_10: 0.2,
  fta_per_minute_10: 0.18,
  true_shooting_mean_5: 0.61,
  game_pace_mean_5: 101.4,
  team_adjusted_offense: 117.2,
  opponent_adjusted_defense: 113.1,
  opponent_efg_allowed_5: 0.55,
}, {
  get(target, property) { return Reflect.get(target, property); },
}) as unknown as NbaPlayerPropFeatureRow;

const projection = {
  participationProbability: 0.94,
  conditionalMinutes: 34.6,
  combinations: { points: 24.8 },
} as unknown as NbaPlayerPropsIndependentProjection;

const view = buildNbaPlayerPropsReaderResearchView({
  feature,
  projection,
  market: "points",
  line: 23.5,
  observations: [],
});
assert.equal(view.forecast.side, "over");
assert.equal(view.forecast.projection, 24.8);
assert(view.production.some((metric) => metric.key === "points_per_minute_10"));
assert(view.matchup.some((metric) => metric.key === "opponent_efg_allowed_5"));
assert.equal(view.prices.length, 0);
assert.equal(view.movement, null);
assert(!JSON.stringify(view).includes("unavailable"));
process.stdout.write("NBA player-props reader research contract passed.\n");

