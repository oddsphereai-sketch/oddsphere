import artifactCoreJson from "./modelArtifacts/nflPlayerPropsRuntime.json";
import passingAttemptsJson from "./modelArtifacts/nflPlayerPropsRuntimeMarketPassingAttempts.json";
import passingCompletionsJson from "./modelArtifacts/nflPlayerPropsRuntimeMarketPassingCompletions.json";
import passingYardsJson from "./modelArtifacts/nflPlayerPropsRuntimeMarketPassingYards.json";
import receptionsJson from "./modelArtifacts/nflPlayerPropsRuntimeMarketReceptions.json";
import receivingYardsJson from "./modelArtifacts/nflPlayerPropsRuntimeMarketReceivingYards.json";
import rushingAttemptsJson from "./modelArtifacts/nflPlayerPropsRuntimeMarketRushingAttempts.json";
import rushingYardsJson from "./modelArtifacts/nflPlayerPropsRuntimeMarketRushingYards.json";
import playerStates0Json from "./modelArtifacts/nflPlayerPropsRuntimePlayers0.json";
import playerStates1Json from "./modelArtifacts/nflPlayerPropsRuntimePlayers1.json";
import playerStates2Json from "./modelArtifacts/nflPlayerPropsRuntimePlayers2.json";
import playerStates3Json from "./modelArtifacts/nflPlayerPropsRuntimePlayers3.json";
import touchdownJson from "./modelArtifacts/nflPlayerPropsRuntimeTouchdown.json";
import jointArtifactJson from "./modelArtifacts/nflPlayerPropsRuntimeJoint.json";
import type { NflPlayerPropMarket, NflPlayerPropsObservationSnapshot } from "./nflPlayerPropsContract";
import type { NflPlayerPropsInferenceContext } from "./nflPlayerPropsInferenceContext";
import type { DailyEdgeAvailabilityPlayer } from "../dailyEdge/gameAvailability";
import type {
  NflPlayerPropsCurrentSeasonState,
  NflPlayerPropsCurrentSeasonStat,
} from "./nflPlayerPropsCurrentSeasonState";
import type { NflPlayerPropsExactOffer } from "./nflPlayerPropsMarketBoard";
import {
  buildNflPlayerPropsMarketEvidenceCapture,
  nflPlayerPropsMarketEvidenceId,
  type NflPlayerPropsMarketEvidenceCapture,
} from "./nflPlayerPropsMarketEvidenceCapture";

export const NFL_PLAYER_PROPS_PORTABLE_ARTIFACT_RELEASE =
  "nfl_player_props_runtime_2026_10_07_r8_settlement_aligned_rushing_attempts" as const;
export const NFL_PLAYER_PROPS_RUNTIME_RELEASE =
  "nfl_player_props_runtime_2026_10_07_r23_settlement_aligned_rushing_attempts" as const;
export const NFL_PLAYER_PROPS_BOARD_RELEASE =
  "nfl_player_props_board_2026_10_07_r26_settlement_aligned_rushing_attempts" as const;
export const NFL_PLAYER_PROPS_DECISION_RELEASE =
  "nfl_player_props_decision_2026_10_07_r22_settlement_aligned_rushing_attempts" as const;
export const NFL_PLAYER_PROPS_MODEL_RELEASE =
  "nfl_player_props_distribution_model_2026_10_07_r17_settlement_aligned_rushing_attempts" as const;
export const NFL_PLAYER_PROPS_CALIBRATION_RELEASE =
  "nfl_player_props_distribution_calibration_2026_10_07_r19_settlement_aligned_rushing_attempts" as const;
export const NFL_PLAYER_PROPS_PASSING_MARKET_RELEASE =
  "nfl_player_props_market_residual_calibration_2026_09_03_r8_single_application" as const;
export const NFL_PLAYER_PROPS_MARKET_COHERENT_PROJECTION_RELEASE =
  "nfl_player_props_market_coherent_projection_2026_09_03_r2_single_distribution" as const;
export const NFL_PLAYER_PROPS_TOUCHDOWN_SHARP_REFERENCE_ACTIONABLE = true as const;
export const NFL_PLAYER_PROPS_QB_PASSING_PROJECTION = {
  release: "nfl_player_props_qb_passing_projection_2026_09_28_r4_joint_latent_workload",
  minimumBooks: 1,
  marketWeight: 0.9,
  roleWeight: 0.1,
} as const;
export const NFL_PLAYER_PROPS_QB_PASSING_WORKLOAD_MARKETS = [
  "passing_attempts", "passing_completions", "passing_yards",
] as const satisfies readonly NflPlayerPropMarket[];
type NflPlayerPropsQbPassingWorkloadMarket = typeof NFL_PLAYER_PROPS_QB_PASSING_WORKLOAD_MARKETS[number];
export const NFL_PLAYER_PROPS_QB_ROLE_FLOORS = {
  confirmedStarter: 0.9,
  projectedStarter: 0.75,
} as const;
export const NFL_PLAYER_PROPS_MAXIMUM_RAW_MARKET_DIVERGENCE = 0.48 as const;
export const NFL_PLAYER_PROPS_MATERIAL_PRICE_MOVEMENT_PP = 0.025 as const;
export const NFL_PLAYER_PROPS_HARD_AVAILABILITY_MAX_GAME_AGE_DAYS = 6 as const;
export const NFL_PLAYER_PROPS_MARKET_ROLE_MINIMUM_BOOKS = 2 as const;
export const NFL_PLAYER_PROPS_RECEPTIONS_MARKET_FLIP_MINIMUM_EDGE = 0.05 as const;

type TreeNode = {
  value: number; featureIndex: number; threshold: number; missingGoToLeft: boolean;
  left: number; right: number; isLeaf: boolean;
};
type TreeModel = {
  kind: "hgb_regressor" | "hgb_classifier";
  featureNames: string[];
  baseline: number;
  trees: Array<Array<{ nodes: TreeNode[] }>>;
  link?: "exponential";
};
type CompactForestNode = [value: number, featureIndex: number, threshold: number, missingGoToLeft: 0 | 1, left: number, right: number, isLeaf: 0 | 1];
type ForestModel = { kind: "extra_trees_regressor"; featureNames: string[]; trees: Array<{ nodes: CompactForestNode[] }> };
type LinearModel = { kind: "linear_regressor"; featureNames: string[]; imputer: number[]; means: number[]; scales: number[]; coefficients: number[]; intercept: number };
type BlendModel = { kind: "weighted_blend"; components: Array<{ weight: number; model: PortableModel }> };
type PortableModel = TreeModel | ForestModel | LinearModel | BlendModel;
type EmpiricalDistribution = { family: "empirical_residual"; residualQuantiles: number[] };
type Distribution = EmpiricalDistribution | {
  family: "empirical_residual_mean_bucket";
  buckets: Array<{ lower: number; upper: number; distribution: EmpiricalDistribution }>;
  fallback: EmpiricalDistribution;
};
type RuntimeArtifact = {
  runtimeRelease: typeof NFL_PLAYER_PROPS_PORTABLE_ARTIFACT_RELEASE;
  modelRelease: string; calibrationRelease: string; touchdownModelRelease: string;
  touchdownCalibrationRelease: string; decisionRelease: string; marketResidualRelease: string;
  featureNames: string[];
  participationModel: TreeModel;
  markets: Record<string, {
    model: PortableModel; distribution: Distribution; baselineColumn: string | null;
    marketResidualWeight: number; marketResidualQualified: boolean;
    promotionPolicy: { bestAngle: boolean; lean: boolean; watchlist: boolean };
  }>;
  touchdown: {
    featureNames: string[]; model: TreeModel; calibrator: { intercept: number; coefficient: number };
    marketResidualWeight: number; actionable: boolean;
  };
  decision: {
    maximumQuoteAgeHours: number;
    releaseEvidence: { ownerApprovedForwardException?: boolean };
    volumeAndYardage: {
      lean: GradeThresholds;
      bestAngle: { minimumEv: number; minimumProbabilityEdge: number; minimumParticipationProbability: number; minimumIndependentBooks: number };
      movementSupportedLean: GradeThresholds;
      movementSupportedBestAngle: GradeThresholds;
    };
    marketLanes: Record<string, {
      eligibleSides: Array<"over" | "under">; bestAngle: boolean; lean: boolean; watchlist: boolean;
      leanThresholds?: GradeThresholds;
    }>;
    touchdown: {
      lean: Omit<GradeThresholds, "minimumIndependentBooks"> & { minimumIndependentBooks?: number };
      bestAngle: GradeThresholds;
      minimumAmericanPrice: number;
      eligibleLine: number;
    };
  };
  playerStates: Record<string, Record<string, number | string | null>>;
  ambiguousPlayerNames: string[];
  teamStates: Record<string, Record<string, number | null>>;
  opponentStates: Record<string, Record<string, number | null>>;
  parity: Array<{ inputs: Record<string, number | null>; participationProbability: number; projections: Record<string, number>; touchdownProbability: number }>;
};
type GradeThresholds = {
  minimumEv: number; minimumProbabilityEdge: number; minimumParticipationProbability: number; minimumIndependentBooks: number;
};
type JointRuntimeArtifact = {
  release: "nfl_player_props_joint_runtime_2026_09_29_r2_full_family_matchup";
  leaguePriors: {
    completionRate: number;
    yardsPerAttempt: number;
    completionRateParticipationStrength: number;
    yardsPerAttemptParticipationStrength: number;
  };
  passingCompletions: {
    jointWeight: number;
    directWeight: number;
    completionRateModel: PortableModel;
  };
  passingYards: {
    jointWeight: number;
    directWeight: number;
    yardsPerAttemptModel: PortableModel;
  };
};

const artifact = {
  ...artifactCoreJson,
  modelRelease: NFL_PLAYER_PROPS_MODEL_RELEASE,
  calibrationRelease: NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
  decisionRelease: NFL_PLAYER_PROPS_DECISION_RELEASE,
  markets: {
    passing_attempts: passingAttemptsJson,
    passing_completions: passingCompletionsJson,
    passing_yards: passingYardsJson,
    rushing_attempts: rushingAttemptsJson,
    rushing_yards: rushingYardsJson,
    receptions: receptionsJson,
    receiving_yards: receivingYardsJson,
  },
  touchdown: touchdownJson,
  playerStates: { ...playerStates0Json, ...playerStates1Json, ...playerStates2Json, ...playerStates3Json },
} as unknown as RuntimeArtifact;
const jointArtifact = jointArtifactJson as unknown as JointRuntimeArtifact;
if (artifact.runtimeRelease !== NFL_PLAYER_PROPS_PORTABLE_ARTIFACT_RELEASE) {
  throw new Error("NFL player props runtime artifact release mismatch.");
}
if (jointArtifact.release !== "nfl_player_props_joint_runtime_2026_09_29_r2_full_family_matchup") {
  throw new Error("NFL player props joint runtime artifact release mismatch.");
}

export type NflPlayerPropsRuntimeFeatureRow = {
  gameId: string; playerName: string; team: string; opponent: string; position: string | null;
  featureAsOf: string; roleFingerprint: string; scoreEligible: boolean; healthHolds: string[];
  teamImpliedPoints: number | null; teamImpliedTouchdowns: number | null;
  expectedQuarterback: {
    name: string; starterStatus: "confirmed" | "projected" | "unknown"; capturedAt: string;
  } | null;
  availability: {
    listed: boolean; status: string | null; detail: string | null; reportedAt: string | null;
    reportUpdatedAt: string | null; source: "ESPN" | "Playbook" | "BALLDONTLIE" | "Conference";
  };
  features: Record<string, number | null>;
};

export type NflPlayerPropsRuntimeScore = {
  participationProbability: number;
  projections: Record<string, number>;
  touchdownProbability: number;
  modelRelease: string; calibrationRelease: string; touchdownModelRelease: string;
};

export type NflPlayerPropsGrade = "Best Angle" | "Lean" | "Watchlist" | "No Play" | "Held";
export type NflPlayerPropsBookEvidence = {
  sportsbook: string; provider: string; americanPrice: number; observedAt: string;
  openingObservedAt: string | null; openingLine: number | null; openingAmericanPrice: number | null;
};
export type NflPlayerPropsMarketMovement = "support" | "adverse" | "neutral";
export type NflPlayerPropsProjectionRange = {
  lower: number; upper: number; centralCoverage: 0.8; source: "empirical_residual_distribution";
};
export type NflPlayerPropsForecastMetric = {
  label: string; value: number; format: "count" | "yards" | "percent";
};
export type NflPlayerPropsForecastTrendPoint = {
  window: "last_game" | "last_3_average" | "last_5_average" | "model_weighted";
  value: number; modelInput: true;
};
export type NflPlayerPropsForecastTrend = {
  label: string; format: NflPlayerPropsForecastMetric["format"];
  source: "timestamped_model_feature";
  points: NflPlayerPropsForecastTrendPoint[];
};
export type NflPlayerPropsForecastContext = {
  featureAsOf: string; position: string | null;
  expectedQuarterback: NflPlayerPropsRuntimeFeatureRow["expectedQuarterback"];
  availability: NflPlayerPropsRuntimeFeatureRow["availability"];
  teamImpliedPoints: number | null; teamImpliedTouchdowns: number | null;
  recentProduction: NflPlayerPropsForecastMetric | null;
  roleOpportunity: NflPlayerPropsForecastMetric[];
  opponentAllowance: NflPlayerPropsForecastMetric | null;
  modelInputTrends?: NflPlayerPropsForecastTrend[];
};
export type NflPlayerPropsRuntimeDecision = {
  gameId: string; providerPlayerId: string | null; playerName: string; team: string; opponent: string;
  scheduledStart: string; market: NflPlayerPropMarket; line: number;
  side: "over" | "under" | "yes"; sportsbook: string; provider: string; americanPrice: number;
  bookEvidence: NflPlayerPropsBookEvidence[];
  observedAt: string; lockAt: string; state: "unlocked" | "locked"; roleFingerprint: string;
  projection: number | null; projectionRange: NflPlayerPropsProjectionRange | null;
  forecastContext: NflPlayerPropsForecastContext;
  participationProbability: number; rawModelProbability: number;
  marketProbability: number; finalProbability: number; probabilityEdge: number; expectedValue: number;
  grade: NflPlayerPropsGrade; marketMovement: NflPlayerPropsMarketMovement; healthHolds: string[]; provisional: false;
  modelRelease: string; calibrationRelease: string; decisionRelease: string;
  projectionEvidence?: {
    release: typeof NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.release;
    source: "market_dominant_expected_starter";
    marketWeight: typeof NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.marketWeight;
    roleWeight: typeof NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.roleWeight;
    market: NflPlayerPropsQbPassingWorkloadMarket;
    books: number;
    marketConsensus: number;
    roleProjection: number;
  } | {
    release: typeof NFL_PLAYER_PROPS_MARKET_COHERENT_PROJECTION_RELEASE;
    source: "single_posterior_distribution";
    independentProjection: number;
    calibratedOverProbability: number;
  };
  passingMarketEvidence?: {
    release: typeof NFL_PLAYER_PROPS_PASSING_MARKET_RELEASE;
    source: "target_book_excluded_cross_line_transport";
    books: number;
    benchmarkProbability: number;
  };
  marketEvidenceId?: string;
};

export type NflPlayerPropsRuntimeBoard = {
  release: typeof NFL_PLAYER_PROPS_BOARD_RELEASE;
  generatedAt: string; evaluatedAt: string; provisional: false; publicationEnabled: false; trackingEnabled: false;
  decisions: NflPlayerPropsRuntimeDecision[];
  counts: Record<NflPlayerPropsGrade, number> & { actionable: number };
  marketEvidence?: NflPlayerPropsMarketEvidenceCapture;
  diagnostics: {
    inputOffers: number; completeExactOffers: number; incompleteExactOffers: number; lockedOffers: number;
    unavailableNoIndependentBenchmark: number; unavailableStaleQuotes: number; unavailableFeatureContext: number;
    completedEvaluations: number; operationalExceptions: number; recoveryEligibleOperationalExceptions: number;
    roleOrIdentityHeld: number;
  };
};

export function scoreNflPlayerPropsRuntimeFeatures(features: Record<string, number | null>): NflPlayerPropsRuntimeScore {
  const participationProbability = clamp(sigmoid(predict(artifact.participationModel, features)), 0.01, 0.99);
  const projections = Object.fromEntries(Object.entries(artifact.markets).map(([market, value]) => [
    market,
    Math.max(0, value.baselineColumn ? (features[value.baselineColumn] ?? 0) : predict(value.model, features)),
  ]));
  if (features.position_qb === 1) {
    const attempts = projections.passing_attempts ?? 0;
    const directCompletions = projections.passing_completions ?? 0;
    const completionRate = sigmoid(predict(jointArtifact.passingCompletions.completionRateModel, features));
    projections.passing_completions = Math.min(attempts, Math.max(0,
      jointArtifact.passingCompletions.jointWeight * attempts * completionRate
      + jointArtifact.passingCompletions.directWeight * directCompletions));
    const directYards = projections.passing_yards ?? 0;
    const yardsPerAttempt = Math.max(0, Math.expm1(predict(jointArtifact.passingYards.yardsPerAttemptModel, features)));
    projections.passing_yards = Math.max(0,
      jointArtifact.passingYards.jointWeight * attempts * yardsPerAttempt
      + jointArtifact.passingYards.directWeight * directYards);
  }
  const touchdownRaw = clamp(sigmoid(predict(artifact.touchdown.model, features)), 0.005, 0.995);
  const touchdownLogit = logit(touchdownRaw);
  const touchdownProbability = sigmoid(artifact.touchdown.calibrator.intercept + artifact.touchdown.calibrator.coefficient * touchdownLogit);
  return {
    participationProbability, projections, touchdownProbability,
    modelRelease: artifact.modelRelease, calibrationRelease: artifact.calibrationRelease,
    touchdownModelRelease: artifact.touchdownModelRelease,
  };
}

export function nflPlayerPropsOverProbability(market: string, projection: number, line: number): number {
  const component = artifact.markets[market];
  if (!component) throw new Error(`NFL props runtime market is unsupported: ${market}`);
  const selected = selectEmpiricalDistribution(component.distribution, projection);
  const target = line - Math.max(projection, 1e-6);
  const residuals = selected.residualQuantiles;
  let low = 0; let high = residuals.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (residuals[middle]! <= target) low = middle + 1;
    else high = middle;
  }
  return 1 - low / residuals.length;
}

export function nflPlayerPropsProjectionRange(
  market: string,
  projection: number,
): NflPlayerPropsProjectionRange {
  const component = artifact.markets[market];
  if (!component) throw new Error(`NFL props runtime market is unsupported: ${market}`);
  const residuals = selectEmpiricalDistribution(component.distribution, projection).residualQuantiles;
  const lowerResidual = empiricalQuantile(residuals, 0.1);
  const upperResidual = empiricalQuantile(residuals, 0.9);
  return {
    lower: Math.max(0, projection + lowerResidual),
    upper: Math.max(0, projection + upperResidual),
    centralCoverage: 0.8,
    source: "empirical_residual_distribution",
  };
}

export function nflPlayerPropsResidualProbability(model: number, market: number, weight: number): number {
  return sigmoid(logit(market) + weight * (logit(model) - logit(market)));
}

export function nflPlayerPropsDiscreteMarketArbitration(args: {
  propMarket: NflPlayerPropMarket;
  rawOverProbability: number;
  marketOverProbability: number;
  independentBooks: number;
  incumbentFinalOverProbability: number;
}): number {
  if (args.independentBooks <= 0) return args.rawOverProbability;
  if (args.propMarket !== "receptions") return args.incumbentFinalOverProbability;
  const directionsDisagree = (args.rawOverProbability >= 0.5) !== (args.marketOverProbability >= 0.5);
  if (!directionsDisagree) return args.incumbentFinalOverProbability;
  if (Math.abs(args.marketOverProbability - 0.5) >= NFL_PLAYER_PROPS_RECEPTIONS_MARKET_FLIP_MINIMUM_EDGE) {
    return args.marketOverProbability;
  }
  return args.incumbentFinalOverProbability;
}

export function nflPlayerPropsExpectedValue(probability: number, americanPrice: number): number {
  const profit = americanPrice < 0 ? 100 / Math.abs(americanPrice) : americanPrice / 100;
  return probability * profit - (1 - probability);
}

export function buildNflPlayerPropsRuntimeFeatureRows(args: {
  snapshot: NflPlayerPropsObservationSnapshot;
  context: NflPlayerPropsInferenceContext;
  currentSeasonState?: NflPlayerPropsCurrentSeasonState | null;
}): NflPlayerPropsRuntimeFeatureRow[] {
  if (args.context.providerSnapshotGeneratedAt !== args.snapshot.generatedAt) {
    throw new Error("NFL props runtime observation/context identity mismatch.");
  }
  const candidates = new Map<string, { gameId: string; playerName: string; playerTeam: string | null; providerPlayerId: string | null }>();
  for (const row of args.snapshot.observations) {
    const ordinary = artifact.markets[row.market] && row.offerType === "over_under";
    const touchdown = row.market === "anytime_td" && row.offerType === "milestone" && row.line === 0.5;
    if (!row.isOpening && row.canonicalGameId && row.playerName && (ordinary || touchdown)) {
      candidates.set(`${row.canonicalGameId}|${normalizeName(row.playerName)}`, {
        gameId: row.canonicalGameId,
        playerName: row.playerName,
        playerTeam: row.playerTeam,
        providerPlayerId: row.providerPlayerId,
      });
    }
  }
  const currentSeason = buildCurrentSeasonFeatureIndex(args.currentSeasonState);
  const contextByGame = new Map(args.context.games.map((game) => [game.canonicalGameId, game]));
  const marketExpectedQuarterbacks = inferMarketExpectedQuarterbacks(args.snapshot, args.context);
  return [...candidates.values()].map((candidate) => {
    const game = contextByGame.get(candidate.gameId);
    if (!game) throw new Error(`NFL props runtime context is missing ${candidate.gameId}.`);
    const roster = [...game.awayDepth.roster, ...game.homeDepth.roster].find((player) => normalizeName(player.name) === normalizeName(candidate.playerName));
    const reportedInjury = game.injuries.teams.flatMap((team) => team.players).find((player) => normalizeName(player.name) === normalizeName(candidate.playerName));
    const injury = nflPlayerPropsCurrentGameAvailability(reportedInjury, game.scheduledStart);
    const playerState = artifact.playerStates[normalizeName(candidate.playerName)];
    const ambiguous = artifact.ambiguousPlayerNames.includes(normalizeName(candidate.playerName));
    const team = normalizeTeam(roster ? ([game.awayDepth, game.homeDepth].find((depth) => depth.roster.includes(roster))?.team ?? candidate.playerTeam ?? "") : (candidate.playerTeam ?? ""));
    const home = normalizeTeam(game.homeTeam); const away = normalizeTeam(game.awayTeam);
    const opponent = team === home ? away : team === away ? home : "";
    const holds = [
      roster ? null : "roster_identity_unmatched",
      playerState ? null : ambiguous ? "historical_identity_ambiguous" : "historical_identity_unmatched",
      opponent ? null : "team_game_identity_unmatched",
      injury && !injury.reportedAt && !game.injuries.reportUpdatedAt ? "injury_report_timestamp_missing" : null,
      injury && ["out", "inactive", "injured reserve", "ir"].includes(injury.status.toLowerCase()) ? "player_listed_out" : null,
    ].filter((value): value is string => value !== null);
    const impliedPoints = impliedTeamPoints(game, team);
    const teamDepth = team === home ? game.homeDepth : game.awayDepth;
    const marketExpectedQuarterback = marketExpectedQuarterbacks.get(`${candidate.gameId}|${team}`) ?? null;
    const expectedQuarterback = marketExpectedQuarterback ?? (teamDepth.expectedStartingQuarterback ? {
      name: teamDepth.expectedStartingQuarterback.name,
      starterStatus: teamDepth.starterStatus,
      capturedAt: teamDepth.capturedAt,
    } : null);
    const features: Record<string, number | null> = {};
    for (const name of new Set([...artifact.featureNames, ...artifact.touchdown.featureNames])) features[name] = null;
    mergeNumeric(features, playerState); mergeNumeric(features, artifact.teamStates[team]); mergeNumeric(features, artifact.opponentStates[opponent]);
    applyNflPlayerPropsCurrentSeasonFeatures({
      features,
      playerStats: currentSeason.player(candidate.playerName, candidate.playerTeam, candidate.providerPlayerId ?? roster?.playerId ?? null),
      teamGames: currentSeason.team(team),
      opponentAllowedGames: currentSeason.opponentAllowed(opponent),
    });
    features.is_home = Number(team === home);
    for (const position of ["qb", "rb", "fb", "wr", "te"]) features[`position_${position}`] = Number(roster?.position?.toLowerCase() === position);
    features.team_implied_touchdowns = impliedPoints === null ? null : impliedPoints / 7;
    features.matchup_week = args.context.week;
    features.matchup_temperature_f = game.weather?.forecast?.temperature_f ?? null;
    features.matchup_wind_mph = game.weather?.forecast?.wind_speed_mph ?? null;
    features.matchup_roof_fixed = game.weather
      ? Number(game.weather.roofType === "fixed" || game.weather.status === "controlled_indoor")
      : null;
    features.matchup_roof_outdoor = game.weather
      ? Number(game.weather.roofType === "outdoor"
        || (game.weather.roofType === "retractable" && game.weather.status === "forecast_available"))
      : null;
    return {
      gameId: candidate.gameId, playerName: candidate.playerName, team, opponent,
      position: roster?.position ?? null, featureAsOf: args.context.capturedAt,
      roleFingerprint: stableRoleFingerprint({ roster, injury, expectedQuarterback }), scoreEligible: holds.length === 0,
      healthHolds: holds, teamImpliedPoints: impliedPoints,
      teamImpliedTouchdowns: features.team_implied_touchdowns, features,
      expectedQuarterback,
      availability: {
        listed: Boolean(injury), status: injury?.status ?? null, detail: injury?.detail ?? null,
        reportedAt: injury?.reportedAt ?? null, reportUpdatedAt: game.injuries.reportUpdatedAt,
        source: game.injuries.source,
      },
    };
  });
}

export function nflPlayerPropsCurrentGameAvailability(
  injury: DailyEdgeAvailabilityPlayer | undefined,
  scheduledStart: string,
): DailyEdgeAvailabilityPlayer | undefined {
  if (!injury) return undefined;
  const expiringGameStatus = ["out", "inactive"].includes(injury.status.trim().toLowerCase());
  if (!expiringGameStatus || !injury.reportedAt) return injury;
  const ageAtGame = Date.parse(scheduledStart) - Date.parse(injury.reportedAt);
  if (!Number.isFinite(ageAtGame)) return injury;
  return ageAtGame > NFL_PLAYER_PROPS_HARD_AVAILABILITY_MAX_GAME_AGE_DAYS * 86_400_000
    ? undefined
    : injury;
}

function inferMarketExpectedQuarterbacks(
  snapshot: NflPlayerPropsObservationSnapshot,
  context: NflPlayerPropsInferenceContext,
): Map<string, NflPlayerPropsRuntimeFeatureRow["expectedQuarterback"]> {
  type Candidate = {
    gameId: string; team: string; playerName: string; books: Set<string>;
    passingYardsLine: number; passingAttemptsLine: number; observedAt: string;
  };
  const candidates = new Map<string, Candidate>();
  const gameById = new Map(context.games.map((game) => [game.canonicalGameId, game]));
  for (const row of snapshot.observations) {
    if (row.isOpening || row.isLive || !row.canonicalGameId || !row.playerName) continue;
    if (row.market !== "passing_yards" && row.market !== "passing_attempts") continue;
    const game = gameById.get(row.canonicalGameId);
    if (!game) continue;
    const depth = [game.awayDepth, game.homeDepth].find((teamDepth) => teamDepth.roster.some((player) =>
      player.position?.trim().toLowerCase() === "qb" && normalizeName(player.name) === normalizeName(row.playerName!)));
    if (!depth) continue;
    const starterScale = row.market === "passing_yards" ? row.line >= 100 : row.line >= 15;
    if (!starterScale) continue;
    const key = `${row.canonicalGameId}|${normalizeTeam(depth.team)}|${normalizeName(row.playerName)}`;
    const candidate = candidates.get(key) ?? {
      gameId: row.canonicalGameId,
      team: normalizeTeam(depth.team),
      playerName: row.playerName,
      books: new Set<string>(),
      passingYardsLine: Number.NEGATIVE_INFINITY,
      passingAttemptsLine: Number.NEGATIVE_INFINITY,
      observedAt: row.observedAt,
    };
    candidate.books.add(normalizeBook(row.sportsbook));
    if (row.market === "passing_yards") candidate.passingYardsLine = Math.max(candidate.passingYardsLine, row.line);
    if (row.market === "passing_attempts") candidate.passingAttemptsLine = Math.max(candidate.passingAttemptsLine, row.line);
    if (Date.parse(row.observedAt) > Date.parse(candidate.observedAt)) candidate.observedAt = row.observedAt;
    candidates.set(key, candidate);
  }
  const byTeam = new Map<string, Candidate[]>();
  for (const candidate of candidates.values()) {
    if (candidate.books.size < NFL_PLAYER_PROPS_MARKET_ROLE_MINIMUM_BOOKS) continue;
    const key = `${candidate.gameId}|${candidate.team}`;
    byTeam.set(key, [...(byTeam.get(key) ?? []), candidate]);
  }
  const selected = new Map<string, NflPlayerPropsRuntimeFeatureRow["expectedQuarterback"]>();
  for (const [key, teamCandidates] of byTeam) {
    const ranked = [...teamCandidates].sort((left, right) =>
      right.books.size - left.books.size
      || right.passingYardsLine - left.passingYardsLine
      || right.passingAttemptsLine - left.passingAttemptsLine
      || left.playerName.localeCompare(right.playerName));
    const first = ranked[0];
    if (!first) continue;
    const second = ranked[1];
    if (second && first.books.size === second.books.size
      && first.passingYardsLine === second.passingYardsLine
      && first.passingAttemptsLine === second.passingAttemptsLine) continue;
    selected.set(key, { name: first.playerName, starterStatus: "projected", capturedAt: first.observedAt });
  }
  return selected;
}

type CurrentSeasonTeamGame = {
  gameId: string;
  week: number;
  team: string;
  opponent: string;
  team_pass_attempts: number;
  team_completions: number;
  team_passing_yards: number;
  team_rush_attempts: number;
  team_rushing_yards: number;
  team_targets: number;
  team_offensive_plays: number;
  team_touchdowns: number;
  matchup_pass_rate?: number | null;
  matchup_completion_rate?: number | null;
  matchup_pass_yards_per_attempt?: number | null;
  matchup_sack_rate?: number | null;
  matchup_rush_yards_per_attempt?: number | null;
  matchup_first_down_rate?: number | null;
  matchup_turnover_rate?: number | null;
};

function buildCurrentSeasonFeatureIndex(state: NflPlayerPropsCurrentSeasonState | null | undefined): {
  player(name: string, team: string | null, providerPlayerId: string | null): NflPlayerPropsCurrentSeasonStat[];
  team(team: string): CurrentSeasonTeamGame[];
  opponentAllowed(team: string): CurrentSeasonTeamGame[];
} {
  const stats = state?.stats ?? [];
  const teamStatsByGameTeam = new Map((state?.teamStats ?? []).map((row) => [
    `${row.gameId}|${normalizeTeam(row.team)}`,
    row,
  ]));
  const byPlayerId = new Map<string, NflPlayerPropsCurrentSeasonStat[]>();
  const byPlayerName = new Map<string, NflPlayerPropsCurrentSeasonStat[]>();
  for (const row of stats) {
    byPlayerId.set(row.playerId, [...(byPlayerId.get(row.playerId) ?? []), row]);
    const key = normalizeName(row.playerName);
    byPlayerName.set(key, [...(byPlayerName.get(key) ?? []), row]);
  }
  const byGameTeam = new Map<string, NflPlayerPropsCurrentSeasonStat[]>();
  for (const row of stats) {
    const key = `${row.gameId}|${normalizeTeam(row.team)}`;
    byGameTeam.set(key, [...(byGameTeam.get(key) ?? []), row]);
  }
  const teamGames: CurrentSeasonTeamGame[] = [];
  const gameTeams = new Map<string, string[]>();
  for (const key of byGameTeam.keys()) {
    const separator = key.indexOf("|");
    const gameId = key.slice(0, separator);
    const team = key.slice(separator + 1);
    gameTeams.set(gameId, [...(gameTeams.get(gameId) ?? []), team]);
  }
  for (const [key, rows] of byGameTeam) {
    const separator = key.indexOf("|");
    const gameId = key.slice(0, separator);
    const team = key.slice(separator + 1);
    const opponent = (gameTeams.get(gameId) ?? []).find((value) => value !== team) ?? "";
    const total = (field: keyof NflPlayerPropsCurrentSeasonStat) => rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0);
    const teamPassAttempts = total("passing_attempts");
    const teamRushAttempts = total("rushing_attempts");
    const teamStat = teamStatsByGameTeam.get(`${gameId}|${team}`);
    const dropbacks = teamStat ? teamStat.passingAttempts + teamStat.sacksAllowed : teamPassAttempts;
    const modeledPlays = teamStat ? dropbacks + teamStat.rushingAttempts : teamPassAttempts + teamRushAttempts;
    teamGames.push({
      gameId,
      week: rows[0]!.week,
      team,
      opponent,
      team_pass_attempts: teamPassAttempts,
      team_completions: total("passing_completions"),
      team_passing_yards: total("passing_yards"),
      team_rush_attempts: teamRushAttempts,
      team_rushing_yards: total("rushing_yards"),
      team_targets: total("receiving_targets"),
      team_offensive_plays: teamPassAttempts + teamRushAttempts,
      team_touchdowns: rows.reduce((sum, row) => sum + playerTouchdowns(row), 0),
      matchup_pass_rate: teamStat ? nullableRatio(dropbacks, modeledPlays) : null,
      matchup_completion_rate: teamStat ? nullableRatio(teamPassAttempts === 0 ? 0 : total("passing_completions"), teamStat.passingAttempts) : null,
      matchup_pass_yards_per_attempt: teamStat ? nullableRatio(teamStat.netPassingYards, teamStat.passingAttempts) : null,
      matchup_sack_rate: teamStat ? nullableRatio(teamStat.sacksAllowed, dropbacks) : null,
      matchup_rush_yards_per_attempt: teamStat ? nullableRatio(teamStat.rushingYards, teamStat.rushingAttempts) : null,
      matchup_first_down_rate: teamStat ? nullableRatio(teamStat.firstDowns, modeledPlays) : null,
      matchup_turnover_rate: teamStat ? nullableRatio(teamStat.turnovers, modeledPlays) : null,
    });
  }
  const sorted = (values: CurrentSeasonTeamGame[]) => [...values].sort((a, b) => a.week - b.week || a.gameId.localeCompare(b.gameId));
  return {
    player: (name, team, providerPlayerId) => {
      const exact = providerPlayerId ? byPlayerId.get(providerPlayerId) : null;
      const candidates = exact?.length ? exact : byPlayerName.get(normalizeName(name)) ?? [];
      const normalizedTeam = team ? normalizeTeam(team) : null;
      const matched = normalizedTeam && candidates.some((row) => normalizeTeam(row.team) === normalizedTeam)
        ? candidates.filter((row) => normalizeTeam(row.team) === normalizedTeam)
        : candidates;
      return [...matched].sort((a, b) => a.week - b.week || a.gameId.localeCompare(b.gameId));
    },
    team: (team) => sorted(teamGames.filter((game) => game.team === normalizeTeam(team))),
    opponentAllowed: (team) => sorted(teamGames.filter((game) => game.opponent === normalizeTeam(team))),
  };
}

export function applyNflPlayerPropsCurrentSeasonFeatures(args: {
  features: Record<string, number | null>;
  playerStats: NflPlayerPropsCurrentSeasonStat[];
  teamGames: CurrentSeasonTeamGame[];
  opponentAllowedGames: CurrentSeasonTeamGame[];
}): void {
  const { features, playerStats, teamGames, opponentAllowedGames } = args;
  if (playerStats.length) {
    const teamByGame = new Map(teamGames.map((game) => [game.gameId, game]));
    const playerMetrics: Array<[string, (row: NflPlayerPropsCurrentSeasonStat) => number]> = [
      ["passing_attempts", (row) => row.passing_attempts],
      ["passing_completions", (row) => row.passing_completions],
      ["passing_yards", (row) => row.passing_yards],
      ["rushing_attempts", (row) => row.rushing_attempts],
      ["rushing_yards", (row) => row.rushing_yards],
      ["targets", (row) => row.receiving_targets],
      ["receptions", (row) => row.receptions],
      ["receiving_yards", (row) => row.receiving_yards],
      ["participated", () => 1],
      ["pass_attempt_share", (row) => ratio(row.passing_attempts, teamByGame.get(row.gameId)?.team_pass_attempts)],
      ["rush_attempt_share", (row) => ratio(row.rushing_attempts, teamByGame.get(row.gameId)?.team_rush_attempts)],
      ["target_share", (row) => ratio(row.receiving_targets, teamByGame.get(row.gameId)?.team_targets)],
    ];
    for (const [metric, read] of playerMetrics) updateRollingFeatures(features, `prior_${metric}`, playerStats.map(read));
    features.prior_roster_game_rows = (numericFeature(features.prior_roster_game_rows) ?? 0) + playerStats.length;
    features.prior_participations = (numericFeature(features.prior_participations) ?? 0) + playerStats.length;
    updateRollingFeatures(features, "prior_anytime_td", playerStats.map((row) => Number(playerTouchdowns(row) > 0)), [5]);
  }
  const teamMetrics: Array<[string, keyof CurrentSeasonTeamGame]> = [
    ["team_pass_attempts", "team_pass_attempts"],
    ["team_completions", "team_completions"],
    ["team_passing_yards", "team_passing_yards"],
    ["team_rush_attempts", "team_rush_attempts"],
    ["team_rushing_yards", "team_rushing_yards"],
    ["team_targets", "team_targets"],
    ["team_offensive_plays", "team_offensive_plays"],
  ];
  for (const [metric, field] of teamMetrics) {
    updateRollingFeatures(features, `prior_${metric}`, teamGames.map((game) => Number(game[field])), [3, 5]);
    const allowedMetric = metric.replace("team_", "allowed_");
    updateRollingFeatures(features, `prior_opponent_${allowedMetric}`, opponentAllowedGames.map((game) => Number(game[field])), [3, 5]);
  }
  if (teamGames.length) features.prior_team_td_avg5 = rollingAverageWithPrior(features.prior_team_td_avg5, teamGames.map((game) => game.team_touchdowns), 5);
  if (opponentAllowedGames.length) features.prior_opponent_td_allowed_avg5 = rollingAverageWithPrior(features.prior_opponent_td_allowed_avg5, opponentAllowedGames.map((game) => game.team_touchdowns), 5);
  const matchupMetrics: Array<[string, keyof CurrentSeasonTeamGame]> = [
    ["pass_rate", "matchup_pass_rate"],
    ["completion_rate", "matchup_completion_rate"],
    ["pass_yards_per_attempt", "matchup_pass_yards_per_attempt"],
    ["sack_rate", "matchup_sack_rate"],
    ["rush_yards_per_attempt", "matchup_rush_yards_per_attempt"],
    ["first_down_rate", "matchup_first_down_rate"],
    ["turnover_rate", "matchup_turnover_rate"],
  ];
  for (const [metric, field] of matchupMetrics) {
    updateRollingFeatures(features, `matchup_team_${metric}`, finiteTeamMetricValues(teamGames, field), [3, 5]);
    updateRollingFeatures(features, `matchup_opponent_allowed_${metric}`, finiteTeamMetricValues(opponentAllowedGames, field), [3, 5]);
  }
}

function finiteTeamMetricValues(games: CurrentSeasonTeamGame[], field: keyof CurrentSeasonTeamGame): number[] {
  return games.map((game) => game[field]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function updateRollingFeatures(
  features: Record<string, number | null>,
  base: string,
  values: number[],
  windows: number[] = [3, 5],
): void {
  if (!values.length) return;
  const clean = values.map((value) => Number.isFinite(value) ? value : 0);
  features[`${base}_lag1`] = clean.at(-1)!;
  for (const window of windows) features[`${base}_avg${window}`] = rollingAverageWithPrior(features[`${base}_avg${window}`], clean, window);
  let ewm = numericFeature(features[`${base}_ewm`]);
  for (const value of clean) ewm = ewm === null ? value : 0.35 * value + 0.65 * ewm;
  features[`${base}_ewm`] = ewm;
  features[`${base}_season_avg`] = clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function rollingAverageWithPrior(prior: number | null | undefined, values: number[], window: number): number {
  const current = values.slice(-window);
  const priorValue = numericFeature(prior);
  const priorCount = priorValue === null ? 0 : Math.max(0, window - current.length);
  const denominator = current.length + priorCount;
  return denominator === 0 ? 0 : (current.reduce((sum, value) => sum + value, 0) + (priorValue ?? 0) * priorCount) / denominator;
}

function playerTouchdowns(row: NflPlayerPropsCurrentSeasonStat): number {
  return row.rushing_touchdowns + row.receiving_touchdowns + row.kick_return_touchdowns + row.punt_return_touchdowns + row.fumbles_touchdowns;
}
function ratio(numerator: number, denominator: number | undefined): number { return denominator && denominator > 0 ? numerator / denominator : 0; }
function nullableRatio(numerator: number, denominator: number): number | null { return denominator > 0 ? numerator / denominator : null; }
function numericFeature(value: number | null | undefined): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }

export function buildNflPlayerPropsRuntimeBoard(args: {
  offers: NflPlayerPropsExactOffer[];
  features: NflPlayerPropsRuntimeFeatureRow[];
  evaluatedAt: string;
  captureMarketEvidence?: boolean;
  auditPrecedingPassingYardsOnly?: boolean;
  auditIncumbentMarketArbitration?: boolean;
}): NflPlayerPropsRuntimeBoard {
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) throw new Error("NFL props runtime board evaluatedAt is invalid.");
  const featureByKey = new Map(args.features.map((row) => [`${row.gameId}|${normalizeName(row.playerName)}`, row]));
  const exact = args.offers.filter((offer) => offer.gradeEligibleMarket && offer.exactPriceComplete);
  const staleOutcomeKeys = new Set<string>();
  const unavailableBenchmarkKeys = new Set<string>();
  const unavailableFeatureKeys = new Set<string>();
  const freshExact = exact.filter((offer) => {
    const stale = evaluatedAt - Date.parse(offer.observedAt) > artifact.decision.maximumQuoteAgeHours * 3_600_000;
    if (stale) for (const key of outcomeKeys(offer)) staleOutcomeKeys.add(key);
    return !stale;
  });
  const benchmarkGroups = new Map<string, Map<string, { over: number | null; under: number | null; yes: number | null }>>();
  for (const offer of freshExact) {
    const key = `${offer.canonicalGameId}|${normalizeName(offer.playerName)}|${offer.market}|${offer.line}`;
    const books = benchmarkGroups.get(key) ?? new Map();
    const book = normalizeBook(offer.sportsbook);
    const probability = { over: offer.overNoVigProbability, under: offer.underNoVigProbability, yes: offer.yesPrice === null ? null : impliedProbability(offer.yesPrice) };
    const previous = books.get(book);
    books.set(book, previous ? {
      over: averagePresent([previous.over, probability.over]), under: averagePresent([previous.under, probability.under]), yes: averagePresent([previous.yes, probability.yes]),
    } : probability);
    benchmarkGroups.set(key, books);
  }
  const workloadMarriageEnabled = args.auditPrecedingPassingYardsOnly !== true;
  const passingPrimaryKeys = primaryNflPlayerPropsOfferKeys(freshExact.filter((offer) =>
    offer.market === "passing_yards" || (workloadMarriageEnabled && isQbPassingWorkloadMarket(offer.market))));
  const passingMarketGroups = new Map<string, NflPlayerPropsExactOffer[]>();
  for (const offer of freshExact) {
    const eligiblePassingMarket = offer.market === "passing_yards"
      || (workloadMarriageEnabled && isQbPassingWorkloadMarket(offer.market));
    if (!eligiblePassingMarket || offer.offerType !== "over_under" || !passingPrimaryKeys.has(offer.offerKey)) continue;
    const key = passingPlayerKey(offer);
    passingMarketGroups.set(key, [...(passingMarketGroups.get(key) ?? []), offer]);
  }
  const decisions: NflPlayerPropsRuntimeDecision[] = [];
  for (const offer of freshExact) {
    const feature = featureByKey.get(`${offer.canonicalGameId}|${normalizeName(offer.playerName)}`);
    if (!feature) {
      for (const key of outcomeKeys(offer)) unavailableFeatureKeys.add(key);
      continue;
    }
    const benchmarkKey = `${offer.canonicalGameId}|${normalizeName(offer.playerName)}|${offer.market}|${offer.line}`;
    const books = benchmarkGroups.get(benchmarkKey) ?? new Map();
    const others = [...books.entries()].filter(([book]) => book !== normalizeBook(offer.sportsbook)).map(([, value]) => value);
    const independentBooks = others.length;
    const scored = scoreNflPlayerPropsRuntimeFeatures(feature.features);
    const commonHolds = [...offer.healthHolds, ...feature.healthHolds];
    if (offer.market === "anytime_td") {
      if (independentBooks === 0) {
        for (const key of outcomeKeys(offer)) unavailableBenchmarkKeys.add(key);
      }
      const decisionReasons = independentBooks === 0
        ? [...commonHolds, "independent_same_line_confirmation_missing"]
        : commonHolds;
      if (offer.yesPrice === null) continue;
      const raw = scored.touchdownProbability;
      const market = averagePresent(others.map((value) => value.yes)) ?? raw;
      const final = independentBooks > 0
        ? nflPlayerPropsResidualProbability(raw, market, artifact.touchdown.marketResidualWeight)
        : raw;
      const edge = final - market; const ev = nflPlayerPropsExpectedValue(final, offer.yesPrice);
      const sharpReferenceBooks = [...books.keys()]
        .filter((book) => book !== normalizeBook(offer.sportsbook) && isSharpReferenceBook(book)).length;
      const grade = gradeNflPlayerPropsTouchdownCandidate({
        commonHolds,
        independentBooks,
        sharpReferenceBooks,
        americanPrice: offer.yesPrice,
        expectedValue: ev,
        probabilityEdge: edge,
        participationProbability: scored.participationProbability,
      });
      decisions.push(decisionRow(offer, feature, scored, "yes", offer.yesPrice, null, raw, market, final, edge, ev, grade, "neutral", decisionReasons, artifact.touchdownModelRelease, artifact.touchdownCalibrationRelease, NFL_PLAYER_PROPS_DECISION_RELEASE));
      continue;
    }
    const policy = artifact.markets[offer.market];
    const lane = nflPlayerPropsProductionMarketLane(offer.market);
    if (!policy || offer.overPrice === null || offer.underPrice === null || offer.overNoVigProbability === null || offer.underNoVigProbability === null) continue;
    const passingWorkloadMarket = offer.market === "passing_yards"
      ? offer.market
      : workloadMarriageEnabled && isQbPassingWorkloadMarket(offer.market)
        ? offer.market
        : null;
    const passingProjection = passingWorkloadMarket
      ? nflPlayerPropsExpectedStarterPassingProjection({
          feature,
          market: passingWorkloadMarket,
          modeledProjection: scored.projections[offer.market]!,
          modeledProjections: scored.projections,
          offers: passingMarketGroups.get(passingPlayerKey(offer)) ?? [],
          evaluatedSportsbook: offer.sportsbook,
        })
      : null;
    const projection = passingProjection?.projection ?? scored.projections[offer.market]!;
    const decisionScore = passingProjection ? {
      ...scored,
      participationProbability: nflPlayerPropsStarterAdjustedParticipationProbability(feature, scored.participationProbability),
    } : scored;
    const rawOver = nflPlayerPropsOverProbability(offer.market, projection, offer.line);
    const independentPassingOffers = passingWorkloadMarket
      ? (passingMarketGroups.get(passingPlayerKey(offer)) ?? [])
          .filter((candidate) => candidate.market === passingWorkloadMarket
            && normalizeBook(candidate.sportsbook) !== normalizeBook(offer.sportsbook))
      : [];
    if (independentBooks === 0) {
      for (const key of outcomeKeys(offer)) unavailableBenchmarkKeys.add(key);
    }
    const decisionReasons = independentBooks === 0
      ? [...commonHolds, "independent_same_line_confirmation_missing"]
      : commonHolds;
    const marketOver = passingWorkloadMarket
      ? independentPassingOffers.length
        ? averagePresent(independentPassingOffers.map((candidate) => candidate.overNoVigProbability === null ? null : nflPlayerPropsTransportedMarketProbability({
            market: passingWorkloadMarket, projection, sourceLine: candidate.line, sourceOverProbability: candidate.overNoVigProbability, targetLine: offer.line,
          })))!
        : rawOver
        : averagePresent(others.map((value) => value.over)) ?? rawOver;
    // The QB point head already incorporates this target-excluded market set.
    // Applying the residual head again would grant the same evidence two votes.
    const incumbentFinalOver = passingProjection?.evidence
      ? rawOver
      : independentBooks > 0
        ? nflPlayerPropsResidualProbability(rawOver, marketOver, policy.marketResidualWeight)
        : rawOver;
    const finalOver = passingProjection?.evidence || args.auditIncumbentMarketArbitration === true
      ? incumbentFinalOver
      : nflPlayerPropsDiscreteMarketArbitration({
          propMarket: offer.market,
          rawOverProbability: rawOver,
          marketOverProbability: marketOver,
          independentBooks,
          incumbentFinalOverProbability: incumbentFinalOver,
        });
    if (!(finalOver > 0 && finalOver < 1)) {
      // Provider catalogs can contain a syntactically complete line outside
      // the empirical residual support (for example, a receptions offer that
      // behaves like a longest-reception line). Do not clamp an endpoint into
      // manufactured confidence and do not let one invalid offer abort the
      // coherent board. Both sides remain unavailable model-input outcomes.
      for (const key of outcomeKeys(offer)) unavailableFeatureKeys.add(key);
      continue;
    }
    const posterior = nflPlayerPropsCoherentPosteriorDistribution({
      market: offer.market,
      line: offer.line,
      calibratedOverProbability: finalOver,
      independentProjection: projection,
    });
    const publishedProjection = posterior.projection;
    const projectionEvidence = passingProjection?.evidence ?? {
      release: NFL_PLAYER_PROPS_MARKET_COHERENT_PROJECTION_RELEASE,
      source: "single_posterior_distribution" as const,
      independentProjection: projection,
      calibratedOverProbability: finalOver,
    };
    for (const [side, price, raw, market, final] of [
      ["over", offer.overPrice, rawOver, marketOver, finalOver],
      ["under", offer.underPrice, 1 - rawOver, 1 - marketOver, 1 - finalOver],
    ] as const) {
      const edge = final - market; const ev = nflPlayerPropsExpectedValue(final, price);
      const divergenceImplausible = nflPlayerPropsRawMarketDivergenceImplausible(raw, market);
      const eligibleSide = lane?.eligibleSides.includes(side) ?? false;
      const movement = nflPlayerPropsSameBookMovement(offer, side);
      const leanThresholds = movement === "support"
        ? artifact.decision.volumeAndYardage.movementSupportedLean
        : lane?.leanThresholds ?? artifact.decision.volumeAndYardage.lean;
      const bestAngleThresholds = movement === "support"
        ? artifact.decision.volumeAndYardage.movementSupportedBestAngle
        : artifact.decision.volumeAndYardage.bestAngle;
      const baseGrade = gradeNflPlayerPropsCrossMarketCandidate({
        commonHolds,
        independentBooks,
        divergenceImplausible,
        eligibleSide,
        marketResidualQualified: policy.marketResidualQualified || artifact.decision.releaseEvidence.ownerApprovedForwardException === true,
        bestAngleEnabled: lane?.bestAngle === true,
        leanEnabled: lane?.lean === true,
        watchlistEnabled: lane?.watchlist === true,
        expectedValue: ev,
        probabilityEdge: edge,
        participationProbability: decisionScore.participationProbability,
        movement,
        leanThresholds,
        bestAngleThresholds,
      });
      const crossLineIndependentBooks = (passingMarketGroups.get(passingPlayerKey(offer)) ?? [])
        .filter((candidate) => candidate.market === offer.market
          && normalizeBook(candidate.sportsbook) !== normalizeBook(offer.sportsbook)).length;
      const bridgedGrade: NflPlayerPropsGrade = offer.market === "passing_yards" && passingProjection && baseGrade === "No Play"
        && nflPlayerPropsPassingYardsWatchlistEligible({
          market: offer.market,
          commonHolds,
          primaryTarget: passingPrimaryKeys.has(offer.offerKey),
          independentMarketBooks: crossLineIndependentBooks,
          divergenceImplausible,
          movement,
          expectedValue: ev,
          probabilityEdge: edge,
        })
          ? "Watchlist"
          : baseGrade;
      const forecastSide = finalOver >= 0.5 ? "over" : "under";
      const grade: NflPlayerPropsGrade = (bridgedGrade === "Best Angle" || bridgedGrade === "Lean")
        && side !== forecastSide
          ? "Watchlist"
          : bridgedGrade;
      decisions.push(decisionRow(
        offer, feature, decisionScore, side, price, publishedProjection, raw, market, final, edge, ev, grade,
        movement,
        divergenceImplausible ? [...decisionReasons, "model_market_divergence_implausible"] : decisionReasons,
        NFL_PLAYER_PROPS_MODEL_RELEASE,
        NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
        NFL_PLAYER_PROPS_DECISION_RELEASE,
        projectionEvidence,
        passingProjection && independentPassingOffers.length ? {
          release: NFL_PLAYER_PROPS_PASSING_MARKET_RELEASE,
          source: "target_book_excluded_cross_line_transport",
          books: independentPassingOffers.length,
          benchmarkProbability: market,
        } : undefined,
        independentBooks === 0 && !passingProjection?.evidence ? undefined : posterior.range,
      ));
    }
  }
  const bestPrice = new Map<string, NflPlayerPropsRuntimeDecision>();
  const evidenceByOutcome = new Map<string, NflPlayerPropsBookEvidence[]>();
  for (const row of decisions) {
    const key = `${row.gameId}|${normalizeName(row.playerName)}|${row.market}|${row.line}|${row.side}`;
    evidenceByOutcome.set(key, [...(evidenceByOutcome.get(key) ?? []), ...row.bookEvidence]);
    const previous = bestPrice.get(key);
    if (!previous || row.americanPrice > previous.americanPrice) bestPrice.set(key, row);
  }
  const deduped = [...bestPrice.entries()].map(([key, row]) => ({
    ...row,
    bookEvidence: [...(evidenceByOutcome.get(key) ?? [])].sort((first, second) =>
      second.americanPrice - first.americanPrice || first.sportsbook.localeCompare(second.sportsbook)),
  })).sort(compareDecision);
  const marketEvidence = args.captureMarketEvidence === false ? null : buildNflPlayerPropsMarketEvidenceCapture({
    offers: args.offers,
    decisions: deduped,
    evaluatedAt: args.evaluatedAt,
    maximumQuoteAgeHours: artifact.decision.maximumQuoteAgeHours,
    incumbentCoefficientByMarket: {
      ...Object.fromEntries(Object.entries(artifact.markets).map(([market, policy]) => [market, policy.marketResidualWeight])),
      anytime_td: artifact.touchdown.marketResidualWeight,
    },
    // The full production payload serializes non-Held decisions in both the
    // canonical board and member decision list. Reserve both references here.
    referenceCopies: 2,
  });
  const capturedDecisions = marketEvidence ? deduped.map((row) => {
    const marketEvidenceId = nflPlayerPropsMarketEvidenceId(row);
    return marketEvidence.retainedIds.has(marketEvidenceId) ? { ...row, marketEvidenceId } : row;
  }) : deduped;
  const count = (grade: NflPlayerPropsGrade) => capturedDecisions.filter((row) => row.grade === grade).length;
  const operationalExceptions = capturedDecisions.filter((row) => row.grade === "Held");
  return {
    release: NFL_PLAYER_PROPS_BOARD_RELEASE, generatedAt: new Date(evaluatedAt).toISOString(), evaluatedAt: args.evaluatedAt,
    provisional: false, publicationEnabled: false, trackingEnabled: false, decisions: capturedDecisions,
    counts: { "Best Angle": count("Best Angle"), Lean: count("Lean"), Watchlist: count("Watchlist"), "No Play": count("No Play"), Held: count("Held"), actionable: count("Best Angle") + count("Lean") },
    ...(marketEvidence ? { marketEvidence: marketEvidence.capture } : {}),
    diagnostics: {
      inputOffers: args.offers.length,
      completeExactOffers: exact.length,
      incompleteExactOffers: args.offers.filter((offer) => offer.gradeEligibleMarket && !offer.exactPriceComplete).length,
      unavailableNoIndependentBenchmark: unavailableBenchmarkKeys.size,
      unavailableStaleQuotes: staleOutcomeKeys.size,
      unavailableFeatureContext: unavailableFeatureKeys.size,
      completedEvaluations: deduped.length - operationalExceptions.length,
      operationalExceptions: operationalExceptions.length,
      recoveryEligibleOperationalExceptions: operationalExceptions.filter((row) => row.state === "unlocked").length,
      roleOrIdentityHeld: operationalExceptions.length,
      lockedOffers: exact.filter((offer) => offer.state === "locked").length,
    },
  };
}

function outcomeKeys(offer: NflPlayerPropsExactOffer): string[] {
  const base = `${offer.canonicalGameId}|${normalizeName(offer.playerName)}|${offer.market}|${offer.line}`;
  return offer.market === "anytime_td" ? [`${base}|yes`] : [`${base}|over`, `${base}|under`];
}

function crossLineMarketKey(offer: NflPlayerPropsExactOffer): string {
  return `${offer.canonicalGameId}|${normalizeName(offer.playerName)}|${offer.market}|${offer.offerType}`;
}

function passingPlayerKey(offer: NflPlayerPropsExactOffer): string {
  return `${offer.canonicalGameId}|${normalizeName(offer.playerName)}|${offer.offerType}`;
}

function isQbPassingWorkloadMarket(market: NflPlayerPropMarket): market is NflPlayerPropsQbPassingWorkloadMarket {
  return (NFL_PLAYER_PROPS_QB_PASSING_WORKLOAD_MARKETS as readonly string[]).includes(market);
}

export function primaryNflPlayerPropsOfferKeys(offers: NflPlayerPropsExactOffer[]): Set<string> {
  const selected = new Map<string, NflPlayerPropsExactOffer>();
  for (const offer of offers) {
    const key = `${crossLineMarketKey(offer)}|${normalizeBook(offer.sportsbook)}`;
    const previous = selected.get(key);
    if (!previous || comparePrimaryOffer(offer, previous) < 0) selected.set(key, offer);
  }
  return new Set([...selected.values()].map((offer) => offer.offerKey));
}

function comparePrimaryOffer(first: NflPlayerPropsExactOffer, second: NflPlayerPropsExactOffer): number {
  const firstBalance = first.overNoVigProbability === null ? 1 : Math.abs(first.overNoVigProbability - 0.5);
  const secondBalance = second.overNoVigProbability === null ? 1 : Math.abs(second.overNoVigProbability - 0.5);
  return firstBalance - secondBalance
    || Date.parse(second.observedAt) - Date.parse(first.observedAt)
    || first.line - second.line
    || first.offerKey.localeCompare(second.offerKey);
}

export function verifyNflPlayerPropsRuntimeParity(tolerance = 1e-9): void {
  for (const test of artifact.parity) {
    const actual = scoreNflPlayerPropsRuntimeFeatures(test.inputs);
    assertNear(actual.participationProbability, test.participationProbability, tolerance, "participation");
    assertNear(actual.touchdownProbability, test.touchdownProbability, tolerance, "touchdown");
    for (const [market, expected] of Object.entries(test.projections)) assertNear(actual.projections[market]!, expected, tolerance, market);
  }
}

export function nflPlayerPropsRuntimePolicy(): Readonly<RuntimeArtifact["decision"]> { return artifact.decision; }
export function nflPlayerPropsRuntimeMarketPolicy(market: NflPlayerPropMarket): { weight: number; qualified: boolean } | null {
  const value = artifact.markets[market];
  return value ? { weight: value.marketResidualWeight, qualified: value.marketResidualQualified } : null;
}
export function nflPlayerPropsTouchdownPolicy(): { weight: number; actionable: boolean; requiresSharpReference: true } {
  return {
    weight: artifact.touchdown.marketResidualWeight,
    actionable: NFL_PLAYER_PROPS_TOUCHDOWN_SHARP_REFERENCE_ACTIONABLE,
    requiresSharpReference: true,
  };
}

function predict(model: PortableModel, features: Record<string, number | null>): number {
  if (model.kind === "weighted_blend") {
    return model.components.reduce((sum, component) => sum + component.weight * predict(component.model, features), 0);
  }
  if (model.kind === "linear_regressor") {
    let value = model.intercept;
    for (let index = 0; index < model.featureNames.length; index += 1) {
      const raw = features[model.featureNames[index]!] ?? model.imputer[index]!;
      value += ((raw - model.means[index]!) / model.scales[index]!) * model.coefficients[index]!;
    }
    return value;
  }
  const inputs = model.featureNames.map((name) => features[name] ?? Number.NaN);
  if (model.kind === "extra_trees_regressor") {
    return model.trees.reduce((sum, tree) => sum + predictCompactForestTree(tree.nodes, inputs), 0) / Math.max(1, model.trees.length);
  }
  let value = model.baseline;
  for (const iteration of model.trees) for (const tree of iteration) value += predictTree(tree.nodes, inputs);
  return model.link === "exponential" ? Math.exp(value) : value;
}

function predictCompactForestTree(nodes: CompactForestNode[], inputs: number[]): number {
  let index = 0;
  while (true) {
    const node = nodes[index]; if (!node) throw new Error("NFL props runtime forest node is missing.");
    if (node[6]) return node[0];
    const input = inputs[node[1]];
    index = input === undefined || !Number.isFinite(input) ? (node[3] ? node[4] : node[5]) : (input <= node[2] ? node[4] : node[5]);
  }
}

function predictTree(nodes: TreeNode[], inputs: number[]): number {
  let index = 0;
  while (true) {
    const node = nodes[index]; if (!node) throw new Error("NFL props runtime tree node is missing.");
    if (node.isLeaf) return node.value;
    const input = inputs[node.featureIndex];
    index = input === undefined || !Number.isFinite(input) ? (node.missingGoToLeft ? node.left : node.right) : (input <= node.threshold ? node.left : node.right);
  }
}

function impliedTeamPoints(game: NflPlayerPropsInferenceContext["games"][number], team: string): number | null {
  const books = game.mainMarket.currentBooks.filter((book) => book.total && book.spread);
  if (!books.length) return null;
  const total = median(books.map((book) => book.total!.line));
  const homeSpread = median(books.map((book) => book.spread!.homeLine));
  const homePoints = total / 2 - homeSpread / 2;
  return team === normalizeTeam(game.homeTeam) ? homePoints : total - homePoints;
}

function mergeNumeric(target: Record<string, number | null>, source: Record<string, number | string | null> | undefined): void {
  if (!source) return;
  for (const [key, value] of Object.entries(source)) if (typeof value === "number") target[key] = value;
}
function stableRoleFingerprint(value: unknown): string {
  const input = JSON.stringify(canonicalize(value));
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([first], [second]) => first.localeCompare(second)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}
function normalizeName(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]/g, ""); }
function normalizeTeam(value: string): string { const team = value.trim().toUpperCase(); return ({ LAR: "LA", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LA" } as Record<string, string>)[team] ?? team; }
function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2; }
function sigmoid(value: number): number { return 1 / (1 + Math.exp(-value)); }
function logit(value: number): number { const clipped = clamp(value, 1e-5, 1 - 1e-5); return Math.log(clipped / (1 - clipped)); }
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }
function assertNear(actual: number, expected: number, tolerance: number, label: string): void { if (Math.abs(actual - expected) > tolerance) throw new Error(`NFL props runtime ${label} parity failed: ${actual} != ${expected}`); }
function impliedProbability(price: number): number { return price < 0 ? -price / (-price + 100) : 100 / (price + 100); }
function averagePresent(values: Array<number | null>): number | null { const present = values.filter((value): value is number => value !== null); return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null; }
function normalizeBook(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function isSharpReferenceBook(value: string): boolean { return ["pinnacle", "circa", "bookmaker"].includes(normalizeBook(value)); }
function decisionRow(
  offer: NflPlayerPropsExactOffer, feature: NflPlayerPropsRuntimeFeatureRow, score: NflPlayerPropsRuntimeScore,
  side: "over" | "under" | "yes", price: number, projection: number | null, raw: number, market: number,
  final: number, edge: number, expectedValue: number, grade: NflPlayerPropsGrade,
  marketMovement: NflPlayerPropsMarketMovement, holds: string[], modelRelease: string, calibrationRelease: string,
  decisionRelease: string,
  projectionEvidence?: NflPlayerPropsRuntimeDecision["projectionEvidence"],
  passingMarketEvidence?: NflPlayerPropsRuntimeDecision["passingMarketEvidence"],
  projectionRange?: NflPlayerPropsProjectionRange,
): NflPlayerPropsRuntimeDecision {
  const openingAmericanPrice = side === "over"
    ? offer.openingOverPrice
    : side === "under"
      ? offer.openingUnderPrice
      : offer.openingYesPrice;
  return {
    gameId: offer.canonicalGameId, providerPlayerId: offer.providerPlayerId, playerName: offer.playerName,
    team: feature.team, opponent: feature.opponent, scheduledStart: offer.scheduledStart, market: offer.market,
    line: offer.line, side, sportsbook: offer.sportsbook, provider: offer.provider, americanPrice: price,
    bookEvidence: [{
      sportsbook: offer.sportsbook, provider: offer.provider, americanPrice: price, observedAt: offer.observedAt,
      openingObservedAt: offer.openingObservedAt, openingLine: offer.openingLine, openingAmericanPrice,
    }],
    observedAt: offer.observedAt, lockAt: offer.lockAt, state: offer.state, roleFingerprint: feature.roleFingerprint,
    projection,
    projectionRange: projection === null ? null : projectionRange ?? nflPlayerPropsProjectionRange(offer.market, projection),
    forecastContext: buildForecastContext(feature, offer.market),
    participationProbability: score.participationProbability, rawModelProbability: raw,
    marketProbability: market, finalProbability: final, probabilityEdge: edge, expectedValue, grade, marketMovement,
    healthHolds: [...new Set(holds)].sort(), provisional: false, modelRelease, calibrationRelease,
    decisionRelease,
    ...(projectionEvidence ? { projectionEvidence } : {}),
    ...(passingMarketEvidence ? { passingMarketEvidence } : {}),
  };
}

export function nflPlayerPropsStarterAdjustedParticipationProbability(
  feature: NflPlayerPropsRuntimeFeatureRow,
  modeledProbability: number,
): number {
  if (feature.position?.trim().toLowerCase() !== "qb") return modeledProbability;
  const quarterback = feature.expectedQuarterback;
  if (!quarterback || normalizeName(quarterback.name) !== normalizeName(feature.playerName)) return modeledProbability;
  const status = feature.availability.status?.trim().toLowerCase() ?? "";
  if (["out", "inactive", "injured reserve", "ir", "doubtful"].includes(status)) return modeledProbability;
  const floor = quarterback.starterStatus === "confirmed"
    ? NFL_PLAYER_PROPS_QB_ROLE_FLOORS.confirmedStarter
    : quarterback.starterStatus === "projected"
      ? NFL_PLAYER_PROPS_QB_ROLE_FLOORS.projectedStarter
      : 0;
  return Math.max(modeledProbability, floor);
}

export function nflPlayerPropsExpectedStarterPassingProjection(args: {
  feature: NflPlayerPropsRuntimeFeatureRow;
  market?: NflPlayerPropsQbPassingWorkloadMarket;
  modeledProjection: number;
  modeledProjections?: Record<string, number>;
  offers: NflPlayerPropsExactOffer[];
  evaluatedSportsbook: string;
}): { projection: number; evidence?: NonNullable<NflPlayerPropsRuntimeDecision["projectionEvidence"]> } | null {
  if (args.feature.position?.trim().toLowerCase() !== "qb") return null;
  const quarterback = args.feature.expectedQuarterback;
  if (!quarterback || quarterback.starterStatus === "unknown"
    || normalizeName(quarterback.name) !== normalizeName(args.feature.playerName)) return null;
  const status = args.feature.availability.status?.trim().toLowerCase() ?? "";
  if (["out", "inactive", "injured reserve", "ir", "doubtful"].includes(status)) return null;
  const market = args.market ?? "passing_yards";
  const roleProjection = (candidateMarket: NflPlayerPropsQbPassingWorkloadMarket): number => {
    const modeled = args.modeledProjections?.[candidateMarket];
    if (typeof modeled === "number" && Number.isFinite(modeled) && modeled >= 0) return modeled;
    const values = [
      args.feature.features[`prior_${candidateMarket}_avg3`],
      args.feature.features[`prior_${candidateMarket}_avg5`],
      args.feature.features[`prior_${candidateMarket}_ewm`],
    ].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
    if (values.length) return median(values);
    return candidateMarket === market && Number.isFinite(args.modeledProjection) && args.modeledProjection >= 0
      ? args.modeledProjection
      : 0;
  };
  const marketOffers = new Map<NflPlayerPropsQbPassingWorkloadMarket, Map<string, NflPlayerPropsExactOffer>>();
  for (const offer of args.offers) {
    if (!isQbPassingWorkloadMarket(offer.market) || offer.offerType !== "over_under" || offer.overNoVigProbability === null) continue;
    if (normalizeBook(offer.sportsbook) === normalizeBook(args.evaluatedSportsbook)) continue;
    const books = marketOffers.get(offer.market) ?? new Map<string, NflPlayerPropsExactOffer>();
    books.set(normalizeBook(offer.sportsbook), offer);
    marketOffers.set(offer.market, books);
  }
  const base = {
    passing_attempts: roleProjection("passing_attempts"),
    passing_completions: roleProjection("passing_completions"),
    passing_yards: roleProjection("passing_yards"),
  };
  const marketConsensus = new Map<NflPlayerPropsQbPassingWorkloadMarket, number>();
  let totalEvidenceBooks = 0;
  for (const candidateMarket of NFL_PLAYER_PROPS_QB_PASSING_WORKLOAD_MARKETS) {
    const books = marketOffers.get(candidateMarket);
    if (!books?.size) continue;
    totalEvidenceBooks += books.size;
    marketConsensus.set(candidateMarket, median([...books.values()].map((offer) =>
      nflPlayerPropsMarketImpliedCenter({
        market: candidateMarket,
        referenceProjection: base[candidateMarket],
        line: offer.line,
        overProbability: offer.overNoVigProbability!,
      }))));
  }
  if (totalEvidenceBooks < NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.minimumBooks) {
    return { projection: base[market] };
  }
  const priorParticipations = Math.max(0, args.feature.features.prior_participations ?? 0);
  const rawCompletionRate = base.passing_attempts > 0
    ? clamp(base.passing_completions / base.passing_attempts, 0.35, 0.85)
    : jointArtifact.leaguePriors.completionRate;
  const completionCredibility = priorParticipations
    / (priorParticipations + jointArtifact.leaguePriors.completionRateParticipationStrength);
  const completionRate = completionCredibility * rawCompletionRate
    + (1 - completionCredibility) * jointArtifact.leaguePriors.completionRate;
  const rawYardsPerAttempt = base.passing_attempts > 0
    ? clamp(base.passing_yards / base.passing_attempts, 3, 12)
    : jointArtifact.leaguePriors.yardsPerAttempt;
  const yardsCredibility = priorParticipations
    / (priorParticipations + jointArtifact.leaguePriors.yardsPerAttemptParticipationStrength);
  const yardsPerAttempt = yardsCredibility * rawYardsPerAttempt
    + (1 - yardsCredibility) * jointArtifact.leaguePriors.yardsPerAttempt;
  const impliedAttemptCenters = [
    marketConsensus.get("passing_attempts"),
    marketConsensus.has("passing_completions")
      ? marketConsensus.get("passing_completions")! / Math.max(completionRate, 1e-6)
      : undefined,
    marketConsensus.has("passing_yards")
      ? marketConsensus.get("passing_yards")! / Math.max(yardsPerAttempt, 1e-6)
      : undefined,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const marketAttempts = impliedAttemptCenters.length ? median(impliedAttemptCenters) : base.passing_attempts;
  const attempts = NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.marketWeight * marketAttempts
    + NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.roleWeight * base.passing_attempts;
  const jointCompletions = attempts * completionRate;
  const completionsCenter = marketConsensus.get("passing_completions") ?? jointCompletions;
  const completions = Math.min(attempts, Math.max(0,
    NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.marketWeight * completionsCenter
    + NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.roleWeight * jointCompletions));
  const jointYards = attempts * yardsPerAttempt;
  const yardsCenter = marketConsensus.get("passing_yards") ?? jointYards;
  const yards = Math.max(0,
    NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.marketWeight * yardsCenter
    + NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.roleWeight * jointYards);
  const projections: Record<NflPlayerPropsQbPassingWorkloadMarket, number> = {
    passing_attempts: attempts,
    passing_completions: completions,
    passing_yards: yards,
  };
  const projection = projections[market];
  return {
    projection,
    evidence: {
      release: NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.release,
      source: "market_dominant_expected_starter",
      marketWeight: NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.marketWeight,
      roleWeight: NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.roleWeight,
      market,
      books: totalEvidenceBooks,
      marketConsensus: marketConsensus.get(market) ?? projection,
      roleProjection: base[market],
    },
  };
}

export function nflPlayerPropsMarketImpliedCenter(args: {
  market?: NflPlayerPropsQbPassingWorkloadMarket;
  referenceProjection: number;
  line: number;
  overProbability: number;
}): number {
  if (!Number.isFinite(args.referenceProjection) || !Number.isFinite(args.line)
    || !Number.isFinite(args.overProbability) || args.overProbability <= 0 || args.overProbability >= 1) {
    throw new Error("NFL props passing market-implied projection input is invalid.");
  }
  const market = args.market ?? "passing_yards";
  const residuals = selectEmpiricalDistribution(artifact.markets[market]!.distribution, args.referenceProjection).residualQuantiles;
  return args.line - empiricalInterpolatedQuantile(residuals, 1 - args.overProbability);
}

export function nflPlayerPropsTransportedMarketProbability(args: {
  market?: NflPlayerPropsQbPassingWorkloadMarket;
  projection: number;
  sourceLine: number;
  sourceOverProbability: number;
  targetLine: number;
}): number {
  if (!Number.isFinite(args.projection) || !Number.isFinite(args.sourceLine) || !Number.isFinite(args.targetLine)
    || !Number.isFinite(args.sourceOverProbability) || args.sourceOverProbability <= 0 || args.sourceOverProbability >= 1) {
    throw new Error("NFL props passing cross-line market input is invalid.");
  }
  const market = args.market ?? "passing_yards";
  const residuals = selectEmpiricalDistribution(artifact.markets[market]!.distribution, args.projection).residualQuantiles;
  const sourceResidual = empiricalInterpolatedQuantile(residuals, 1 - args.sourceOverProbability);
  const impliedCenter = args.sourceLine - sourceResidual;
  return clamp(empiricalOverProbability(residuals, args.targetLine - impliedCenter), 0.001, 0.999);
}

export function nflPlayerPropsProbabilityCoherentProjection(args: {
  market: string;
  line: number;
  calibratedOverProbability: number;
  independentProjection: number;
}): number {
  return nflPlayerPropsCoherentPosteriorDistribution(args).projection;
}

export function nflPlayerPropsCoherentPosteriorDistribution(args: {
  market: string;
  line: number;
  calibratedOverProbability: number;
  independentProjection: number;
}): { projection: number; range: NflPlayerPropsProjectionRange } {
  if (!artifact.markets[args.market] || !Number.isFinite(args.line)
    || !Number.isFinite(args.independentProjection)
    || !Number.isFinite(args.calibratedOverProbability)
    || args.calibratedOverProbability <= 0 || args.calibratedOverProbability >= 1) {
    throw new Error("NFL props market-coherent projection input is invalid.");
  }
  // Select the empirically calibrated residual family once from the independent
  // sports-model point. Re-selecting a mean bucket while inverse-solving can
  // splice different distributions and make the displayed point oppose the
  // probability that was graded.
  const residuals = selectEmpiricalDistribution(
    artifact.markets[args.market]!.distribution,
    args.independentProjection,
  ).residualQuantiles;
  const location = args.line
    - empiricalInterpolatedQuantile(residuals, 1 - args.calibratedOverProbability);
  const projection = Math.max(0, location + empiricalInterpolatedQuantile(residuals, 0.5));
  return {
    projection,
    range: {
      lower: Math.max(0, location + empiricalInterpolatedQuantile(residuals, 0.1)),
      upper: Math.max(0, location + empiricalInterpolatedQuantile(residuals, 0.9)),
      centralCoverage: 0.8,
      source: "empirical_residual_distribution",
    },
  };
}

export function nflPlayerPropsPassingYardsWatchlistEligible(args: {
  market: string;
  commonHolds: string[];
  primaryTarget: boolean;
  independentMarketBooks: number;
  divergenceImplausible: boolean;
  movement: NflPlayerPropsMarketMovement;
  expectedValue: number;
  probabilityEdge: number;
}): boolean {
  return args.market === "passing_yards"
    && args.commonHolds.length === 0
    && args.primaryTarget
    && args.independentMarketBooks > 0
    && !args.divergenceImplausible
    && args.movement !== "adverse"
    && args.expectedValue >= 0
    && args.probabilityEdge >= 0;
}

export function nflPlayerPropsProductionMarketLane(market: string): RuntimeArtifact["decision"]["marketLanes"][string] | undefined {
  return artifact.decision.marketLanes[market];
}

export function nflPlayerPropsSameBookMovement(
  offer: NflPlayerPropsExactOffer,
  side: "over" | "under",
): NflPlayerPropsMarketMovement {
  if (offer.openingLine === null || offer.openingObservedAt === null) return "neutral";
  const openingPrice = side === "over" ? offer.openingOverPrice : offer.openingUnderPrice;
  const currentPrice = side === "over" ? offer.overPrice : offer.underPrice;
  const lineDirection = side === "over"
    ? Math.sign(offer.line - offer.openingLine)
    : Math.sign(offer.openingLine - offer.line);
  const priceDelta = openingPrice !== null && currentPrice !== null
    ? impliedProbability(currentPrice) - impliedProbability(openingPrice)
    : 0;
  // A price-only twitch is not a sharp signal. Require 2.5 implied-probability
  // points before price movement alone can lower a threshold or cap a play.
  const priceDirection = priceDelta >= NFL_PLAYER_PROPS_MATERIAL_PRICE_MOVEMENT_PP
    ? 1
    : priceDelta <= -NFL_PLAYER_PROPS_MATERIAL_PRICE_MOVEMENT_PP
      ? -1
      : 0;
  if (lineDirection > 0) return priceDirection < 0 ? "neutral" : "support";
  if (lineDirection < 0) return "adverse";
  if (priceDirection > 0) return "support";
  if (priceDirection < 0) return "adverse";
  return "neutral";
}

export function gradeNflPlayerPropsCrossMarketCandidate(args: {
  commonHolds: string[];
  independentBooks: number;
  divergenceImplausible: boolean;
  eligibleSide: boolean;
  marketResidualQualified: boolean;
  bestAngleEnabled: boolean;
  leanEnabled: boolean;
  watchlistEnabled: boolean;
  expectedValue: number;
  probabilityEdge: number;
  participationProbability: number;
  movement: NflPlayerPropsMarketMovement;
  leanThresholds: GradeThresholds;
  bestAngleThresholds: GradeThresholds;
}): NflPlayerPropsGrade {
  if (args.commonHolds.length) return "Held";
  if (args.independentBooks === 0 || args.divergenceImplausible) return "No Play";
  const coherent = args.eligibleSide && args.marketResidualQualified;
  if (args.movement !== "adverse" && coherent && args.bestAngleEnabled
    && meetsGradeThresholds(args, args.bestAngleThresholds)) return "Best Angle";
  if (args.movement !== "adverse" && coherent && args.leanEnabled
    && meetsGradeThresholds(args, args.leanThresholds)) return "Lean";
  if (coherent && args.watchlistEnabled && args.expectedValue >= 0 && args.probabilityEdge >= 0) return "Watchlist";
  return "No Play";
}

export function gradeNflPlayerPropsTouchdownCandidate(args: {
  commonHolds: string[];
  independentBooks: number;
  sharpReferenceBooks: number;
  americanPrice: number;
  expectedValue: number;
  probabilityEdge: number;
  participationProbability: number;
}): NflPlayerPropsGrade {
  if (args.commonHolds.length) return "Held";
  if (args.independentBooks === 0) return "No Play";
  const priceEligible = args.americanPrice >= artifact.decision.touchdown.minimumAmericanPrice;
  if (priceEligible && args.sharpReferenceBooks > 0 && NFL_PLAYER_PROPS_TOUCHDOWN_SHARP_REFERENCE_ACTIONABLE
    && meetsGradeThresholds(args, artifact.decision.touchdown.bestAngle)) return "Best Angle";
  if (priceEligible && args.sharpReferenceBooks > 0 && NFL_PLAYER_PROPS_TOUCHDOWN_SHARP_REFERENCE_ACTIONABLE
    && meetsGradeThresholds(args, {
      ...artifact.decision.touchdown.lean,
      minimumIndependentBooks: artifact.decision.touchdown.lean.minimumIndependentBooks ?? 1,
    })) return "Lean";
  if (priceEligible && args.expectedValue >= 0 && args.probabilityEdge >= 0) return "Watchlist";
  return "No Play";
}

function meetsGradeThresholds(
  values: Pick<Parameters<typeof gradeNflPlayerPropsCrossMarketCandidate>[0],
    "expectedValue" | "probabilityEdge" | "participationProbability" | "independentBooks">,
  thresholds: GradeThresholds,
): boolean {
  return values.expectedValue >= thresholds.minimumEv
    && values.probabilityEdge >= thresholds.minimumProbabilityEdge
    && values.participationProbability >= thresholds.minimumParticipationProbability
    && values.independentBooks >= thresholds.minimumIndependentBooks;
}

export function nflPlayerPropsRawMarketDivergenceImplausible(raw: number, market: number): boolean {
  return Math.abs(raw - market) > NFL_PLAYER_PROPS_MAXIMUM_RAW_MARKET_DIVERGENCE;
}

function selectEmpiricalDistribution(distribution: Distribution, projection: number): EmpiricalDistribution {
  if (distribution.family === "empirical_residual") return distribution;
  return distribution.buckets.find((bucket) => bucket.lower <= projection && projection <= bucket.upper)?.distribution
    ?? distribution.fallback;
}

function empiricalQuantile(values: number[], probability: number): number {
  if (values.length === 0) throw new Error("NFL props empirical residual distribution is empty.");
  const index = Math.min(values.length - 1, Math.max(0, Math.round(probability * (values.length - 1))));
  return values[index]!;
}

function empiricalInterpolatedQuantile(values: number[], probability: number): number {
  if (values.length === 0) throw new Error("NFL props empirical residual distribution is empty.");
  const clipped = clamp(probability, 0, 1);
  const position = clipped * (values.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return values[lower]!;
  const weight = position - lower;
  return values[lower]! * (1 - weight) + values[upper]! * weight;
}

function empiricalOverProbability(values: number[], targetResidual: number): number {
  if (values.length === 0) throw new Error("NFL props empirical residual distribution is empty.");
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! <= targetResidual) low = middle + 1;
    else high = middle;
  }
  return 1 - low / values.length;
}

function buildForecastContext(
  feature: NflPlayerPropsRuntimeFeatureRow,
  market: NflPlayerPropMarket,
): NflPlayerPropsForecastContext {
  const marketConfig: Record<string, {
    production: [string, string, NflPlayerPropsForecastMetric["format"]];
    opportunity: Array<[string, string, NflPlayerPropsForecastMetric["format"]]>;
    opponent: [string, string, NflPlayerPropsForecastMetric["format"]];
  }> = {
    passing_attempts: {
      production: ["Recent pass attempts", "prior_passing_attempts_ewm", "count"],
      opportunity: [["Team pass attempts", "prior_team_pass_attempts_ewm", "count"], ["Player pass share", "prior_pass_attempt_share_ewm", "percent"]],
      opponent: ["Opponent pass attempts allowed", "prior_opponent_allowed_pass_attempts_ewm", "count"],
    },
    passing_completions: {
      production: ["Recent completions", "prior_passing_completions_ewm", "count"],
      opportunity: [["Recent pass attempts", "prior_passing_attempts_ewm", "count"], ["Team pass attempts", "prior_team_pass_attempts_ewm", "count"]],
      opponent: ["Opponent completions allowed", "prior_opponent_allowed_completions_ewm", "count"],
    },
    passing_yards: {
      production: ["Recent passing yards", "prior_passing_yards_ewm", "yards"],
      opportunity: [["Recent pass attempts", "prior_passing_attempts_ewm", "count"], ["Team pass attempts", "prior_team_pass_attempts_ewm", "count"]],
      opponent: ["Opponent passing yards allowed", "prior_opponent_allowed_passing_yards_ewm", "yards"],
    },
    rushing_attempts: {
      production: ["Recent carries", "prior_rushing_attempts_ewm", "count"],
      opportunity: [["Rush-attempt share", "prior_rush_attempt_share_ewm", "percent"], ["Offensive snap share", "prior_offense_snap_pct_ewm", "percent"]],
      opponent: ["Opponent rush attempts allowed", "prior_opponent_allowed_rush_attempts_ewm", "count"],
    },
    rushing_yards: {
      production: ["Recent rushing yards", "prior_rushing_yards_ewm", "yards"],
      opportunity: [["Recent carries", "prior_rushing_attempts_ewm", "count"], ["Rush-attempt share", "prior_rush_attempt_share_ewm", "percent"], ["Offensive snap share", "prior_offense_snap_pct_ewm", "percent"]],
      opponent: ["Opponent rushing yards allowed", "prior_opponent_allowed_rushing_yards_ewm", "yards"],
    },
    receptions: {
      production: ["Recent receptions", "prior_receptions_ewm", "count"],
      opportunity: [["Recent targets", "prior_targets_ewm", "count"], ["Target share", "prior_target_share_ewm", "percent"], ["Offensive snap share", "prior_offense_snap_pct_ewm", "percent"]],
      opponent: ["Opponent targets allowed", "prior_opponent_allowed_targets_ewm", "count"],
    },
    receiving_yards: {
      production: ["Recent receiving yards", "prior_receiving_yards_ewm", "yards"],
      opportunity: [["Recent targets", "prior_targets_ewm", "count"], ["Target share", "prior_target_share_ewm", "percent"], ["Offensive snap share", "prior_offense_snap_pct_ewm", "percent"]],
      opponent: ["Opponent targets allowed", "prior_opponent_allowed_targets_ewm", "count"],
    },
    anytime_td: {
      production: ["Recent touchdown rate", "prior_anytime_td_ewm", "percent"],
      opportunity: [["Red-zone opportunities", "prior_redzone_opportunity_ewm", "count"], ["Goal-line opportunities", "prior_goal_line_opportunity_ewm", "count"], ["Offensive snap share", "prior_offense_snap_pct_ewm", "percent"]],
      opponent: ["Opponent touchdowns allowed", "prior_opponent_td_allowed_avg5", "count"],
    },
  };
  const config = marketConfig[market];
  const metric = (definition: [string, string, NflPlayerPropsForecastMetric["format"]]): NflPlayerPropsForecastMetric | null => {
    const value = feature.features[definition[1]];
    return value === null || value === undefined ? null : { label: definition[0], value, format: definition[2] };
  };
  const trend = (definition: [string, string, NflPlayerPropsForecastMetric["format"]]): NflPlayerPropsForecastTrend | null => {
    const base = definition[1].replace(/_(?:lag1|avg3|avg5|ewm)$/, "");
    const candidates: Array<[NflPlayerPropsForecastTrendPoint["window"], string]> = [
      ["last_game", `${base}_lag1`],
      ["last_3_average", `${base}_avg3`],
      ["last_5_average", `${base}_avg5`],
      ["model_weighted", `${base}_ewm`],
    ];
    const points = candidates.flatMap(([window, featureName]) => {
      const value = feature.features[featureName];
      return value === null || value === undefined ? [] : [{ window, value, modelInput: true as const }];
    });
    return points.length ? { label: definition[0], format: definition[2], source: "timestamped_model_feature", points } : null;
  };
  return {
    featureAsOf: feature.featureAsOf,
    position: feature.position,
    expectedQuarterback: feature.expectedQuarterback,
    availability: feature.availability,
    teamImpliedPoints: feature.teamImpliedPoints,
    teamImpliedTouchdowns: feature.teamImpliedTouchdowns,
    recentProduction: config ? metric(config.production) : null,
    roleOpportunity: config ? config.opportunity.map(metric).filter((value): value is NflPlayerPropsForecastMetric => value !== null) : [],
    opponentAllowance: config ? metric(config.opponent) : null,
    modelInputTrends: config ? [config.production, ...config.opportunity, config.opponent].map(trend).filter((value): value is NflPlayerPropsForecastTrend => value !== null) : [],
  };
}
function compareDecision(first: NflPlayerPropsRuntimeDecision, second: NflPlayerPropsRuntimeDecision): number {
  return first.gameId.localeCompare(second.gameId) || first.playerName.localeCompare(second.playerName)
    || first.market.localeCompare(second.market) || first.line - second.line || first.side.localeCompare(second.side);
}
