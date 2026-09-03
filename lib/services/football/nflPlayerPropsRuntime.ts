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
import type { NflPlayerPropMarket, NflPlayerPropsObservationSnapshot } from "./nflPlayerPropsContract";
import type { NflPlayerPropsInferenceContext } from "./nflPlayerPropsInferenceContext";
import type { NflPlayerPropsExactOffer } from "./nflPlayerPropsMarketBoard";
import {
  buildNflPlayerPropsMarketEvidenceCapture,
  nflPlayerPropsMarketEvidenceId,
  type NflPlayerPropsMarketEvidenceCapture,
} from "./nflPlayerPropsMarketEvidenceCapture";

export const NFL_PLAYER_PROPS_PORTABLE_ARTIFACT_RELEASE =
  "nfl_player_props_runtime_2026_09_01_r4_cross_market_movement" as const;
export const NFL_PLAYER_PROPS_RUNTIME_RELEASE =
  "nfl_player_props_runtime_2026_09_03_r10_forecast_authority" as const;
export const NFL_PLAYER_PROPS_BOARD_RELEASE =
  "nfl_player_props_board_2026_09_03_r13_forecast_authority" as const;
export const NFL_PLAYER_PROPS_DECISION_RELEASE =
  "nfl_player_props_decision_2026_09_03_r10_forecast_authority" as const;
export const NFL_PLAYER_PROPS_MODEL_RELEASE =
  "nfl_player_props_distribution_model_2026_09_03_r7_forecast_authority" as const;
export const NFL_PLAYER_PROPS_CALIBRATION_RELEASE =
  "nfl_player_props_distribution_calibration_2026_09_03_r7_forecast_authority" as const;
export const NFL_PLAYER_PROPS_PASSING_MARKET_RELEASE =
  "nfl_player_props_market_residual_calibration_2026_09_03_r8_single_application" as const;
export const NFL_PLAYER_PROPS_MARKET_COHERENT_PROJECTION_RELEASE =
  "nfl_player_props_market_coherent_projection_2026_09_03_r2_single_distribution" as const;
export const NFL_PLAYER_PROPS_TOUCHDOWN_SHARP_REFERENCE_ACTIONABLE = true as const;
export const NFL_PLAYER_PROPS_QB_PASSING_PROJECTION = {
  release: "nfl_player_props_qb_passing_projection_2026_09_02_r2_target_excluded_consensus",
  minimumBooks: 1,
  marketWeight: 0.9,
  roleWeight: 0.1,
} as const;
export const NFL_PLAYER_PROPS_QB_ROLE_FLOORS = {
  confirmedStarter: 0.9,
  projectedStarter: 0.75,
} as const;
export const NFL_PLAYER_PROPS_MAXIMUM_RAW_MARKET_DIVERGENCE = 0.48 as const;
export const NFL_PLAYER_PROPS_MATERIAL_PRICE_MOVEMENT_PP = 0.025 as const;

type TreeNode = {
  value: number; featureIndex: number; threshold: number; missingGoToLeft: boolean;
  left: number; right: number; isLeaf: boolean;
};
type TreeModel = { kind: "hgb_regressor" | "hgb_classifier"; featureNames: string[]; baseline: number; trees: Array<Array<{ nodes: TreeNode[] }>> };
type LinearModel = { kind: "linear_regressor"; featureNames: string[]; imputer: number[]; means: number[]; scales: number[]; coefficients: number[]; intercept: number };
type PortableModel = TreeModel | LinearModel;
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

const artifact = {
  ...artifactCoreJson,
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
if (artifact.runtimeRelease !== NFL_PLAYER_PROPS_PORTABLE_ARTIFACT_RELEASE) {
  throw new Error("NFL player props runtime artifact release mismatch.");
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
    reportUpdatedAt: string | null; source: "ESPN" | "Playbook" | "BALLDONTLIE";
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

export function nflPlayerPropsExpectedValue(probability: number, americanPrice: number): number {
  const profit = americanPrice < 0 ? 100 / Math.abs(americanPrice) : americanPrice / 100;
  return probability * profit - (1 - probability);
}

export function buildNflPlayerPropsRuntimeFeatureRows(args: {
  snapshot: NflPlayerPropsObservationSnapshot;
  context: NflPlayerPropsInferenceContext;
}): NflPlayerPropsRuntimeFeatureRow[] {
  if (args.context.providerSnapshotGeneratedAt !== args.snapshot.generatedAt) {
    throw new Error("NFL props runtime observation/context identity mismatch.");
  }
  const candidates = new Map<string, { gameId: string; playerName: string; playerTeam: string | null }>();
  for (const row of args.snapshot.observations) {
    const ordinary = artifact.markets[row.market] && row.offerType === "over_under";
    const touchdown = row.market === "anytime_td" && row.offerType === "milestone" && row.line === 0.5;
    if (!row.isOpening && row.canonicalGameId && row.playerName && (ordinary || touchdown)) {
      candidates.set(`${row.canonicalGameId}|${normalizeName(row.playerName)}`, { gameId: row.canonicalGameId, playerName: row.playerName, playerTeam: row.playerTeam });
    }
  }
  const contextByGame = new Map(args.context.games.map((game) => [game.canonicalGameId, game]));
  return [...candidates.values()].map((candidate) => {
    const game = contextByGame.get(candidate.gameId);
    if (!game) throw new Error(`NFL props runtime context is missing ${candidate.gameId}.`);
    const roster = [...game.awayDepth.roster, ...game.homeDepth.roster].find((player) => normalizeName(player.name) === normalizeName(candidate.playerName));
    const injury = game.injuries.teams.flatMap((team) => team.players).find((player) => normalizeName(player.name) === normalizeName(candidate.playerName));
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
    const features: Record<string, number | null> = {};
    for (const name of new Set([...artifact.featureNames, ...artifact.touchdown.featureNames])) features[name] = null;
    mergeNumeric(features, playerState); mergeNumeric(features, artifact.teamStates[team]); mergeNumeric(features, artifact.opponentStates[opponent]);
    features.is_home = Number(team === home);
    for (const position of ["qb", "rb", "fb", "wr", "te"]) features[`position_${position}`] = Number(roster?.position?.toLowerCase() === position);
    features.team_implied_touchdowns = impliedPoints === null ? null : impliedPoints / 7;
    return {
      gameId: candidate.gameId, playerName: candidate.playerName, team, opponent,
      position: roster?.position ?? null, featureAsOf: args.context.capturedAt,
      roleFingerprint: stableRoleFingerprint({ roster, injury }), scoreEligible: holds.length === 0,
      healthHolds: holds, teamImpliedPoints: impliedPoints,
      teamImpliedTouchdowns: features.team_implied_touchdowns, features,
      expectedQuarterback: teamDepth.expectedStartingQuarterback ? {
        name: teamDepth.expectedStartingQuarterback.name,
        starterStatus: teamDepth.starterStatus,
        capturedAt: teamDepth.capturedAt,
      } : null,
      availability: {
        listed: Boolean(injury), status: injury?.status ?? null, detail: injury?.detail ?? null,
        reportedAt: injury?.reportedAt ?? null, reportUpdatedAt: game.injuries.reportUpdatedAt,
        source: game.injuries.source,
      },
    };
  });
}

export function buildNflPlayerPropsRuntimeBoard(args: {
  offers: NflPlayerPropsExactOffer[];
  features: NflPlayerPropsRuntimeFeatureRow[];
  evaluatedAt: string;
  captureMarketEvidence?: boolean;
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
  const passingPrimaryKeys = primaryNflPlayerPropsOfferKeys(freshExact.filter((offer) => offer.market === "passing_yards"));
  const passingMarketGroups = new Map<string, NflPlayerPropsExactOffer[]>();
  for (const offer of freshExact) {
    if (offer.market !== "passing_yards" || offer.offerType !== "over_under" || !passingPrimaryKeys.has(offer.offerKey)) continue;
    const key = crossLineMarketKey(offer);
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
    if (independentBooks === 0) {
      for (const key of outcomeKeys(offer)) unavailableBenchmarkKeys.add(key);
    }
    const scored = scoreNflPlayerPropsRuntimeFeatures(feature.features);
    const commonHolds = [...offer.healthHolds, ...feature.healthHolds];
    const decisionReasons = independentBooks === 0
      ? [...commonHolds, "independent_same_line_confirmation_missing"]
      : commonHolds;
    if (offer.market === "anytime_td") {
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
    const passingProjection = offer.market === "passing_yards"
      ? nflPlayerPropsExpectedStarterPassingProjection({
          feature,
          modeledProjection: scored.projections.passing_yards!,
          offers: passingMarketGroups.get(crossLineMarketKey(offer)) ?? [],
          evaluatedSportsbook: offer.sportsbook,
        })
      : null;
    const projection = passingProjection?.projection ?? scored.projections[offer.market]!;
    const decisionScore = passingProjection ? {
      ...scored,
      participationProbability: nflPlayerPropsStarterAdjustedParticipationProbability(feature, scored.participationProbability),
    } : scored;
    const rawOver = nflPlayerPropsOverProbability(offer.market, projection, offer.line);
    const independentPassingOffers = offer.market === "passing_yards"
      ? (passingMarketGroups.get(crossLineMarketKey(offer)) ?? [])
          .filter((candidate) => normalizeBook(candidate.sportsbook) !== normalizeBook(offer.sportsbook))
      : [];
    const marketOver = offer.market === "passing_yards"
      ? independentPassingOffers.length
        ? averagePresent(independentPassingOffers.map((candidate) => candidate.overNoVigProbability === null ? null : nflPlayerPropsTransportedMarketProbability({
            projection, sourceLine: candidate.line, sourceOverProbability: candidate.overNoVigProbability, targetLine: offer.line,
          })))!
        : rawOver
        : averagePresent(others.map((value) => value.over)) ?? rawOver;
    // The QB point head already incorporates this target-excluded market set.
    // Applying the residual head again would grant the same evidence two votes.
    const finalOver = passingProjection?.evidence
      ? rawOver
      : independentBooks > 0
        ? nflPlayerPropsResidualProbability(rawOver, marketOver, policy.marketResidualWeight)
        : rawOver;
    const posterior = nflPlayerPropsCoherentPosteriorDistribution({
      market: offer.market,
      line: offer.line,
      calibratedOverProbability: finalOver,
      independentProjection: projection,
    });
    const publishedProjection = independentBooks === 0 && !passingProjection?.evidence
      ? projection
      : posterior.projection;
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
      const crossLineIndependentBooks = (passingMarketGroups.get(crossLineMarketKey(offer)) ?? [])
        .filter((candidate) => normalizeBook(candidate.sportsbook) !== normalizeBook(offer.sportsbook)).length;
      const bridgedGrade: NflPlayerPropsGrade = passingProjection && baseGrade === "No Play"
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
  if (model.kind === "linear_regressor") {
    let value = model.intercept;
    for (let index = 0; index < model.featureNames.length; index += 1) {
      const raw = features[model.featureNames[index]!] ?? model.imputer[index]!;
      value += ((raw - model.means[index]!) / model.scales[index]!) * model.coefficients[index]!;
    }
    return value;
  }
  const inputs = model.featureNames.map((name) => features[name] ?? Number.NaN);
  let value = model.baseline;
  for (const iteration of model.trees) for (const tree of iteration) value += predictTree(tree.nodes, inputs);
  return value;
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
  modeledProjection: number;
  offers: NflPlayerPropsExactOffer[];
  evaluatedSportsbook: string;
}): { projection: number; evidence?: NonNullable<NflPlayerPropsRuntimeDecision["projectionEvidence"]> } | null {
  if (args.feature.position?.trim().toLowerCase() !== "qb") return null;
  const quarterback = args.feature.expectedQuarterback;
  if (!quarterback || quarterback.starterStatus === "unknown"
    || normalizeName(quarterback.name) !== normalizeName(args.feature.playerName)) return null;
  const status = args.feature.availability.status?.trim().toLowerCase() ?? "";
  if (["out", "inactive", "injured reserve", "ir", "doubtful"].includes(status)) return null;
  const uniqueBooks = new Map<string, NflPlayerPropsExactOffer>();
  for (const offer of args.offers) {
    if (offer.market !== "passing_yards" || offer.offerType !== "over_under" || offer.overNoVigProbability === null) continue;
    if (normalizeBook(offer.sportsbook) === normalizeBook(args.evaluatedSportsbook)) continue;
    uniqueBooks.set(normalizeBook(offer.sportsbook), offer);
  }
  const roleValues = [
    args.feature.features.prior_passing_yards_avg3,
    args.feature.features.prior_passing_yards_avg5,
    args.feature.features.prior_passing_yards_ewm,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const roleProjection = roleValues.length ? median(roleValues) : args.modeledProjection;
  if (uniqueBooks.size < NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.minimumBooks) {
    return { projection: roleProjection };
  }
  const marketConsensus = median([...uniqueBooks.values()].map((offer) =>
    nflPlayerPropsMarketImpliedCenter({
      referenceProjection: roleProjection,
      line: offer.line,
      overProbability: offer.overNoVigProbability!,
    })));
  const projection = NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.marketWeight * marketConsensus
    + NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.roleWeight * roleProjection;
  return {
    projection,
    evidence: {
      release: NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.release,
      source: "market_dominant_expected_starter",
      marketWeight: NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.marketWeight,
      roleWeight: NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.roleWeight,
      books: uniqueBooks.size,
      marketConsensus,
      roleProjection,
    },
  };
}

export function nflPlayerPropsMarketImpliedCenter(args: {
  referenceProjection: number;
  line: number;
  overProbability: number;
}): number {
  if (!Number.isFinite(args.referenceProjection) || !Number.isFinite(args.line)
    || !Number.isFinite(args.overProbability) || args.overProbability <= 0 || args.overProbability >= 1) {
    throw new Error("NFL props passing market-implied projection input is invalid.");
  }
  const residuals = selectEmpiricalDistribution(artifact.markets.passing_yards!.distribution, args.referenceProjection).residualQuantiles;
  return args.line - empiricalInterpolatedQuantile(residuals, 1 - args.overProbability);
}

export function nflPlayerPropsTransportedMarketProbability(args: {
  projection: number;
  sourceLine: number;
  sourceOverProbability: number;
  targetLine: number;
}): number {
  if (!Number.isFinite(args.projection) || !Number.isFinite(args.sourceLine) || !Number.isFinite(args.targetLine)
    || !Number.isFinite(args.sourceOverProbability) || args.sourceOverProbability <= 0 || args.sourceOverProbability >= 1) {
    throw new Error("NFL props passing cross-line market input is invalid.");
  }
  const residuals = selectEmpiricalDistribution(artifact.markets.passing_yards!.distribution, args.projection).residualQuantiles;
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
