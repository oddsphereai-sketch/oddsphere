import assert from "node:assert/strict";
import type { PropFeatureSnapshot } from "../lib/mlb/props/featureBuilder";
import {
  MLB_PROPS_SHADOW_PITCHER_FEATURE_VERSION,
  MLB_PROPS_SHADOW_PITCHER_RELEASE_ID,
  scoreShadowPitcherProp,
} from "../lib/mlb/props/shadowPitcherModel";

function strikeoutFeature(overrides: Partial<PropFeatureSnapshot["features"]> = {}): PropFeatureSnapshot {
  return {
    gameId: "mlbstats-game-1",
    playerId: "mlbstats-player-1",
    marketKey: "pitcher_strikeouts",
    line: 5.5,
    asOfTimestamp: "2026-08-12T18:00:00.000Z",
    featureVersion: "active_model_control",
    features: {
      recent_starts: 10,
      rolling_10_batters_faced: 23,
      recent_strikeout_rate: 0.25,
      season_strikeout_rate: 0.248,
      expected_batters_faced: 23.4,
      opponent_strikeout_rate: 0.24,
      opponent_league_strikeout_rate: 0.225,
      pitch_arsenal_whiff_percent: 28,
      rolling_pitch_count: 94,
      ...overrides,
    },
    dataAvailability: {
      season_pitching_k: 140,
      season_batters_faced: 560,
      season_pitching_games_started: 24,
      season_pitch_count: 2256,
      pitch_arsenal_pitches_tracked: 2100,
    },
    leakageGuardHash: "fixture",
  };
}

const scored = scoreShadowPitcherProp(strikeoutFeature());
assert.equal(scored.releaseId, MLB_PROPS_SHADOW_PITCHER_RELEASE_ID);
assert.equal(scored.featureVersion, MLB_PROPS_SHADOW_PITCHER_FEATURE_VERSION);
assert.equal(scored.status, "scored");
assert.ok(scored.overProbability !== null && scored.overProbability > 0 && scored.overProbability < 1);
assert.ok(scored.underProbability !== null && Math.abs(scored.overProbability! + scored.underProbability - 1) < 1e-6);
assert.ok(scored.projection !== null && scored.projection > 0);

const inningsProxy = strikeoutFeature();
delete inningsProxy.dataAvailability.season_batters_faced;
const inningsProxyScored = scoreShadowPitcherProp(inningsProxy);
assert.equal(inningsProxyScored.status, "scored");
assert.equal(inningsProxyScored.featureSnapshot.seasonRateSource, "innings_proxy");

const lowerWhiff = scoreShadowPitcherProp(strikeoutFeature({
  pitch_arsenal_whiff_percent: 18,
  opponent_strikeout_rate: 0.19,
}));
assert.ok(lowerWhiff.overProbability! < scored.overProbability!);

const incomplete = strikeoutFeature({ pitch_arsenal_whiff_percent: null });
const held = scoreShadowPitcherProp(incomplete);
assert.equal(held.status, "insufficient_features");
assert.equal(held.overProbability, null);
assert.ok(held.missingFeatures.includes("pitch_arsenal_whiff_percent"));

const invalidExposure = strikeoutFeature();
invalidExposure.dataAvailability.pitch_arsenal_pitches_tracked = 0;
assert.equal(scoreShadowPitcherProp(invalidExposure).status, "insufficient_features");

const outs: PropFeatureSnapshot = {
  ...strikeoutFeature(),
  marketKey: "pitcher_outs",
  line: 16.5,
  features: {
    peer_consensus_over_probability: 0.54,
    recent_three_outs_per_start: 17,
    season_outs_per_start: 16.4,
  },
  dataAvailability: {
    season_pitching_games_started: 20,
    peer_consensus_books: 5,
  },
};
const outsControl = scoreShadowPitcherProp(outs);
assert.equal(outsControl.status, "control_only");
assert.equal(outsControl.overProbability, 0.54);

console.log("PASS MLB props shadow pitcher model: versioned, bounded, and fail-closed");
