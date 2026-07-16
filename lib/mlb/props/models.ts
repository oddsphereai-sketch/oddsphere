import { poissonProbabilityOver } from "@/lib/models/props/distributions/poisson";
import type { MlbPropMarketKey } from "./config";
import type { PropFeatureSnapshot } from "./featureBuilder";
import { getMlbPropMarketDefinition } from "./marketCatalog";

export type PropModelPrediction = {
  marketKey: MlbPropMarketKey;
  side: "over" | "under";
  line: number;
  modelProbability: number;
  fairDecimalOdds: number;
  fairAmericanOdds: number;
  explanation: Record<string, unknown>;
};

export interface BasePropModel {
  readonly modelName: string;
  readonly marketKey: MlbPropMarketKey;
  fit(trainData: PropFeatureSnapshot[]): Promise<void>;
  predict_proba(featureRows: PropFeatureSnapshot[]): Promise<PropModelPrediction[]>;
  predict_distribution(featureRows: PropFeatureSnapshot[]): Promise<Record<string, unknown>[]>;
  save(path: string): Promise<void>;
  load(path: string): Promise<void>;
  explain(featureRow: PropFeatureSnapshot): Record<string, unknown>;
}

export class PitcherStrikeoutsModel implements BasePropModel {
  readonly modelName = "pitcher_strikeouts_distribution_v3_verified";
  readonly marketKey = "pitcher_strikeouts" as const;

  async fit(): Promise<void> {
    return;
  }

  async predict_proba(featureRows: PropFeatureSnapshot[]): Promise<PropModelPrediction[]> {
    return featureRows.map((row) => {
      const distribution = strikeoutDistribution(row);
      const overProbability = distribution.overProbability;
      return {
        marketKey: this.marketKey,
        side: overProbability >= 0.5 ? "over" : "under",
        line: row.line,
        modelProbability: Math.max(overProbability, 1 - overProbability),
        fairDecimalOdds: 1 / Math.max(overProbability, 1 - overProbability),
        fairAmericanOdds: probabilityToAmerican(Math.max(overProbability, 1 - overProbability)),
        explanation: this.explain(row),
      };
    });
  }

  async predict_distribution(featureRows: PropFeatureSnapshot[]): Promise<Record<string, unknown>[]> {
    return featureRows.map((row) => strikeoutDistribution(row));
  }

  async save(_path: string): Promise<void> {
    return;
  }

  async load(_path: string): Promise<void> {
    return;
  }

  explain(featureRow: PropFeatureSnapshot): Record<string, unknown> {
    return {
      model: this.modelName,
      reasonCodes: pitcherReasonCodes(featureRow),
      projectedStrikeouts: strikeoutDistribution(featureRow).projectedStrikeouts,
      distribution: strikeoutDistribution(featureRow),
      featureConfidence: featureConfidence(featureRow),
      recentStarts: featureRow.features.recent_starts,
      rollingStrikeouts: featureRow.features.rolling_10_start_k,
      rollingBattersFaced: featureRow.features.rolling_10_batters_faced,
      rollingPitchCount: featureRow.features.rolling_pitch_count,
      daysRest: featureRow.features.days_rest,
      line: featureRow.line,
    };
  }
}

export class PitcherOutsModel implements BasePropModel {
  readonly modelName = "pitcher_outs_workload_distribution_v2_verified";
  readonly marketKey = "pitcher_outs" as const;

  async fit(_trainData: PropFeatureSnapshot[]): Promise<void> {
    return;
  }

  async predict_proba(featureRows: PropFeatureSnapshot[]): Promise<PropModelPrediction[]> {
    return featureRows.map((row) => {
      const distribution = outsDistribution(row);
      const overProbability = distribution.overProbability;
      const modelProbability = Math.max(overProbability, 1 - overProbability);
      return {
        marketKey: this.marketKey,
        side: overProbability >= 0.5 ? "over" : "under",
        line: row.line,
        modelProbability,
        fairDecimalOdds: 1 / modelProbability,
        fairAmericanOdds: probabilityToAmerican(modelProbability),
        explanation: this.explain(row),
      };
    });
  }

  async predict_distribution(featureRows: PropFeatureSnapshot[]): Promise<Record<string, unknown>[]> {
    return featureRows.map((row) => outsDistribution(row));
  }

  async save(_path: string): Promise<void> {
    return;
  }

  async load(_path: string): Promise<void> {
    return;
  }

  explain(featureRow: PropFeatureSnapshot): Record<string, unknown> {
    return {
      model: this.modelName,
      reasonCodes: pitcherReasonCodes(featureRow),
      projectedOuts: outsDistribution(featureRow).projectedOuts,
      distribution: outsDistribution(featureRow),
      featureConfidence: featureConfidence(featureRow),
      recentStarts: featureRow.features.recent_starts,
      rollingOuts: featureRow.features.rolling_10_outs,
      rollingPitchCount: featureRow.features.rolling_pitch_count,
      daysRest: featureRow.features.days_rest,
      line: featureRow.line,
    };
  }
}

export class ConservativeCountPropModel implements BasePropModel {
  readonly modelName: string;

  constructor(readonly marketKey: MlbPropMarketKey) {
    this.modelName = `${getMlbPropMarketDefinition(marketKey).modelFamily}_v1_conservative`;
  }

  async fit(): Promise<void> {
    return;
  }

  async predict_proba(featureRows: PropFeatureSnapshot[]): Promise<PropModelPrediction[]> {
    return featureRows.map((row) => {
      const distribution = conservativeMarketDistribution(row);
      const overProbability = distribution.overProbability;
      const modelProbability = Math.max(overProbability, 1 - overProbability);
      return {
        marketKey: this.marketKey,
        side: overProbability >= 0.5 ? "over" : "under",
        line: row.line,
        modelProbability,
        fairDecimalOdds: 1 / modelProbability,
        fairAmericanOdds: probabilityToAmerican(modelProbability),
        explanation: this.explain(row),
      };
    });
  }

  async predict_distribution(featureRows: PropFeatureSnapshot[]): Promise<Record<string, unknown>[]> {
    return featureRows.map((row) => conservativeMarketDistribution(row));
  }

  async save(_path: string): Promise<void> {
    return;
  }

  async load(_path: string): Promise<void> {
    return;
  }

  explain(featureRow: PropFeatureSnapshot): Record<string, unknown> {
    const definition = getMlbPropMarketDefinition(this.marketKey);
    return {
      model: this.modelName,
      marketFamily: definition.family,
      modelFamily: definition.modelFamily,
      reasonCodes: genericReasonCodes(featureRow),
      distribution: conservativeMarketDistribution(featureRow),
      featureConfidence: featureConfidence(featureRow),
      line: featureRow.line,
    };
  }
}

export function modelForMlbPropMarket(marketKey: MlbPropMarketKey): BasePropModel {
  if (marketKey === "pitcher_strikeouts") return new PitcherStrikeoutsModel();
  if (marketKey === "pitcher_outs") return new PitcherOutsModel();
  return new ConservativeCountPropModel(marketKey);
}

function expectedStrikeouts(row: PropFeatureSnapshot): number {
  const kRate = numberFeature(row, "strikeout_rate_recent", 0.22);
  const battersFaced = numberFeature(row, "rolling_10_batters_faced", 22);
  const pitchCount = numberFeature(row, "rolling_pitch_count", 88);
  const workloadMultiplier = Math.min(1.12, Math.max(0.88, pitchCount / 88));
  return Math.max(0.1, kRate * battersFaced * workloadMultiplier);
}

export function legacyPitcherBaselineProbability(row: PropFeatureSnapshot): { side: "over" | "under"; probability: number; overProbability: number; expectedValue: number } {
  const expected = row.marketKey === "pitcher_outs" ? expectedOuts(row) : expectedStrikeouts(row);
  const overProbability = clamp(poissonProbabilityOver(expected, Math.floor(row.line) + 1));
  return {
    side: overProbability >= 0.5 ? "over" : "under",
    probability: Math.max(overProbability, 1 - overProbability),
    overProbability,
    expectedValue: expected,
  };
}

function strikeoutDistribution(row: PropFeatureSnapshot): Record<string, unknown> & {
  distribution: string;
  projectedStrikeouts: number;
  overProbability: number;
} {
  const seasonKRate = numberFeature(row, "season_strikeout_rate", numberFeature(row, "strikeout_rate_recent", 0.218));
  const recentKRate = nullableNumberFeature(row, "recent_strikeout_rate");
  const rateWeight = recentKRate === null ? 0 : Math.min(0.35, Math.max(0.1, numberFeature(row, "recent_logs", 0) / 30));
  const baselineKRate = seasonKRate * (1 - rateWeight) + (recentKRate ?? seasonKRate) * rateWeight;
  const opponentMultiplier = ratioMultiplier(
    nullableNumberFeature(row, "opponent_strikeout_rate"),
    nullableNumberFeature(row, "opponent_league_strikeout_rate"),
    0.65,
    0.92,
    1.08,
  );
  const parkMultiplier = indexedFactorMultiplier(nullableNumberFeature(row, "park_strikeout_factor"), 0.35, 0.97, 1.03);
  const weatherMultiplier = temperatureWorkloadMultiplier(nullableNumberFeature(row, "temperature_f"));
  const estimatedKRate = clampRate(baselineKRate * opponentMultiplier * parkMultiplier * weatherMultiplier, 0.08, 0.42);
  const expectedBattersFaced = numberFeature(row, "expected_batters_faced", numberFeature(row, "rolling_10_batters_faced", 22));
  const projectedStrikeouts = Math.max(0.1, expectedBattersFaced * estimatedKRate);
  const poissonOver = clamp(poissonProbabilityOver(projectedStrikeouts, Math.floor(row.line) + 1));
  const confidence = featureConfidence(row);
  const dispersion = row.dataAvailability.recent_logs && Number(row.dataAvailability.recent_logs) > 0 ? 1.18 : 1.32;
  const overProbability = overdispersedProbability(poissonOver, dispersion, confidence);
  return {
    distribution: "poisson_overdispersion_adjusted",
    projectedStrikeouts: round(projectedStrikeouts),
    expectedBattersFaced: round(expectedBattersFaced),
    estimatedKRate: round(estimatedKRate),
    seasonKRate: round(seasonKRate),
    recentKRate: recentKRate === null ? null : round(recentKRate),
    recentWeight: round(rateWeight),
    opponentMultiplier: round(opponentMultiplier),
    parkMultiplier: round(parkMultiplier),
    weatherMultiplier: round(weatherMultiplier),
    overdispersion: dispersion,
    confidence,
    overProbability,
    underProbability: round(1 - overProbability),
    line: row.line,
    verifiedInputs: {
      seasonStats: row.dataAvailability.bdl_stat_bundle === true,
      recentLogs: Number(row.dataAvailability.recent_logs ?? 0) > 0,
      opponentKProfile: row.dataAvailability.opponent_k_profile === true,
      parkFactor: row.dataAvailability.park_factor === true,
      weather: row.dataAvailability.weather === true,
    },
  };
}

function expectedOuts(row: PropFeatureSnapshot): number {
  const outs = numberFeature(row, "rolling_10_outs", 16);
  const pitchCount = numberFeature(row, "rolling_pitch_count", 88);
  const rest = nullableNumberFeature(row, "days_rest");
  const restMultiplier = rest === null ? 1 : rest < 4 ? 0.94 : rest > 6 ? 1.03 : 1;
  const pitchCountMultiplier = Math.min(1.1, Math.max(0.9, pitchCount / 88));
  return Math.max(3, outs * restMultiplier * pitchCountMultiplier);
}

function outsDistribution(row: PropFeatureSnapshot): Record<string, unknown> & {
  distribution: string;
  projectedOuts: number;
  overProbability: number;
} {
  const seasonOuts = numberFeature(row, "season_outs_per_start", numberFeature(row, "rolling_10_outs", 16));
  const recentOuts = nullableNumberFeature(row, "recent_outs_per_start");
  const recentWeight = recentOuts === null ? 0 : Math.min(0.4, Math.max(0.12, numberFeature(row, "recent_logs", 0) / 25));
  const rest = nullableNumberFeature(row, "days_rest");
  const restMultiplier = rest === null ? 1 : rest < 4 ? 0.94 : rest > 6 ? 1.03 : 1;
  const opponentMultiplier = inverseRatioMultiplier(
    nullableNumberFeature(row, "opponent_ops"),
    nullableNumberFeature(row, "opponent_league_ops"),
    0.25,
    0.94,
    1.06,
  );
  const parkMultiplier = inverseIndexedFactorMultiplier(nullableNumberFeature(row, "park_run_factor"), 0.2, 0.97, 1.03);
  const weatherMultiplier = temperatureWorkloadMultiplier(nullableNumberFeature(row, "temperature_f"));
  const projectedOuts = Math.max(3, (seasonOuts * (1 - recentWeight) + (recentOuts ?? seasonOuts) * recentWeight)
    * restMultiplier * opponentMultiplier * parkMultiplier * weatherMultiplier);
  const poissonOver = clamp(poissonProbabilityOver(projectedOuts, Math.floor(row.line) + 1));
  const confidence = featureConfidence(row);
  const dispersion = row.dataAvailability.recent_logs && Number(row.dataAvailability.recent_logs) > 0 ? 1.12 : 1.25;
  const overProbability = overdispersedProbability(poissonOver, dispersion, confidence);
  return {
    distribution: "workload_poisson_overdispersion_adjusted",
    projectedOuts: round(projectedOuts),
    seasonOutsPerStart: round(seasonOuts),
    recentOutsPerStart: recentOuts === null ? null : round(recentOuts),
    recentWeight: round(recentWeight),
    opponentMultiplier: round(opponentMultiplier),
    parkMultiplier: round(parkMultiplier),
    weatherMultiplier: round(weatherMultiplier),
    overdispersion: dispersion,
    confidence,
    overProbability,
    underProbability: round(1 - overProbability),
    line: row.line,
    verifiedInputs: {
      seasonStats: row.dataAvailability.bdl_stat_bundle === true,
      recentLogs: Number(row.dataAvailability.recent_logs ?? 0) > 0,
      starterConfirmed: row.dataAvailability.starter_confirmed === true,
      opponentProfile: row.dataAvailability.opponent_profile === true,
      parkFactor: row.dataAvailability.park_factor === true,
      weather: row.dataAvailability.weather === true,
    },
  };
}

function conservativeMarketDistribution(row: PropFeatureSnapshot): Record<string, unknown> & {
  distribution: string;
  projectedValue: number;
  overProbability: number;
} {
  const definition = getMlbPropMarketDefinition(row.marketKey);
  const mean = expectedConservativeValue(row);
  const poissonOver = clamp(poissonProbabilityOver(mean, Math.floor(row.line) + 1));
  const confidence = featureConfidence(row);
  const overProbability = definition.recommendationEligibility === "research_only"
    ? overdispersedProbability(poissonOver, 1.65, Math.min(confidence, 0.45))
    : overdispersedProbability(poissonOver, 1.42, confidence);
  return {
    distribution: definition.milestone ? "rare_event_market_prior_proxy" : "count_poisson_overdispersion_adjusted",
    projectedValue: round(mean),
    overProbability,
    underProbability: round(1 - overProbability),
    confidence,
    modelFamily: definition.modelFamily,
    verifiedInputs: {
      seasonStats: row.dataAvailability.bdl_stat_bundle === true,
      batterSeasonStats: row.dataAvailability.batter_season_baseline === true,
      lineup: Number(row.dataAvailability.lineups ?? 0) > 0,
      opponentProfile: row.dataAvailability.opponent_profile === true,
    },
    missingFeatures: definition.missingFeatureReasons,
  };
}

function expectedConservativeValue(row: PropFeatureSnapshot): number {
  const market = row.marketKey;
  if (market === "pitcher_hits_allowed") return numberFeature(row, "season_hits_allowed_per_start", 5);
  if (market === "pitcher_walks") return numberFeature(row, "season_walks_per_start", 1.8);
  if (market === "pitcher_earned_runs") return numberFeature(row, "season_earned_runs_per_start", 2.6);
  if (market === "pitcher_record_a_win") return numberFeature(row, "pitcher_win_probability_proxy", 0.34);
  if (market === "batter_strikeouts") return numberFeature(row, "batter_strikeouts_per_game", 0.9);
  if (market === "batter_walks") return numberFeature(row, "batter_walks_per_game", 0.35);
  if (market === "batter_hits") return numberFeature(row, "batter_hits_per_game", 0.95);
  if (market === "batter_total_bases") return numberFeature(row, "batter_total_bases_per_game", 1.45);
  if (market === "batter_home_runs") return numberFeature(row, "batter_home_run_probability", 0.095);
  if (market === "batter_rbis") return numberFeature(row, "batter_rbis_per_game", 0.48);
  if (market === "batter_runs_scored") return numberFeature(row, "batter_runs_per_game", 0.52);
  if (market === "batter_hits_runs_rbis") return numberFeature(row, "batter_hrr_per_game", 1.95);
  if (market === "batter_singles") return numberFeature(row, "batter_singles_per_game", 0.62);
  if (market === "batter_doubles") return numberFeature(row, "batter_doubles_per_game", 0.18);
  if (market === "batter_triples") return numberFeature(row, "batter_triples_per_game", 0.025);
  if (market === "batter_stolen_bases") return numberFeature(row, "stolen_base_probability", 0.08);
  if (market === "first_home_run") return numberFeature(row, "first_home_run_probability", 0.025);
  return 0.5;
}

function numberFeature(row: PropFeatureSnapshot, key: string, fallback: number): number {
  const value = row.features[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nullableNumberFeature(row: PropFeatureSnapshot, key: string): number | null {
  const value = row.features[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function ratioMultiplier(value: number | null, leagueAverage: number | null, weight: number, min: number, max: number): number {
  if (value === null || leagueAverage === null || leagueAverage <= 0) return 1;
  return Math.min(max, Math.max(min, 1 + (value / leagueAverage - 1) * weight));
}

function inverseRatioMultiplier(value: number | null, leagueAverage: number | null, weight: number, min: number, max: number): number {
  if (value === null || leagueAverage === null || leagueAverage <= 0) return 1;
  return Math.min(max, Math.max(min, 1 - (value / leagueAverage - 1) * weight));
}

function indexedFactorMultiplier(value: number | null, weight: number, min: number, max: number): number {
  if (value === null || value <= 0) return 1;
  return Math.min(max, Math.max(min, 1 + (value / 100 - 1) * weight));
}

function inverseIndexedFactorMultiplier(value: number | null, weight: number, min: number, max: number): number {
  if (value === null || value <= 0) return 1;
  return Math.min(max, Math.max(min, 1 - (value / 100 - 1) * weight));
}

function temperatureWorkloadMultiplier(temperatureF: number | null): number {
  if (temperatureF === null) return 1;
  return Math.min(1.015, Math.max(0.985, 1 - (temperatureF - 70) * 0.0005));
}

function pitcherReasonCodes(row: PropFeatureSnapshot): string[] {
  const codes: string[] = [];
  if (numberFeature(row, "recent_starts", 0) < 3) codes.push("SEASON_BASELINE_FALLBACK");
  if (Number(row.dataAvailability.recent_logs ?? 0) === 0) codes.push("RECENT_LOGS_UNAVAILABLE");
  if (row.dataAvailability.opponent_k_profile !== true) codes.push("OPPONENT_PROFILE_UNAVAILABLE");
  if (numberFeature(row, "rolling_pitch_count", 0) >= 90) codes.push("WORKLOAD_EDGE");
  if (row.features.home_away === "home") codes.push("HOME_CONTEXT");
  if (row.features.lineup_status_confirmed === true) codes.push("LINEUP_CONFIRMED");
  return codes.length > 0 ? codes : ["BASELINE_FORM"];
}

function genericReasonCodes(row: PropFeatureSnapshot): string[] {
  const definition = getMlbPropMarketDefinition(row.marketKey);
  const codes = [...definition.missingFeatureReasons];
  if (definition.recommendationEligibility === "research_only") codes.push("MARKET_RESEARCH_ONLY");
  if (definition.recommendationEligibility === "watchlist_until_context") codes.push("BATTER_CONTEXT_INSUFFICIENT");
  if (Number(row.dataAvailability.feature_confidence ?? 0) < 0.75) codes.push("LOW_DATA_CONFIDENCE");
  if (!definition.twoWayEligible) codes.push("MILESTONE_MODEL_NOT_PROMOTED");
  return [...new Set(codes)];
}

function probabilityToAmerican(probability: number): number {
  if (probability <= 0 || probability >= 1) throw new Error(`probabilityToAmerican invalid ${probability}`);
  return probability >= 0.5
    ? Math.round((-100 * probability) / (1 - probability))
    : Math.round((100 * (1 - probability)) / probability);
}

function clamp(value: number): number {
  return Math.min(0.999, Math.max(0.001, value));
}

function clampRate(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function overdispersedProbability(poissonOver: number, dispersion: number, confidence: number): number {
  const dispersionShrink = 1 / Math.sqrt(Math.max(1, dispersion));
  const confidenceShrink = 0.72 + Math.max(0, Math.min(1, confidence)) * 0.28;
  return round(clamp(0.5 + (poissonOver - 0.5) * dispersionShrink * confidenceShrink));
}

function featureConfidence(row: PropFeatureSnapshot): number {
  const value = row.dataAvailability.feature_confidence;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.65;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
