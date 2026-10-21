import { createHash } from "node:crypto";

import frozenArtifactJson from "./fixtures/nbaPlayerPropsFrozenRuntimeArtifact.json";
import {
  NBA_PLAYER_PROPS_FOUNDATION_MARKETS,
  type NbaPlayerPropMarket,
  type NbaPlayerPropPriceObservation,
} from "./nbaPlayerPropsContract";
import {
  projectNbaPlayerPropsIndependent,
  type NbaPlayerPropsIndependentResearchModel,
} from "./nbaPlayerPropsIndependentModel";
import {
  buildNbaPlayerPropsMarketEvidence,
  selectNbaPlayerPropsCurrentCanonicalOfferSets,
} from "./nbaPlayerPropsMarketEvidence";
import type { NbaPlayerPropFeatureRow } from "./nbaPlayerPropsPointInTimeFeatures";
import type { NbaPlayerPropsMemberGrade } from "./nbaPlayerPropsProductContract";

export const NBA_PLAYER_PROPS_FROZEN_RUNTIME_RELEASE =
  "nba_player_props_frozen_runtime_artifact_2026_10_21_r1_private_forward" as const;
export const NBA_PLAYER_PROPS_FORWARD_DECISION_RELEASE =
  "nba_player_props_forward_decision_2026_10_21_r1_private_disabled" as const;

type FoundationMarket = (typeof NBA_PLAYER_PROPS_FOUNDATION_MARKETS)[number];
type Component = "points" | "rebounds" | "assists" | "threes";
type Side = "over" | "under";
type SignalFamily =
  | "raw_model_probability"
  | "projection_distance"
  | "target_excluded_probability"
  | "target_price_probability"
  | "market_consensus"
  | "model_market_consensus"
  | "target_excluded_expected_value"
  | "model_market_conservative_expected_value"
  | "model_market_average_expected_value";
type EligibilityGate =
  | "all"
  | "established_role"
  | "not_back_to_back"
  | "established_role_not_back_to_back"
  | "over_only"
  | "under_only"
  | "established_role_over"
  | "established_role_under";
type MinuteRegression = Readonly<{
  features: readonly string[];
  means: readonly number[];
  scales: readonly number[];
  coefficients: readonly number[];
  lambda: number;
}>;
type StructuralCountModel = Readonly<{
  component: Component;
  transform: "identity" | "log1p";
  features: readonly string[];
  means: readonly number[];
  scales: readonly number[];
  coefficients: readonly number[];
  lambda: number;
}>;
type ReliabilityModel = Readonly<{
  features: readonly string[];
  means: readonly number[];
  scales: readonly number[];
  coefficients: readonly number[];
}>;

type FrozenArtifact = Readonly<{
  release: typeof NBA_PLAYER_PROPS_FROZEN_RUNTIME_RELEASE;
  publicEnabled: false;
  sourceInputsSha256: string;
  sourceTournamentRelease: string;
  sourceGradeRelease: string;
  payloadSha256: string;
  selectedByMarket: Readonly<Record<FoundationMarket, string>>;
  underlyingByMarket: Readonly<Record<FoundationMarket, string>>;
  candidateMarketMinimumDistance: Readonly<Record<FoundationMarket, number | null>>;
  exactPriceArbitrationMinimumDistance: Readonly<Record<FoundationMarket, number | null>>;
  ridgeModel: NbaPlayerPropsIndependentResearchModel;
  minuteModel: MinuteRegression;
  structuralDirectModels: Readonly<Record<Component, StructuralCountModel>>;
  structuralLogModels: Readonly<Record<Component, StructuralCountModel>>;
  opportunityModels: Readonly<Record<Component, StructuralCountModel>>;
  distributions: Readonly<Record<FoundationMarket, Readonly<{ bias: number; standardDeviation: number }>>>;
  reliabilityModels: Readonly<Record<FoundationMarket, ReliabilityModel>>;
  gradePolicies: Readonly<Record<FoundationMarket, Readonly<{
    kind: "ranked" | "threshold_relative_best" | "slate_relative_lean";
    policy: Readonly<Record<string, unknown>>;
    bestAngleQualified?: boolean;
    publicQualified?: false;
    relativeBest?: Readonly<{ signalFamily: SignalFamily; threshold: number }> | null;
  }>>>;
}>;

export type NbaPlayerPropsForwardDecision = Readonly<{
  release: typeof NBA_PLAYER_PROPS_FORWARD_DECISION_RELEASE;
  modelRelease: string;
  calibrationRelease: string;
  decisionRelease: typeof NBA_PLAYER_PROPS_FORWARD_DECISION_RELEASE;
  publicEnabled: false;
  scopeKey: string;
  gameId: number;
  playerId: number;
  playerName: string | null;
  teamId: number;
  opponentTeamId: number;
  market: FoundationMarket;
  line: number;
  independentProjection: number;
  finalProjection: number;
  independentSide: Side;
  side: Side;
  rawProbability: number;
  independentProbability: number;
  probability: number;
  sportsbook: string;
  americanPrice: number;
  expectedValue: number;
  targetExcludedProbability: number;
  targetExcludedBooks: number;
  targetExcludedReferenceBooks: number;
  marketEvidenceMode: "target_excluded_arbitration" | "candidate_projection";
  grade: NbaPlayerPropsMemberGrade;
  gradePolicySource:
    | "points_ungated_ranked"
    | "assists_role_stable_ranked"
    | "pra_relative_best"
    | "universal_market_relative_lean"
    | "combo_market_relative_lean"
    | "forward_only_market_relative_lean"
    | "forecast_only";
  evidenceObservedAt: string;
}>;

type ScoredDecision = NbaPlayerPropsForwardDecision & Readonly<{
  slateDate: string;
  projectionStandardDeviation: number;
  playerGamesPrior: number;
  minutesStandardDeviation10: number | null;
  teamBackToBack: boolean;
}>;

const COMPONENTS: Readonly<Record<FoundationMarket, readonly Component[]>> = {
  points: ["points"],
  rebounds: ["rebounds"],
  assists: ["assists"],
  threes: ["threes"],
  points_rebounds_assists: ["points", "rebounds", "assists"],
  points_rebounds: ["points", "rebounds"],
  points_assists: ["points", "assists"],
  rebounds_assists: ["rebounds", "assists"],
};

let validatedArtifact: FrozenArtifact | null = null;

export function nbaPlayerPropsFrozenRuntimeArtifact(): FrozenArtifact {
  if (validatedArtifact) return validatedArtifact;
  const artifact = frozenArtifactJson as unknown as FrozenArtifact;
  if (artifact.release !== NBA_PLAYER_PROPS_FROZEN_RUNTIME_RELEASE || artifact.publicEnabled !== false) {
    throw new Error("NBA props frozen runtime artifact release or public gate is invalid.");
  }
  const { payloadSha256, ...payload } = artifact;
  const actual = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  if (actual !== payloadSha256) throw new Error("NBA props frozen runtime artifact checksum mismatch.");
  for (const market of NBA_PLAYER_PROPS_FOUNDATION_MARKETS) {
    if (!artifact.selectedByMarket[market] || !artifact.underlyingByMarket[market]
      || !artifact.distributions[market] || !artifact.reliabilityModels[market]
      || !artifact.gradePolicies[market]) {
      throw new Error(`NBA props frozen runtime artifact is incomplete for ${market}.`);
    }
  }
  validatedArtifact = artifact;
  return artifact;
}

/** Scores the complete private slate without fitting, mutating, or publishing a model. */
export function buildNbaPlayerPropsForwardDecisions(args: {
  features: readonly NbaPlayerPropFeatureRow[];
  observations: readonly NbaPlayerPropPriceObservation[];
  evaluatedAt?: string;
}): NbaPlayerPropsForwardDecision[] {
  const artifact = nbaPlayerPropsFrozenRuntimeArtifact();
  const offers = selectNbaPlayerPropsCurrentCanonicalOfferSets(args.observations);
  const historyByScope = groupBy(args.observations, marketScopeKey);
  const featureByScope = new Map(args.features.map((row) => [`${row.game_id}|${row.player_id}`, row]));
  const scored: ScoredDecision[] = [];
  for (const offer of offers) {
    const [gameIdText, playerIdText, marketText] = offer.scopeKey.split("|");
    const market = marketText as FoundationMarket;
    if (!isFoundationMarket(market)) continue;
    const gameId = Number(String(gameIdText).replace(/^.*:/, ""));
    const playerId = Number(String(playerIdText).replace(/^.*:/, ""));
    const feature = featureByScope.get(`${gameId}|${playerId}`);
    if (!feature) continue;
    const independentProjection = projectUnderlying(feature, market, artifact);
    const resolved = resolveFinalProjection({
      offer,
      independentProjection,
      selectedCandidate: artifact.selectedByMarket[market],
      candidateMinimumMarketDistance: artifact.candidateMarketMinimumDistance[market],
      exactPriceMinimumMarketDistance: artifact.exactPriceArbitrationMinimumDistance[market],
      historyObservations: historyByScope.get(offer.scopeKey) ?? offer.observations,
      evaluatedAt: args.evaluatedAt,
    });
    if (!resolved) continue;
    const { target, finalProjection, evidence, mode } = resolved;
    const independentSide: Side = independentProjection > offer.canonicalLine ? "over" : "under";
    const side: Side = finalProjection > offer.canonicalLine ? "over" : "under";
    const distribution = artifact.distributions[market];
    const probabilityOver = residualProbabilityOver({
      line: offer.canonicalLine,
      projection: finalProjection,
      bias: distribution.bias,
      standardDeviation: distribution.standardDeviation,
    });
    const rawProbability = side === "over" ? probabilityOver : 1 - probabilityOver;
    const independentProbabilityOver = residualProbabilityOver({
      line: offer.canonicalLine,
      projection: independentProjection,
      bias: distribution.bias,
      standardDeviation: distribution.standardDeviation,
    });
    const independentProbability = independentSide === "over"
      ? independentProbabilityOver
      : 1 - independentProbabilityOver;
    const targetExcludedProbability = side === "over"
      ? evidence.targetExcludedOverProbability!
      : 1 - evidence.targetExcludedOverProbability!;
    const probability = reliabilityProbability({
      model: artifact.reliabilityModels[market],
      rawProbability,
      finalProjection,
      independentProjection,
      line: offer.canonicalLine,
      standardDeviation: distribution.standardDeviation,
      targetExcludedProbability,
      targetPriceProbability: implied(target.americanPrice),
      referenceBookConfirmation: evidence.targetExcludedReferenceBooks > 0,
    });
    const base: ScoredDecision = {
      release: NBA_PLAYER_PROPS_FORWARD_DECISION_RELEASE,
      modelRelease: artifact.sourceTournamentRelease,
      calibrationRelease: artifact.sourceGradeRelease,
      decisionRelease: NBA_PLAYER_PROPS_FORWARD_DECISION_RELEASE,
      publicEnabled: false,
      scopeKey: offer.scopeKey,
      gameId,
      playerId,
      playerName: feature.player_name,
      teamId: feature.team_id,
      opponentTeamId: feature.opponent_team_id,
      market,
      line: offer.canonicalLine,
      independentProjection,
      finalProjection,
      independentSide,
      side,
      rawProbability,
      independentProbability,
      probability,
      sportsbook: target.sportsbook,
      americanPrice: target.americanPrice,
      expectedValue: expectedValue(probability, target.americanPrice),
      targetExcludedProbability,
      targetExcludedBooks: evidence.targetExcludedBooks,
      targetExcludedReferenceBooks: evidence.targetExcludedReferenceBooks,
      marketEvidenceMode: mode,
      grade: "No Play",
      gradePolicySource: "forecast_only",
      evidenceObservedAt: evidence.evidenceObservedAt,
      slateDate: easternDate(feature.feature_cutoff),
      projectionStandardDeviation: distribution.standardDeviation,
      playerGamesPrior: feature.player_games_prior,
      minutesStandardDeviation10: feature.minutes_sd_10,
      teamBackToBack: feature.team_back_to_back === 1,
    };
    scored.push(applyDirectGrade(base, artifact));
  }
  return applySlateRelativeGrades(scored, artifact).map(({ projectionStandardDeviation,
    playerGamesPrior, minutesStandardDeviation10, teamBackToBack, slateDate, ...row }) => {
    void projectionStandardDeviation;
    void playerGamesPrior;
    void minutesStandardDeviation10;
    void teamBackToBack;
    void slateDate;
    return {
      ...row,
      independentProjection: round(row.independentProjection, 3),
      finalProjection: round(row.finalProjection, 3),
      rawProbability: round(row.rawProbability, 6),
      independentProbability: round(row.independentProbability, 6),
      probability: round(row.probability, 6),
      expectedValue: round(row.expectedValue, 6),
      targetExcludedProbability: round(row.targetExcludedProbability, 6),
    };
  });
}

function projectUnderlying(row: NbaPlayerPropFeatureRow, market: FoundationMarket, artifact: FrozenArtifact): number {
  const underlying = artifact.underlyingByMarket[market];
  if (underlying === "ridge_r2_minutes_regression") {
    const base = projectNbaPlayerPropsIndependent(row, artifact.ridgeModel);
    if (base.conditionalMinutes <= 0) return base.combinations[market];
    return Math.max(0, (base.combinations[market] / base.conditionalMinutes) * predictMinutes(row, artifact.minuteModel));
  }
  const models = underlying === "structural_log_counts"
    ? artifact.structuralLogModels
    : underlying === "opportunity_direct_counts"
      ? artifact.opportunityModels
      : artifact.structuralDirectModels;
  return COMPONENTS[market].reduce((sum, component) =>
    sum + predictStructural(row, models[component], artifact.minuteModel), 0);
}

function resolveFinalProjection(args: {
  offer: ReturnType<typeof selectNbaPlayerPropsCurrentCanonicalOfferSets>[number];
  independentProjection: number;
  selectedCandidate: string;
  candidateMinimumMarketDistance: number | null;
  exactPriceMinimumMarketDistance: number | null;
  historyObservations: readonly NbaPlayerPropPriceObservation[];
  evaluatedAt?: string;
}) {
  const independentSide: Side = args.independentProjection > args.offer.canonicalLine ? "over" : "under";
  const usesCandidateMarketRead = args.selectedCandidate.includes("market_read") || args.selectedCandidate.includes("fanduel_");
  const candidateMarketOver = usesCandidateMarketRead
    ? selectedMarketProbability(args.offer.observations, args.selectedCandidate)
    : null;
  const candidateMarketDistance = candidateMarketOver === null ? 0 : Math.abs(candidateMarketOver - 0.5);
  const candidateThreshold = args.candidateMinimumMarketDistance ?? Infinity;
  const candidateSide: Side = candidateMarketOver !== null && candidateMarketDistance >= candidateThreshold
    ? candidateMarketOver > 0.5 ? "over" : "under"
    : independentSide;
  const distance = Math.max(0.05, Math.abs(args.independentProjection - args.offer.canonicalLine));
  const candidateProjection = candidateSide === independentSide
    ? args.independentProjection
    : Math.max(0, args.offer.canonicalLine + (candidateSide === "over" ? distance : -distance));
  const exactArbitration = args.exactPriceMinimumMarketDistance === null
    ? null
    : resolveTargetExcludedArbitration({
      offer: args.offer,
      independentProjection: args.independentProjection,
      minimumMarketDistance: args.exactPriceMinimumMarketDistance,
      historyObservations: args.historyObservations,
      evaluatedAt: args.evaluatedAt,
    });
  if (exactArbitration) return exactArbitration;
  const desired = candidateSide;
  const target = args.offer.observations
    .filter((row) => row.side === desired)
    .sort((left, right) => right.americanPrice - left.americanPrice)[0];
  if (!target) return null;
  const evidence = buildNbaPlayerPropsMarketEvidence({
    target,
    observations: args.historyObservations,
    evaluatedAt: args.evaluatedAt ?? target.observedAt,
  });
  if (evidence.targetExcludedOverProbability === null || evidence.targetExcludedBooks < 1) return null;
  return {
    target,
    evidence,
    finalProjection: candidateProjection,
    mode: "candidate_projection" as const,
  };
}

function resolveTargetExcludedArbitration(args: {
  offer: ReturnType<typeof selectNbaPlayerPropsCurrentCanonicalOfferSets>[number];
  independentProjection: number;
  minimumMarketDistance: number;
  historyObservations: readonly NbaPlayerPropPriceObservation[];
  evaluatedAt?: string;
}) {
  const independentSide: Side = args.independentProjection > args.offer.canonicalLine ? "over" : "under";
  let side = independentSide;
  let lastBook = "";
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const target = args.offer.observations
      .filter((row) => row.side === side)
      .sort((left, right) => right.americanPrice - left.americanPrice)[0];
    if (!target) return null;
    const evidence = buildNbaPlayerPropsMarketEvidence({
      target,
      observations: args.historyObservations,
      evaluatedAt: args.evaluatedAt ?? target.observedAt,
    });
    if (evidence.targetExcludedOverProbability === null || evidence.targetExcludedBooks < 1) return null;
    const marketDistance = Math.abs(evidence.targetExcludedOverProbability - 0.5);
    const desired: Side = marketDistance >= args.minimumMarketDistance
      ? evidence.targetExcludedOverProbability > 0.5 ? "over" : "under"
      : independentSide;
    if (desired === side) {
      const distance = Math.max(0.05, Math.abs(args.independentProjection - args.offer.canonicalLine));
      return {
        target,
        evidence,
        finalProjection: Math.max(0, args.offer.canonicalLine + (side === "over" ? distance : -distance)),
        mode: "target_excluded_arbitration" as const,
      };
    }
    const targetBook = normalizeBook(target.sportsbook);
    if (targetBook === lastBook) return null;
    lastBook = targetBook;
    side = desired;
  }
  return null;
}

function selectedMarketProbability(rows: readonly NbaPlayerPropPriceObservation[], selectedCandidate: string): number | null {
  if (selectedCandidate.includes("fanduel_confirmed")) {
    const fanduel = noVigOverForBook(rows, "fanduel");
    if (fanduel === null || fanduel === 0.5) return null;
    const confirmed = [...new Set(rows.map((row) => normalizeBook(row.sportsbook)))]
      .filter((book) => book !== "fanduel")
      .some((book) => {
        const probability = noVigOverForBook(rows, book);
        return probability !== null && (probability > 0.5) === (fanduel > 0.5);
      });
    return confirmed ? fanduel : null;
  }
  if (selectedCandidate.includes("fanduel_read")) return noVigOverForBook(rows, "fanduel");
  return consensusNoVigOver(rows);
}

function applyDirectGrade(row: ScoredDecision, artifact: FrozenArtifact): ScoredDecision {
  const config = artifact.gradePolicies[row.market];
  let grade: NbaPlayerPropsMemberGrade = "No Play";
  let gradePolicySource: ScoredDecision["gradePolicySource"] = "forecast_only";
  if (config.kind === "ranked") {
    const policy = config.policy;
    const eligible = eligibility(row, String(policy.eligibilityGate) as EligibilityGate);
    const score = signal(row, String(policy.signalFamily) as SignalFamily);
    const best = signal(row, String(policy.bestSignalFamily) as SignalFamily);
    const priceQualified = row.americanPrice >= Number(policy.minimumAmericanPrice);
    if (eligible && priceQualified && score >= Number(policy.leanThreshold) && best >= Number(policy.bestThreshold)) {
      grade = config.bestAngleQualified === false ? "Lean" : "Best Angle";
    } else if (eligible && priceQualified && score >= Number(policy.leanThreshold)) grade = "Lean";
    else if (eligible && score >= Number(policy.leanThreshold)) grade = "Watchlist";
    gradePolicySource = row.market === "points" ? "points_ungated_ranked" : "assists_role_stable_ranked";
  } else if (config.kind === "threshold_relative_best") {
    const policy = config.policy;
    if (row.probability >= Number(policy.bestProbability) && row.expectedValue >= Number(policy.bestEv)
      && row.targetExcludedProbability >= Number(policy.bestMarketProbability)
      && row.targetExcludedReferenceBooks >= 1) grade = "Best Angle";
    else if (row.probability >= Number(policy.leanProbability) && row.expectedValue >= Number(policy.leanEv)
      && row.targetExcludedProbability >= Number(policy.leanMarketProbability)
      && (policy.leanRequiresReferenceBook !== true || row.targetExcludedReferenceBooks >= 1)) grade = "Lean";
    else if (row.probability >= Number(policy.watchProbability) && row.expectedValue >= Number(policy.watchEv)) grade = "Watchlist";
    if ((grade === "Best Angle" || grade === "Lean") && config.relativeBest) {
      grade = signal(row, config.relativeBest.signalFamily) >= config.relativeBest.threshold ? "Best Angle" : "Lean";
    }
    gradePolicySource = "pra_relative_best";
  }
  if ((grade === "Best Angle" || grade === "Lean") && row.probability < 0.5) grade = "Watchlist";
  return { ...row, grade, gradePolicySource };
}

function applySlateRelativeGrades(rows: readonly ScoredDecision[], artifact: FrozenArtifact): ScoredDecision[] {
  const selected = new Set<string>();
  for (const market of NBA_PLAYER_PROPS_FOUNDATION_MARKETS) {
    const config = artifact.gradePolicies[market];
    if (config.kind !== "slate_relative_lean") continue;
    const policy = config.policy;
    for (const slateRows of groupBy(rows.filter((row) => row.market === market), (row) => row.slateDate).values()) {
      const candidates = slateRows
        .filter((row) => eligibility(row, String(policy.eligibilityGate) as EligibilityGate))
        .filter((row) => row.probability >= Number(policy.minimumProbability))
        .filter((row) => row.expectedValue >= Number(policy.minimumExpectedValue))
        .filter((row) => row.americanPrice >= Number(policy.minimumAmericanPrice))
        .filter((row) => policy.requireReferenceBook !== true || row.targetExcludedReferenceBooks >= 1)
        .sort((left, right) => signal(right, String(policy.signalFamily) as SignalFamily)
          - signal(left, String(policy.signalFamily) as SignalFamily)
          || right.probability - left.probability
          || right.expectedValue - left.expectedValue
          || left.scopeKey.localeCompare(right.scopeKey));
      for (const row of candidates.slice(0, Number(policy.maxPerSlate))) selected.add(row.scopeKey);
    }
  }
  return rows.map((row) => {
    if (!selected.has(row.scopeKey) || row.grade === "Best Angle" || row.grade === "Lean") return row;
    const source = row.market === "rebounds" ? "universal_market_relative_lean"
      : row.market === "threes" ? "forward_only_market_relative_lean"
        : "combo_market_relative_lean";
    return { ...row, grade: "Lean", gradePolicySource: source };
  });
}

function signal(row: ScoredDecision, family: SignalFamily): number {
  const targetPrice = implied(row.americanPrice);
  if (family === "raw_model_probability") return row.rawProbability;
  if (family === "projection_distance") return Math.abs(row.finalProjection - row.line) / Math.max(0.25, row.projectionStandardDeviation);
  if (family === "target_excluded_probability") return row.targetExcludedProbability;
  if (family === "target_price_probability") return targetPrice;
  if (family === "market_consensus") return (row.targetExcludedProbability + targetPrice) / 2;
  if (family === "model_market_consensus") return (row.rawProbability + row.targetExcludedProbability + targetPrice) / 3;
  if (family === "target_excluded_expected_value") return expectedValue(row.targetExcludedProbability, row.americanPrice);
  const probability = family === "model_market_conservative_expected_value"
    ? Math.min(row.rawProbability, row.targetExcludedProbability)
    : (row.rawProbability + row.targetExcludedProbability) / 2;
  return expectedValue(probability, row.americanPrice);
}

function eligibility(row: ScoredDecision, gate: EligibilityGate): boolean {
  const established = row.playerGamesPrior >= 10 && (row.minutesStandardDeviation10 ?? Infinity) <= 5;
  if (gate === "established_role") return established;
  if (gate === "not_back_to_back") return !row.teamBackToBack;
  if (gate === "established_role_not_back_to_back") return established && !row.teamBackToBack;
  if (gate === "over_only") return row.side === "over";
  if (gate === "under_only") return row.side === "under";
  if (gate === "established_role_over") return established && row.side === "over";
  if (gate === "established_role_under") return established && row.side === "under";
  return true;
}

function reliabilityProbability(args: {
  model: ReliabilityModel;
  rawProbability: number;
  finalProjection: number;
  independentProjection: number;
  line: number;
  standardDeviation: number;
  targetExcludedProbability: number;
  targetPriceProbability: number;
  referenceBookConfirmation: boolean;
}): number {
  const raw = boundedProbability(args.rawProbability);
  const values: Record<string, number> = {
    raw_model_logit: Math.log(raw / (1 - raw)),
    standardized_projection_distance: Math.abs(args.finalProjection - args.line) / Math.max(0.25, args.standardDeviation),
    target_excluded_margin: args.targetExcludedProbability - 0.5,
    target_price_implied_probability: args.targetPriceProbability,
    independent_final_agreement: Number((args.independentProjection > args.line) === (args.finalProjection > args.line)),
    reference_book_confirmation: Number(args.referenceBookConfirmation),
  };
  let logit = args.model.coefficients[0] ?? 0;
  args.model.features.forEach((feature, index) => {
    const value = values[feature] ?? 0;
    logit += (args.model.coefficients[index + 1] ?? 0)
      * ((value - args.model.means[index]!) / args.model.scales[index]!);
  });
  return boundedProbability(1 / (1 + Math.exp(-logit)));
}

function predictMinutes(row: NbaPlayerPropFeatureRow, model: MinuteRegression): number {
  let value = model.coefficients[0] ?? 0;
  model.features.forEach((feature, index) => {
    const raw = numericFeature(row, feature) ?? model.means[index]!;
    value += (model.coefficients[index + 1] ?? 0) * ((raw - model.means[index]!) / model.scales[index]!);
  });
  return Math.max(0, Math.min(48, value));
}

function predictStructural(row: NbaPlayerPropFeatureRow, model: StructuralCountModel, minutes: MinuteRegression): number {
  let value = model.coefficients[0] ?? 0;
  model.features.forEach((feature, index) => {
    const raw = structuralFeature(row, feature, minutes) ?? model.means[index]!;
    value += (model.coefficients[index + 1] ?? 0) * ((raw - model.means[index]!) / model.scales[index]!);
  });
  return Math.max(0, model.transform === "log1p" ? Math.expm1(value) : value);
}

function structuralFeature(row: NbaPlayerPropFeatureRow, feature: string, minuteModel: MinuteRegression): number | null {
  const minutes = predictMinutes(row, minuteModel);
  if (feature === "predicted_minutes") return minutes;
  if (feature === "predicted_rebound_chances") return multiply(row.rebound_chances_per_minute_5, minutes);
  if (feature === "recent_rebound_capture") return ratio(row.rebounds_per_minute_10, row.rebound_chances_per_minute_5, 0, 1);
  if (feature === "predicted_touches") return multiply(row.touches_per_minute_5, minutes);
  if (feature === "predicted_passes") return multiply(row.passes_per_minute_5, minutes);
  if (feature === "assists_per_touch") return ratio(row.assists_per_minute_10, row.touches_per_minute_5, 0, 1);
  if (feature === "assists_per_pass") return ratio(row.assists_per_minute_10, row.passes_per_minute_5, 0, 1);
  if (feature === "predicted_three_attempts") return multiply(row.fg3a_per_minute_10, minutes);
  if (feature === "recent_three_pct") return ratio(row.threes_per_minute_10, row.fg3a_per_minute_10, 0, 0.8);
  if (feature === "opponent_three_factor") return row.opponent_matchup_three_point_pct_5 === null
    ? null : Math.max(0.6, Math.min(1.4, row.opponent_matchup_three_point_pct_5 / 0.36));
  return numericFeature(row, feature);
}

function numericFeature(row: NbaPlayerPropFeatureRow, key: string): number | null {
  const value = (row as unknown as Readonly<Record<string, unknown>>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function noVigOverForBook(rows: readonly NbaPlayerPropPriceObservation[], sportsbook: string): number | null {
  const normalized = normalizeBook(sportsbook);
  const bookRows = rows.filter((row) => normalizeBook(row.sportsbook) === normalized);
  const over = bookRows.find((row) => row.side === "over");
  const under = bookRows.find((row) => row.side === "under");
  if (!over || !under) return null;
  const overImplied = implied(over.americanPrice);
  const underImplied = implied(under.americanPrice);
  return overImplied / (overImplied + underImplied);
}

function consensusNoVigOver(rows: readonly NbaPlayerPropPriceObservation[]): number | null {
  const probabilities = [...new Set(rows.map((row) => normalizeBook(row.sportsbook)))]
    .flatMap((book) => {
      const probability = noVigOverForBook(rows, book);
      return probability === null ? [] : [probability];
    }).sort((left, right) => left - right);
  if (probabilities.length === 0) return null;
  const middle = Math.floor(probabilities.length / 2);
  return probabilities.length % 2 ? probabilities[middle]! : (probabilities[middle - 1]! + probabilities[middle]!) / 2;
}

function residualProbabilityOver(args: { line: number; projection: number; bias: number; standardDeviation: number }): number {
  const z = (args.line - (args.projection + args.bias)) / args.standardDeviation;
  return Math.min(0.995, Math.max(0.005, 1 - normalCdf(z)));
}

function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592)
    * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function expectedValue(probability: number, price: number): number {
  const profit = price > 0 ? price / 100 : 100 / -price;
  return probability * profit - (1 - probability);
}

function implied(price: number): number { return price < 0 ? -price / (-price + 100) : 100 / (price + 100); }
function boundedProbability(value: number): number { return Math.min(0.995, Math.max(0.005, value)); }
function multiply(value: number | null, factor: number): number | null { return value === null ? null : value * factor; }
function ratio(numerator: number | null, denominator: number | null, min: number, max: number): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return Math.max(min, Math.min(max, numerator / denominator));
}
function normalizeBook(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function marketScopeKey(row: NbaPlayerPropPriceObservation): string {
  const player = row.canonicalPlayerId
    ?? (row.providerPlayerId ? `${row.provider}:${row.providerPlayerId}` : normalizeIdentity(row.playerName ?? ""));
  return [row.canonicalGameId, player, row.market].join("|");
}
function normalizeIdentity(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function easternDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}
function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) groups.set(key(value), [...(groups.get(key(value)) ?? []), value]);
  return groups;
}
function round(value: number, digits: number): number { return Number(value.toFixed(digits)); }
function isFoundationMarket(value: NbaPlayerPropMarket): value is FoundationMarket {
  return (NBA_PLAYER_PROPS_FOUNDATION_MARKETS as readonly string[]).includes(value);
}
