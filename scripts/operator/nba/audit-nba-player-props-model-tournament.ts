/**
 * Offline-only NBA player-props model tournament.
 *
 * Candidate selection uses a chronological selection window. The winning
 * family is then refit on development + selection and evaluated exactly once
 * on the later untouched confirmation window. No production or member writes.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  fitNbaPlayerPropsIndependentResearchModel,
  projectNbaPlayerPropsIndependent,
  type NbaPlayerPropCombination,
  type NbaPlayerPropsIndependentResearchModel,
} from "../../../lib/services/nba/nbaPlayerPropsIndependentModel";
import {
  selectNbaPlayerPropsCanonicalOfferSets,
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
  | "structural_direct_counts"
  | "structural_log_counts"
  | "opportunity_direct_counts"
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
  | "participation_rate_10"
  | "same_team_games_10"
  | "changed_team_since_last_game"
  | "days_rest"
  | "is_home"
  | "team_back_to_back"
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
  | "team_three_point_attempt_share_5"
  | "opponent_matchup_three_point_pct_5"
  | "opponent_contested_shots_per100_5"
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

async function main(): Promise<void> {
  const input = value("--input");
  if (!input) throw new Error("--input is required.");
  const outputValue = value("--output");
  const dataset = JSON.parse(await readFile(input, "utf8")) as Dataset;
  if (dataset.mode !== "offline_research_only" || dataset.actionable !== false) {
    throw new Error("NBA props tournament accepts only an offline, non-actionable research dataset.");
  }

  const modelingGames = dataset.projectionGames ?? dataset.games;
  const modelingRows = dataset.projectionFeatureRows ?? dataset.featureRows;
  const orderedGames = [...modelingGames]
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || a.gameId - b.gameId);
  if (orderedGames.length < 30) throw new Error("NBA props tournament requires at least 30 chronological games.");
  const developmentEnd = Math.floor(orderedGames.length * 0.60);
  const selectionEnd = Math.floor(orderedGames.length * 0.80);
  const developmentIds = new Set(orderedGames.slice(0, developmentEnd).map((game) => game.gameId));
  const selectionIds = new Set(orderedGames.slice(developmentEnd, selectionEnd).map((game) => game.gameId));
  const confirmationIds = new Set(orderedGames.slice(selectionEnd).map((game) => game.gameId));
  const development = chronological(modelingRows.filter((row) => developmentIds.has(row.game_id)));
  const selection = chronological(modelingRows.filter((row) => selectionIds.has(row.game_id)));
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
    structuralCountCandidate("structural_direct_counts", "identity"),
    structuralCountCandidate("structural_log_counts", "log1p"),
    opportunityCountCandidate(),
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
      evaluate(selection, market, predict, lineByScope),
    ]));
  }

  const selectedByMarket = Object.fromEntries(MARKETS.map((market) => [
    market,
    selectCandidate(candidates, selectionMetrics, market),
  ])) as Record<Market, CandidateName>;

  const fitRows = chronological([...development, ...selection]);
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
        selection,
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
  const selectionWindowGames = orderedGames.slice(0, selectionEnd);
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
    release: "nba_player_props_model_tournament_2026_10_20_r2_expanded_projection_window",
    mode: "offline_research_only",
    actionable: false,
    sourceDatasetRelease: dataset.release,
    immutableInputsSha256: dataset.immutableInputsSha256,
    split: {
      population: dataset.projectionPopulation ?? "Opening-price player population.",
      developmentGames: developmentIds.size,
      selectionGames: selectionIds.size,
      untouchedConfirmationGames: confirmationIds.size,
      developmentRows: development.length,
      selectionRows: selection.length,
      confirmationRows: confirmation.length,
      confirmationFrom: confirmation[0]?.feature_cutoff ?? null,
      confirmationThrough: confirmation.at(-1)?.feature_cutoff ?? null,
    },
    selectionMetrics,
    selectedByMarket,
    confirmationCandidateMetrics,
    confirmationMetrics,
    selectionWindowStability,
    walkForwardStability,
    launchDecision: "not_fit",
    reasons: [
      "A single confirmation block is still insufficient for production qualification.",
      "Opening prices cannot validate same-book movement or lock-time market arbitration.",
      "No grade, stake, promotion, demotion, or member output was evaluated.",
    ],
    integrity: {
      chronologicalGameSplit: true,
      candidateSelectionExcludedConfirmation: true,
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
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
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
    release: "nba_player_props_walk_forward_stability_2026_10_20_r1",
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

function fitMinuteRegression(rows: readonly NbaPlayerPropFeatureRow[]): MinuteRegression {
  const ordered = chronological(rows).filter((row) => (row.target_minutes ?? 0) > 0);
  const split = Math.max(8, Math.min(ordered.length - 4, Math.floor(ordered.length * 0.75)));
  const train = ordered.slice(0, split);
  const validate = ordered.slice(split);
  const candidates = [0.1, 1, 5, 20, 100];
  return candidates.map((lambda) => fitMinuteRegressionAtLambda(train, lambda))
    .sort((left, right) => minuteRegressionMae(validate, left) - minuteRegressionMae(validate, right))[0]!;
}

function fitMinuteRegressionAtLambda(rows: readonly NbaPlayerPropFeatureRow[], lambda: number): MinuteRegression {
  const means = MINUTE_FEATURES.map((feature) => mean(nonNull(rows.map((row) => row[feature]))) ?? 0);
  const scales = MINUTE_FEATURES.map((feature, index) => standardDeviation(nonNull(rows.map((row) => row[feature]))) || Math.max(1, Math.abs(means[index]!)));
  const x = rows.map((row) => [1, ...MINUTE_FEATURES.map((feature, index) => ((row[feature] ?? means[index]!) - means[index]!) / scales[index]!)]);
  const y = rows.map((row) => row.target_minutes!);
  return { features: MINUTE_FEATURES, means, scales, coefficients: ridgeSolve(x, y, lambda), lambda };
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
  return [...pool].sort((left, right) => {
    const a = metrics[left.name]![market]!;
    const b = metrics[right.name]![market]!;
    return (a.mae! - b.mae!) || ((b.directionHitRate ?? 0) - (a.directionHitRate ?? 0));
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
