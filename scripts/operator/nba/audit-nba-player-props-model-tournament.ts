/**
 * Offline-only NBA player-props model tournament.
 *
 * Candidate selection, reliability fitting, grade-policy fitting, and final
 * confirmation use separate chronological windows. No production or member
 * writes.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { nbaPlayerPropsArtifactSha256 } from "../../../lib/services/nba/nbaPlayerPropsArtifactChecksum";
import {
  fitNbaPlayerPropsIndependentResearchModel,
  projectNbaPlayerPropsIndependent,
  type NbaPlayerPropCombination,
  type NbaPlayerPropsIndependentResearchModel,
} from "../../../lib/services/nba/nbaPlayerPropsIndependentModel";
import {
  buildNbaPlayerPropsMarketEvidence,
  selectNbaPlayerPropsCanonicalOfferSets,
  type NbaPlayerPropsCanonicalOfferSet,
} from "../../../lib/services/nba/nbaPlayerPropsMarketEvidence";
import type { NbaPlayerPropPriceObservation } from "../../../lib/services/nba/nbaPlayerPropsContract";
import type { NbaPlayerPropFeatureRow } from "../../../lib/services/nba/nbaPlayerPropsPointInTimeFeatures";

type Dataset = {
  release: string;
  mode: "offline_research_only";
  actionable: false;
  games: Array<{ gameId: number; startTime: string }>;
  featureRows: NbaPlayerPropFeatureRow[];
  projectionGames?: Array<{ gameId: number; startTime: string }>;
  projectionFeatureRows?: NbaPlayerPropFeatureRow[];
  projectionPopulation?: string;
  openingObservations: NbaPlayerPropPriceObservation[];
  immutableInputsSha256: string;
};

type Market = NbaPlayerPropCombination;
type CandidateName =
  | "ridge_r2"
  | "ridge_r2_minutes_regression"
  | "ridge_r2_role_minutes_regression"
  | "structural_direct_counts"
  | "structural_log_counts"
  | "opportunity_direct_counts"
  | "opportunity_role_minutes_counts"
  | "robust_component_counts"
  // Retained as explicit research candidates for reproducible rejected-model
  // diagnostics. They are not part of the active tournament candidate list.
  | "learned_market_residual_correction"
  | "role_segmented_independent_experts"
  | "direct_market_counts"
  | "direct_market_log_counts"
  | "bias_corrected_structural_direct_counts"
  | "bias_corrected_structural_log_counts"
  | "bias_corrected_direct_market_counts"
  | "boosted_market_counts"
  | "market_read_all_disagreements"
  | "market_read_2pp_disagreements"
  | "market_read_5pp_disagreements"
  | "fanduel_read_2pp_disagreements"
  | "fanduel_confirmed_2pp_disagreements"
  | "hybrid_market_read_all_disagreements"
  | "hybrid_market_read_2pp_disagreements"
  | "hybrid_market_read_5pp_disagreements"
  | "raw_recent_minutes"
  | "raw_balanced_minutes"
  | "raw_stable_minutes"
  | "hierarchical_recent_minutes"
  | "hierarchical_balanced_minutes"
  | "hierarchical_stable_minutes";

type Candidate = {
  name: CandidateName;
  fit: (rows: readonly NbaPlayerPropFeatureRow[]) => (row: NbaPlayerPropFeatureRow, market: Market) => number;
};

type MinuteFeature = keyof Pick<NbaPlayerPropFeatureRow,
  | "minutes_mean_3"
  | "minutes_mean_5"
  | "minutes_mean_10"
  | "minutes_mean_season"
  | "minutes_sd_10"
  | "minutes_p25_10"
  | "minutes_p75_10"
  | "participation_rate_10"
  | "same_team_games_10"
  | "changed_team_since_last_game"
  | "days_rest"
  | "is_home"
  | "team_back_to_back"
  | "team_rotation_expected_players_5"
  | "team_rotation_expected_top1_minutes_5"
  | "team_rotation_continuity_5"
  | "team_rotation_latest_vs_recent_5"
  | "player_games_prior"
>;

type MinuteRegression = {
  features: MinuteFeature[];
  means: number[];
  scales: number[];
  coefficients: number[];
  lambda: number;
};

type Component = "points" | "rebounds" | "assists" | "threes";
type StructuralFeature =
  | "predicted_minutes"
  | "predicted_rebound_chances"
  | "recent_rebound_capture"
  | "predicted_touches"
  | "predicted_passes"
  | "assists_per_touch"
  | "assists_per_pass"
  | "predicted_three_attempts"
  | "recent_three_pct"
  | "opponent_three_factor"
  | keyof Pick<NbaPlayerPropFeatureRow,
  | "minutes_sd_10"
  | "player_games_prior"
  | "days_rest"
  | "is_home"
  | "team_back_to_back"
  | "opponent_rest_days"
  | "points_per_minute_10"
  | "rebounds_per_minute_10"
  | "rebounds_per_minute_20"
  | "rebounds_per_minute_season"
  | "assists_per_minute_10"
  | "assists_per_minute_20"
  | "assists_per_minute_season"
  | "threes_per_minute_10"
  | "threes_per_minute_20"
  | "threes_per_minute_season"
  | "fga_per_minute_10"
  | "fg3a_per_minute_10"
  | "fg3a_per_minute_20"
  | "fg3a_per_minute_season"
  | "fta_per_minute_10"
  | "usage_mean_5"
  | "touches_per_minute_5"
  | "passes_per_minute_5"
  | "rebound_chances_per_minute_5"
  | "rebound_chances_off_per_minute_5"
  | "rebound_chances_def_per_minute_5"
  | "rebound_capture_rate_5"
  | "offensive_rebound_percentage_mean_5"
  | "defensive_rebound_percentage_mean_5"
  | "fg3_percentage_10"
  | "fg3_percentage_20"
  | "fg3_percentage_season"
  | "three_point_attempt_share_mean_5"
  | "true_shooting_mean_5"
  | "assist_percentage_mean_5"
  | "points_share_mean_5"
  | "fga_share_mean_5"
  | "game_pace_mean_5"
  | "game_pace_mean_15"
  | "team_adjusted_offense"
  | "opponent_adjusted_defense"
  | "team_efg_5"
  | "opponent_efg_allowed_5"
  | "team_assist_percentage_5"
  | "opponent_deflections_per100_5"
  | "team_offensive_rebound_rate_5"
  | "opponent_defensive_rebound_percentage_5"
  | "opponent_rebound_chances_per100_5"
  | "opponent_rebound_chances_off_per100_5"
  | "opponent_rebound_chances_def_per100_5"
  | "opponent_offensive_rebound_percentage_5"
  | "team_three_point_attempt_share_5"
  | "opponent_three_point_attempt_share_5"
  | "opponent_matchup_three_point_pct_5"
  | "opponent_contested_shots_per100_5"
  | "minutes_p25_10"
  | "minutes_p75_10"
  | "team_rotation_expected_players_5"
  | "team_rotation_expected_top1_minutes_5"
  | "team_rotation_continuity_5"
  | "team_rotation_latest_vs_recent_5"
>;

type StructuralCountModel = {
  component: Component;
  transform: "identity" | "log1p";
  features: StructuralFeature[];
  means: number[];
  scales: number[];
  coefficients: number[];
  lambda: number;
};

type DirectMarketCountModel = {
  market: Market;
  transform: "identity" | "log1p";
  features: StructuralFeature[];
  means: number[];
  scales: number[];
  coefficients: number[];
  lambda: number;
};

type BoostedStump = {
  feature: StructuralFeature;
  imputation: number;
  threshold: number;
  left: number;
  right: number;
};

type BoostedMarketCountModel = {
  market: Market;
  base: number;
  learningRate: number;
  stumps: BoostedStump[];
};

type Metrics = {
  rows: number;
  games: number;
  pricedRows: number;
  mae: number | null;
  rmse: number | null;
  medianAbsoluteError: number | null;
  bias: number | null;
  directionHitRate: number | null;
  overShare: number | null;
};

type WalkForwardFold = {
  trainGames: number;
  testGames: number;
  testFrom: string | null;
  testThrough: string | null;
  markets: Record<Market, {
    independent: Metrics;
    twoStageMinutes: Metrics;
    structuralDirect: Metrics;
    structuralLog: Metrics;
    opportunityDirect: Metrics;
    marketReadAll: Metrics;
    marketRead2pp: Metrics;
    marketRead5pp: Metrics;
    fanduelRead2pp: Metrics;
    fanduelConfirmed2pp: Metrics;
    hybridMarketReadAll: Metrics;
    hybridMarketRead2pp: Metrics;
    hybridMarketRead5pp: Metrics;
    openingMarket: ReturnType<typeof marketDiagnostic>;
  }>;
};

const MARKETS: Market[] = [
  "points",
  "rebounds",
  "assists",
  "threes",
  "points_rebounds_assists",
  "points_rebounds",
  "points_assists",
  "rebounds_assists",
];

const MINUTES = {
  recent: [0.45, 0.30, 0.15, 0.10] as const,
  balanced: [0.25, 0.30, 0.25, 0.20] as const,
  stable: [0.10, 0.20, 0.30, 0.40] as const,
};

const MINUTE_FEATURES: MinuteFeature[] = [
  "minutes_mean_3",
  "minutes_mean_5",
  "minutes_mean_10",
  "minutes_mean_season",
  "minutes_sd_10",
  "participation_rate_10",
  "same_team_games_10",
  "changed_team_since_last_game",
  "days_rest",
  "is_home",
  "team_back_to_back",
  "player_games_prior",
];

const ROLE_MINUTE_FEATURES: MinuteFeature[] = [
  ...MINUTE_FEATURES,
  "minutes_p25_10",
  "minutes_p75_10",
  "team_rotation_expected_players_5",
  "team_rotation_expected_top1_minutes_5",
  "team_rotation_continuity_5",
  "team_rotation_latest_vs_recent_5",
];

const STRUCTURAL_FEATURES: Record<Component, StructuralFeature[]> = {
  points: [
    "predicted_minutes", "points_per_minute_10", "fga_per_minute_10", "fta_per_minute_10",
    "usage_mean_5", "true_shooting_mean_5", "points_share_mean_5", "fga_share_mean_5",
    "game_pace_mean_5", "team_adjusted_offense", "opponent_adjusted_defense",
    "team_efg_5", "opponent_efg_allowed_5", "minutes_sd_10", "days_rest", "is_home",
  ],
  rebounds: [
    "predicted_minutes", "rebounds_per_minute_10", "rebound_chances_per_minute_5",
    "team_offensive_rebound_rate_5", "opponent_defensive_rebound_percentage_5",
    "opponent_rebound_chances_per100_5", "game_pace_mean_5", "game_pace_mean_15",
    "minutes_sd_10", "player_games_prior", "days_rest", "is_home", "team_back_to_back",
  ],
  assists: [
    "predicted_minutes", "assists_per_minute_10", "touches_per_minute_5", "passes_per_minute_5",
    "assist_percentage_mean_5", "team_assist_percentage_5", "usage_mean_5",
    "opponent_deflections_per100_5", "game_pace_mean_5", "game_pace_mean_15",
    "team_adjusted_offense", "opponent_adjusted_defense", "minutes_sd_10", "player_games_prior",
  ],
  threes: [
    "predicted_minutes", "threes_per_minute_10", "fg3a_per_minute_10", "fga_per_minute_10",
    "true_shooting_mean_5", "team_three_point_attempt_share_5", "opponent_matchup_three_point_pct_5",
    "opponent_contested_shots_per100_5", "game_pace_mean_5", "team_efg_5",
    "opponent_efg_allowed_5", "minutes_sd_10", "player_games_prior", "is_home",
  ],
};

const OPPORTUNITY_FEATURES: Record<Component, StructuralFeature[]> = {
  points: STRUCTURAL_FEATURES.points,
  rebounds: [
    "predicted_minutes", "predicted_rebound_chances", "recent_rebound_capture",
    "rebounds_per_minute_10", "rebounds_per_minute_20", "rebounds_per_minute_season",
    "team_offensive_rebound_rate_5",
    "opponent_defensive_rebound_percentage_5", "opponent_rebound_chances_per100_5",
    "game_pace_mean_5", "minutes_sd_10",
  ],
  assists: [
    "predicted_minutes", "predicted_touches", "predicted_passes", "assists_per_touch",
    "assists_per_pass", "assists_per_minute_10", "assists_per_minute_20",
    "assists_per_minute_season", "assist_percentage_mean_5",
    "team_assist_percentage_5", "opponent_deflections_per100_5", "game_pace_mean_5",
  ],
  threes: [
    "predicted_minutes", "predicted_three_attempts", "recent_three_pct", "opponent_three_factor",
    "threes_per_minute_10", "threes_per_minute_20", "threes_per_minute_season",
    "fg3a_per_minute_20", "fg3a_per_minute_season", "team_three_point_attempt_share_5",
    "opponent_contested_shots_per100_5", "game_pace_mean_5",
  ],
};

function value(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const input = value("--input");
  if (!input) throw new Error("--input is required.");
  const outputValue = value("--output");
  const previewOutputValue = value("--preview-output");
  const artifactOutputValue = value("--artifact-output");
  const parityOutputValue = value("--parity-output");
  const projectionOnly = hasFlag("--projection-only");
  const dataset = JSON.parse(await readFile(input, "utf8")) as Dataset;
  if (dataset.mode !== "offline_research_only" || dataset.actionable !== false) {
    throw new Error("NBA props tournament accepts only an offline, non-actionable research dataset.");
  }

  const modelingGames = dataset.projectionGames ?? dataset.games;
  const modelingRows = dataset.projectionFeatureRows ?? dataset.featureRows;
  const orderedGames = [...modelingGames]
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || a.gameId - b.gameId);
  if (orderedGames.length < 30) throw new Error("NBA props tournament requires at least 30 chronological games.");
  const developmentEnd = Math.floor(orderedGames.length * 0.50);
  const modelSelectionEnd = Math.floor(orderedGames.length * 0.60);
  const reliabilityFitEnd = Math.floor(orderedGames.length * 0.70);
  const gradePolicyEnd = Math.floor(orderedGames.length * 0.80);
  const developmentIds = new Set(orderedGames.slice(0, developmentEnd).map((game) => game.gameId));
  const modelSelectionIds = new Set(orderedGames.slice(developmentEnd, modelSelectionEnd).map((game) => game.gameId));
  const reliabilityFitIds = new Set(orderedGames.slice(modelSelectionEnd, reliabilityFitEnd).map((game) => game.gameId));
  const gradePolicyIds = new Set(orderedGames.slice(reliabilityFitEnd, gradePolicyEnd).map((game) => game.gameId));
  const confirmationIds = new Set(orderedGames.slice(gradePolicyEnd).map((game) => game.gameId));
  const development = chronological(modelingRows.filter((row) => developmentIds.has(row.game_id)));
  const modelSelection = chronological(modelingRows.filter((row) => modelSelectionIds.has(row.game_id)));
  const reliabilityFit = chronological(modelingRows.filter((row) => reliabilityFitIds.has(row.game_id)));
  const gradePolicy = chronological(modelingRows.filter((row) => gradePolicyIds.has(row.game_id)));
  const confirmation = chronological(modelingRows.filter((row) => confirmationIds.has(row.game_id)));
  const canonical = selectNbaPlayerPropsCanonicalOfferSets(dataset.openingObservations.filter((row) => row.isOpening));
  const lineByScope = new Map(canonical.map((offer) => [offer.scopeKey, offer.canonicalLine]));
  const marketProbabilityByScope = new Map(canonical.flatMap((offer) => {
    const probability = consensusNoVigOver(offer.observations);
    return probability === null ? [] : [[offer.scopeKey, probability] as const];
  }));
  const fanduelProbabilityByScope = new Map(canonical.flatMap((offer) => {
    const probability = noVigOverForBook(offer.observations, "fanduel");
    return probability === null ? [] : [[offer.scopeKey, probability] as const];
  }));
  const fanduelConfirmedProbabilityByScope = new Map(canonical.flatMap((offer) => {
    const probability = confirmedFanduelProbability(offer.observations);
    return probability === null ? [] : [[offer.scopeKey, probability] as const];
  }));

  const candidates: Candidate[] = [
    ridgeCandidate(),
    ridgeMinutesRegressionCandidate(),
    ridgeRoleMinutesRegressionCandidate(),
    structuralCountCandidate("structural_direct_counts", "identity"),
    structuralCountCandidate("structural_log_counts", "log1p"),
    opportunityCountCandidate(),
    opportunityRoleMinutesCountCandidate(),
    robustComponentCandidate(),
    marketArbitrationCandidate("market_read_all_disagreements", 0, lineByScope, marketProbabilityByScope),
    marketArbitrationCandidate("market_read_2pp_disagreements", 0.02, lineByScope, marketProbabilityByScope),
    marketArbitrationCandidate("market_read_5pp_disagreements", 0.05, lineByScope, marketProbabilityByScope),
    marketArbitrationCandidate("fanduel_read_2pp_disagreements", 0.02, lineByScope, fanduelProbabilityByScope),
    marketArbitrationCandidate("fanduel_confirmed_2pp_disagreements", 0.02, lineByScope, fanduelConfirmedProbabilityByScope),
    hybridMarketArbitrationCandidate("hybrid_market_read_all_disagreements", 0, lineByScope, marketProbabilityByScope),
    hybridMarketArbitrationCandidate("hybrid_market_read_2pp_disagreements", 0.02, lineByScope, marketProbabilityByScope),
    hybridMarketArbitrationCandidate("hybrid_market_read_5pp_disagreements", 0.05, lineByScope, marketProbabilityByScope),
    rawCandidate("raw_recent_minutes", MINUTES.recent),
    rawCandidate("raw_balanced_minutes", MINUTES.balanced),
    rawCandidate("raw_stable_minutes", MINUTES.stable),
    hierarchicalCandidate("hierarchical_recent_minutes", MINUTES.recent),
    hierarchicalCandidate("hierarchical_balanced_minutes", MINUTES.balanced),
    hierarchicalCandidate("hierarchical_stable_minutes", MINUTES.stable),
  ];

  const selectionMetrics: Record<string, Partial<Record<Market, Metrics>>> = {};
  const selectionPredictors = new Map<CandidateName, ReturnType<Candidate["fit"]>>();
  for (const candidate of candidates) {
    const predict = candidate.fit(development);
    selectionPredictors.set(candidate.name, predict);
    selectionMetrics[candidate.name] = Object.fromEntries(MARKETS.map((market) => [
      market,
      evaluate(modelSelection, market, predict, lineByScope),
    ]));
  }

  const selectedByMarket = Object.fromEntries(MARKETS.map((market) => [
    market,
    selectCandidate(candidates, selectionMetrics, market),
  ])) as Record<Market, CandidateName>;

  const gradeModelFitRows = chronological([...development, ...modelSelection]);
  const gradePredictors = new Map<CandidateName, ReturnType<Candidate["fit"]>>();
  for (const candidate of candidates) gradePredictors.set(candidate.name, candidate.fit(gradeModelFitRows));
  const fitRows = chronological([...gradeModelFitRows, ...reliabilityFit, ...gradePolicy]);
  const ridgeDiagnosticModel = fitNbaPlayerPropsIndependentResearchModel(fitRows);
  const predictors = new Map<CandidateName, ReturnType<Candidate["fit"]>>();
  for (const candidate of candidates) predictors.set(candidate.name, candidate.fit(fitRows));
  const confirmationCandidateMetrics = Object.fromEntries(candidates.map((candidate) => [
    candidate.name,
    Object.fromEntries(MARKETS.map((market) => [
      market,
      evaluate(confirmation, market, predictors.get(candidate.name)!, lineByScope),
    ])),
  ]));
  const confirmationMetrics = Object.fromEntries(MARKETS.map((market) => {
    const candidate = selectedByMarket[market];
    const candidateMetrics = evaluate(confirmation, market, predictors.get(candidate)!, lineByScope);
    const ridgeMetrics = evaluate(confirmation, market, predictors.get("ridge_r2")!, lineByScope);
    return [market, {
      selectedCandidate: candidate,
      metrics: candidateMetrics,
      baselineRidge: ridgeMetrics,
      confirmationVerdict: confirmationVerdict(candidate, candidateMetrics, ridgeMetrics),
      ridgeErrorDecomposition: projectionErrorDecomposition(confirmation, market, ridgeDiagnosticModel),
      failureSegments: segmentFailures(confirmation, market, predictors.get(candidate)!, lineByScope),
      openingMarketSelectionDiagnostic: marketDiagnostic(
        modelSelection,
        market,
        selectionPredictors.get(candidate)!,
        lineByScope,
        marketProbabilityByScope,
      ),
      openingMarketDiagnostic: marketDiagnostic(
        confirmation,
        market,
        predictors.get(candidate)!,
        lineByScope,
        marketProbabilityByScope,
      ),
    }];
  }));
  if (projectionOnly) {
    const projectionReport = {
      release: "nba_player_props_projection_tournament_2026_10_22_r2_robust_rebounds_full_refit",
      mode: "offline_research_only",
      actionable: false,
      sourceDatasetRelease: dataset.release,
      immutableInputsSha256: dataset.immutableInputsSha256,
      split: {
        developmentGames: developmentIds.size,
        modelSelectionGames: modelSelectionIds.size,
        reliabilityFitGames: reliabilityFitIds.size,
        gradePolicyGames: gradePolicyIds.size,
        untouchedConfirmationGames: confirmationIds.size,
      },
      selectionMetrics,
      selectedByMarket,
      confirmationCandidateMetrics,
      confirmationMetrics,
    };
    if (outputValue) {
      const output = path.resolve(outputValue);
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify(projectionReport, null, 2)}\n`, "utf8");
    }
    process.stdout.write(`${JSON.stringify(projectionReport, null, 2)}\n`);
    return;
  }
  const exactPriceResearch = buildExactPriceGradeResearch({
    modelFitRows: gradeModelFitRows,
    reliabilityFit,
    gradePolicy,
    confirmation,
    canonical,
    selectedByMarket,
    gradePredictors,
    confirmationPredictors: predictors,
  });
  const exactPriceGradeResearch = exactPriceResearch.report;
  const frozenRuntimeArtifact = buildFrozenRuntimeArtifact({
    dataset,
    fitRows,
    selectedByMarket,
    predictors,
    exactPriceGradeResearch,
  });
  const selectionWindowGames = orderedGames.slice(0, modelSelectionEnd);
  const selectionWindowIds = new Set(selectionWindowGames.map((game) => game.gameId));
  const selectionWindowStability = walkForward(
    selectionWindowGames,
    modelingRows.filter((row) => selectionWindowIds.has(row.game_id)),
    lineByScope,
    marketProbabilityByScope,
    fanduelProbabilityByScope,
    fanduelConfirmedProbabilityByScope,
  );
  const walkForwardStability = walkForward(
    orderedGames,
    modelingRows,
    lineByScope,
    marketProbabilityByScope,
    fanduelProbabilityByScope,
    fanduelConfirmedProbabilityByScope,
  );

  const report = {
    release: "nba_player_props_model_tournament_2026_10_22_r12_robust_rebounds_full_refit",
    mode: "offline_research_only",
    actionable: false,
    sourceDatasetRelease: dataset.release,
    immutableInputsSha256: dataset.immutableInputsSha256,
    split: {
      population: dataset.projectionPopulation ?? "Opening-price player population.",
      developmentGames: developmentIds.size,
      modelSelectionGames: modelSelectionIds.size,
      reliabilityFitGames: reliabilityFitIds.size,
      gradePolicyGames: gradePolicyIds.size,
      untouchedConfirmationGames: confirmationIds.size,
      developmentRows: development.length,
      modelSelectionRows: modelSelection.length,
      reliabilityFitRows: reliabilityFit.length,
      gradePolicyRows: gradePolicy.length,
      confirmationRows: confirmation.length,
      confirmationFrom: confirmation[0]?.feature_cutoff ?? null,
      confirmationThrough: confirmation.at(-1)?.feature_cutoff ?? null,
    },
    selectionMetrics,
    selectedByMarket,
    confirmationCandidateMetrics,
    confirmationMetrics,
    exactPriceGradeResearch,
    selectionWindowStability,
    walkForwardStability,
    launchDecision: "not_fit",
    reasons: [
      "A single confirmation block is still insufficient for production qualification.",
      "Opening prices cannot validate same-book movement or lock-time market arbitration.",
      "No production grade, stake, promotion, demotion, or member output was evaluated.",
      "Exact-price grade research is retrospective and non-actionable; target-book-excluded evidence is mandatory.",
    ],
    integrity: {
      chronologicalGameSplit: true,
      candidateSelectionExcludedReliabilityGradesAndConfirmation: true,
      reliabilityFitExcludedGradePolicyAndConfirmation: true,
      gradePolicySelectionExcludedConfirmation: true,
      noDatabaseWrites: true,
      noMemberWrites: true,
      noGradesOrStakes: true,
    },
  };
  if (outputValue) {
    const output = path.resolve(outputValue);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (previewOutputValue) {
    const previewOutput = path.resolve(previewOutputValue);
    await mkdir(path.dirname(previewOutput), { recursive: true });
    await writeFile(previewOutput, `${JSON.stringify({
      release: "nba_player_props_private_product_preview_2026_10_22_r4_robust_rebounds_full_refit",
      mode: "private_historical_visual_qa_only",
      actionable: false,
      sourceDatasetRelease: dataset.release,
      sourceTournamentRelease: report.release,
      games: modelingGames.filter((game) => exactPriceResearch.previewGameIds.has(game.gameId)),
      rows: exactPriceResearch.previewRows,
      features: confirmation.filter((row) => exactPriceResearch.previewScopeKeys.has(
        `${row.game_id}|${row.player_id}`,
      )),
      observations: dataset.openingObservations.filter((row) => row.isOpening
        && row.canonicalGameId !== null
        && exactPriceResearch.previewGameIds.has(Number(row.providerEventId))),
    }, null, 2)}\n`, "utf8");
  }
  if (artifactOutputValue) {
    const artifactOutput = path.resolve(artifactOutputValue);
    await mkdir(path.dirname(artifactOutput), { recursive: true });
    await writeFile(artifactOutput, `${JSON.stringify(frozenRuntimeArtifact, null, 2)}\n`, "utf8");
  }
  if (parityOutputValue) {
    const parityOutput = path.resolve(parityOutputValue);
    await mkdir(path.dirname(parityOutput), { recursive: true });
    await writeFile(parityOutput, `${JSON.stringify({
      release: "nba_player_props_frozen_runtime_parity_2026_10_22_r2",
      mode: "private_historical_parity_only",
      actionable: false,
      features: confirmation,
      observations: dataset.openingObservations.filter((row) => row.isOpening
        && row.canonicalGameId !== null
        && confirmationIds.has(Number(row.providerEventId))),
      rows: exactPriceResearch.parityRows,
    }, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildFrozenRuntimeArtifact(args: {
  dataset: Dataset;
  fitRows: readonly NbaPlayerPropFeatureRow[];
  selectedByMarket: Readonly<Record<Market, CandidateName>>;
  predictors: ReadonlyMap<CandidateName, ReturnType<Candidate["fit"]>>;
  exactPriceGradeResearch: ReturnType<typeof buildExactPriceGradeResearch>["report"];
}) {
  const ridgeModel = fitNbaPlayerPropsIndependentResearchModel(args.fitRows);
  const minuteModel = fitMinuteRegression(args.fitRows);
  const structuralDirectModels = Object.fromEntries(
    (["points", "rebounds", "assists", "threes"] as const).map((component) => [
      component,
      fitStructuralCountModel(args.fitRows, component, "identity", minuteModel, STRUCTURAL_FEATURES),
    ]),
  );
  const structuralLogModels = Object.fromEntries(
    (["points", "rebounds", "assists", "threes"] as const).map((component) => [
      component,
      fitStructuralCountModel(args.fitRows, component, "log1p", minuteModel, STRUCTURAL_FEATURES),
    ]),
  );
  const opportunityModels = Object.fromEntries(
    (["points", "rebounds", "assists", "threes"] as const).map((component) => [
      component,
      fitStructuralCountModel(args.fitRows, component, "identity", minuteModel, OPPORTUNITY_FEATURES),
    ]),
  );
  const robustMinuteModel = fitMinuteRegression(args.fitRows, ROLE_MINUTE_FEATURES);
  const robustModels = Object.fromEntries(
    (["points", "rebounds", "assists", "threes"] as const).map((component) => [
      component,
      fitRobustStructuralCountModel(args.fitRows, component, robustMinuteModel),
    ]),
  );
  const underlyingByMarket = Object.fromEntries(MARKETS.map((market) => [
    market,
    underlyingIndependentCandidate(args.selectedByMarket[market], market),
  ]));
  const distributions = Object.fromEntries(MARKETS.map((market) => {
    const candidate = args.selectedByMarket[market];
    return [market, residualDistribution(args.fitRows, market, args.predictors.get(candidate)!)];
  }));
  const candidateMarketMinimumDistance = Object.fromEntries(MARKETS.map((market) => {
    const selected = args.selectedByMarket[market];
    return [market, selected.includes("all_disagreements") ? 0
      : selected.includes("2pp_disagreements") ? 0.02
        : selected.includes("5pp_disagreements") ? 0.05
          : null];
  }));
  const exactPriceArbitrationMinimumDistance = Object.fromEntries(MARKETS.map((market) => [
    market,
    targetExcludedArbitrationThreshold(market),
  ]));
  const byMarket = args.exactPriceGradeResearch.byMarket;
  const artifactWithoutChecksum = {
    release: "nba_player_props_frozen_runtime_artifact_2026_10_22_r3_canonical_checksum",
    publicEnabled: false,
    sourceDatasetRelease: args.dataset.release,
    sourceInputsSha256: args.dataset.immutableInputsSha256,
    sourceTournamentRelease: "nba_player_props_model_tournament_2026_10_22_r12_robust_rebounds_full_refit",
    sourceGradeRelease: args.exactPriceGradeResearch.release,
    trainedThrough: args.fitRows.at(-1)?.feature_cutoff ?? null,
    selectedByMarket: args.selectedByMarket,
    underlyingByMarket,
    candidateMarketMinimumDistance,
    exactPriceArbitrationMinimumDistance,
    ridgeModel,
    minuteModel,
    structuralDirectModels,
    structuralLogModels,
    opportunityModels,
    robustMinuteModel,
    robustModels,
    distributions,
    reliabilityModels: Object.fromEntries(MARKETS.map((market) => [market, byMarket[market].reliabilityModel])),
    gradePolicies: {
      points: {
        kind: "ranked",
        policy: byMarket.points.ungatedRankedGradeAudit.policy,
        bestAngleQualified: byMarket.points.ungatedRankedGradeAudit.verdict.bestAngleQualified,
      },
      assists: {
        kind: "ranked",
        policy: byMarket.assists.rankedGradeAudit.policy,
        bestAngleQualified: byMarket.assists.rankedGradeAudit.verdict.bestAngleQualified,
      },
      points_rebounds_assists: {
        kind: "threshold_relative_best",
        policy: byMarket.points_rebounds_assists.exploratoryPolicy,
        relativeBest: byMarket.points_rebounds_assists.relativeBestAngleAudit.selected,
      },
      rebounds: {
        kind: "slate_relative_lean",
        policy: args.exactPriceGradeResearch.inheritedReboundLeanAudit.inheritedPolicy,
        publicQualified: false,
      },
      threes: {
        kind: "slate_relative_lean",
        policy: args.exactPriceGradeResearch.threesForwardOnlyLeanAudit.selectedPolicy,
        publicQualified: false,
      },
      points_rebounds: {
        kind: "slate_relative_lean",
        policy: args.exactPriceGradeResearch.uncoveredSlateRelativeLeanAudits.combos.selectedPolicy,
        publicQualified: false,
      },
      points_assists: {
        kind: "slate_relative_lean",
        policy: args.exactPriceGradeResearch.uncoveredSlateRelativeLeanAudits.combos.selectedPolicy,
        publicQualified: false,
      },
      rebounds_assists: {
        kind: "slate_relative_lean",
        policy: args.exactPriceGradeResearch.uncoveredSlateRelativeLeanAudits.combos.selectedPolicy,
        publicQualified: false,
      },
    },
  } as const;
  return {
    ...artifactWithoutChecksum,
    payloadSha256: nbaPlayerPropsArtifactSha256(artifactWithoutChecksum),
  };
}

function walkForward(
  games: ReadonlyArray<{ gameId: number; startTime: string }>,
  rows: readonly NbaPlayerPropFeatureRow[],
  lineByScope: ReadonlyMap<string, number>,
  probabilityByScope: ReadonlyMap<string, number>,
  fanduelProbabilityByScope: ReadonlyMap<string, number>,
  fanduelConfirmedProbabilityByScope: ReadonlyMap<string, number>,
) {
  const initialGames = Math.floor(games.length / 2);
  const remaining = games.length - initialGames;
  const blockSize = Math.max(1, Math.floor(remaining / 5));
  const folds: WalkForwardFold[] = [];
  for (let start = initialGames; start < games.length; start += blockSize) {
    const end = Math.min(games.length, start + blockSize);
    const trainIds = new Set(games.slice(0, start).map((game) => game.gameId));
    const testGames = games.slice(start, end);
    const testIds = new Set(testGames.map((game) => game.gameId));
    const train = chronological(rows.filter((row) => trainIds.has(row.game_id)));
    const test = chronological(rows.filter((row) => testIds.has(row.game_id)));
    if (train.length < 8 || test.length === 0) continue;
    const model = fitNbaPlayerPropsIndependentResearchModel(train);
    const predict = (row: NbaPlayerPropFeatureRow, market: Market) =>
      projectNbaPlayerPropsIndependent(row, model).combinations[market];
    const twoStagePredict = ridgeMinutesRegressionCandidate().fit(train);
    const structuralDirectPredict = structuralCountCandidate("structural_direct_counts", "identity").fit(train);
    const structuralLogPredict = structuralCountCandidate("structural_log_counts", "log1p").fit(train);
    const opportunityDirectPredict = opportunityCountCandidate().fit(train);
    const marketReadAllPredict = marketArbitrationCandidate("market_read_all_disagreements", 0, lineByScope, probabilityByScope).fit(train);
    const marketRead2ppPredict = marketArbitrationCandidate("market_read_2pp_disagreements", 0.02, lineByScope, probabilityByScope).fit(train);
    const marketRead5ppPredict = marketArbitrationCandidate("market_read_5pp_disagreements", 0.05, lineByScope, probabilityByScope).fit(train);
    const fanduelRead2ppPredict = marketArbitrationCandidate("fanduel_read_2pp_disagreements", 0.02, lineByScope, fanduelProbabilityByScope).fit(train);
    const fanduelConfirmed2ppPredict = marketArbitrationCandidate("fanduel_confirmed_2pp_disagreements", 0.02, lineByScope, fanduelConfirmedProbabilityByScope).fit(train);
    const hybridMarketReadAllPredict = hybridMarketArbitrationCandidate("hybrid_market_read_all_disagreements", 0, lineByScope, probabilityByScope).fit(train);
    const hybridMarketRead2ppPredict = hybridMarketArbitrationCandidate("hybrid_market_read_2pp_disagreements", 0.02, lineByScope, probabilityByScope).fit(train);
    const hybridMarketRead5ppPredict = hybridMarketArbitrationCandidate("hybrid_market_read_5pp_disagreements", 0.05, lineByScope, probabilityByScope).fit(train);
    folds.push({
      trainGames: trainIds.size,
      testGames: testIds.size,
      testFrom: testGames[0]?.startTime ?? null,
      testThrough: testGames.at(-1)?.startTime ?? null,
      markets: Object.fromEntries(MARKETS.map((market) => [market, {
        independent: evaluate(test, market, predict, lineByScope),
        twoStageMinutes: evaluate(test, market, twoStagePredict, lineByScope),
        structuralDirect: evaluate(test, market, structuralDirectPredict, lineByScope),
        structuralLog: evaluate(test, market, structuralLogPredict, lineByScope),
        opportunityDirect: evaluate(test, market, opportunityDirectPredict, lineByScope),
        marketReadAll: evaluate(test, market, marketReadAllPredict, lineByScope),
        marketRead2pp: evaluate(test, market, marketRead2ppPredict, lineByScope),
        marketRead5pp: evaluate(test, market, marketRead5ppPredict, lineByScope),
        fanduelRead2pp: evaluate(test, market, fanduelRead2ppPredict, lineByScope),
        fanduelConfirmed2pp: evaluate(test, market, fanduelConfirmed2ppPredict, lineByScope),
        hybridMarketReadAll: evaluate(test, market, hybridMarketReadAllPredict, lineByScope),
        hybridMarketRead2pp: evaluate(test, market, hybridMarketRead2ppPredict, lineByScope),
        hybridMarketRead5pp: evaluate(test, market, hybridMarketRead5ppPredict, lineByScope),
        openingMarket: marketDiagnostic(test, market, predict, lineByScope, probabilityByScope),
      }])) as WalkForwardFold["markets"],
    });
  }
  return {
    release: "nba_player_props_walk_forward_stability_2026_10_20_r2_dense_exact_prices",
    folds,
    summary: Object.fromEntries(MARKETS.map((market) => {
      const metrics = folds.map((fold) => fold.markets[market]!.independent);
      const twoStageMetrics = folds.map((fold) => fold.markets[market]!.twoStageMinutes);
      const structuralDirectMetrics = folds.map((fold) => fold.markets[market]!.structuralDirect);
      const structuralLogMetrics = folds.map((fold) => fold.markets[market]!.structuralLog);
      const opportunityDirectMetrics = folds.map((fold) => fold.markets[market]!.opportunityDirect);
      const marketReadAllMetrics = folds.map((fold) => fold.markets[market]!.marketReadAll);
      const marketRead2ppMetrics = folds.map((fold) => fold.markets[market]!.marketRead2pp);
      const marketRead5ppMetrics = folds.map((fold) => fold.markets[market]!.marketRead5pp);
      const fanduelRead2ppMetrics = folds.map((fold) => fold.markets[market]!.fanduelRead2pp);
      const fanduelConfirmed2ppMetrics = folds.map((fold) => fold.markets[market]!.fanduelConfirmed2pp);
      const hybridMarketReadAllMetrics = folds.map((fold) => fold.markets[market]!.hybridMarketReadAll);
      const hybridMarketRead2ppMetrics = folds.map((fold) => fold.markets[market]!.hybridMarketRead2pp);
      const hybridMarketRead5ppMetrics = folds.map((fold) => fold.markets[market]!.hybridMarketRead5pp);
      const hitRates = metrics.map((metric) => metric.directionHitRate).filter((item): item is number => item !== null);
      const maes = metrics.map((metric) => metric.mae).filter((item): item is number => item !== null);
      const marketHits = folds.map((fold) => fold.markets[market]!.openingMarket.all.marketHitRate)
        .filter((item): item is number => item !== null);
      const candidateWins = twoStageMetrics.reduce((count, candidate, index) => {
        const baseline = metrics[index]!;
        if (candidate.mae === null || baseline.mae === null || candidate.directionHitRate === null || baseline.directionHitRate === null) return count;
        return count + Number(candidate.mae < baseline.mae && candidate.directionHitRate >= baseline.directionHitRate - 0.02);
      }, 0);
      return [market, {
        folds: metrics.length,
        twoStageCandidateWins: candidateWins,
        structuralDirectCandidateWins: candidateWinCount(structuralDirectMetrics, metrics),
        structuralLogCandidateWins: candidateWinCount(structuralLogMetrics, metrics),
        opportunityDirectCandidateWins: candidateWinCount(opportunityDirectMetrics, metrics),
        marketReadAllCandidateWins: candidateWinCount(marketReadAllMetrics, metrics),
        marketRead2ppCandidateWins: candidateWinCount(marketRead2ppMetrics, metrics),
        marketRead5ppCandidateWins: candidateWinCount(marketRead5ppMetrics, metrics),
        fanduelRead2ppCandidateWins: candidateWinCount(fanduelRead2ppMetrics, metrics),
        fanduelConfirmed2ppCandidateWins: candidateWinCount(fanduelConfirmed2ppMetrics, metrics),
        hybridMarketReadAllCandidateWins: candidateWinCount(hybridMarketReadAllMetrics, metrics),
        hybridMarketRead2ppCandidateWins: candidateWinCount(hybridMarketRead2ppMetrics, metrics),
        hybridMarketRead5ppCandidateWins: candidateWinCount(hybridMarketRead5ppMetrics, metrics),
        directionHitRateRange: hitRates.length ? [Math.min(...hitRates), Math.max(...hitRates)] : null,
        projectionMaeRange: maes.length ? [Math.min(...maes), Math.max(...maes)] : null,
        openingMarketHitRateRange: marketHits.length ? [Math.min(...marketHits), Math.max(...marketHits)] : null,
      }];
    })),
  };
}

function candidateWinCount(candidates: readonly Metrics[], baselines: readonly Metrics[]): number {
  return candidates.reduce((count, candidate, index) => {
    const baseline = baselines[index]!;
    if (candidate.mae === null || baseline.mae === null || candidate.directionHitRate === null || baseline.directionHitRate === null) return count;
    return count + Number(candidate.mae < baseline.mae && candidate.directionHitRate >= baseline.directionHitRate - 0.02);
  }, 0);
}

function ridgeCandidate(): Candidate {
  return {
    name: "ridge_r2",
    fit(rows) {
      const model = fitNbaPlayerPropsIndependentResearchModel(rows);
      return (row, market) => projectNbaPlayerPropsIndependent(row, model).combinations[market];
    },
  };
}

function ridgeMinutesRegressionCandidate(): Candidate {
  return {
    name: "ridge_r2_minutes_regression",
    fit(rows) {
      const baseModel = fitNbaPlayerPropsIndependentResearchModel(rows);
      const minuteModel = fitMinuteRegression(rows);
      return (row, market) => {
        const base = projectNbaPlayerPropsIndependent(row, baseModel);
        if (base.conditionalMinutes <= 0) return base.combinations[market];
        const rate = base.combinations[market] / base.conditionalMinutes;
        return Math.max(0, rate * predictMinuteRegression(row, minuteModel));
      };
    },
  };
}

function ridgeRoleMinutesRegressionCandidate(): Candidate {
  return {
    name: "ridge_r2_role_minutes_regression",
    fit(rows) {
      const baseModel = fitNbaPlayerPropsIndependentResearchModel(rows);
      const minuteModel = fitMinuteRegression(rows, ROLE_MINUTE_FEATURES);
      return (row, market) => {
        const base = projectNbaPlayerPropsIndependent(row, baseModel);
        if (base.conditionalMinutes <= 0) return base.combinations[market];
        const rate = base.combinations[market] / base.conditionalMinutes;
        return Math.max(0, rate * predictMinuteRegression(row, minuteModel));
      };
    },
  };
}

function structuralCountCandidate(
  name: Extract<CandidateName, "structural_direct_counts" | "structural_log_counts">,
  transform: StructuralCountModel["transform"],
): Candidate {
  return {
    name,
    fit(rows) {
      const minuteModel = fitMinuteRegression(rows);
      const models = Object.fromEntries(
        (["points", "rebounds", "assists", "threes"] as const).map((component) => [
          component,
          fitStructuralCountModel(rows, component, transform, minuteModel, STRUCTURAL_FEATURES),
        ]),
      ) as Record<Component, StructuralCountModel>;
      return (row, market) => marketComponents(market)
        .reduce((sum, component) => sum + predictStructuralCount(row, models[component], minuteModel), 0);
    },
  };
}

function opportunityCountCandidate(): Candidate {
  return {
    name: "opportunity_direct_counts",
    fit(rows) {
      const minuteModel = fitMinuteRegression(rows);
      const models = Object.fromEntries(
        (["points", "rebounds", "assists", "threes"] as const).map((component) => [
          component,
          fitStructuralCountModel(rows, component, "identity", minuteModel, OPPORTUNITY_FEATURES),
        ]),
      ) as Record<Component, StructuralCountModel>;
      return (row, market) => marketComponents(market)
        .reduce((sum, component) => sum + predictStructuralCount(row, models[component], minuteModel), 0);
    },
  };
}

function opportunityRoleMinutesCountCandidate(): Candidate {
  return {
    name: "opportunity_role_minutes_counts",
    fit(rows) {
      const minuteModel = fitMinuteRegression(rows, ROLE_MINUTE_FEATURES);
      const models = Object.fromEntries(
        (["points", "rebounds", "assists", "threes"] as const).map((component) => [
          component,
          fitStructuralCountModel(rows, component, "identity", minuteModel, OPPORTUNITY_FEATURES),
        ]),
      ) as Record<Component, StructuralCountModel>;
      return (row, market) => marketComponents(market)
        .reduce((sum, component) => sum + predictStructuralCount(row, models[component], minuteModel), 0);
    },
  };
}

function robustComponentCandidate(): Candidate {
  return {
    name: "robust_component_counts",
    fit(rows) {
      const minuteModel = fitMinuteRegression(rows, ROLE_MINUTE_FEATURES);
      const models = Object.fromEntries(
        (["points", "rebounds", "assists", "threes"] as const).map((component) => [
          component,
          fitRobustStructuralCountModel(rows, component, minuteModel),
        ]),
      ) as Record<Component, StructuralCountModel>;
      return (row, market) => marketComponents(market)
        .reduce((sum, component) => sum + predictStructuralCount(row, models[component], minuteModel), 0);
    },
  };
}

function fitRobustStructuralCountModel(
  rows: readonly NbaPlayerPropFeatureRow[],
  component: Component,
  minuteModel: MinuteRegression,
): StructuralCountModel {
  const ordered = chronological(rows).filter((row) => componentTarget(row, component) !== null);
  const split = Math.max(8, Math.min(ordered.length - 4, Math.floor(ordered.length * 0.75)));
  const train = ordered.slice(0, split);
  const validate = ordered.slice(split);
  const candidates = [1, 5, 20].map((lambda) =>
    fitRobustStructuralCountModelAtLambda(train, component, minuteModel, lambda));
  const selectedLambda = candidates.sort((left, right) =>
    structuralCountMae(validate, left, minuteModel) - structuralCountMae(validate, right, minuteModel))[0]?.lambda ?? 5;
  return fitRobustStructuralCountModelAtLambda(ordered, component, minuteModel, selectedLambda);
}

function fitRobustStructuralCountModelAtLambda(
  rows: readonly NbaPlayerPropFeatureRow[],
  component: Component,
  minuteModel: MinuteRegression,
  lambda: number,
): StructuralCountModel {
  const features = OPPORTUNITY_FEATURES[component];
  const values = rows.map((row) => features.map((feature) => structuralFeatureValue(row, feature, minuteModel)));
  const means = features.map((_, index) => mean(nonNull(values.map((row) => row[index]))) ?? 0);
  const scales = features.map((_, index) => standardDeviation(nonNull(values.map((row) => row[index]))) || Math.max(1, Math.abs(means[index]!)));
  const x = values.map((row) => [1, ...row.map((item, index) => ((item ?? means[index]!) - means[index]!) / scales[index]!)]);
  const y = rows.map((row) => componentTarget(row, component) ?? 0);
  let coefficients = ridgeSolve(x, y, lambda);
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const residuals = x.map((featuresRow, index) =>
      y[index]! - featuresRow.reduce((sum, value, coefficientIndex) => sum + value * (coefficients[coefficientIndex] ?? 0), 0));
    const scale = Math.max(0.25, (median(residuals.map(Math.abs)) ?? 1) * 0.75);
    const weights = residuals.map((residual) => 1 / Math.max(scale, Math.abs(residual)));
    coefficients = weightedRidgeSolve(x, y, weights, lambda);
  }
  return { component, transform: "identity", features, means, scales, coefficients, lambda };
}

function weightedRidgeSolve(
  x: readonly number[][],
  y: readonly number[],
  weights: readonly number[],
  lambda: number,
): number[] {
  const weightedX = x.map((row, index) => row.map((value) => value * Math.sqrt(weights[index] ?? 1)));
  const weightedY = y.map((value, index) => value * Math.sqrt(weights[index] ?? 1));
  return ridgeSolve(weightedX, weightedY, lambda);
}

function directMarketCountCandidate(
  name: Extract<CandidateName, "direct_market_counts" | "direct_market_log_counts">,
  transform: DirectMarketCountModel["transform"],
): Candidate {
  return {
    name,
    fit(rows) {
      const minuteModel = fitMinuteRegression(rows);
      const models = Object.fromEntries(MARKETS.map((market) => [
        market,
        fitDirectMarketCountModel(rows, market, transform, minuteModel),
      ])) as Record<Market, DirectMarketCountModel>;
      return (row, market) => predictDirectMarketCount(row, models[market], minuteModel);
    },
  };
}

function residualBiasCorrectedCandidate(
  name: Extract<CandidateName,
    | "bias_corrected_structural_direct_counts"
    | "bias_corrected_structural_log_counts"
    | "bias_corrected_direct_market_counts">,
  base: Candidate,
): Candidate {
  return {
    name,
    fit(rows) {
      const games = [...new Map(chronological(rows).map((row) => [row.game_id, row.feature_cutoff])).entries()]
        .sort((left, right) => Date.parse(left[1]) - Date.parse(right[1]) || left[0] - right[0]);
      const split = Math.max(4, Math.min(games.length - 2, Math.floor(games.length * 0.75)));
      const trainIds = new Set(games.slice(0, split).map(([gameId]) => gameId));
      const validateIds = new Set(games.slice(split).map(([gameId]) => gameId));
      const train = rows.filter((row) => trainIds.has(row.game_id));
      const validate = rows.filter((row) => validateIds.has(row.game_id));
      const validationPredict = base.fit(train);
      const correction = Object.fromEntries(MARKETS.map((market) => {
        const residuals = validate.flatMap((row) => {
          const actual = target(row, market);
          return actual === null ? [] : [actual - validationPredict(row, market)];
        });
        return [market, median(residuals) ?? 0];
      })) as Record<Market, number>;
      const finalPredict = base.fit(rows);
      return (row, market) => Math.max(0, finalPredict(row, market) + correction[market]);
    },
  };
}

function boostedMarketCountCandidate(): Candidate {
  return {
    name: "boosted_market_counts",
    fit(rows) {
      const minuteModel = fitMinuteRegression(rows);
      const models = Object.fromEntries(MARKETS.map((market) => [
        market,
        fitBoostedMarketCountModel(rows, market, minuteModel),
      ])) as Record<Market, BoostedMarketCountModel>;
      return (row, market) => predictBoostedMarketCount(row, models[market], minuteModel);
    },
  };
}

function fitBoostedMarketCountModel(
  rows: readonly NbaPlayerPropFeatureRow[],
  market: Market,
  minuteModel: MinuteRegression,
): BoostedMarketCountModel {
  const ordered = chronological(rows).filter((row) => target(row, market) !== null);
  const games = [...new Map(ordered.map((row) => [row.game_id, row.feature_cutoff])).entries()]
    .sort((left, right) => Date.parse(left[1]) - Date.parse(right[1]) || left[0] - right[0]);
  const split = Math.max(4, Math.min(games.length - 2, Math.floor(games.length * 0.8)));
  const trainIds = new Set(games.slice(0, split).map(([gameId]) => gameId));
  const validateIds = new Set(games.slice(split).map(([gameId]) => gameId));
  const train = ordered.filter((row) => trainIds.has(row.game_id));
  const validate = ordered.filter((row) => validateIds.has(row.game_id));
  const learningRate = 0.05;
  const staged = fitBoostedMarketCountModelAtIterations(train, market, minuteModel, learningRate, 60);
  const candidateIterations = [10, 20, 30, 40, 50, 60];
  const bestIterations = candidateIterations.map((iterations) => ({
    iterations,
    mae: boostedMarketCountMae(validate, { ...staged, stumps: staged.stumps.slice(0, iterations) }, minuteModel),
  })).sort((left, right) => left.mae - right.mae || left.iterations - right.iterations)[0]?.iterations ?? 20;
  return fitBoostedMarketCountModelAtIterations(ordered, market, minuteModel, learningRate, bestIterations);
}

function fitBoostedMarketCountModelAtIterations(
  rows: readonly NbaPlayerPropFeatureRow[],
  market: Market,
  minuteModel: MinuteRegression,
  learningRate: number,
  iterations: number,
): BoostedMarketCountModel {
  const features = [...new Set(marketComponents(market).flatMap((component) => STRUCTURAL_FEATURES[component]))];
  const actual = rows.map((row) => target(row, market) ?? 0);
  const base = mean(actual) ?? 0;
  const predictions = rows.map(() => base);
  const featureValues = new Map(features.map((feature) => {
    const raw = rows.map((row) => structuralFeatureValue(row, feature, minuteModel));
    const imputation = median(nonNull(raw)) ?? 0;
    return [feature, {
      imputation,
      values: raw.map((value) => value ?? imputation),
    }] as const;
  }));
  const stumps: BoostedStump[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const residuals = actual.map((value, index) => value - predictions[index]!);
    let best: (BoostedStump & { squaredError: number }) | null = null;
    for (const feature of features) {
      const prepared = featureValues.get(feature)!;
      const sorted = [...prepared.values].sort((left, right) => left - right);
      const thresholds = [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]
        .map((fraction) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]!)
        .filter((value, index, values) => index === 0 || value !== values[index - 1]);
      for (const threshold of thresholds) {
        const leftResiduals = residuals.filter((_, index) => prepared.values[index]! <= threshold);
        const rightResiduals = residuals.filter((_, index) => prepared.values[index]! > threshold);
        if (leftResiduals.length < 20 || rightResiduals.length < 20) continue;
        const left = mean(leftResiduals) ?? 0;
        const right = mean(rightResiduals) ?? 0;
        const squaredError = residuals.reduce((sum, residual, index) => {
          const fitted = prepared.values[index]! <= threshold ? left : right;
          return sum + (residual - fitted) ** 2;
        }, 0);
        if (!best || squaredError < best.squaredError) {
          best = { feature, imputation: prepared.imputation, threshold, left, right, squaredError };
        }
      }
    }
    if (!best) break;
    const { squaredError: _squaredError, ...stump } = best;
    stumps.push(stump);
    const prepared = featureValues.get(stump.feature)!;
    predictions.forEach((_, index) => {
      predictions[index] = predictions[index]! + learningRate
        * (prepared.values[index]! <= stump.threshold ? stump.left : stump.right);
    });
  }
  return { market, base, learningRate, stumps };
}

function predictBoostedMarketCount(
  row: NbaPlayerPropFeatureRow,
  model: BoostedMarketCountModel,
  minuteModel: MinuteRegression,
): number {
  const value = model.stumps.reduce((prediction, stump) => {
    const raw = structuralFeatureValue(row, stump.feature, minuteModel) ?? stump.imputation;
    return prediction + model.learningRate * (raw <= stump.threshold ? stump.left : stump.right);
  }, model.base);
  return Math.max(0, value);
}

function boostedMarketCountMae(
  rows: readonly NbaPlayerPropFeatureRow[],
  model: BoostedMarketCountModel,
  minuteModel: MinuteRegression,
): number {
  const errors = rows.flatMap((row) => {
    const actual = target(row, model.market);
    return actual === null ? [] : [Math.abs(predictBoostedMarketCount(row, model, minuteModel) - actual)];
  });
  return mean(errors) ?? Infinity;
}

function fitDirectMarketCountModel(
  rows: readonly NbaPlayerPropFeatureRow[],
  market: Market,
  transform: DirectMarketCountModel["transform"],
  minuteModel: MinuteRegression,
): DirectMarketCountModel {
  const ordered = chronological(rows).filter((row) => target(row, market) !== null);
  const split = Math.max(8, Math.min(ordered.length - 4, Math.floor(ordered.length * 0.75)));
  const train = ordered.slice(0, split);
  const validate = ordered.slice(split);
  const lambdas = [0.1, 1, 5, 20, 100];
  const selectedLambda = lambdas.map((lambda) => fitDirectMarketCountModelAtLambda(
    train,
    market,
    transform,
    minuteModel,
    lambda,
  )).sort((left, right) => directMarketCountMae(validate, left, minuteModel)
    - directMarketCountMae(validate, right, minuteModel))[0]?.lambda ?? 20;
  return fitDirectMarketCountModelAtLambda(ordered, market, transform, minuteModel, selectedLambda);
}

function fitDirectMarketCountModelAtLambda(
  rows: readonly NbaPlayerPropFeatureRow[],
  market: Market,
  transform: DirectMarketCountModel["transform"],
  minuteModel: MinuteRegression,
  lambda: number,
): DirectMarketCountModel {
  const features = [...new Set(marketComponents(market).flatMap((component) => STRUCTURAL_FEATURES[component]))];
  const values = rows.map((row) => features.map((feature) => structuralFeatureValue(row, feature, minuteModel)));
  const means = features.map((_, index) => mean(nonNull(values.map((row) => row[index]))) ?? 0);
  const scales = features.map((_, index) => standardDeviation(nonNull(values.map((row) => row[index]))) || Math.max(1, Math.abs(means[index]!)));
  const x = values.map((row) => [
    1,
    ...row.map((item, index) => ((item ?? means[index]!) - means[index]!) / scales[index]!),
  ]);
  const targets = rows.map((row) => target(row, market) ?? 0);
  const y = transform === "log1p" ? targets.map((item) => Math.log1p(Math.max(0, item))) : targets;
  return { market, transform, features, means, scales, coefficients: ridgeSolve(x, y, lambda), lambda };
}

function predictDirectMarketCount(
  row: NbaPlayerPropFeatureRow,
  model: DirectMarketCountModel,
  minuteModel: MinuteRegression,
): number {
  let value = model.coefficients[0] ?? 0;
  model.features.forEach((feature, index) => {
    const raw = structuralFeatureValue(row, feature, minuteModel) ?? model.means[index]!;
    value += (model.coefficients[index + 1] ?? 0) * ((raw - model.means[index]!) / model.scales[index]!);
  });
  return Math.max(0, model.transform === "log1p" ? Math.expm1(value) : value);
}

function directMarketCountMae(
  rows: readonly NbaPlayerPropFeatureRow[],
  model: DirectMarketCountModel,
  minuteModel: MinuteRegression,
): number {
  const errors = rows.flatMap((row) => {
    const actual = target(row, model.market);
    return actual === null ? [] : [Math.abs(predictDirectMarketCount(row, model, minuteModel) - actual)];
  });
  return mean(errors) ?? Infinity;
}

function marketArbitrationCandidate(
  name: Extract<CandidateName,
    | "market_read_all_disagreements"
    | "market_read_2pp_disagreements"
    | "market_read_5pp_disagreements"
    | "fanduel_read_2pp_disagreements"
    | "fanduel_confirmed_2pp_disagreements">,
  minimumMarketDistance: number,
  lineByScope: ReadonlyMap<string, number>,
  probabilityByScope: ReadonlyMap<string, number>,
): Candidate {
  return {
    name,
    fit(rows) {
      const independent = ridgeMinutesRegressionCandidate().fit(rows);
      return (row, market) => {
        const center = independent(row, market);
        const key = scope(row, market);
        const line = lineByScope.get(key);
        const marketProbability = probabilityByScope.get(key);
        if (line === undefined || marketProbability === undefined) return center;
        const marketDistance = Math.abs(marketProbability - 0.5);
        const independentOver = center > line;
        const marketOver = marketProbability > 0.5;
        if (marketDistance < minimumMarketDistance || independentOver === marketOver) return center;
        const projectionDistance = Math.max(0.05, Math.abs(center - line));
        return Math.max(0, line + (marketOver ? projectionDistance : -projectionDistance));
      };
    },
  };
}

type LearnedMarketCorrectionModel = {
  means: number[];
  scales: number[];
  coefficients: number[];
  lambda: number;
};

/**
 * Learns a residual correction to the independent projection rather than a
 * market-weighted replacement. The independent model remains the center; the
 * opening market can confirm it, soften it, or move it through the line when
 * that relationship was useful in earlier chronological games.
 */
function learnedMarketResidualCorrectionCandidate(
  lineByScope: ReadonlyMap<string, number>,
  probabilityByScope: ReadonlyMap<string, number>,
): Candidate {
  return {
    name: "learned_market_residual_correction",
    fit(rows) {
      const independent = ridgeMinutesRegressionCandidate().fit(rows);
      const models = Object.fromEntries(MARKETS.map((market) => [
        market,
        fitLearnedMarketCorrection(rows, market, independent, lineByScope, probabilityByScope),
      ])) as Record<Market, LearnedMarketCorrectionModel | null>;
      return (row, market) => {
        const center = independent(row, market);
        const line = lineByScope.get(scope(row, market));
        const marketProbability = probabilityByScope.get(scope(row, market));
        const model = models[market];
        if (!model || line === undefined || marketProbability === undefined) return center;
        const raw = learnedMarketCorrectionFeatures(row, center, line, marketProbability);
        const correction = model.coefficients[0]! + raw.reduce((sum, item, index) =>
          sum + (model.coefficients[index + 1] ?? 0) * ((item - model.means[index]!) / model.scales[index]!), 0);
        return Math.max(0, center + correction);
      };
    },
  };
}

function roleSegmentedIndependentExpertsCandidate(
  lineByScope: ReadonlyMap<string, number>,
): Candidate {
  return {
    name: "role_segmented_independent_experts",
    fit(rows) {
      const games = [...new Map(chronological(rows).map((row) => [row.game_id, row.feature_cutoff])).entries()]
        .sort((left, right) => Date.parse(left[1]) - Date.parse(right[1]) || left[0] - right[0]);
      const split = Math.max(12, Math.min(games.length - 6, Math.floor(games.length * 0.75)));
      const trainIds = new Set(games.slice(0, split).map(([gameId]) => gameId));
      const validateIds = new Set(games.slice(split).map(([gameId]) => gameId));
      const train = rows.filter((row) => trainIds.has(row.game_id));
      const validate = rows.filter((row) => validateIds.has(row.game_id));
      const factories: Array<() => Candidate> = [
        ridgeMinutesRegressionCandidate,
        ridgeRoleMinutesRegressionCandidate,
        () => structuralCountCandidate("structural_direct_counts", "identity"),
        () => structuralCountCandidate("structural_log_counts", "log1p"),
        opportunityCountCandidate,
        opportunityRoleMinutesCountCandidate,
        robustComponentCandidate,
      ];
      const names = factories.map((factory) => factory().name);
      const validationPredictors = new Map(factories.map((factory) => {
        const candidate = factory();
        return [candidate.name, candidate.fit(train)] as const;
      }));
      const selections = new Map<string, CandidateName>();
      for (const market of MARKETS) {
        for (const segment of ["stable", "volatile", "stable_b2b", "volatile_b2b"] as const) {
          const segmentRows = validate.filter((row) => independentExpertSegment(row) === segment);
          const scored = names.map((name) => ({
            name,
            metrics: evaluate(segmentRows, market, validationPredictors.get(name)!, lineByScope),
          })).filter((item) => item.metrics.rows >= 12 && item.metrics.mae !== null);
          if (scored.length === 0) {
            selections.set(`${market}|${segment}`, "ridge_r2_minutes_regression");
            continue;
          }
          const minimumMae = Math.min(...scored.map((item) => item.metrics.mae ?? Infinity));
          const frontier = scored.filter((item) => (item.metrics.mae ?? Infinity) <= minimumMae * 1.02);
          const selected = frontier.sort((left, right) =>
            ((right.metrics.directionHitRate ?? 0) - (left.metrics.directionHitRate ?? 0))
            || ((left.metrics.mae ?? Infinity) - (right.metrics.mae ?? Infinity)))[0]!;
          selections.set(`${market}|${segment}`, selected.name);
        }
      }
      const finalPredictors = new Map(factories.map((factory) => {
        const candidate = factory();
        return [candidate.name, candidate.fit(rows)] as const;
      }));
      return (row, market) => {
        const selected = selections.get(`${market}|${independentExpertSegment(row)}`)
          ?? "ridge_r2_minutes_regression";
        return finalPredictors.get(selected)!(row, market);
      };
    },
  };
}

function independentExpertSegment(row: NbaPlayerPropFeatureRow): "stable" | "volatile" | "stable_b2b" | "volatile_b2b" {
  const stable = row.player_games_prior >= 10 && (row.minutes_sd_10 ?? Infinity) <= 5;
  const backToBack = row.team_back_to_back === 1;
  if (stable) return backToBack ? "stable_b2b" : "stable";
  return backToBack ? "volatile_b2b" : "volatile";
}

function fitLearnedMarketCorrection(
  rows: readonly NbaPlayerPropFeatureRow[],
  market: Market,
  independent: (row: NbaPlayerPropFeatureRow, market: Market) => number,
  lineByScope: ReadonlyMap<string, number>,
  probabilityByScope: ReadonlyMap<string, number>,
): LearnedMarketCorrectionModel | null {
  const prepared = chronological(rows).flatMap((row) => {
    const actual = target(row, market);
    const line = lineByScope.get(scope(row, market));
    const probability = probabilityByScope.get(scope(row, market));
    if (actual === null || line === undefined || probability === undefined) return [];
    const center = independent(row, market);
    return [{
      row,
      center,
      actual,
      features: learnedMarketCorrectionFeatures(row, center, line, probability),
    }];
  });
  if (prepared.length < 40) return null;
  const split = Math.max(24, Math.min(prepared.length - 12, Math.floor(prepared.length * 0.75)));
  const train = prepared.slice(0, split);
  const validate = prepared.slice(split);
  const selectedLambda = [1, 5, 20, 100].map((lambda) => {
    const model = fitLearnedMarketCorrectionAtLambda(train, lambda);
    const mae = mean(validate.map((item) => Math.abs(
      item.center + predictLearnedMarketCorrection(item.features, model) - item.actual,
    ))) ?? Infinity;
    return { lambda, mae };
  }).sort((left, right) => left.mae - right.mae || left.lambda - right.lambda)[0]!.lambda;
  return fitLearnedMarketCorrectionAtLambda(prepared, selectedLambda);
}

function fitLearnedMarketCorrectionAtLambda(
  rows: ReadonlyArray<{ features: number[]; center: number; actual: number }>,
  lambda: number,
): LearnedMarketCorrectionModel {
  const width = rows[0]!.features.length;
  const means = Array.from({ length: width }, (_, index) => mean(rows.map((row) => row.features[index]!)) ?? 0);
  const scales = Array.from({ length: width }, (_, index) =>
    standardDeviation(rows.map((row) => row.features[index]!)) || Math.max(1, Math.abs(means[index]!)));
  const x = rows.map((row) => [1, ...row.features.map((item, index) => (item - means[index]!) / scales[index]!)]);
  const y = rows.map((row) => row.actual - row.center);
  return { means, scales, coefficients: ridgeSolve(x, y, lambda), lambda };
}

function predictLearnedMarketCorrection(features: readonly number[], model: LearnedMarketCorrectionModel): number {
  return model.coefficients[0]! + features.reduce((sum, item, index) =>
    sum + (model.coefficients[index + 1] ?? 0) * ((item - model.means[index]!) / model.scales[index]!), 0);
}

function learnedMarketCorrectionFeatures(
  row: NbaPlayerPropFeatureRow,
  independentProjection: number,
  line: number,
  marketProbability: number,
): number[] {
  const independentMargin = independentProjection - line;
  const marketMargin = marketProbability - 0.5;
  const disagreement = Math.sign(independentMargin) !== Math.sign(marketMargin) ? 1 : 0;
  return [
    independentMargin,
    marketMargin,
    Math.abs(independentMargin),
    Math.abs(marketMargin),
    disagreement,
    independentMargin * marketMargin,
    Math.log1p(Math.max(0, row.player_games_prior)),
    row.minutes_sd_10 ?? 0,
    row.team_back_to_back ?? 0,
    row.changed_team_since_last_game ?? 0,
    row.days_rest ?? 0,
    row.is_home ?? 0,
  ];
}

function hybridMarketArbitrationCandidate(
  name: Extract<CandidateName,
    | "hybrid_market_read_all_disagreements"
    | "hybrid_market_read_2pp_disagreements"
    | "hybrid_market_read_5pp_disagreements">,
  minimumMarketDistance: number,
  lineByScope: ReadonlyMap<string, number>,
  probabilityByScope: ReadonlyMap<string, number>,
): Candidate {
  return {
    name,
    fit(rows) {
      const twoStage = ridgeMinutesRegressionCandidate().fit(rows);
      const opportunity = opportunityCountCandidate().fit(rows);
      return (row, market) => {
        const center = market === "rebounds" || market === "threes" || market === "rebounds_assists"
          ? opportunity(row, market)
          : twoStage(row, market);
        const key = scope(row, market);
        const line = lineByScope.get(key);
        const marketProbability = probabilityByScope.get(key);
        if (line === undefined || marketProbability === undefined) return center;
        const marketDistance = Math.abs(marketProbability - 0.5);
        const independentOver = center > line;
        const marketOver = marketProbability > 0.5;
        if (marketDistance < minimumMarketDistance || independentOver === marketOver) return center;
        const projectionDistance = Math.max(0.05, Math.abs(center - line));
        return Math.max(0, line + (marketOver ? projectionDistance : -projectionDistance));
      };
    },
  };
}

function fitStructuralCountModel(
  rows: readonly NbaPlayerPropFeatureRow[],
  component: Component,
  transform: StructuralCountModel["transform"],
  minuteModel: MinuteRegression,
  featureSpec: Readonly<Record<Component, StructuralFeature[]>>,
): StructuralCountModel {
  const ordered = chronological(rows).filter((row) => componentTarget(row, component) !== null);
  const split = Math.max(8, Math.min(ordered.length - 4, Math.floor(ordered.length * 0.75)));
  const train = ordered.slice(0, split);
  const validate = ordered.slice(split);
  const lambdas = [0.1, 1, 5, 20, 100];
  const selectedLambda = lambdas.map((lambda) => fitStructuralCountModelAtLambda(
    train,
    component,
    transform,
    minuteModel,
    featureSpec,
    lambda,
  )).sort((left, right) => structuralCountMae(validate, left, minuteModel) - structuralCountMae(validate, right, minuteModel))[0]?.lambda ?? 20;
  return fitStructuralCountModelAtLambda(ordered, component, transform, minuteModel, featureSpec, selectedLambda);
}

function fitStructuralCountModelAtLambda(
  rows: readonly NbaPlayerPropFeatureRow[],
  component: Component,
  transform: StructuralCountModel["transform"],
  minuteModel: MinuteRegression,
  featureSpec: Readonly<Record<Component, StructuralFeature[]>>,
  lambda: number,
): StructuralCountModel {
  const features = featureSpec[component];
  const values = rows.map((row) => features.map((feature) => structuralFeatureValue(row, feature, minuteModel)));
  const means = features.map((_, index) => mean(nonNull(values.map((row) => row[index]))) ?? 0);
  const scales = features.map((_, index) => standardDeviation(nonNull(values.map((row) => row[index]))) || Math.max(1, Math.abs(means[index]!)));
  const x = values.map((row) => [
    1,
    ...row.map((item, index) => ((item ?? means[index]!) - means[index]!) / scales[index]!),
  ]);
  const targets = rows.map((row) => componentTarget(row, component) ?? 0);
  const y = transform === "log1p" ? targets.map((item) => Math.log1p(Math.max(0, item))) : targets;
  return { component, transform, features, means, scales, coefficients: ridgeSolve(x, y, lambda), lambda };
}

function structuralFeatureValue(
  row: NbaPlayerPropFeatureRow,
  feature: StructuralFeature,
  minuteModel: MinuteRegression,
): number | null {
  const minutes = predictMinuteRegression(row, minuteModel);
  if (feature === "predicted_minutes") return minutes;
  if (feature === "predicted_rebound_chances") return multiply(row.rebound_chances_per_minute_5, minutes);
  if (feature === "recent_rebound_capture") return safeRatio(row.rebounds_per_minute_10, row.rebound_chances_per_minute_5, 0, 1);
  if (feature === "predicted_touches") return multiply(row.touches_per_minute_5, minutes);
  if (feature === "predicted_passes") return multiply(row.passes_per_minute_5, minutes);
  if (feature === "assists_per_touch") return safeRatio(row.assists_per_minute_10, row.touches_per_minute_5, 0, 1);
  if (feature === "assists_per_pass") return safeRatio(row.assists_per_minute_10, row.passes_per_minute_5, 0, 1);
  if (feature === "predicted_three_attempts") return multiply(row.fg3a_per_minute_10, minutes);
  if (feature === "recent_three_pct") return safeRatio(row.threes_per_minute_10, row.fg3a_per_minute_10, 0, 0.8);
  if (feature === "opponent_three_factor") {
    return row.opponent_matchup_three_point_pct_5 === null
      ? null
      : Math.max(0.6, Math.min(1.4, row.opponent_matchup_three_point_pct_5 / 0.36));
  }
  return row[feature];
}

function multiply(value: number | null, factor: number): number | null {
  return value === null ? null : value * factor;
}

function safeRatio(
  numerator: number | null,
  denominator: number | null,
  minimum: number,
  maximum: number,
): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return Math.max(minimum, Math.min(maximum, numerator / denominator));
}

function predictStructuralCount(
  row: NbaPlayerPropFeatureRow,
  model: StructuralCountModel,
  minuteModel: MinuteRegression,
): number {
  let value = model.coefficients[0] ?? 0;
  model.features.forEach((feature, index) => {
    const raw = structuralFeatureValue(row, feature, minuteModel) ?? model.means[index]!;
    value += (model.coefficients[index + 1] ?? 0) * ((raw - model.means[index]!) / model.scales[index]!);
  });
  const count = model.transform === "log1p" ? Math.expm1(value) : value;
  return Math.max(0, count);
}

function structuralCountMae(
  rows: readonly NbaPlayerPropFeatureRow[],
  model: StructuralCountModel,
  minuteModel: MinuteRegression,
): number {
  const errors = rows.flatMap((row) => {
    const actual = componentTarget(row, model.component);
    return actual === null ? [] : [Math.abs(predictStructuralCount(row, model, minuteModel) - actual)];
  });
  return mean(errors) ?? Infinity;
}

function fitMinuteRegression(
  rows: readonly NbaPlayerPropFeatureRow[],
  features: readonly MinuteFeature[] = MINUTE_FEATURES,
): MinuteRegression {
  const ordered = chronological(rows).filter((row) => (row.target_minutes ?? 0) > 0);
  const split = Math.max(8, Math.min(ordered.length - 4, Math.floor(ordered.length * 0.75)));
  const train = ordered.slice(0, split);
  const validate = ordered.slice(split);
  const candidates = [0.1, 1, 5, 20, 100];
  const selectedLambda = candidates.map((lambda) => fitMinuteRegressionAtLambda(train, lambda, features))
    .sort((left, right) => minuteRegressionMae(validate, left) - minuteRegressionMae(validate, right))[0]?.lambda ?? 20;
  return fitMinuteRegressionAtLambda(ordered, selectedLambda, features);
}

function fitMinuteRegressionAtLambda(
  rows: readonly NbaPlayerPropFeatureRow[],
  lambda: number,
  features: readonly MinuteFeature[] = MINUTE_FEATURES,
): MinuteRegression {
  const means = features.map((feature) => mean(nonNull(rows.map((row) => row[feature]))) ?? 0);
  const scales = features.map((feature, index) => standardDeviation(nonNull(rows.map((row) => row[feature]))) || Math.max(1, Math.abs(means[index]!)));
  const x = rows.map((row) => [1, ...features.map((feature, index) => ((row[feature] ?? means[index]!) - means[index]!) / scales[index]!)]);
  const y = rows.map((row) => row.target_minutes!);
  return { features: [...features], means, scales, coefficients: ridgeSolve(x, y, lambda), lambda };
}

function predictMinuteRegression(row: NbaPlayerPropFeatureRow, model: MinuteRegression): number {
  let value = model.coefficients[0] ?? 0;
  model.features.forEach((feature, index) => {
    value += (model.coefficients[index + 1] ?? 0)
      * (((row[feature] ?? model.means[index]!) - model.means[index]!) / model.scales[index]!);
  });
  return Math.max(0, Math.min(48, value));
}

function minuteRegressionMae(rows: readonly NbaPlayerPropFeatureRow[], model: MinuteRegression): number {
  const errors = rows.flatMap((row) => row.target_minutes === null || row.target_minutes <= 0
    ? []
    : [Math.abs(predictMinuteRegression(row, model) - row.target_minutes)]);
  return mean(errors) ?? Infinity;
}

function ridgeSolve(x: readonly number[][], y: readonly number[], lambda: number): number[] {
  const width = x[0]?.length ?? 1;
  const matrix = Array.from({ length: width }, (_, row) => Array.from({ length: width + 1 }, (_, column) => {
    if (column === width) return x.reduce((sum, values, index) => sum + values[row]! * y[index]!, 0);
    const ridge = row === column && row > 0 ? lambda : 0;
    return x.reduce((sum, values) => sum + values[row]! * values[column]!, ridge);
  }));
  for (let pivot = 0; pivot < width; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < width; row += 1) {
      if (Math.abs(matrix[row]![pivot]!) > Math.abs(matrix[best]![pivot]!)) best = row;
    }
    [matrix[pivot], matrix[best]] = [matrix[best]!, matrix[pivot]!];
    const divisor = matrix[pivot]![pivot]!;
    if (Math.abs(divisor) < 1e-10) continue;
    for (let column = pivot; column <= width; column += 1) matrix[pivot]![column] /= divisor;
    for (let row = 0; row < width; row += 1) {
      if (row === pivot) continue;
      const factor = matrix[row]![pivot]!;
      for (let column = pivot; column <= width; column += 1) matrix[row]![column] -= factor * matrix[pivot]![column]!;
    }
  }
  return matrix.map((row) => Number.isFinite(row[width]) ? row[width]! : 0);
}

function rawCandidate(name: CandidateName, weights: readonly [number, number, number, number]): Candidate {
  return {
    name,
    fit() {
      return (row, market) => componentProjection(row, market, weights, null);
    },
  };
}

function hierarchicalCandidate(name: CandidateName, weights: readonly [number, number, number, number]): Candidate {
  return {
    name,
    fit(rows) {
      const priors = roleRatePriors(rows);
      return (row, market) => componentProjection(row, market, weights, priors);
    },
  };
}

function componentProjection(
  row: NbaPlayerPropFeatureRow,
  market: Market,
  weights: readonly [number, number, number, number],
  priors: Record<string, Record<string, number>> | null,
): number {
  const minutes = predictedMinutes(row, weights);
  const components = marketComponents(market).map((component) => {
    const raw = componentRate(row, component) ?? 0;
    if (!priors) return raw * minutes;
    const role = minuteRole(minutes);
    const prior = priors[component]?.[role] ?? priors[component]?.all ?? raw;
    const sample = Math.min(10, Math.max(0, row.player_games_prior));
    const shrinkage = 8 / (sample + 8);
    return ((1 - shrinkage) * raw + shrinkage * prior) * minutes;
  });
  return Math.max(0, components.reduce((sum, component) => sum + component, 0));
}

function roleRatePriors(rows: readonly NbaPlayerPropFeatureRow[]): Record<string, Record<string, number>> {
  const output: Record<string, Record<string, number>> = {};
  for (const component of ["points", "rebounds", "assists", "threes"] as const) {
    const groups: Record<string, number[]> = { low: [], rotation: [], starter: [], high: [], all: [] };
    for (const row of rows) {
      const minutes = row.target_minutes ?? 0;
      const target = componentTarget(row, component);
      if (minutes <= 0 || target === null) continue;
      const rate = target / minutes;
      groups[minuteRole(predictedMinutes(row, MINUTES.balanced))]!.push(rate);
      groups.all!.push(rate);
    }
    output[component] = Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, median(values) ?? 0]));
  }
  return output;
}

function evaluate(
  rows: readonly NbaPlayerPropFeatureRow[],
  market: Market,
  predict: (row: NbaPlayerPropFeatureRow, market: Market) => number,
  lineByScope: ReadonlyMap<string, number>,
): Metrics {
  const errors: number[] = [];
  const gameIds = new Set<number>();
  const hits: number[] = [];
  const sides: number[] = [];
  let pricedRows = 0;
  for (const row of rows) {
    const actual = target(row, market);
    if (actual === null) continue;
    const projection = predict(row, market);
    gameIds.add(row.game_id);
    errors.push(projection - actual);
    const line = lineByScope.get(scope(row, market));
    if (line === undefined || actual === line || projection === line) continue;
    pricedRows += 1;
    const over = projection > line;
    sides.push(Number(over));
    hits.push(Number(over === (actual > line)));
  }
  return {
    rows: errors.length,
    games: gameIds.size,
    pricedRows,
    mae: mean(errors.map(Math.abs)),
    rmse: errors.length ? Math.sqrt(mean(errors.map((error) => error ** 2))!) : null,
    medianAbsoluteError: median(errors.map(Math.abs)),
    bias: mean(errors),
    directionHitRate: mean(hits),
    overShare: mean(sides),
  };
}

function projectionErrorDecomposition(
  rows: readonly NbaPlayerPropFeatureRow[],
  market: Market,
  model: NbaPlayerPropsIndependentResearchModel,
) {
  const fullErrors: number[] = [];
  const perfectMinutesErrors: number[] = [];
  const perfectRateErrors: number[] = [];
  const minuteErrors: number[] = [];
  for (const row of rows) {
    const actual = target(row, market);
    const actualMinutes = row.target_minutes;
    if (actual === null || actualMinutes === null || actualMinutes <= 0) continue;
    const projection = projectNbaPlayerPropsIndependent(row, model);
    const predictedMinutes = projection.conditionalMinutes;
    if (predictedMinutes <= 0) continue;
    const center = projection.combinations[market];
    const predictedRate = center / predictedMinutes;
    const actualRate = actual / actualMinutes;
    fullErrors.push(center - actual);
    perfectMinutesErrors.push(predictedRate * actualMinutes - actual);
    perfectRateErrors.push(actualRate * predictedMinutes - actual);
    minuteErrors.push(predictedMinutes - actualMinutes);
  }
  return {
    rows: fullErrors.length,
    fullProjectionMae: mean(fullErrors.map(Math.abs)),
    rateErrorMaeWithPerfectMinutes: mean(perfectMinutesErrors.map(Math.abs)),
    minutesErrorMaeWithPerfectRate: mean(perfectRateErrors.map(Math.abs)),
    minutesMae: mean(minuteErrors.map(Math.abs)),
    note: "Oracle decompositions diagnose error source only; they are not deployable forecasts.",
  };
}

function selectCandidate(
  candidates: readonly Candidate[],
  metrics: Record<string, Partial<Record<Market, Metrics>>>,
  market: Market,
): CandidateName {
  const ridge = metrics.ridge_r2?.[market];
  const ridgeHit = ridge?.directionHitRate ?? 0;
  const eligible = candidates.filter((candidate) => {
    const item = metrics[candidate.name]?.[market];
    return item !== undefined && item.mae !== null && item.directionHitRate !== null
      && item.pricedRows >= 20
      && item.directionHitRate >= ridgeHit - 0.02;
  });
  const pool = eligible.length > 0 ? eligible : candidates.filter((candidate) => metrics[candidate.name]?.[market]?.mae !== null);
  const minimumMae = Math.min(...pool.map((candidate) => metrics[candidate.name]![market]!.mae ?? Infinity));
  // Direction determines whether the member wins the prop; projection error
  // determines whether that side remains trustworthy as lines move. Preserve
  // the near-best projection frontier, then select the strongest direction
  // result instead of letting a negligible MAE difference hide a material hit
  // rate gain.
  const projectionFrontier = pool.filter((candidate) =>
    (metrics[candidate.name]![market]!.mae ?? Infinity) <= minimumMae * 1.01);
  return [...projectionFrontier].sort((left, right) => {
    const a = metrics[left.name]![market]!;
    const b = metrics[right.name]![market]!;
    return ((b.directionHitRate ?? 0) - (a.directionHitRate ?? 0)) || (a.mae! - b.mae!);
  })[0]!.name;
}

function segmentFailures(
  rows: readonly NbaPlayerPropFeatureRow[],
  market: Market,
  predict: (row: NbaPlayerPropFeatureRow, market: Market) => number,
  lineByScope: ReadonlyMap<string, number>,
): Record<string, Metrics> {
  const segments: Record<string, (row: NbaPlayerPropFeatureRow) => boolean> = {
    established_role: (row) => row.player_games_prior >= 10 && (row.minutes_sd_10 ?? Infinity) <= 5,
    volatile_minutes: (row) => (row.minutes_sd_10 ?? 0) > 5,
    limited_history: (row) => row.player_games_prior < 10,
    changed_team: (row) => row.changed_team_since_last_game === 1,
    back_to_back: (row) => row.team_back_to_back === 1,
    projected_over: (row) => {
      const line = lineByScope.get(scope(row, market));
      return line !== undefined && predict(row, market) > line;
    },
    projected_under: (row) => {
      const line = lineByScope.get(scope(row, market));
      return line !== undefined && predict(row, market) < line;
    },
  };
  return Object.fromEntries(Object.entries(segments).map(([name, predicate]) => [
    name,
    evaluate(rows.filter(predicate), market, predict, lineByScope),
  ]));
}

function confirmationVerdict(candidate: CandidateName, metrics: Metrics, baseline: Metrics): {
  accepted: false;
  reason: string;
} {
  if (candidate === "ridge_r2") return { accepted: false, reason: "No alternative survived selection." };
  if (metrics.mae === null || baseline.mae === null || metrics.directionHitRate === null || baseline.directionHitRate === null) {
    return { accepted: false, reason: "Confirmation coverage was insufficient." };
  }
  const maeImprovement = (baseline.mae - metrics.mae) / baseline.mae;
  const hitDelta = metrics.directionHitRate - baseline.directionHitRate;
  if (maeImprovement >= 0.02 && hitDelta >= -0.02) {
    // A passing candidate still remains non-actionable because this pilot has
    // only one confirmation block. The return type deliberately stays false.
    return { accepted: false, reason: "Promising on one confirmation block; requires a second season/window before acceptance." };
  }
  return {
    accepted: false,
    reason: `Failed confirmation versus ridge (MAE change ${(maeImprovement * 100).toFixed(1)}%; direction change ${(hitDelta * 100).toFixed(1)} pp).`,
  };
}

function marketDiagnostic(
  rows: readonly NbaPlayerPropFeatureRow[],
  market: Market,
  predict: (row: NbaPlayerPropFeatureRow, market: Market) => number,
  lineByScope: ReadonlyMap<string, number>,
  probabilityByScope: ReadonlyMap<string, number>,
) {
  const allIndependent: number[] = [];
  const allMarket: number[] = [];
  const agree: number[] = [];
  const disagreeIndependent: number[] = [];
  const disagreeMarket: number[] = [];
  const disagreementStrength: Record<string, { independent: number[]; market: number[] }> = {
    under_2pp: { independent: [], market: [] },
    from_2_to_5pp: { independent: [], market: [] },
    at_least_5pp: { independent: [], market: [] },
  };
  for (const row of rows) {
    const actual = target(row, market);
    const key = scope(row, market);
    const line = lineByScope.get(key);
    const probability = probabilityByScope.get(key);
    if (actual === null || line === undefined || probability === undefined || actual === line) continue;
    const independentOver = predict(row, market) > line;
    const marketOver = probability >= 0.5;
    const outcomeOver = actual > line;
    const independentHit = Number(independentOver === outcomeOver);
    const marketHit = Number(marketOver === outcomeOver);
    allIndependent.push(independentHit);
    allMarket.push(marketHit);
    if (independentOver === marketOver) {
      agree.push(independentHit);
      continue;
    }
    disagreeIndependent.push(independentHit);
    disagreeMarket.push(marketHit);
    const distance = Math.abs(probability - 0.5);
    const bucket = distance < 0.02 ? "under_2pp" : distance < 0.05 ? "from_2_to_5pp" : "at_least_5pp";
    disagreementStrength[bucket]!.independent.push(independentHit);
    disagreementStrength[bucket]!.market.push(marketHit);
  }
  return {
    limitation: "Archived opening de-vig only; no same-book movement or lock-time evidence.",
    all: { rows: allIndependent.length, independentHitRate: mean(allIndependent), marketHitRate: mean(allMarket) },
    agreement: { rows: agree.length, sharedHitRate: mean(agree) },
    disagreement: {
      rows: disagreeIndependent.length,
      independentHitRate: mean(disagreeIndependent),
      marketHitRate: mean(disagreeMarket),
      byMarketPriceStrength: Object.fromEntries(Object.entries(disagreementStrength).map(([key, item]) => [key, {
        rows: item.independent.length,
        independentHitRate: mean(item.independent),
        marketHitRate: mean(item.market),
      }])),
    },
  };
}

type GradeName = "Best Angle" | "Lean" | "Watchlist" | "No Play";
type GradePolicy = Readonly<{
  bestProbability: number;
  bestEv: number;
  bestMarketProbability: number;
  leanProbability: number;
  leanEv: number;
  leanMarketProbability: number;
  leanRequiresReferenceBook: boolean;
  watchProbability: number;
  watchEv: number;
}>;
type ExactPriceReplayRow = Readonly<{
  gameId: number;
  playerId: number;
  playerName: string | null;
  teamId: number;
  opponentTeamId: number;
  scopeKey: string;
  featureCutoff: string;
  market: Market;
  independentSide: "over" | "under";
  finalSide: "over" | "under";
  outcomeSide: "over" | "under";
  line: number;
  actual: number;
  independentProjection: number;
  finalProjection: number;
  projectionStandardDeviation: number;
  rawFinalProbability: number;
  finalProbability: number;
  sportsbook: string;
  americanPrice: number;
  expectedValue: number;
  targetExcludedProbability: number;
  targetExcludedBooks: number;
  targetExcludedReferenceBooks: number;
  allBookProbability: number | null;
  marketEvidenceMode: "target_excluded_arbitration" | "candidate_projection";
  playerGamesPrior: number;
  minutesStandardDeviation10: number | null;
  teamBackToBack: boolean;
}>;

type ReliabilityFeature =
  | "raw_model_logit"
  | "standardized_projection_distance"
  | "target_excluded_margin"
  | "target_price_implied_probability"
  | "independent_final_agreement"
  | "reference_book_confirmation";

type GradeReliabilityModel = Readonly<{
  release: "nba_player_props_grade_reliability_research_2026_10_20_r3_five_stage_chronology";
  features: readonly ReliabilityFeature[];
  means: readonly number[];
  scales: readonly number[];
  coefficients: readonly number[];
  lambda: number;
  family:
    | "market_specific"
    | "partially_pooled"
    | "raw_model_only"
    | "projection_distance_only"
    | "target_excluded_only"
    | "target_price_only";
  fitRows: number;
  pooledRows: number;
  internalValidationRows: number;
  internalValidationLogLoss: number | null;
}>;

function buildExactPriceGradeResearch(args: {
  modelFitRows: readonly NbaPlayerPropFeatureRow[];
  reliabilityFit: readonly NbaPlayerPropFeatureRow[];
  gradePolicy: readonly NbaPlayerPropFeatureRow[];
  confirmation: readonly NbaPlayerPropFeatureRow[];
  canonical: readonly NbaPlayerPropsCanonicalOfferSet[];
  selectedByMarket: Readonly<Record<Market, CandidateName>>;
  gradePredictors: ReadonlyMap<CandidateName, ReturnType<Candidate["fit"]>>;
  confirmationPredictors: ReadonlyMap<CandidateName, ReturnType<Candidate["fit"]>>;
}) {
  const canonicalByScope = new Map(args.canonical.map((offer) => [offer.scopeKey, offer]));
  const reliabilityRows: ExactPriceReplayRow[] = [];
  const policyRows: ExactPriceReplayRow[] = [];
  const confirmationRows: ExactPriceReplayRow[] = [];
  const previewRows: Array<ExactPriceReplayRow & {
    grade: GradeName;
    gradePolicySource:
      | "points_ungated_ranked"
      | "assists_role_stable_ranked"
      | "pra_relative_best"
      | "universal_market_relative_lean"
      | "combo_market_relative_lean"
      | "forward_only_market_relative_lean"
      | "forecast_only";
  }> = [];
  const prepareMarket = (market: Market) => {
    const candidate = args.selectedByMarket[market];
    const gradeFinal = args.gradePredictors.get(candidate)!;
    const confirmationFinal = args.confirmationPredictors.get(candidate)!;
    const underlying = underlyingIndependentCandidate(candidate, market);
    const gradeIndependent = args.gradePredictors.get(underlying)!;
    const confirmationIndependent = args.confirmationPredictors.get(underlying)!;
    const gradeDistribution = residualDistribution(args.modelFitRows, market, gradeFinal);
    const confirmationDistribution = residualDistribution(
      [...args.modelFitRows, ...args.reliabilityFit, ...args.gradePolicy],
      market,
      confirmationFinal,
    );
    const reliabilityFitRaw = exactPriceReplayRows({
      rows: args.reliabilityFit,
      market,
      independentPredict: gradeIndependent,
      finalPredict: gradeFinal,
      distribution: gradeDistribution,
      canonicalByScope,
    });
    const gradePolicyRaw = exactPriceReplayRows({
      rows: args.gradePolicy,
      market,
      independentPredict: gradeIndependent,
      finalPredict: gradeFinal,
      distribution: gradeDistribution,
      canonicalByScope,
    });
    const confirmed = exactPriceReplayRows({
      rows: args.confirmation,
      market,
      independentPredict: confirmationIndependent,
      finalPredict: confirmationFinal,
      distribution: confirmationDistribution,
      canonicalByScope,
    });
    return { candidate, underlying, reliabilityFitRaw, gradePolicyRaw, confirmed };
  };
  const preparedByMarket = new Map(MARKETS.map((market) => [market, prepareMarket(market)] as const));
  const pooledReliabilityFitRaw = [...preparedByMarket.values()].flatMap((prepared) => prepared.reliabilityFitRaw);
  const byMarket = Object.fromEntries(MARKETS.map((market) => {
    const prepared = preparedByMarket.get(market)!;
    const { candidate, underlying, reliabilityFitRaw, gradePolicyRaw, confirmed } = prepared;
    const probabilityCalibration = fitProbabilityCalibration(reliabilityFitRaw);
    const reliabilityModel = fitGradeReliabilityModel(reliabilityFitRaw, pooledReliabilityFitRaw);
    const calibratedReliabilityFit = applyGradeReliabilityModel(reliabilityFitRaw, reliabilityModel);
    const calibratedGradePolicy = applyGradeReliabilityModel(gradePolicyRaw, reliabilityModel);
    const calibratedConfirmed = applyGradeReliabilityModel(confirmed, reliabilityModel);
    reliabilityRows.push(...calibratedReliabilityFit);
    policyRows.push(...calibratedGradePolicy);
    confirmationRows.push(...calibratedConfirmed);
    const policySearch = selectExploratoryGradePolicy(calibratedGradePolicy);
    const policyConfirmation = scoreGradePolicy(calibratedConfirmed, policySearch.policy);
    const policyVerdict = gradePolicyVerdict(policySearch.summary, policyConfirmation);
    const rankedGradeAudit = auditRankedGradePolicy(
      reliabilityFitRaw,
      gradePolicyRaw,
      confirmed,
    );
    const ungatedRankedGradeAudit = auditRankedGradePolicy(
      reliabilityFitRaw,
      gradePolicyRaw,
      confirmed,
      ["all"],
    );
    const slateRelativeLeanAudit = auditSlateRelativeLeanPolicy(
      calibratedReliabilityFit,
      calibratedGradePolicy,
      calibratedConfirmed,
    );
    const relativeBestAngleAudit = auditRelativeBestAngleTier(
      calibratedGradePolicy,
      calibratedConfirmed,
      policySearch.policy,
    );
    for (const row of calibratedConfirmed) {
      let grade: GradeName = "No Play";
      let gradePolicySource: "points_ungated_ranked" | "assists_role_stable_ranked" | "pra_relative_best" | "forecast_only" = "forecast_only";
      if (market === "points" && ungatedRankedGradeAudit.verdict.qualified) {
        grade = rankGrade(row, ungatedRankedGradeAudit.policy);
        gradePolicySource = "points_ungated_ranked";
      } else if (market === "assists" && rankedGradeAudit.verdict.qualified) {
        grade = rankGrade(row, rankedGradeAudit.policy);
        if (grade === "Best Angle" && !rankedGradeAudit.verdict.bestAngleQualified) grade = "Lean";
        gradePolicySource = "assists_role_stable_ranked";
      } else if (market === "points_rebounds_assists" && policyVerdict.qualified) {
        grade = gradeRowWithRelativeBest(row, policySearch.policy, relativeBestAngleAudit);
        gradePolicySource = "pra_relative_best";
      }
      // An actionable member label cannot contradict its own chosen-side
      // probability. Preserve the forecast and row, but keep it at Watchlist
      // until the calibrated outcome probability clears 50%.
      if ((grade === "Best Angle" || grade === "Lean") && row.finalProbability < 0.5) grade = "Watchlist";
      previewRows.push({ ...row, grade, gradePolicySource });
    }
    return [market, {
      selectedCandidate: candidate,
      underlyingIndependentCandidate: underlying,
      rawReliabilityFit: exactPriceReplaySummary(reliabilityFitRaw),
      rawGradePolicy: exactPriceReplaySummary(gradePolicyRaw),
      rawConfirmation: exactPriceReplaySummary(confirmed),
      rawSignalReliabilityFit: signalRankDiagnostics(reliabilityFitRaw),
      rawSignalGradePolicy: signalRankDiagnostics(gradePolicyRaw),
      rawSignalConfirmation: signalRankDiagnostics(confirmed),
      legacyProbabilityCalibrationDiagnostic: probabilityCalibration,
      reliabilityModel,
      reliabilityFit: reliabilityDiagnostics(calibratedReliabilityFit),
      reliabilityGradePolicy: reliabilityDiagnostics(calibratedGradePolicy),
      reliabilityConfirmation: reliabilityDiagnostics(calibratedConfirmed),
      singleSignalFamilyAudit: auditSingleSignalGradeFamilies(
        reliabilityFitRaw,
        gradePolicyRaw,
        confirmed,
      ),
      rankedGradeAudit,
      ungatedRankedGradeAudit,
      slateRelativeLeanAudit,
      gradePolicy: exactPriceReplaySummary(calibratedGradePolicy),
      confirmation: exactPriceReplaySummary(calibratedConfirmed),
      exploratoryPolicy: policySearch.policy,
      policyGradePolicy: policySearch.summary,
      policyConfirmation,
      policyVerdict,
      relativeBestAngleAudit,
    }];
  }));
  const pooledSlateRelativeLeanAudit = auditPooledSlateRelativeLeanPolicy({
    reliabilityFit: reliabilityRows,
    gradePolicy: policyRows,
    confirmation: confirmationRows,
  });
  const uncoveredSlateRelativeLeanAudits = {
    singleStat: auditPooledSlateRelativeLeanPolicy({
      reliabilityFit: reliabilityRows,
      gradePolicy: policyRows,
      confirmation: confirmationRows,
      markets: ["rebounds", "threes"],
    }),
    combos: auditPooledSlateRelativeLeanPolicy({
      reliabilityFit: reliabilityRows,
      gradePolicy: policyRows,
      confirmation: confirmationRows,
      markets: ["points_rebounds", "points_assists", "rebounds_assists"],
    }),
  };
  const universalSingleStatLeanAudit = auditInheritedPooledSlateRelativeLeanPolicy({
    policy: pooledSlateRelativeLeanAudit.selectedPolicy,
    reliabilityFit: reliabilityRows,
    gradePolicy: policyRows,
    confirmation: confirmationRows,
    markets: ["rebounds", "threes"],
  });
  const inheritedReboundLeanAudit = auditInheritedPooledSlateRelativeLeanPolicy({
    policy: pooledSlateRelativeLeanAudit.selectedPolicy,
    reliabilityFit: reliabilityRows,
    gradePolicy: policyRows,
    confirmation: confirmationRows,
    markets: ["rebounds"],
  });
  const threesForwardOnlyLeanAudit = {
    ...byMarket.threes.slateRelativeLeanAudit,
    retrospectiveProductDecisionAfterOutcomeReview: true,
    requiresForwardConfirmation: true,
    publicQualified: false,
    semantics: "preconfirmation_selected_best_available_private_lean_only",
  };
  const inheritedReboundRows = inheritedReboundLeanAudit.verdict.qualified
    ? selectPooledSlateRelativeLeanRows(
      confirmationRows,
      inheritedReboundLeanAudit.inheritedPolicy,
      inheritedReboundLeanAudit.markets,
    )
    : [];
  const threesForwardOnlyRows = selectPooledSlateRelativeLeanRows(
    confirmationRows,
    threesForwardOnlyLeanAudit.selectedPolicy,
    ["threes"],
  );
  const comboRows = uncoveredSlateRelativeLeanAudits.combos.verdict.qualified
    ? selectPooledSlateRelativeLeanRows(
      confirmationRows,
      uncoveredSlateRelativeLeanAudits.combos.selectedPolicy,
      uncoveredSlateRelativeLeanAudits.combos.markets,
    )
    : [];
  const inheritedReboundScopeKeys = new Set(inheritedReboundRows.map((row) => row.scopeKey));
  const threesForwardOnlyScopeKeys = new Set(threesForwardOnlyRows.map((row) => row.scopeKey));
  const comboScopeKeys = new Set(comboRows.map((row) => row.scopeKey));
  const expandedPreviewRows = previewRows.map((row) => {
    if (row.grade === "Best Angle" || row.grade === "Lean") return row;
    if (inheritedReboundScopeKeys.has(row.scopeKey)) {
      return { ...row, grade: "Lean" as const, gradePolicySource: "universal_market_relative_lean" as const };
    }
    if (threesForwardOnlyScopeKeys.has(row.scopeKey)) {
      return { ...row, grade: "Lean" as const, gradePolicySource: "forward_only_market_relative_lean" as const };
    }
    if (comboScopeKeys.has(row.scopeKey)) {
      return { ...row, grade: "Lean" as const, gradePolicySource: "combo_market_relative_lean" as const };
    }
    return row;
  });
  const report = {
    release: "nba_player_props_exact_price_grade_research_2026_10_22_r11_robust_rebounds_full_refit",
    status: "opened_retrospective_research_only",
    actionable: false,
    targetBookExcluded: true,
    gradePolicy: exactPriceReplaySummary(policyRows),
    confirmation: exactPriceReplaySummary(confirmationRows),
    byMarket,
    pooledSlateRelativeLeanAudit,
    uncoveredSlateRelativeLeanAudits,
    universalSingleStatLeanAudit,
    inheritedReboundLeanAudit,
    threesForwardOnlyLeanAudit,
    actionableCoherenceAudit: {
      baseline: summarizeActionableCoherence(expandedPreviewRows, () => true),
      probabilityAtLeastHalf: summarizeActionableCoherence(expandedPreviewRows, (row) => row.finalProbability >= 0.5),
      nonnegativeExactPriceEv: summarizeActionableCoherence(expandedPreviewRows, (row) => row.expectedValue >= 0),
      coherentProbabilityAndPrice: summarizeActionableCoherence(
        expandedPreviewRows,
        (row) => row.finalProbability >= 0.5 && row.expectedValue >= 0,
      ),
    },
    limitations: [
      "Only archived opening quotes are available; T-180/T-60/T-15/lock movement and CLV are not represented.",
      "The earlier confirmation outcomes were already opened during model research, so grade results cannot qualify production.",
      "Policies are exploratory candidates for private forward tracking, not member grades or stakes.",
    ],
  };
  const previewGameIds = selectPreviewGames(expandedPreviewRows);
  const selectedPreviewRows = expandedPreviewRows.filter((row) => previewGameIds.has(row.gameId));
  return {
    report,
    parityRows: expandedPreviewRows,
    previewRows: selectedPreviewRows,
    previewGameIds,
    previewScopeKeys: new Set(selectedPreviewRows.map((row) => `${row.gameId}|${row.playerId}`)),
  };
}

function summarizeActionableCoherence(
  rows: readonly (ExactPriceReplayRow & { grade: GradeName })[],
  retain: (row: ExactPriceReplayRow & { grade: GradeName }) => boolean,
) {
  const summarize = (values: readonly (ExactPriceReplayRow & { grade: GradeName })[]) => {
    const actionable = values.filter((row) => (row.grade === "Best Angle" || row.grade === "Lean") && retain(row));
    const wins = actionable.filter((row) => row.finalSide === row.outcomeSide).length;
    const units = actionable.reduce((sum, row) => sum + unitReturn(
      row.finalSide === row.outcomeSide,
      row.americanPrice,
    ), 0);
    return {
      records: actionable.length,
      wins,
      losses: actionable.length - wins,
      hitRate: actionable.length > 0 ? wins / actionable.length : null,
      units,
      roi: actionable.length > 0 ? units / actionable.length : null,
      boardShare: values.length > 0 ? actionable.length / values.length : null,
    };
  };
  return {
    all: summarize(rows),
    byMarket: Object.fromEntries(MARKETS.map((market) => [
      market,
      summarize(rows.filter((row) => row.market === market)),
    ])),
  };
}

function exactPriceReplayRows(args: {
  rows: readonly NbaPlayerPropFeatureRow[];
  market: Market;
  independentPredict: (row: NbaPlayerPropFeatureRow, market: Market) => number;
  finalPredict: (row: NbaPlayerPropFeatureRow, market: Market) => number;
  distribution: { bias: number; standardDeviation: number };
  canonicalByScope: ReadonlyMap<string, NbaPlayerPropsCanonicalOfferSet>;
}): ExactPriceReplayRow[] {
  const output: ExactPriceReplayRow[] = [];
  for (const row of args.rows) {
    const actual = target(row, args.market);
    const scopeKey = scope(row, args.market);
    const offer = args.canonicalByScope.get(scopeKey);
    if (actual === null || !offer || actual === offer.canonicalLine) continue;
    const independentProjection = args.independentPredict(row, args.market);
    const candidateProjection = args.finalPredict(row, args.market);
    if (independentProjection === offer.canonicalLine || candidateProjection === offer.canonicalLine) continue;
    const independentSide = independentProjection > offer.canonicalLine ? "over" : "under";
    const outcomeSide = actual > offer.canonicalLine ? "over" : "under";
    const arbitrationThreshold = targetExcludedArbitrationThreshold(args.market);
    const arbitration = arbitrationThreshold === null ? null : resolveTargetExcludedArbitration({
      offer,
      independentProjection,
      minimumMarketDistance: arbitrationThreshold,
    });
    const finalProjection = arbitration?.projection ?? candidateProjection;
    const finalSide = finalProjection > offer.canonicalLine ? "over" : "under";
    const priceCandidates = arbitration
      ? [arbitration.target]
      : offer.observations
        .filter((observation) => observation.side === finalSide)
        .sort((left, right) => right.americanPrice - left.americanPrice);
    let resolved: ExactPriceReplayRow | null = null;
    for (const price of priceCandidates) {
      const evidence = buildNbaPlayerPropsMarketEvidence({
        target: price,
        observations: offer.observations,
        evaluatedAt: price.observedAt,
      });
      if (evidence.targetExcludedOverProbability === null || evidence.targetExcludedBooks < 1) continue;
      const probabilityOver = residualProbabilityOver({
        line: offer.canonicalLine,
        projection: finalProjection,
        ...args.distribution,
      });
      const finalProbability = finalSide === "over" ? probabilityOver : 1 - probabilityOver;
      const targetExcludedProbability = finalSide === "over"
        ? evidence.targetExcludedOverProbability
        : 1 - evidence.targetExcludedOverProbability;
      resolved = {
        gameId: row.game_id,
        playerId: row.player_id,
        playerName: row.player_name,
        teamId: row.team_id,
        opponentTeamId: row.opponent_team_id,
        scopeKey,
        featureCutoff: row.feature_cutoff,
        market: args.market,
        independentSide,
        finalSide,
        outcomeSide,
        line: offer.canonicalLine,
        actual,
        independentProjection,
        finalProjection,
        projectionStandardDeviation: args.distribution.standardDeviation,
        rawFinalProbability: finalProbability,
        finalProbability,
        sportsbook: price.sportsbook,
        americanPrice: price.americanPrice,
        expectedValue: expectedValue(finalProbability, price.americanPrice),
        targetExcludedProbability,
        targetExcludedBooks: evidence.targetExcludedBooks,
        targetExcludedReferenceBooks: evidence.targetExcludedReferenceBooks,
        allBookProbability: sideProbabilityFromOver(consensusNoVigOver(offer.observations), finalSide),
        marketEvidenceMode: arbitration ? "target_excluded_arbitration" : "candidate_projection",
        playerGamesPrior: row.player_games_prior,
        minutesStandardDeviation10: row.minutes_sd_10,
        teamBackToBack: row.team_back_to_back === 1,
      };
      break;
    }
    if (resolved) output.push(resolved);
  }
  return output;
}

function resolveTargetExcludedArbitration(args: {
  offer: NbaPlayerPropsCanonicalOfferSet;
  independentProjection: number;
  minimumMarketDistance: number;
}): { projection: number; target: NbaPlayerPropPriceObservation } | null {
  const independentSide = args.independentProjection > args.offer.canonicalLine ? "over" : "under";
  let side = independentSide;
  let lastBook = "";
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const target = args.offer.observations
      .filter((row) => row.side === side)
      .sort((left, right) => right.americanPrice - left.americanPrice)[0];
    if (!target) return null;
    const evidence = buildNbaPlayerPropsMarketEvidence({
      target,
      observations: args.offer.observations,
      evaluatedAt: target.observedAt,
    });
    if (evidence.targetExcludedOverProbability === null || evidence.targetExcludedBooks < 1) return null;
    const marketOver = evidence.targetExcludedOverProbability > 0.5;
    const marketDistance = Math.abs(evidence.targetExcludedOverProbability - 0.5);
    const desired = marketDistance >= args.minimumMarketDistance
      ? marketOver ? "over" : "under"
      : independentSide;
    if (desired === side) {
      const distance = Math.max(0.05, Math.abs(args.independentProjection - args.offer.canonicalLine));
      return {
        projection: Math.max(0, args.offer.canonicalLine + (side === "over" ? distance : -distance)),
        target,
      };
    }
    const targetBook = normalizeBook(target.sportsbook);
    if (targetBook === lastBook) return null;
    lastBook = targetBook;
    side = desired;
  }
  return null;
}

function targetExcludedArbitrationThreshold(market: Market): number | null {
  if (market === "rebounds" || market === "threes") return 0.05;
  if (market === "assists") return 0.02;
  if (market === "rebounds_assists") return 0;
  return null;
}

function exactPriceReplaySummary(rows: readonly ExactPriceReplayRow[]) {
  const settled = rows.map((row) => row.finalSide === row.outcomeSide);
  const independent = rows.map((row) => row.independentSide === row.outcomeSide);
  const flips = rows.filter((row) => row.independentSide !== row.finalSide);
  const corrections = flips.filter((row) => row.finalSide === row.outcomeSide).length;
  const harms = flips.filter((row) => row.independentSide === row.outcomeSide).length;
  const pricedUnits = rows.reduce((sum, row) => sum + unitReturn(row.finalSide === row.outcomeSide, row.americanPrice), 0);
  const excludedDirectionDisagreements = rows.filter((row) => {
    const excludedSide = row.targetExcludedProbability >= 0.5 ? row.finalSide : opposite(row.finalSide);
    const allBookSide = row.allBookProbability === null
      ? excludedSide
      : row.allBookProbability >= 0.5 ? row.finalSide : opposite(row.finalSide);
    return excludedSide !== allBookSide;
  }).length;
  return {
    rows: rows.length,
    hitRate: mean(settled.map(Number)),
    independentHitRate: mean(independent.map(Number)),
    brier: mean(rows.map((row) => (row.finalProbability - Number(row.finalSide === row.outcomeSide)) ** 2)),
    logLoss: mean(rows.map((row) => {
      const probability = Math.min(1 - 1e-9, Math.max(1e-9, row.finalProbability));
      return row.finalSide === row.outcomeSide ? -Math.log(probability) : -Math.log(1 - probability);
    })),
    units: pricedUnits,
    roi: rows.length > 0 ? pricedUnits / rows.length : null,
    flips: flips.length,
    corrections,
    harms,
    netCorrections: corrections - harms,
    targetExcludedCoverage: rows.length,
    withReferenceBookConfirmation: rows.filter((row) => row.targetExcludedReferenceBooks > 0).length,
    allBookVsTargetExcludedDirectionDisagreements: excludedDirectionDisagreements,
  };
}

function selectExploratoryGradePolicy(rows: readonly ExactPriceReplayRow[]): {
  policy: GradePolicy;
  summary: ReturnType<typeof scoreGradePolicy>;
} {
  const policies: GradePolicy[] = [];
  for (const leanProbability of [0.53, 0.56, 0.59, 0.62, 0.65]) {
    for (const leanEv of [0, 0.03, 0.06, 0.09]) {
      for (const leanMarketProbability of [0.50, 0.52, 0.54]) {
          for (const leanRequiresReferenceBook of [false, true]) {
            for (const bestProbability of [0.60, 0.64, 0.68, 0.72]) {
            for (const bestEv of [0.05, 0.08, 0.12, 0.16]) {
              for (const bestMarketProbability of [0.52, 0.55]) {
              if (bestProbability <= leanProbability || bestEv < leanEv
                || bestMarketProbability < leanMarketProbability) continue;
              policies.push({
                bestProbability,
                bestEv,
                bestMarketProbability,
                leanProbability,
                leanEv,
                leanMarketProbability,
                leanRequiresReferenceBook,
                watchProbability: 0.52,
                watchEv: -0.01,
              });
              }
            }
          }
        }
      }
    }
  }
  const minimumActionables = Math.max(8, Math.floor(rows.length * 0.08));
  const candidates = policies.map((policy) => ({ policy, summary: scoreGradePolicy(rows, policy) }))
    .filter(({ summary }) => summary.actionable.records >= minimumActionables
      && summary.actionable.records <= Math.ceil(rows.length * 0.45)
      && summary.bestAngle.records >= Math.min(3, Math.floor(minimumActionables / 2))
      && summary.bestAngle.records <= Math.ceil(rows.length * 0.20)
      && (summary.bestAngle.hitRate ?? 0) >= (summary.actionable.hitRate ?? 0));
  return (candidates.length > 0 ? candidates : policies.map((policy) => ({ policy, summary: scoreGradePolicy(rows, policy) })))
    .sort((left, right) => gradePolicyScore(right.summary) - gradePolicyScore(left.summary))[0]!;
}

function scoreGradePolicy(rows: readonly ExactPriceReplayRow[], policy: GradePolicy) {
  const graded = rows.map((row) => ({ row, grade: grade(row, policy) }));
  const summary = (values: typeof graded) => {
    const wins = values.filter(({ row }) => row.finalSide === row.outcomeSide).length;
    const units = values.reduce((sum, { row }) => sum + unitReturn(row.finalSide === row.outcomeSide, row.americanPrice), 0);
    return {
      records: values.length,
      wins,
      losses: values.length - wins,
      hitRate: values.length > 0 ? wins / values.length : null,
      units,
      roi: values.length > 0 ? units / values.length : null,
    };
  };
  const bestAngle = graded.filter((row) => row.grade === "Best Angle");
  const lean = graded.filter((row) => row.grade === "Lean");
  const watchlist = graded.filter((row) => row.grade === "Watchlist");
  const noPlay = graded.filter((row) => row.grade === "No Play");
  return {
    all: summary(graded),
    actionable: summary([...bestAngle, ...lean]),
    bestAngle: summary(bestAngle),
    lean: summary(lean),
    watchlist: summary(watchlist),
    noPlay: summary(noPlay),
    boardShare: {
      actionable: graded.length > 0 ? (bestAngle.length + lean.length) / graded.length : null,
      bestAngle: graded.length > 0 ? bestAngle.length / graded.length : null,
      watchlist: graded.length > 0 ? watchlist.length / graded.length : null,
      noPlay: graded.length > 0 ? noPlay.length / graded.length : null,
    },
  };
}

function grade(row: ExactPriceReplayRow, policy: GradePolicy): GradeName {
  if (row.finalProbability >= policy.bestProbability && row.expectedValue >= policy.bestEv
    && row.targetExcludedProbability >= policy.bestMarketProbability
    && row.targetExcludedReferenceBooks >= 1) return "Best Angle";
  if (row.finalProbability >= policy.leanProbability && row.expectedValue >= policy.leanEv
    && row.targetExcludedProbability >= policy.leanMarketProbability
    && (!policy.leanRequiresReferenceBook || row.targetExcludedReferenceBooks >= 1)) return "Lean";
  if (row.finalProbability >= policy.watchProbability && row.expectedValue >= policy.watchEv) return "Watchlist";
  return "No Play";
}

function gradePolicyVerdict(
  gradePolicy: ReturnType<typeof scoreGradePolicy>,
  confirmation: ReturnType<typeof scoreGradePolicy>,
): { qualified: boolean; reasons: string[]; bestAngleQualified: boolean; bestAngleReasons: string[] } {
  const reasons: string[] = [];
  const bestAngleReasons: string[] = [];
  if (gradePolicy.actionable.records < 10) reasons.push("fewer_than_10_grade_policy_actionables");
  if ((gradePolicy.actionable.hitRate ?? 0) < 0.55) reasons.push("grade_policy_actionable_hit_below_55_percent");
  if ((gradePolicy.actionable.roi ?? -1) <= 0) reasons.push("grade_policy_actionable_roi_not_positive");
  if (confirmation.actionable.records < 10) reasons.push("fewer_than_10_confirmation_actionables");
  if ((confirmation.actionable.hitRate ?? 0) < 0.55) reasons.push("confirmation_actionable_hit_below_55_percent");
  if ((confirmation.actionable.roi ?? -1) <= 0) reasons.push("confirmation_actionable_roi_not_positive");
  if (confirmation.lean.records > 0 && (confirmation.lean.hitRate ?? 0) < 0.5) {
    reasons.push("confirmation_lean_hit_below_50_percent");
  }
  if (confirmation.noPlay.records >= 10
    && (confirmation.noPlay.hitRate ?? 0) > (confirmation.actionable.hitRate ?? 0) + 0.05) {
    reasons.push("no_play_materially_outperforms_actionables");
  }
  const validationShare = gradePolicy.boardShare.actionable ?? 0;
  const confirmationShare = confirmation.boardShare.actionable ?? 0;
  if (Math.abs(validationShare - confirmationShare) > 0.20) reasons.push("actionable_board_share_unstable");
  if (gradePolicy.bestAngle.records === 0) {
    bestAngleReasons.push("best_angle_tier_not_emitted");
  } else {
    if (gradePolicy.bestAngle.records < 5) bestAngleReasons.push("fewer_than_5_grade_policy_best_angles");
    if ((gradePolicy.bestAngle.hitRate ?? 0) < (gradePolicy.lean.hitRate ?? 0)) {
      bestAngleReasons.push("grade_policy_best_angle_does_not_outrank_lean");
    }
    if ((gradePolicy.bestAngle.roi ?? -1) < (gradePolicy.lean.roi ?? -1)) {
      bestAngleReasons.push("grade_policy_best_angle_roi_below_lean");
    }
    if (confirmation.bestAngle.records < 5) bestAngleReasons.push("fewer_than_5_confirmation_best_angles");
    if ((confirmation.bestAngle.hitRate ?? 0) < (confirmation.lean.hitRate ?? 0) - 0.05) {
      bestAngleReasons.push("confirmation_best_angle_materially_underperforms_lean");
    }
    if ((confirmation.bestAngle.roi ?? -1) <= 0) {
      bestAngleReasons.push("confirmation_best_angle_roi_not_positive");
    }
  }
  return {
    qualified: reasons.length === 0,
    reasons,
    bestAngleQualified: bestAngleReasons.length === 0,
    bestAngleReasons,
  };
}

function gradePolicyScore(summary: ReturnType<typeof scoreGradePolicy>): number {
  const actionableRoi = summary.actionable.roi ?? -1;
  const actionableHit = summary.actionable.hitRate ?? 0;
  // A market may support Leans without enough evidence for Best Angles. Treat
  // an intentionally absent top tier as neutral rather than penalizing the
  // entire useful grade surface.
  const bestRoi = summary.bestAngle.roi ?? 0;
  const bestHit = summary.bestAngle.hitRate ?? 0.5;
  return actionableRoi + 0.35 * (actionableHit - 0.5) + 0.25 * bestRoi + 0.15 * (bestHit - 0.5);
}

function auditRelativeBestAngleTier(
  gradePolicyRows: readonly ExactPriceReplayRow[],
  confirmationRows: readonly ExactPriceReplayRow[],
  actionablePolicy: GradePolicy,
) {
  const families: readonly RankSignalFamily[] = [
    "raw_model_probability",
    "projection_distance",
    "target_excluded_probability",
    "target_price_probability",
    "market_consensus",
    "model_market_consensus",
    "target_excluded_expected_value",
    "model_market_conservative_expected_value",
    "model_market_average_expected_value",
  ];
  const candidates = families.flatMap((signalFamily) => [0.20, 0.30, 0.40].map((bestShare) => {
    const actionable = gradePolicyRows.filter((row) => {
      const value = grade(row, actionablePolicy);
      return value === "Best Angle" || value === "Lean";
    });
    const ordered = actionable.map((row) => rankSignal(row, signalFamily)).sort((left, right) => right - left);
    const index = Math.max(0, Math.min(ordered.length - 1, Math.ceil(ordered.length * bestShare) - 1));
    const threshold = ordered[index] ?? Infinity;
    const summary = scoreRelativeBestAngleTier(gradePolicyRows, actionablePolicy, signalFamily, threshold);
    return { signalFamily, bestShare, threshold, summary };
  }));
  const eligible = candidates.filter(({ summary }) => summary.bestAngle.records >= 5
    && summary.lean.records >= 10
    && (summary.bestAngle.hitRate ?? 0) >= (summary.lean.hitRate ?? 0)
    && (summary.bestAngle.roi ?? -1) >= (summary.lean.roi ?? -1));
  const selected = eligible.sort((left, right) => {
    const leftSeparation = (left.summary.bestAngle.hitRate ?? 0) - (left.summary.lean.hitRate ?? 0);
    const rightSeparation = (right.summary.bestAngle.hitRate ?? 0) - (right.summary.lean.hitRate ?? 0);
    return rightSeparation - leftSeparation
      || (right.summary.bestAngle.roi ?? -1) - (left.summary.bestAngle.roi ?? -1);
  })[0] ?? null;
  if (!selected) {
    return {
      semantics: "top_ranked_slice_of_qualified_actionables",
      selected: null,
      qualified: false,
      reasons: ["no_policy_window_ranking_separated_best_angles_from_leans"],
    };
  }
  const confirmation = scoreRelativeBestAngleTier(
    confirmationRows,
    actionablePolicy,
    selected.signalFamily,
    selected.threshold,
  );
  const reasons: string[] = [];
  if (confirmation.bestAngle.records < 5) reasons.push("fewer_than_5_confirmation_best_angles");
  if ((confirmation.bestAngle.hitRate ?? 0) < (confirmation.lean.hitRate ?? 0) - 0.05) {
    reasons.push("confirmation_best_angle_materially_underperforms_lean");
  }
  if ((confirmation.bestAngle.roi ?? -1) <= 0) {
    reasons.push("confirmation_best_angle_roi_not_positive");
  }
  return {
    semantics: "top_ranked_slice_of_qualified_actionables",
    selected: {
      signalFamily: selected.signalFamily,
      bestShare: selected.bestShare,
      threshold: selected.threshold,
      gradePolicy: selected.summary,
      confirmation,
    },
    qualified: reasons.length === 0,
    reasons,
  };
}

function scoreRelativeBestAngleTier(
  rows: readonly ExactPriceReplayRow[],
  actionablePolicy: GradePolicy,
  signalFamily: RankSignalFamily,
  threshold: number,
) {
  const actionable = rows.filter((row) => {
    const value = grade(row, actionablePolicy);
    return value === "Best Angle" || value === "Lean";
  });
  const summarize = (values: readonly ExactPriceReplayRow[]) => {
    const wins = values.filter((row) => row.finalSide === row.outcomeSide).length;
    const units = values.reduce((sum, row) => sum + unitReturn(
      row.finalSide === row.outcomeSide,
      row.americanPrice,
    ), 0);
    return {
      records: values.length,
      wins,
      losses: values.length - wins,
      hitRate: values.length > 0 ? wins / values.length : null,
      roi: values.length > 0 ? units / values.length : null,
    };
  };
  const bestAngle = actionable.filter((row) => rankSignal(row, signalFamily) >= threshold);
  const lean = actionable.filter((row) => rankSignal(row, signalFamily) < threshold);
  return {
    actionable: summarize(actionable),
    bestAngle: summarize(bestAngle),
    lean: summarize(lean),
  };
}

const GRADE_RELIABILITY_FEATURES: readonly ReliabilityFeature[] = [
  "raw_model_logit",
  "standardized_projection_distance",
  "target_excluded_margin",
  "target_price_implied_probability",
  "independent_final_agreement",
  "reference_book_confirmation",
] as const;

function fitGradeReliabilityModel(
  rows: readonly ExactPriceReplayRow[],
  pooledRows: readonly ExactPriceReplayRow[],
): GradeReliabilityModel {
  const ordered = [...rows].sort((left, right) => Date.parse(left.featureCutoff) - Date.parse(right.featureCutoff));
  const split = Math.max(4, Math.min(ordered.length - 2, Math.floor(ordered.length * 0.7)));
  const fitRows = ordered.slice(0, split);
  const internalValidation = ordered.slice(split);
  const market = ordered[0]?.market;
  const otherMarkets = pooledRows.filter((row) => row.market !== market);
  const partiallyPooledFit = [...otherMarkets, ...fitRows, ...fitRows, ...fitRows];
  const lambdas = [0.5, 1, 2, 5, 10, 20, 50];
  const selected = lambdas.flatMap((lambda) => [
    { family: "market_specific" as const, model: fitGradeReliabilityAtLambda(fitRows, lambda, GRADE_RELIABILITY_FEATURES, "market_specific") },
    { family: "partially_pooled" as const, model: fitGradeReliabilityAtLambda(partiallyPooledFit, lambda, GRADE_RELIABILITY_FEATURES, "partially_pooled") },
    { family: "raw_model_only" as const, model: fitGradeReliabilityAtLambda(fitRows, lambda, ["raw_model_logit"], "raw_model_only") },
    { family: "projection_distance_only" as const, model: fitGradeReliabilityAtLambda(fitRows, lambda, ["standardized_projection_distance"], "projection_distance_only") },
    { family: "target_excluded_only" as const, model: fitGradeReliabilityAtLambda(fitRows, lambda, ["target_excluded_margin"], "target_excluded_only") },
    { family: "target_price_only" as const, model: fitGradeReliabilityAtLambda(fitRows, lambda, ["target_price_implied_probability"], "target_price_only") },
  ]).map((candidate) => ({
    ...candidate,
    loss: reliabilityLogLoss(internalValidation, candidate.model) ?? Infinity,
  })).sort((left, right) => left.loss - right.loss || left.model.lambda - right.model.lambda)[0];
  const lambda = selected?.model.lambda ?? 20;
  const family = selected?.family ?? "market_specific";
  const pooledRefitRows = family === "partially_pooled"
    ? [...otherMarkets, ...ordered, ...ordered, ...ordered]
    : ordered;
  const features = featuresForReliabilityFamily(family);
  const refit = calibrateReliabilityIntercept(fitGradeReliabilityAtLambda(pooledRefitRows, lambda, features, family), ordered);
  return {
    ...refit,
    family,
    fitRows: ordered.length,
    pooledRows: otherMarkets.length,
    internalValidationRows: internalValidation.length,
    internalValidationLogLoss: selected && Number.isFinite(selected.loss) ? selected.loss : null,
  };
}

function auditSingleSignalGradeFamilies(
  gradeFit: readonly ExactPriceReplayRow[],
  gradeValidation: readonly ExactPriceReplayRow[],
  confirmation: readonly ExactPriceReplayRow[],
) {
  const families: readonly GradeReliabilityModel["family"][] = [
    "raw_model_only",
    "projection_distance_only",
    "target_excluded_only",
    "target_price_only",
  ];
  return Object.fromEntries(families.map((family) => {
    const model = fitSingleSignalGradeReliability(gradeFit, family);
    const fitRows = applyGradeReliabilityModel(gradeFit, model);
    const validationRows = applyGradeReliabilityModel(gradeValidation, model);
    const confirmationRows = applyGradeReliabilityModel(confirmation, model);
    const policySearch = selectExploratoryGradePolicy(fitRows);
    const validation = scoreGradePolicy(validationRows, policySearch.policy);
    const confirmed = scoreGradePolicy(confirmationRows, policySearch.policy);
    return [family, {
      model,
      fit: policySearch.summary,
      validation,
      confirmation: confirmed,
      verdict: gradePolicyVerdict(validation, confirmed),
    }];
  }));
}

type RankSignalFamily =
  | "raw_model_probability"
  | "projection_distance"
  | "target_excluded_probability"
  | "target_price_probability"
  | "market_consensus"
  | "model_market_consensus"
  | "target_excluded_expected_value"
  | "model_market_conservative_expected_value"
  | "model_market_average_expected_value";

type RankEligibilityGate =
  | "all"
  | "established_role"
  | "not_back_to_back"
  | "established_role_not_back_to_back"
  | "over_only"
  | "under_only"
  | "established_role_over"
  | "established_role_under";

type RankGradePolicy = Readonly<{
  signalFamily: RankSignalFamily;
  bestSignalFamily: RankSignalFamily;
  eligibilityGate: RankEligibilityGate;
  leanThreshold: number;
  bestThreshold: number;
  minimumAmericanPrice: number;
}>;

function auditRankedGradePolicy(
  reliabilityFit: readonly ExactPriceReplayRow[],
  gradePolicy: readonly ExactPriceReplayRow[],
  confirmation: readonly ExactPriceReplayRow[],
  allowedGates: readonly RankEligibilityGate[] = [
    "all",
    "established_role",
    "not_back_to_back",
    "established_role_not_back_to_back",
  ],
) {
  const families: readonly RankSignalFamily[] = [
    "raw_model_probability",
    "projection_distance",
    "target_excluded_probability",
    "target_price_probability",
    "market_consensus",
    "model_market_consensus",
    "target_excluded_expected_value",
    "model_market_conservative_expected_value",
    "model_market_average_expected_value",
  ];
  const gates = allowedGates;
  const familyDiagnostics = Object.fromEntries(families.map((family) => {
    const reliabilityTop = rankTopFractionSummary(reliabilityFit, family, 0.20);
    return [family, {
      reliabilityFitAuc: scoreAuc(reliabilityFit, (row) => rankSignal(row, family)),
      reliabilityFitTop20: reliabilityTop,
      reliabilityScore: (reliabilityTop.roi ?? -1) + 0.35 * ((reliabilityTop.hitRate ?? 0) - 0.5),
      gradePolicyAuc: scoreAuc(gradePolicy, (row) => rankSignal(row, family)),
      confirmationAuc: scoreAuc(confirmation, (row) => rankSignal(row, family)),
    }];
  }));
  const pairDiagnostics = Object.fromEntries(families.flatMap((family) => gates.map((gate) => {
    const reliabilityTop = rankTopFractionSummary(reliabilityFit, family, 0.20, gate);
    return [`${family}:${gate}`, {
      signalFamily: family,
      eligibilityGate: gate,
      reliabilityFitTop20: reliabilityTop,
      reliabilityScore: (reliabilityTop.roi ?? -1) + 0.35 * ((reliabilityTop.hitRate ?? 0) - 0.5),
    }];
  })));
  const rankedPairs = Object.values(pairDiagnostics).sort((left, right) =>
    right.reliabilityScore - left.reliabilityScore
    || left.signalFamily.localeCompare(right.signalFamily)
    || left.eligibilityGate.localeCompare(right.eligibilityGate));
  const minimumActionables = Math.max(10, Math.floor(gradePolicy.length * 0.08));
  const policiesForPair = (
    signalFamily: RankSignalFamily,
    eligibilityGate: RankEligibilityGate,
  ): RankGradePolicy[] => {
    const policies: RankGradePolicy[] = [];
    for (const actionableFraction of [0.10, 0.15, 0.20, 0.25, 0.30, 0.40]) {
      for (const minimumAmericanPrice of [-150, -130, -120, -110]) {
        policies.push({
          signalFamily,
          bestSignalFamily: signalFamily,
          eligibilityGate,
          leanThreshold: quantileThreshold(gradePolicy, signalFamily, actionableFraction, eligibilityGate),
          bestThreshold: Infinity,
          minimumAmericanPrice,
        });
      }
    }
    return policies;
  };
  const selectedPair = rankedPairs.find(({ signalFamily, eligibilityGate }) =>
    policiesForPair(signalFamily, eligibilityGate).some((policy) =>
      scoreRankGradePolicy(gradePolicy, policy).actionable.records >= minimumActionables))
    ?? rankedPairs[0]!;
  const { signalFamily, eligibilityGate } = selectedPair;
  const policies = policiesForPair(signalFamily, eligibilityGate);
  const eligible = policies.map((policy) => ({ policy, summary: scoreRankGradePolicy(gradePolicy, policy) }))
    .filter(({ summary }) => summary.actionable.records >= minimumActionables
      && (summary.boardShare.actionable ?? 0) <= 0.40
      && (summary.actionable.hitRate ?? 0) >= 0.55
      && (summary.actionable.roi ?? -1) > 0
      && (summary.bestAngle.records === 0
        || (summary.bestAngle.hitRate ?? 0) >= (summary.actionable.hitRate ?? 0)));
  const pool = eligible.length > 0
    ? eligible
    : policies.map((policy) => ({ policy, summary: scoreRankGradePolicy(gradePolicy, policy) }));
  const selectedLean = pool.sort((left, right) =>
    gradePolicyScore(right.summary) - gradePolicyScore(left.summary)
    || right.summary.actionable.records - left.summary.actionable.records)[0]!;
  const bestCandidates = families.flatMap((bestSignalFamily) => [0.20, 0.30, 0.40]
    .map((bestShareOfActionables) => {
      const bestThreshold = bestThresholdForPolicy(
        gradePolicy,
        selectedLean.policy,
        bestSignalFamily,
        bestShareOfActionables,
      );
      const policy = { ...selectedLean.policy, bestSignalFamily, bestThreshold };
      return { bestShareOfActionables, policy, summary: scoreRankGradePolicy(gradePolicy, policy) };
    }))
    .filter(({ summary }) => summary.bestAngle.records >= 5
      && summary.lean.records >= 10
      && (summary.bestAngle.hitRate ?? 0) >= (summary.lean.hitRate ?? 0)
      && (summary.bestAngle.roi ?? -1) >= (summary.lean.roi ?? -1));
  const fallback = {
    bestShareOfActionables: null,
    policy: selectedLean.policy,
    summary: selectedLean.summary,
  };
  const selected = bestCandidates.sort((left, right) => {
    const leftSeparation = (left.summary.bestAngle.hitRate ?? 0) - (left.summary.lean.hitRate ?? 0);
    const rightSeparation = (right.summary.bestAngle.hitRate ?? 0) - (right.summary.lean.hitRate ?? 0);
    return rightSeparation - leftSeparation
      || gradePolicyScore(right.summary) - gradePolicyScore(left.summary);
  })[0] ?? fallback;
  const confirmed = scoreRankGradePolicy(confirmation, selected.policy);
  return {
    signalSelectionExcludedGradePolicyAndConfirmation: true,
    policySelectionExcludedConfirmation: true,
    signalFamily,
    eligibilityGate,
    familyDiagnostics,
    pairDiagnostics,
    bestAngleSemantics: "top_ranked_slice_of_qualified_actionables",
    selectedBestShareOfActionables: selected.bestShareOfActionables,
    policy: selected.policy,
    gradePolicy: selected.summary,
    confirmation: confirmed,
    verdict: gradePolicyVerdict(selected.summary, confirmed),
  };
}

function bestThresholdForPolicy(
  rows: readonly ExactPriceReplayRow[],
  policy: RankGradePolicy,
  bestSignalFamily: RankSignalFamily,
  upperFraction: number,
): number {
  const values = rows
    .filter((row) => rankEligibility(row, policy.eligibilityGate))
    .filter((row) => row.americanPrice >= policy.minimumAmericanPrice)
    .filter((row) => rankSignal(row, policy.signalFamily) >= policy.leanThreshold)
    .map((row) => rankSignal(row, bestSignalFamily))
    .sort((left, right) => right - left);
  if (values.length === 0) return Infinity;
  const index = Math.max(0, Math.min(values.length - 1, Math.ceil(values.length * upperFraction) - 1));
  return values[index]!;
}

function quantileThreshold(
  rows: readonly ExactPriceReplayRow[],
  family: RankSignalFamily,
  upperFraction: number,
  gate: RankEligibilityGate = "all",
): number {
  const values = rows.filter((row) => rankEligibility(row, gate))
    .map((row) => rankSignal(row, family)).sort((left, right) => right - left);
  if (values.length === 0) return Infinity;
  const index = Math.max(0, Math.min(values.length - 1, Math.ceil(values.length * upperFraction) - 1));
  return values[index]!;
}

function rankSignal(row: ExactPriceReplayRow, family: RankSignalFamily): number {
  const projectionDistance = Math.abs(row.finalProjection - row.line) / Math.max(0.25, row.projectionStandardDeviation);
  const targetPriceProbability = implied(row.americanPrice);
  if (family === "raw_model_probability") return row.rawFinalProbability;
  if (family === "projection_distance") return projectionDistance;
  if (family === "target_excluded_probability") return row.targetExcludedProbability;
  if (family === "target_price_probability") return targetPriceProbability;
  if (family === "market_consensus") return (row.targetExcludedProbability + targetPriceProbability) / 2;
  if (family === "model_market_consensus") {
    return (row.rawFinalProbability + row.targetExcludedProbability + targetPriceProbability) / 3;
  }
  if (family === "target_excluded_expected_value") {
    return expectedValue(row.targetExcludedProbability, row.americanPrice);
  }
  const marriedProbability = family === "model_market_conservative_expected_value"
    ? Math.min(row.rawFinalProbability, row.targetExcludedProbability)
    : (row.rawFinalProbability + row.targetExcludedProbability) / 2;
  return expectedValue(marriedProbability, row.americanPrice);
}

function rankTopFractionSummary(
  rows: readonly ExactPriceReplayRow[],
  family: RankSignalFamily,
  fraction: number,
  gate: RankEligibilityGate = "all",
) {
  const eligible = rows.filter((row) => rankEligibility(row, gate));
  const count = Math.max(1, Math.ceil(eligible.length * fraction));
  const selected = [...eligible]
    .sort((left, right) => rankSignal(right, family) - rankSignal(left, family))
    .slice(0, count);
  const wins = selected.filter((row) => row.finalSide === row.outcomeSide).length;
  const units = selected.reduce((sum, row) => sum + unitReturn(
    row.finalSide === row.outcomeSide,
    row.americanPrice,
  ), 0);
  return {
    records: selected.length,
    hitRate: selected.length > 0 ? wins / selected.length : null,
    roi: selected.length > 0 ? units / selected.length : null,
  };
}

function rankEligibility(row: ExactPriceReplayRow, gate: RankEligibilityGate): boolean {
  const establishedRole = row.playerGamesPrior >= 10
    && (row.minutesStandardDeviation10 ?? Infinity) <= 5;
  if (gate === "established_role") return establishedRole;
  if (gate === "not_back_to_back") return !row.teamBackToBack;
  if (gate === "established_role_not_back_to_back") return establishedRole && !row.teamBackToBack;
  if (gate === "over_only") return row.finalSide === "over";
  if (gate === "under_only") return row.finalSide === "under";
  if (gate === "established_role_over") return establishedRole && row.finalSide === "over";
  if (gate === "established_role_under") return establishedRole && row.finalSide === "under";
  return true;
}

function scoreRankGradePolicy(rows: readonly ExactPriceReplayRow[], policy: RankGradePolicy) {
  const graded = rows.map((row) => {
    return { row, grade: rankGrade(row, policy) };
  });
  const summary = (values: typeof graded) => {
    const wins = values.filter(({ row }) => row.finalSide === row.outcomeSide).length;
    const units = values.reduce((sum, { row }) => sum + unitReturn(row.finalSide === row.outcomeSide, row.americanPrice), 0);
    return {
      records: values.length,
      wins,
      losses: values.length - wins,
      hitRate: values.length > 0 ? wins / values.length : null,
      units,
      roi: values.length > 0 ? units / values.length : null,
    };
  };
  const bestAngle = graded.filter((row) => row.grade === "Best Angle");
  const lean = graded.filter((row) => row.grade === "Lean");
  const watchlist = graded.filter((row) => row.grade === "Watchlist");
  const noPlay = graded.filter((row) => row.grade === "No Play");
  return {
    all: summary(graded),
    actionable: summary([...bestAngle, ...lean]),
    bestAngle: summary(bestAngle),
    lean: summary(lean),
    watchlist: summary(watchlist),
    noPlay: summary(noPlay),
    boardShare: {
      actionable: graded.length > 0 ? (bestAngle.length + lean.length) / graded.length : null,
      bestAngle: graded.length > 0 ? bestAngle.length / graded.length : null,
      watchlist: graded.length > 0 ? watchlist.length / graded.length : null,
      noPlay: graded.length > 0 ? noPlay.length / graded.length : null,
    },
  };
}

function rankGrade(row: ExactPriceReplayRow, policy: RankGradePolicy): GradeName {
  const score = rankSignal(row, policy.signalFamily);
  const bestScore = rankSignal(row, policy.bestSignalFamily);
  const eligible = rankEligibility(row, policy.eligibilityGate);
  const priceQualified = row.americanPrice >= policy.minimumAmericanPrice;
  if (eligible && priceQualified && score >= policy.leanThreshold && bestScore >= policy.bestThreshold) {
    return "Best Angle";
  }
  if (eligible && priceQualified && score >= policy.leanThreshold) return "Lean";
  if (eligible && score >= policy.leanThreshold) return "Watchlist";
  return "No Play";
}

type SlateRelativeLeanPolicy = Readonly<{
  signalFamily: RankSignalFamily;
  eligibilityGate: RankEligibilityGate;
  maxPerSlate: 1 | 2;
  minimumProbability: number;
  minimumExpectedValue: number;
  minimumAmericanPrice: number;
  requireReferenceBook: boolean;
}>;

function auditSlateRelativeLeanPolicy(
  reliabilityFit: readonly ExactPriceReplayRow[],
  gradePolicy: readonly ExactPriceReplayRow[],
  confirmation: readonly ExactPriceReplayRow[],
) {
  const families: readonly RankSignalFamily[] = [
    "raw_model_probability",
    "projection_distance",
    "target_excluded_probability",
    "target_price_probability",
    "market_consensus",
    "model_market_consensus",
    "target_excluded_expected_value",
    "model_market_conservative_expected_value",
    "model_market_average_expected_value",
  ];
  const gates: readonly RankEligibilityGate[] = [
    "all",
    "established_role",
    "not_back_to_back",
    "established_role_not_back_to_back",
  ];
  const scoreReliability = buildSlateRelativeLeanScorer(reliabilityFit, families);
  const scoreGradePolicy = buildSlateRelativeLeanScorer(gradePolicy, families);
  const scoreConfirmation = buildSlateRelativeLeanScorer(confirmation, families);
  const candidatePolicies: SlateRelativeLeanPolicy[] = [];
  for (const signalFamily of families) {
    for (const eligibilityGate of gates) {
      for (const maxPerSlate of [1, 2] as const) {
        for (const minimumProbability of [0.5, 0.52, 0.54]) {
          for (const minimumExpectedValue of [-0.03, 0, 0.02]) {
            for (const minimumAmericanPrice of [-150, -130, -110]) {
              for (const requireReferenceBook of [false, true]) {
                candidatePolicies.push({
                  signalFamily,
                  eligibilityGate,
                  maxPerSlate,
                  minimumProbability,
                  minimumExpectedValue,
                  minimumAmericanPrice,
                  requireReferenceBook,
                });
              }
            }
          }
        }
      }
    }
  }
  const reliabilityMinimumRows = Math.min(8, Math.max(4, new Set(reliabilityFit.map((row) => easternDateForPreview(row.featureCutoff))).size));
  const gradeMinimumRows = Math.min(8, Math.max(4, new Set(gradePolicy.map((row) => easternDateForPreview(row.featureCutoff))).size));
  const evaluated = candidatePolicies.map((policy) => ({
    policy,
    reliabilityFit: scoreReliability(policy),
    gradePolicy: scoreGradePolicy(policy),
  }));
  const eligible = evaluated.filter(({ reliabilityFit: fit, gradePolicy: grade }) =>
    fit.actionable.records >= reliabilityMinimumRows
    && grade.actionable.records >= gradeMinimumRows
    && (fit.actionable.hitRate ?? 0) >= 0.52
    && (grade.actionable.hitRate ?? 0) >= 0.52
    && (fit.actionable.roi ?? -1) > -0.02
    && (grade.actionable.roi ?? -1) > -0.02);
  const selected = (eligible.length > 0 ? eligible : evaluated)
    .sort((left, right) => robustSlateRelativeLeanScore(right) - robustSlateRelativeLeanScore(left)
      || right.gradePolicy.actionable.records - left.gradePolicy.actionable.records)[0]!;
  const confirmed = scoreConfirmation(selected.policy);
  const onePerSlatePolicy = { ...selected.policy, maxPerSlate: 1 as const };
  const onePerSlate = {
    policy: onePerSlatePolicy,
    reliabilityFit: scoreReliability(onePerSlatePolicy),
    gradePolicy: scoreGradePolicy(onePerSlatePolicy),
    confirmation: scoreConfirmation(onePerSlatePolicy),
  };
  const reasons: string[] = [];
  if (selected.reliabilityFit.actionable.records < reliabilityMinimumRows) reasons.push("fewer_than_minimum_reliability_fit_relative_leans");
  if ((selected.reliabilityFit.actionable.hitRate ?? 0) < 0.52) reasons.push("reliability_fit_relative_lean_hit_below_52_percent");
  if ((selected.reliabilityFit.actionable.roi ?? -1) <= -0.02) reasons.push("reliability_fit_relative_lean_roi_below_minus_2_percent");
  if (selected.gradePolicy.actionable.records < gradeMinimumRows) reasons.push("fewer_than_minimum_grade_policy_relative_leans");
  if ((selected.gradePolicy.actionable.hitRate ?? 0) < 0.52) reasons.push("grade_policy_relative_lean_hit_below_52_percent");
  if ((selected.gradePolicy.actionable.roi ?? -1) <= -0.02) reasons.push("grade_policy_relative_lean_roi_below_minus_2_percent");
  if (confirmed.actionable.records < gradeMinimumRows) reasons.push("fewer_than_minimum_confirmation_relative_leans");
  if ((confirmed.actionable.hitRate ?? 0) < 0.52) reasons.push("confirmation_relative_lean_hit_below_52_percent");
  if ((confirmed.actionable.roi ?? -1) <= -0.02) reasons.push("confirmation_relative_lean_roi_below_minus_2_percent");
  return {
    semantics: "highest_ranked_coherent_opportunities_per_market_slate",
    policySelectionExcludedConfirmation: true,
    policySelectedAcrossTwoPreConfirmationWindows: true,
    eligiblePolicyCount: eligible.length,
    selectedPolicy: selected.policy,
    reliabilityFit: selected.reliabilityFit,
    gradePolicy: selected.gradePolicy,
    confirmation: confirmed,
    onePerSlateDiagnostic: onePerSlate,
    verdict: { qualified: reasons.length === 0, reasons },
  };
}

function auditPooledSlateRelativeLeanPolicy(args: {
  reliabilityFit: readonly ExactPriceReplayRow[];
  gradePolicy: readonly ExactPriceReplayRow[];
  confirmation: readonly ExactPriceReplayRow[];
  markets?: readonly Market[];
}) {
  const markets = args.markets ?? MARKETS;
  const families: readonly RankSignalFamily[] = [
    "raw_model_probability",
    "projection_distance",
    "target_excluded_probability",
    "target_price_probability",
    "market_consensus",
    "model_market_consensus",
    "target_excluded_expected_value",
    "model_market_conservative_expected_value",
    "model_market_average_expected_value",
  ];
  const gates: readonly RankEligibilityGate[] = [
    "all",
    "established_role",
    "not_back_to_back",
    "established_role_not_back_to_back",
  ];
  const scoreReliability = buildPooledSlateRelativeLeanScorer(args.reliabilityFit, families, markets);
  const scoreGradePolicy = buildPooledSlateRelativeLeanScorer(args.gradePolicy, families, markets);
  const scoreConfirmation = buildPooledSlateRelativeLeanScorer(args.confirmation, families, markets);
  const candidatePolicies: SlateRelativeLeanPolicy[] = [];
  for (const signalFamily of families) {
    for (const eligibilityGate of gates) {
      for (const maxPerSlate of [1, 2] as const) {
        for (const minimumProbability of [0.5, 0.52, 0.54]) {
          for (const minimumExpectedValue of [-0.03, 0, 0.02]) {
            for (const minimumAmericanPrice of [-150, -130, -110]) {
              for (const requireReferenceBook of [false, true]) {
                candidatePolicies.push({
                  signalFamily,
                  eligibilityGate,
                  maxPerSlate,
                  minimumProbability,
                  minimumExpectedValue,
                  minimumAmericanPrice,
                  requireReferenceBook,
                });
              }
            }
          }
        }
      }
    }
  }
  const evaluated = candidatePolicies.map((policy) => ({
    policy,
    reliabilityFit: scoreReliability(policy),
    gradePolicy: scoreGradePolicy(policy),
  }));
  const minimumWindowRecords = markets.length * 3;
  const eligible = evaluated.filter(({ reliabilityFit: fit, gradePolicy: grade }) =>
    fit.actionable.records >= minimumWindowRecords
    && grade.actionable.records >= minimumWindowRecords
    && markets.every((market) => (fit.byMarket[market]?.records ?? 0) >= 2
      && (grade.byMarket[market]?.records ?? 0) >= 2)
    && (fit.actionable.hitRate ?? 0) >= 0.52
    && (grade.actionable.hitRate ?? 0) >= 0.52
    && (fit.actionable.roi ?? -1) > -0.02
    && (grade.actionable.roi ?? -1) > -0.02);
  const selected = (eligible.length > 0 ? eligible : evaluated)
    .sort((left, right) => robustPooledSlateRelativeLeanScore(right, markets)
      - robustPooledSlateRelativeLeanScore(left, markets)
      || right.gradePolicy.actionable.records - left.gradePolicy.actionable.records)[0]!;
  const confirmation = scoreConfirmation(selected.policy);
  const reasons: string[] = [];
  if (eligible.length === 0) reasons.push("no_policy_qualified_across_both_preconfirmation_windows");
  if ((confirmation.actionable.hitRate ?? 0) < 0.52) reasons.push("confirmation_pooled_hit_below_52_percent");
  if ((confirmation.actionable.roi ?? -1) <= -0.02) reasons.push("confirmation_pooled_roi_below_minus_2_percent");
  for (const market of markets) {
    const summary = confirmation.byMarket[market];
    if ((summary?.records ?? 0) < 3) reasons.push(`${market}_confirmation_fewer_than_3`);
    if ((summary?.hitRate ?? 0) < 0.40) reasons.push(`${market}_confirmation_hit_below_40_percent`);
  }
  return {
    semantics: "one_preconfirmation_selected_policy_ranked_within_each_market_and_slate",
    markets,
    policySelectionExcludedConfirmation: true,
    selectedPolicy: selected.policy,
    eligiblePolicyCount: eligible.length,
    reliabilityFit: selected.reliabilityFit,
    gradePolicy: selected.gradePolicy,
    confirmation,
    verdict: { qualified: reasons.length === 0, reasons },
  };
}

function auditInheritedPooledSlateRelativeLeanPolicy(args: {
  policy: SlateRelativeLeanPolicy;
  reliabilityFit: readonly ExactPriceReplayRow[];
  gradePolicy: readonly ExactPriceReplayRow[];
  confirmation: readonly ExactPriceReplayRow[];
  markets: readonly Market[];
}) {
  const scoreReliability = buildPooledSlateRelativeLeanScorer(
    args.reliabilityFit,
    [args.policy.signalFamily],
    args.markets,
  );
  const scoreGradePolicy = buildPooledSlateRelativeLeanScorer(
    args.gradePolicy,
    [args.policy.signalFamily],
    args.markets,
  );
  const scoreConfirmation = buildPooledSlateRelativeLeanScorer(
    args.confirmation,
    [args.policy.signalFamily],
    args.markets,
  );
  const reliabilityFit = scoreReliability(args.policy);
  const gradePolicy = scoreGradePolicy(args.policy);
  const confirmation = scoreConfirmation(args.policy);
  const combinedRecords = reliabilityFit.actionable.records
    + gradePolicy.actionable.records
    + confirmation.actionable.records;
  const combinedWins = reliabilityFit.actionable.wins
    + gradePolicy.actionable.wins
    + confirmation.actionable.wins;
  const combinedUnits = reliabilityFit.actionable.units
    + gradePolicy.actionable.units
    + confirmation.actionable.units;
  const combined = {
    records: combinedRecords,
    wins: combinedWins,
    losses: combinedRecords - combinedWins,
    hitRate: combinedRecords > 0 ? combinedWins / combinedRecords : null,
    units: combinedUnits,
    roi: combinedRecords > 0 ? combinedUnits / combinedRecords : null,
  };
  const reasons: string[] = [];
  const windows = [reliabilityFit, gradePolicy, confirmation];
  if (windows.some((window) => window.actionable.records < args.markets.length * 2)) {
    reasons.push("chronological_window_too_sparse");
  }
  if (windows.some((window) => (window.actionable.hitRate ?? 0) < 0.40)) {
    reasons.push("chronological_window_hit_below_40_percent");
  }
  if ((combined.hitRate ?? 0) < 0.55) reasons.push("combined_three_window_hit_below_55_percent");
  if ((combined.roi ?? -1) <= 0) reasons.push("combined_three_window_roi_not_positive");
  if ((confirmation.actionable.hitRate ?? 0) < 0.50) reasons.push("confirmation_hit_below_50_percent");
  if ((confirmation.actionable.roi ?? -1) <= -0.02) reasons.push("confirmation_roi_below_minus_2_percent");
  for (const market of args.markets) {
    if ((confirmation.byMarket[market]?.records ?? 0) < 3) reasons.push(`${market}_confirmation_fewer_than_3`);
    if ((confirmation.byMarket[market]?.hitRate ?? 0) < 0.40) reasons.push(`${market}_confirmation_hit_below_40_percent`);
  }
  return {
    semantics: "all_market_policy_inherited_without_single_stat_refit",
    policySelectionExcludedSingleStatOutcomes: true,
    markets: args.markets,
    inheritedPolicy: args.policy,
    reliabilityFit,
    gradePolicy,
    confirmation,
    combined,
    retrospectivePolicyChangeAfterOutcomeReview: true,
    requiresForwardConfirmation: true,
    verdict: { qualified: reasons.length === 0, reasons },
  };
}

function selectPooledSlateRelativeLeanRows(
  rows: readonly ExactPriceReplayRow[],
  policy: SlateRelativeLeanPolicy,
  markets: readonly Market[],
): ExactPriceReplayRow[] {
  const dates = [...new Set(rows.map((row) => easternDateForPreview(row.featureCutoff)))].sort();
  const selected: ExactPriceReplayRow[] = [];
  for (const market of markets) {
    for (const date of dates) {
      const ranked = rows
        .filter((row) => row.market === market && easternDateForPreview(row.featureCutoff) === date)
        .sort((left, right) => rankSignal(right, policy.signalFamily) - rankSignal(left, policy.signalFamily)
          || right.finalProbability - left.finalProbability
          || right.expectedValue - left.expectedValue
          || left.scopeKey.localeCompare(right.scopeKey));
      let retained = 0;
      for (const row of ranked) {
        if (!rankEligibility(row, policy.eligibilityGate)
          || row.finalProbability < policy.minimumProbability
          || row.expectedValue < policy.minimumExpectedValue
          || row.americanPrice < policy.minimumAmericanPrice
          || (policy.requireReferenceBook && row.targetExcludedReferenceBooks < 1)) continue;
        selected.push(row);
        retained += 1;
        if (retained >= policy.maxPerSlate) break;
      }
    }
  }
  return selected;
}

function buildPooledSlateRelativeLeanScorer(
  rows: readonly ExactPriceReplayRow[],
  families: readonly RankSignalFamily[],
  markets: readonly Market[],
) {
  const dates = [...new Set(rows.map((row) => easternDateForPreview(row.featureCutoff)))].sort();
  const sorted = new Map<RankSignalFamily, Map<string, ExactPriceReplayRow[]>>();
  for (const family of families) {
    const groups = new Map<string, ExactPriceReplayRow[]>();
    for (const market of markets) {
      for (const date of dates) {
        groups.set(`${market}|${date}`, rows
          .filter((row) => row.market === market && easternDateForPreview(row.featureCutoff) === date)
          .sort((left, right) => rankSignal(right, family) - rankSignal(left, family)
            || right.finalProbability - left.finalProbability
            || right.expectedValue - left.expectedValue
            || left.scopeKey.localeCompare(right.scopeKey)));
      }
    }
    sorted.set(family, groups);
  }
  return (policy: SlateRelativeLeanPolicy) => {
    const selected: ExactPriceReplayRow[] = [];
    const groups = sorted.get(policy.signalFamily)!;
    for (const market of markets) {
      for (const date of dates) {
        let retained = 0;
        for (const row of groups.get(`${market}|${date}`) ?? []) {
          if (!rankEligibility(row, policy.eligibilityGate)
            || row.finalProbability < policy.minimumProbability
            || row.expectedValue < policy.minimumExpectedValue
            || row.americanPrice < policy.minimumAmericanPrice
            || (policy.requireReferenceBook && row.targetExcludedReferenceBooks < 1)) continue;
          selected.push(row);
          retained += 1;
          if (retained >= policy.maxPerSlate) break;
        }
      }
    }
    const summarize = (values: readonly ExactPriceReplayRow[]) => {
      const wins = values.filter((row) => row.finalSide === row.outcomeSide).length;
      const units = values.reduce((sum, row) => sum + unitReturn(
        row.finalSide === row.outcomeSide,
        row.americanPrice,
      ), 0);
      const overs = values.filter((row) => row.finalSide === "over").length;
      return {
        records: values.length,
        wins,
        losses: values.length - wins,
        hitRate: values.length > 0 ? wins / values.length : null,
        units,
        roi: values.length > 0 ? units / values.length : null,
        overs,
        unders: values.length - overs,
      };
    };
    return {
      actionable: summarize(selected),
      byMarket: Object.fromEntries(markets.map((market) => [
        market,
        summarize(selected.filter((row) => row.market === market)),
      ])) as Partial<Record<Market, ReturnType<typeof summarize>>>,
      slateDates: dates.length,
      slatesWithActionable: new Set(selected.map((row) => easternDateForPreview(row.featureCutoff))).size,
      boardShare: rows.length > 0 ? selected.length / rows.length : null,
    };
  };
}

function robustPooledSlateRelativeLeanScore(candidate: {
  reliabilityFit: ReturnType<ReturnType<typeof buildPooledSlateRelativeLeanScorer>>;
  gradePolicy: ReturnType<ReturnType<typeof buildPooledSlateRelativeLeanScorer>>;
}, markets: readonly Market[]): number {
  const aggregate = Math.min(
    slateRelativeLeanScore(candidate.reliabilityFit),
    slateRelativeLeanScore(candidate.gradePolicy),
  );
  const marketFloor = Math.min(...markets.map((market) => Math.min(
    (candidate.reliabilityFit.byMarket[market]?.hitRate ?? 0) - 0.5,
    (candidate.gradePolicy.byMarket[market]?.hitRate ?? 0) - 0.5,
  )));
  return aggregate + 0.25 * marketFloor;
}

function scoreSlateRelativeLeanPolicy(
  rows: readonly ExactPriceReplayRow[],
  policy: SlateRelativeLeanPolicy,
) {
  return buildSlateRelativeLeanScorer(rows, [policy.signalFamily])(policy);
}

function buildSlateRelativeLeanScorer(
  rows: readonly ExactPriceReplayRow[],
  families: readonly RankSignalFamily[],
) {
  const slateDates = [...new Set(rows.map((row) => easternDateForPreview(row.featureCutoff)))].sort();
  const sortedByFamilyAndDate = new Map<RankSignalFamily, Map<string, ExactPriceReplayRow[]>>();
  for (const family of families) {
    const byDate = new Map<string, ExactPriceReplayRow[]>();
    for (const date of slateDates) {
      byDate.set(date, rows
        .filter((row) => easternDateForPreview(row.featureCutoff) === date)
        .sort((left, right) => rankSignal(right, family) - rankSignal(left, family)
          || right.finalProbability - left.finalProbability
          || right.expectedValue - left.expectedValue
          || left.scopeKey.localeCompare(right.scopeKey)));
    }
    sortedByFamilyAndDate.set(family, byDate);
  }
  return (policy: SlateRelativeLeanPolicy) => {
    const selected: ExactPriceReplayRow[] = [];
    const byDate = sortedByFamilyAndDate.get(policy.signalFamily)!;
    for (const date of slateDates) {
      let retained = 0;
      for (const row of byDate.get(date) ?? []) {
        if (!rankEligibility(row, policy.eligibilityGate)
          || row.finalProbability < policy.minimumProbability
          || row.expectedValue < policy.minimumExpectedValue
          || row.americanPrice < policy.minimumAmericanPrice
          || (policy.requireReferenceBook && row.targetExcludedReferenceBooks < 1)) continue;
        selected.push(row);
        retained += 1;
        if (retained >= policy.maxPerSlate) break;
      }
    }
    const wins = selected.filter((row) => row.finalSide === row.outcomeSide).length;
    const units = selected.reduce((sum, row) => sum + unitReturn(
      row.finalSide === row.outcomeSide,
      row.americanPrice,
    ), 0);
    const overs = selected.filter((row) => row.finalSide === "over").length;
    return {
      actionable: {
        records: selected.length,
        wins,
        losses: selected.length - wins,
        hitRate: selected.length > 0 ? wins / selected.length : null,
        units,
        roi: selected.length > 0 ? units / selected.length : null,
        overs,
        unders: selected.length - overs,
      },
      slateDates: slateDates.length,
      slatesWithActionable: new Set(selected.map((row) => easternDateForPreview(row.featureCutoff))).size,
      boardShare: rows.length > 0 ? selected.length / rows.length : null,
    };
  };
}

function slateRelativeLeanScore(summary: ReturnType<typeof scoreSlateRelativeLeanPolicy>): number {
  return (summary.actionable.roi ?? -1)
    + 0.35 * ((summary.actionable.hitRate ?? 0) - 0.5)
    + 0.02 * Math.min(summary.actionable.records, 10);
}

function robustSlateRelativeLeanScore(candidate: {
  reliabilityFit: ReturnType<typeof scoreSlateRelativeLeanPolicy>;
  gradePolicy: ReturnType<typeof scoreSlateRelativeLeanPolicy>;
}): number {
  return Math.min(
    slateRelativeLeanScore(candidate.reliabilityFit),
    slateRelativeLeanScore(candidate.gradePolicy),
  );
}

function gradeRowWithRelativeBest(
  row: ExactPriceReplayRow,
  policy: GradePolicy,
  audit: ReturnType<typeof auditRelativeBestAngleTier>,
): GradeName {
  const base = grade(row, policy);
  if ((base !== "Best Angle" && base !== "Lean") || !audit.qualified || !audit.selected) return base;
  return rankSignal(row, audit.selected.signalFamily) >= audit.selected.threshold ? "Best Angle" : "Lean";
}

function selectPreviewGames(rows: readonly (ExactPriceReplayRow & { grade: GradeName })[]): Set<number> {
  const scoreByDate = new Map<string, { qualified: number; total: number; games: Set<number> }>();
  for (const row of rows) {
    const date = easternDateForPreview(row.featureCutoff);
    const score = scoreByDate.get(date) ?? { qualified: 0, total: 0, games: new Set<number>() };
    score.total += 1;
    score.games.add(row.gameId);
    if (row.grade === "Best Angle" || row.grade === "Lean") score.qualified += 1;
    scoreByDate.set(date, score);
  }
  const selectedDate = [...scoreByDate.entries()]
    .filter(([, score]) => score.games.size >= 2)
    .sort((left, right) => right[1].qualified - left[1].qualified || right[1].games.size - left[1].games.size || right[1].total - left[1].total)[0]?.[0]
    ?? [...scoreByDate.keys()].sort()[0];
  const slateRows = selectedDate ? rows.filter((row) => easternDateForPreview(row.featureCutoff) === selectedDate) : rows;
  const scoreByGame = new Map<number, { qualified: number; total: number }>();
  for (const row of slateRows) {
    const score = scoreByGame.get(row.gameId) ?? { qualified: 0, total: 0 };
    score.total += 1;
    if (row.grade === "Best Angle" || row.grade === "Lean") score.qualified += 1;
    scoreByGame.set(row.gameId, score);
  }
  const selected = [...scoreByGame.entries()]
    .sort((left, right) => right[1].qualified - left[1].qualified || right[1].total - left[1].total)
    .slice(0, 3)
    .map(([gameId]) => gameId);
  return new Set(selected);
}

function easternDateForPreview(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function fitSingleSignalGradeReliability(
  rows: readonly ExactPriceReplayRow[],
  family: GradeReliabilityModel["family"],
): GradeReliabilityModel {
  const ordered = [...rows].sort((left, right) => Date.parse(left.featureCutoff) - Date.parse(right.featureCutoff));
  const split = Math.max(4, Math.min(ordered.length - 2, Math.floor(ordered.length * 0.7)));
  const fitRows = ordered.slice(0, split);
  const internalValidation = ordered.slice(split);
  const features = featuresForReliabilityFamily(family);
  const selected = [0.5, 1, 2, 5, 10, 20, 50].map((lambda) => {
    const model = fitGradeReliabilityAtLambda(fitRows, lambda, features, family);
    return { model, loss: reliabilityLogLoss(internalValidation, model) ?? Infinity };
  }).sort((left, right) => left.loss - right.loss || left.model.lambda - right.model.lambda)[0]!;
  const refit = calibrateReliabilityIntercept(
    fitGradeReliabilityAtLambda(ordered, selected.model.lambda, features, family),
    ordered,
  );
  return {
    ...refit,
    fitRows: ordered.length,
    pooledRows: 0,
    internalValidationRows: internalValidation.length,
    internalValidationLogLoss: Number.isFinite(selected.loss) ? selected.loss : null,
  };
}

function featuresForReliabilityFamily(
  family: GradeReliabilityModel["family"],
): readonly ReliabilityFeature[] {
  if (family === "raw_model_only") return ["raw_model_logit"];
  if (family === "projection_distance_only") return ["standardized_projection_distance"];
  if (family === "target_excluded_only") return ["target_excluded_margin"];
  if (family === "target_price_only") return ["target_price_implied_probability"];
  return GRADE_RELIABILITY_FEATURES;
}

function fitGradeReliabilityAtLambda(
  rows: readonly ExactPriceReplayRow[],
  lambda: number,
  features: readonly ReliabilityFeature[] = GRADE_RELIABILITY_FEATURES,
  family: GradeReliabilityModel["family"] = "market_specific",
): GradeReliabilityModel {
  const raw = rows.map((row) => reliabilityFeatureVector(row, features));
  const means = features.map((_, index) => mean(raw.map((values) => values[index]!)) ?? 0);
  const scales = features.map((_, index) => standardDeviation(raw.map((values) => values[index]!)) || 1);
  const x = raw.map((values) => [1, ...values.map((value, index) => (value - means[index]!) / scales[index]!)]);
  const y = rows.map((row) => Number(row.finalSide === row.outcomeSide));
  const baseRate = Math.min(1 - 1e-4, Math.max(1e-4, mean(y) ?? 0.5));
  const coefficients = [Math.log(baseRate / (1 - baseRate)), ...features.map(() => 0)];
  const learningRate = 0.04;
  for (let iteration = 0; iteration < 4_000; iteration += 1) {
    const gradient = coefficients.map(() => 0);
    x.forEach((values, rowIndex) => {
      const probability = sigmoid(values.reduce((sum, value, index) => sum + value * coefficients[index]!, 0));
      const error = probability - y[rowIndex]!;
      values.forEach((value, index) => { gradient[index]! += error * value; });
    });
    coefficients.forEach((coefficient, index) => {
      const penalty = index === 0 ? 0 : lambda * coefficient;
      coefficients[index] = coefficient - learningRate * ((gradient[index]! + penalty) / Math.max(1, rows.length));
    });
  }
  return {
    release: "nba_player_props_grade_reliability_research_2026_10_20_r3_five_stage_chronology",
    features,
    means,
    scales,
    coefficients,
    lambda,
    family,
    fitRows: rows.length,
    pooledRows: 0,
    internalValidationRows: 0,
    internalValidationLogLoss: null,
  };
}

function calibrateReliabilityIntercept(
  model: GradeReliabilityModel,
  rows: readonly ExactPriceReplayRow[],
): GradeReliabilityModel {
  let best = { offset: 0, loss: reliabilityLogLoss(rows, model) ?? Infinity };
  for (let offset = -1.5; offset <= 1.5001; offset += 0.025) {
    const candidate = { ...model, coefficients: [model.coefficients[0]! + offset, ...model.coefficients.slice(1)] };
    const loss = reliabilityLogLoss(rows, candidate) ?? Infinity;
    if (loss < best.loss) best = { offset, loss };
  }
  return {
    ...model,
    coefficients: [model.coefficients[0]! + best.offset, ...model.coefficients.slice(1)],
  };
}

function applyGradeReliabilityModel(
  rows: readonly ExactPriceReplayRow[],
  model: GradeReliabilityModel,
): ExactPriceReplayRow[] {
  return rows.map((row) => {
    const raw = reliabilityFeatureVector(row, model.features);
    const values = [1, ...raw.map((value, index) => (value - model.means[index]!) / model.scales[index]!)];
    const finalProbability = boundedProbability(sigmoid(values.reduce(
      (sum, value, index) => sum + value * (model.coefficients[index] ?? 0),
      0,
    )));
    return {
      ...row,
      finalProbability,
      expectedValue: expectedValue(finalProbability, row.americanPrice),
    };
  });
}

function reliabilityFeatureVector(
  row: ExactPriceReplayRow,
  features: readonly ReliabilityFeature[] = GRADE_RELIABILITY_FEATURES,
): number[] {
  const rawProbability = boundedProbability(row.rawFinalProbability);
  const values: Record<ReliabilityFeature, number> = {
    raw_model_logit: Math.log(rawProbability / (1 - rawProbability)),
    standardized_projection_distance: Math.abs(row.finalProjection - row.line) / Math.max(0.25, row.projectionStandardDeviation),
    target_excluded_margin: row.targetExcludedProbability - 0.5,
    target_price_implied_probability: implied(row.americanPrice),
    independent_final_agreement: Number(row.independentSide === row.finalSide),
    reference_book_confirmation: Number(row.targetExcludedReferenceBooks > 0),
  };
  return features.map((feature) => values[feature]);
}

function reliabilityLogLoss(
  rows: readonly ExactPriceReplayRow[],
  model: GradeReliabilityModel,
): number | null {
  const scored = applyGradeReliabilityModel(rows, model);
  return mean(scored.map((row) => {
    const won = row.finalSide === row.outcomeSide;
    return won ? -Math.log(row.finalProbability) : -Math.log(1 - row.finalProbability);
  }));
}

function reliabilityDiagnostics(rows: readonly ExactPriceReplayRow[]) {
  const ordered = [...rows].sort((left, right) => right.finalProbability - left.finalProbability);
  const quartile = Math.max(1, Math.floor(ordered.length / 4));
  const top = ordered.slice(0, quartile);
  const bottom = ordered.slice(-quartile);
  const hitRate = (values: readonly ExactPriceReplayRow[]) => mean(values.map(
    (row) => Number(row.finalSide === row.outcomeSide),
  ));
  return {
    rows: rows.length,
    auc: reliabilityAuc(rows),
    topQuartileRows: top.length,
    topQuartileHitRate: hitRate(top),
    bottomQuartileRows: bottom.length,
    bottomQuartileHitRate: hitRate(bottom),
    rankSpread: (hitRate(top) ?? 0) - (hitRate(bottom) ?? 0),
  };
}

function signalRankDiagnostics(rows: readonly ExactPriceReplayRow[]) {
  const signals: Record<string, (row: ExactPriceReplayRow) => number> = {
    rawModelProbability: (row) => row.rawFinalProbability,
    standardizedProjectionDistance: (row) => Math.abs(row.finalProjection - row.line) / Math.max(0.25, row.projectionStandardDeviation),
    targetExcludedProbability: (row) => row.targetExcludedProbability,
    targetPriceImpliedProbability: (row) => implied(row.americanPrice),
    independentFinalAgreement: (row) => Number(row.independentSide === row.finalSide),
    referenceBookConfirmation: (row) => Number(row.targetExcludedReferenceBooks > 0),
  };
  return Object.fromEntries(Object.entries(signals).map(([name, score]) => [name, {
    auc: scoreAuc(rows, score),
    upperHalfHitRate: rankedHalfHitRate(rows, score, "upper"),
    lowerHalfHitRate: rankedHalfHitRate(rows, score, "lower"),
  }]));
}

function scoreAuc(
  rows: readonly ExactPriceReplayRow[],
  score: (row: ExactPriceReplayRow) => number,
): number | null {
  const wins = rows.filter((row) => row.finalSide === row.outcomeSide);
  const losses = rows.filter((row) => row.finalSide !== row.outcomeSide);
  if (wins.length === 0 || losses.length === 0) return null;
  let value = 0;
  for (const win of wins) {
    for (const loss of losses) {
      value += score(win) > score(loss) ? 1 : score(win) === score(loss) ? 0.5 : 0;
    }
  }
  return value / (wins.length * losses.length);
}

function rankedHalfHitRate(
  rows: readonly ExactPriceReplayRow[],
  score: (row: ExactPriceReplayRow) => number,
  half: "upper" | "lower",
): number | null {
  const ordered = [...rows].sort((left, right) => score(right) - score(left));
  const midpoint = Math.max(1, Math.floor(ordered.length / 2));
  const selected = half === "upper" ? ordered.slice(0, midpoint) : ordered.slice(midpoint);
  return mean(selected.map((row) => Number(row.finalSide === row.outcomeSide)));
}

function reliabilityAuc(rows: readonly ExactPriceReplayRow[]): number | null {
  const wins = rows.filter((row) => row.finalSide === row.outcomeSide);
  const losses = rows.filter((row) => row.finalSide !== row.outcomeSide);
  if (wins.length === 0 || losses.length === 0) return null;
  let score = 0;
  for (const win of wins) {
    for (const loss of losses) {
      score += win.finalProbability > loss.finalProbability ? 1 : win.finalProbability === loss.finalProbability ? 0.5 : 0;
    }
  }
  return score / (wins.length * losses.length);
}

function boundedProbability(value: number): number {
  return Math.min(1 - 1e-6, Math.max(1e-6, value));
}

function sigmoid(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-Math.min(40, value)));
  const exponential = Math.exp(Math.max(-40, value));
  return exponential / (1 + exponential);
}

function fitProbabilityCalibration(rows: readonly ExactPriceReplayRow[]): {
  intercept: number;
  slope: number;
  selectionLogLoss: number | null;
} {
  if (rows.length === 0) return { intercept: 0, slope: 0, selectionLogLoss: null };
  let best = { intercept: 0, slope: 1, selectionLogLoss: Infinity };
  for (let intercept = -0.5; intercept <= 0.5001; intercept += 0.05) {
    for (let slope = 0; slope <= 1.5001; slope += 0.05) {
      const loss = mean(rows.map((row) => {
        const probability = plattProbability(row.finalProbability, intercept, slope);
        return row.finalSide === row.outcomeSide ? -Math.log(probability) : -Math.log(1 - probability);
      })) ?? Infinity;
      if (loss < best.selectionLogLoss) best = { intercept, slope, selectionLogLoss: loss };
    }
  }
  return best;
}

function plattProbability(probability: number, intercept: number, slope: number): number {
  const bounded = Math.min(1 - 1e-6, Math.max(1e-6, probability));
  const logit = Math.log(bounded / (1 - bounded));
  const calibrated = 1 / (1 + Math.exp(-(intercept + slope * logit)));
  return Math.min(1 - 1e-6, Math.max(1e-6, calibrated));
}

function underlyingIndependentCandidate(candidate: CandidateName, market: Market): CandidateName {
  if (candidate.startsWith("market_read_") || candidate.startsWith("fanduel_")) {
    return "ridge_r2_minutes_regression";
  }
  if (candidate.startsWith("hybrid_market_read_")) {
    return market === "rebounds" || market === "threes" || market === "rebounds_assists"
      ? "opportunity_direct_counts"
      : "ridge_r2_minutes_regression";
  }
  return candidate;
}

function residualDistribution(
  rows: readonly NbaPlayerPropFeatureRow[],
  market: Market,
  predict: (row: NbaPlayerPropFeatureRow, market: Market) => number,
): { bias: number; standardDeviation: number } {
  const errors = rows.flatMap((row) => {
    const actual = target(row, market);
    return actual === null ? [] : [actual - predict(row, market)];
  });
  return {
    bias: mean(errors) ?? 0,
    standardDeviation: Math.max(0.25, standardDeviation(errors)),
  };
}

function residualProbabilityOver(args: {
  line: number;
  projection: number;
  bias: number;
  standardDeviation: number;
}): number {
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

function unitReturn(win: boolean, price: number): number {
  if (!win) return -1;
  return price > 0 ? price / 100 : 100 / -price;
}

function sideProbabilityFromOver(probabilityOver: number | null, side: "over" | "under"): number | null {
  return probabilityOver === null ? null : side === "over" ? probabilityOver : 1 - probabilityOver;
}

function opposite(side: "over" | "under"): "over" | "under" {
  return side === "over" ? "under" : "over";
}

function normalizeBook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function predictedMinutes(row: NbaPlayerPropFeatureRow, weights: readonly [number, number, number, number]): number {
  const inputs: Array<[number | null, number]> = [
    [row.minutes_mean_3, weights[0]],
    [row.minutes_mean_5, weights[1]],
    [row.minutes_mean_10, weights[2]],
    [row.minutes_mean_season, weights[3]],
  ];
  const available = inputs.filter((item): item is [number, number] => item[0] !== null && Number.isFinite(item[0]));
  const denominator = available.reduce((sum, [, weight]) => sum + weight, 0);
  return denominator > 0 ? Math.max(0, Math.min(48, available.reduce((sum, [minutes, weight]) => sum + minutes * weight, 0) / denominator)) : 0;
}

function componentRate(row: NbaPlayerPropFeatureRow, component: "points" | "rebounds" | "assists" | "threes"): number | null {
  if (component === "points") return row.points_per_minute_10;
  if (component === "rebounds") return row.rebounds_per_minute_10;
  if (component === "assists") return row.assists_per_minute_10;
  return row.threes_per_minute_10;
}

function componentTarget(row: NbaPlayerPropFeatureRow, component: "points" | "rebounds" | "assists" | "threes"): number | null {
  if (component === "points") return row.target_points;
  if (component === "rebounds") return row.target_rebounds;
  if (component === "assists") return row.target_assists;
  return row.target_threes;
}

function target(row: NbaPlayerPropFeatureRow, market: Market): number | null {
  if (market === "points") return row.target_points;
  if (market === "rebounds") return row.target_rebounds;
  if (market === "assists") return row.target_assists;
  if (market === "threes") return row.target_threes;
  if (market === "points_rebounds_assists") return row.target_points_rebounds_assists;
  if (market === "points_rebounds") return row.target_points_rebounds;
  if (market === "points_assists") return row.target_points_assists;
  return row.target_rebounds_assists;
}

function marketComponents(market: Market): Array<"points" | "rebounds" | "assists" | "threes"> {
  if (market === "points_rebounds_assists") return ["points", "rebounds", "assists"];
  if (market === "points_rebounds") return ["points", "rebounds"];
  if (market === "points_assists") return ["points", "assists"];
  if (market === "rebounds_assists") return ["rebounds", "assists"];
  return [market];
}

function minuteRole(minutes: number): "low" | "rotation" | "starter" | "high" {
  if (minutes < 20) return "low";
  if (minutes < 28) return "rotation";
  if (minutes < 34) return "starter";
  return "high";
}

function scope(row: NbaPlayerPropFeatureRow, market: Market): string {
  return `nba-bdl:${row.game_id}|nba-bdl-player:${row.player_id}|${market}`;
}

function consensusNoVigOver(rows: readonly NbaPlayerPropPriceObservation[]): number | null {
  const byBook = new Map<string, NbaPlayerPropPriceObservation[]>();
  for (const row of rows) byBook.set(row.sportsbook, [...(byBook.get(row.sportsbook) ?? []), row]);
  const probabilities: number[] = [];
  for (const bookRows of byBook.values()) {
    const over = bookRows.find((row) => row.side === "over");
    const under = bookRows.find((row) => row.side === "under");
    if (!over || !under) continue;
    const overImplied = implied(over.americanPrice);
    const underImplied = implied(under.americanPrice);
    probabilities.push(overImplied / (overImplied + underImplied));
  }
  return median(probabilities);
}

function noVigOverForBook(
  rows: readonly NbaPlayerPropPriceObservation[],
  sportsbook: string,
): number | null {
  const bookRows = rows.filter((row) => row.sportsbook.toLowerCase() === sportsbook.toLowerCase());
  const over = bookRows.find((row) => row.side === "over");
  const under = bookRows.find((row) => row.side === "under");
  if (!over || !under) return null;
  const overImplied = implied(over.americanPrice);
  const underImplied = implied(under.americanPrice);
  return overImplied / (overImplied + underImplied);
}

function confirmedFanduelProbability(rows: readonly NbaPlayerPropPriceObservation[]): number | null {
  const fanduel = noVigOverForBook(rows, "fanduel");
  if (fanduel === null || fanduel === 0.5) return null;
  const confirmingBooks = [...new Set(rows.map((row) => row.sportsbook.toLowerCase()))]
    .filter((book) => book !== "fanduel")
    .flatMap((book) => {
      const probability = noVigOverForBook(rows, book);
      return probability === null ? [] : [probability];
    })
    .filter((probability) => (probability > 0.5) === (fanduel > 0.5));
  return confirmingBooks.length >= 1 ? fanduel : null;
}

function implied(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

function chronological(rows: readonly NbaPlayerPropFeatureRow[]): NbaPlayerPropFeatureRow[] {
  return [...rows].sort((a, b) => Date.parse(a.feature_cutoff) - Date.parse(b.feature_cutoff) || a.game_id - b.game_id || a.player_id - b.player_id);
}

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : null;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[index]! : (ordered[index - 1]! + ordered[index]!) / 2;
}

function nonNull(values: readonly (number | null)[]): number[] {
  return values.filter((item): item is number => item !== null && Number.isFinite(item));
}

function standardDeviation(values: readonly number[]): number {
  const average = mean(values);
  if (average === null || values.length < 2) return 0;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
