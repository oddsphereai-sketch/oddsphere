import type { MlbPropMarketKey } from "./config";
import type { PropFeatureSnapshot } from "./featureBuilder";

export const MLB_PROPS_SHADOW_PITCHER_FEATURE_VERSION =
  "mlb_props_shared_pitcher_features_v1_2026_08_12";
export const MLB_PROPS_SHADOW_PITCHER_RELEASE_ID =
  "mlb_props_shadow_pitcher_2026_08_12_r1";

export type MlbPropsShadowPitcherPrediction = {
  releaseId: typeof MLB_PROPS_SHADOW_PITCHER_RELEASE_ID;
  featureVersion: typeof MLB_PROPS_SHADOW_PITCHER_FEATURE_VERSION;
  market: MlbPropMarketKey;
  status: "scored" | "insufficient_features" | "control_only";
  overProbability: number | null;
  underProbability: number | null;
  selectedSide: "over" | "under" | null;
  selectedProbability: number | null;
  projection: number | null;
  missingFeatures: string[];
  featureSnapshot: Record<string, number | string | boolean | null>;
};

/**
 * Prospective-only pitcher challenger. It cannot change the active pick.
 * The frozen output is intended to be stamped into T-60 tracking evidence so
 * later evaluation never reconstructs pregame features with postgame data.
 */
export function scoreShadowPitcherProp(
  row: PropFeatureSnapshot,
): MlbPropsShadowPitcherPrediction {
  if (row.marketKey === "pitcher_strikeouts") return scoreStrikeouts(row);
  if (row.marketKey === "pitcher_outs") return scoreOutsControl(row);
  return baseResult(row, "control_only", null, null, ["SHADOW_MARKET_NOT_IMPLEMENTED"]);
}

function scoreStrikeouts(row: PropFeatureSnapshot): MlbPropsShadowPitcherPrediction {
  const seasonStarts = positive(row.dataAvailability.season_pitching_games_started);
  const seasonStrikeoutRate = finite(row.features.season_strikeout_rate);
  const recentStarts = positive(row.features.recent_starts);
  const recentBattersFacedPerStart = positive(row.features.rolling_10_batters_faced);
  const expectedBattersFacedProxy = positive(row.features.expected_batters_faced);
  const recentStrikeoutRate = finite(row.features.recent_strikeout_rate);
  const opponentStrikeoutRate = finite(row.features.opponent_strikeout_rate);
  const opponentLeagueStrikeoutRate = positive(row.features.opponent_league_strikeout_rate);
  const arsenalWhiffPercent = finite(row.features.pitch_arsenal_whiff_percent);
  const arsenalPitchesTracked = positive(row.dataAvailability.pitch_arsenal_pitches_tracked);
  const recentPitchCount = finite(row.features.rolling_pitch_count);
  const seasonPitchCount = finite(row.dataAvailability.season_pitch_count);

  const required = {
    season_starts: seasonStarts,
    season_strikeout_rate: seasonStrikeoutRate,
    recent_starts: recentStarts,
    recent_batters_faced: recentBattersFacedPerStart,
    expected_batters_faced_proxy: expectedBattersFacedProxy,
    recent_strikeout_rate: recentStrikeoutRate,
    opponent_strikeout_rate: opponentStrikeoutRate,
    opponent_league_strikeout_rate: opponentLeagueStrikeoutRate,
    pitch_arsenal_whiff_percent: arsenalWhiffPercent,
    pitch_arsenal_pitches_tracked: arsenalPitchesTracked,
  };
  const missingFeatures = Object.entries(required)
    .filter(([, value]) => value === null)
    .map(([key]) => key);
  if (missingFeatures.length) {
    return baseResult(row, "insufficient_features", null, null, missingFeatures);
  }

  const leagueRate = clamp(opponentLeagueStrikeoutRate!, 0.15, 0.32);
  const priorBattersFaced = 100;
  const recentSample = Math.max(1, recentStarts! * recentBattersFacedPerStart!);
  const recentPosterior = (recentStrikeoutRate! * recentSample + leagueRate * priorBattersFaced)
    / (recentSample + priorBattersFaced);
  const pitcherRate = clamp(seasonStrikeoutRate!, 0.05, 0.45) * 0.4
    + clamp(recentPosterior, 0.05, 0.45) * 0.6;
  const opponentMultiplier = clamp(
    1 + (opponentStrikeoutRate! / opponentLeagueStrikeoutRate! - 1) * 0.5,
    0.9,
    1.1,
  );
  const arsenalMultiplier = clamp(
    1 + ((arsenalWhiffPercent! / 100) / 0.245 - 1) * 0.35,
    0.9,
    1.1,
  );
  const workloadMultiplier = recentPitchCount !== null && seasonPitchCount !== null
    ? clamp(recentPitchCount / Math.max(1, seasonPitchCount / seasonStarts!), 0.9, 1.08)
    : 1;
  const expectedBattersFaced = clamp(
    (recentBattersFacedPerStart! * 0.65 + expectedBattersFacedProxy! * 0.35)
      * workloadMultiplier,
    12,
    32,
  );
  const adjustedRate = clamp(pitcherRate * opponentMultiplier * arsenalMultiplier, 0.08, 0.42);
  const trialsLow = Math.floor(expectedBattersFaced);
  const trialsHigh = Math.ceil(expectedBattersFaced);
  const highWeight = expectedBattersFaced - trialsLow;
  const concentration = clamp(recentSample + priorBattersFaced, 100, 500);
  const alpha = adjustedRate * concentration;
  const beta = (1 - adjustedRate) * concentration;
  const threshold = Math.floor(row.line);
  const lowOver = betaBinomialOver(trialsLow, threshold, alpha, beta);
  const highOver = betaBinomialOver(trialsHigh, threshold, alpha, beta);
  const overProbability = clamp(lowOver * (1 - highWeight) + highOver * highWeight, 0.001, 0.999);

  return baseResult(row, "scored", overProbability, expectedBattersFaced * adjustedRate, [], {
    pitcherRate: round(pitcherRate),
    opponentMultiplier: round(opponentMultiplier),
    arsenalMultiplier: round(arsenalMultiplier),
    adjustedStrikeoutRate: round(adjustedRate),
    expectedBattersFaced: round(expectedBattersFaced),
    arsenalWhiffPercent: arsenalWhiffPercent!,
    arsenalPitchesTracked: arsenalPitchesTracked!,
    seasonRateSource: row.dataAvailability.season_batters_faced === null
      || row.dataAvailability.season_batters_faced === undefined
      ? "innings_proxy"
      : "official_batters_faced",
  });
}

function scoreOutsControl(row: PropFeatureSnapshot): MlbPropsShadowPitcherPrediction {
  const peerOver = finite(row.features.peer_consensus_over_probability);
  if (peerOver === null) {
    return baseResult(row, "insufficient_features", null, null, ["peer_consensus_over_probability"]);
  }
  return baseResult(row, "control_only", clamp(peerOver, 0.001, 0.999), null, [], {
    recentThreeOutsPerStart: finite(row.features.recent_three_outs_per_start),
    seasonOutsPerStart: finite(row.features.season_outs_per_start),
    seasonStarts: finite(row.dataAvailability.season_pitching_games_started),
    peerConsensusBooks: finite(row.dataAvailability.peer_consensus_books),
  });
}

function baseResult(
  row: PropFeatureSnapshot,
  status: MlbPropsShadowPitcherPrediction["status"],
  overProbability: number | null,
  projection: number | null,
  missingFeatures: string[],
  featureSnapshot: Record<string, number | string | boolean | null> = {},
): MlbPropsShadowPitcherPrediction {
  const underProbability = overProbability === null ? null : 1 - overProbability;
  const selectedSide = overProbability === null ? null : overProbability >= 0.5 ? "over" : "under";
  return {
    releaseId: MLB_PROPS_SHADOW_PITCHER_RELEASE_ID,
    featureVersion: MLB_PROPS_SHADOW_PITCHER_FEATURE_VERSION,
    market: row.marketKey,
    status,
    overProbability: overProbability === null ? null : round(overProbability),
    underProbability: underProbability === null ? null : round(underProbability),
    selectedSide,
    selectedProbability: overProbability === null
      ? null
      : round(Math.max(overProbability, underProbability!)),
    projection: projection === null ? null : round(projection),
    missingFeatures,
    featureSnapshot: { line: row.line, ...featureSnapshot },
  };
}

function betaBinomialOver(trials: number, threshold: number, alpha: number, beta: number): number {
  if (threshold < 0) return 1;
  if (threshold >= trials) return 0;
  let cumulative = 0;
  for (let successes = 0; successes <= threshold; successes++) {
    cumulative += Math.exp(
      logGamma(trials + 1)
      - logGamma(successes + 1)
      - logGamma(trials - successes + 1)
      + logBeta(successes + alpha, trials - successes + beta)
      - logBeta(alpha, beta),
    );
  }
  return clamp(1 - cumulative, 0.001, 0.999);
}

function logBeta(alpha: number, beta: number): number {
  return logGamma(alpha) + logGamma(beta) - logGamma(alpha + beta);
}

function logGamma(value: number): number {
  const coefficients = [676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012,
    9.984369578019572e-6, 1.5056327351493116e-7];
  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  let result = 0.9999999999998099;
  const shifted = value - 1;
  for (let index = 0; index < coefficients.length; index++) {
    result += coefficients[index]! / (shifted + index + 1);
  }
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(result);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positive(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
