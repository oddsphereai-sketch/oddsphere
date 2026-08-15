export const IMMEDIATE_MARKET_CHAMPION_POLICY_VERSION =
  "immediate_market_champion_policy_v2_raw_projection_champions_2026_08_15" as const;

export const MLB_MONEYLINE_POSITIVE_EV_FAVORITE_RULE_ID =
  "mlb_moneyline_positive_ev_favorite_addition_v1_2026_08_15" as const;
export const MLB_MONEYLINE_RAW_CHAMPION_ACTION_RULE_ID =
  "mlb_moneyline_raw_champion_replace_minus120_plus129_v1_2026_08_15" as const;
export const MLB_TOTAL_PRICE_CALIBRATION_RULE_ID =
  "mlb_total_price_calibration_side_floor_v1_2026_08_15" as const;
export const MLB_MONEYLINE_RAW_SIDE_CHAMPION_RULE_ID =
  "mlb_away_market_40_45_raw_side_champion_v1_2026_08_15" as const;
export const MLB_TOTAL_RUNTIME_RESIDUAL_CHAMPION_RULE_ID =
  "mlb_total_runtime_residual_guarded40_champion_v1_2026_08_15" as const;
export const WNBA_MONEYLINE_POSITIVE_EV_ADDITION_RULE_ID =
  "wnba_moneyline_positive_ev_addition_v1_2026_08_15" as const;
export const WNBA_SPREAD_PRICE_CHAMPION_RULE_ID =
  "wnba_spread_price_champion_v1_2026_08_15" as const;
export const WNBA_TOTAL_REFLECTED_PROJECTION_CHAMPION_RULE_ID =
  "wnba_total_market_reflected_projection_v1_2026_08_15" as const;

export const WNBA_SPREAD_POLICY_MIN_EDGE = 0.02;

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export function americanBreakEvenProbability(odds: number | null): number | null {
  if (!finite(odds) || odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function clampProbability(value: number): number {
  return Math.min(0.999999, Math.max(0.000001, value));
}

function logit(value: number): number {
  const probability = clampProbability(value);
  return Math.log(probability / (1 - probability));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

export function resolveMlbMoneylineRawSideChampion(args: {
  currentSide: "home" | "away" | null;
  currentModelProbability: number | null;
  currentMarketProbability: number | null;
  homeOdds: number | null;
}):
  | {
      applied: true;
      ruleId: typeof MLB_MONEYLINE_RAW_SIDE_CHAMPION_RULE_ID;
      correctedSide: "home";
      correctedOdds: number;
      correctedModelProbability: number;
      correctedMarketProbability: number;
    }
  | { applied: false; reason: string } {
  if (args.currentSide !== "away") return { applied: false, reason: "current_side_not_away" };
  if (!finite(args.currentModelProbability)) return { applied: false, reason: "missing_model_probability" };
  if (!finite(args.currentMarketProbability)) return { applied: false, reason: "missing_market_probability" };
  if (args.currentMarketProbability < 0.4 || args.currentMarketProbability >= 0.45) {
    return { applied: false, reason: "outside_locked_market_40_45_cohort" };
  }
  if (!finite(args.homeOdds)) return { applied: false, reason: "missing_exact_opposite_price" };
  return {
    applied: true,
    ruleId: MLB_MONEYLINE_RAW_SIDE_CHAMPION_RULE_ID,
    correctedSide: "home",
    correctedOdds: args.homeOdds,
    correctedModelProbability: 1 - args.currentMarketProbability,
    correctedMarketProbability: 1 - args.currentMarketProbability,
  };
}

export type MlbTotalRuntimeResidualInputs = {
  currentSide: "over" | "under" | null;
  currentMarketProbability: number | null;
  independentTotal: number | null;
  posteriorTotal: number | null;
  marketTotal: number | null;
  homeStarterEra: number | null;
  awayStarterEra: number | null;
  homeBullpenFactor: number | null;
  awayBullpenFactor: number | null;
  homeLineupWeightedOps: number | null;
  awayLineupWeightedOps: number | null;
  homeTopOrderOps: number | null;
  awayTopOrderOps: number | null;
  parkFactorRuns: number | null;
  weatherTotalAdjust: number | null;
  leagueAverageEra: number | null;
  leagueAverageOps: number | null;
  overOdds: number | null;
  underOdds: number | null;
  overLine: number | null;
  underLine: number | null;
};

export function resolveMlbTotalRuntimeResidualChampion(args: MlbTotalRuntimeResidualInputs):
  | {
      applied: true;
      ruleId: typeof MLB_TOTAL_RUNTIME_RESIDUAL_CHAMPION_RULE_ID;
      correctedSide: "over" | "under";
      correctedOdds: number;
      correctedLine: number;
      correctedModelProbability: number;
      correctedMarketProbability: number | null;
      projectedMarketResidual: number;
      overProbability: number;
    }
  | { applied: false; reason: string; projectedMarketResidual?: number; overProbability?: number } {
  if (args.currentSide !== "over" && args.currentSide !== "under") {
    return { applied: false, reason: "missing_current_side" };
  }
  if (!finite(args.independentTotal) || !finite(args.posteriorTotal) || !finite(args.marketTotal)) {
    return { applied: false, reason: "missing_required_projection_input" };
  }
  const leagueEra = finite(args.leagueAverageEra) ? args.leagueAverageEra : 4.2;
  const leagueOps = finite(args.leagueAverageOps) ? args.leagueAverageOps : 0.72;
  const starterSumCentered = finite(args.homeStarterEra) && finite(args.awayStarterEra)
    ? args.homeStarterEra + args.awayStarterEra - 2 * leagueEra
    : 0;
  const bullpenSumCentered = finite(args.homeBullpenFactor) && finite(args.awayBullpenFactor)
    ? args.homeBullpenFactor + args.awayBullpenFactor - 2
    : 0;
  const lineupSumCentered = finite(args.homeLineupWeightedOps) && finite(args.awayLineupWeightedOps)
    ? args.homeLineupWeightedOps + args.awayLineupWeightedOps - 2 * leagueOps
    : 0;
  const topOrderSumCentered = finite(args.homeTopOrderOps) && finite(args.awayTopOrderOps)
    ? args.homeTopOrderOps + args.awayTopOrderOps - 2 * leagueOps
    : 0;
  const projectedMarketResidual =
    0.21937246
    + 0.21467304 * (args.independentTotal - args.marketTotal)
    - 0.23219491 * (args.posteriorTotal - args.marketTotal)
    - 0.08283439 * starterSumCentered
    - 0.38844991 * bullpenSumCentered
    + 1.42575875 * lineupSumCentered
    + 1.87298987 * topOrderSumCentered
    + 0.00048605 * ((args.parkFactorRuns ?? 1) - 1)
    - 1.32100637 * (args.weatherTotalAdjust ?? 0)
    - 0.04736969 * (args.marketTotal - 8.5);
  const overProbability = clampProbability(sigmoid(-0.30863529 + 0.47301004 * projectedMarketResidual));
  const currentSideProbability = args.currentSide === "over" ? overProbability : 1 - overProbability;
  if (currentSideProbability >= 0.4) {
    return {
      applied: false,
      reason: "candidate_does_not_strongly_oppose_current_side",
      projectedMarketResidual,
      overProbability,
    };
  }
  const correctedSide = args.currentSide === "over" ? "under" : "over";
  const correctedOdds = correctedSide === "over" ? args.overOdds : args.underOdds;
  const correctedLine = correctedSide === "over" ? args.overLine : args.underLine;
  if (!finite(correctedOdds) || !finite(correctedLine)) {
    return {
      applied: false,
      reason: "missing_exact_opposite_price_or_line",
      projectedMarketResidual,
      overProbability,
    };
  }
  return {
    applied: true,
    ruleId: MLB_TOTAL_RUNTIME_RESIDUAL_CHAMPION_RULE_ID,
    correctedSide,
    correctedOdds,
    correctedLine,
    correctedModelProbability: 1 - currentSideProbability,
    correctedMarketProbability: finite(args.currentMarketProbability)
      ? 1 - args.currentMarketProbability
      : null,
    projectedMarketResidual,
    overProbability,
  };
}

export function resolveMlbMoneylineChampionAction(args: {
  currentActionable: boolean;
  blocked: boolean;
  modelProbability: number | null;
  oddsAmerican: number | null;
}): { actionable: boolean; promoted: boolean; demoted: boolean; ruleId: string | null } {
  if (args.blocked) {
    return {
      actionable: false,
      promoted: false,
      demoted: args.currentActionable,
      ruleId: null,
    };
  }
  const breakEven = americanBreakEvenProbability(args.oddsAmerican);
  const oddsAmerican = finite(args.oddsAmerican) ? args.oddsAmerican : null;
  const positiveEv =
    finite(args.modelProbability)
    && oddsAmerican !== null
    && oddsAmerican < 0
    && breakEven !== null
    && args.modelProbability >= breakEven;
  const inRawChampionReplacementScope =
    oddsAmerican !== null
    && oddsAmerican >= -120
    && oddsAmerican <= 129;
  const actionable = inRawChampionReplacementScope
    ? finite(args.modelProbability)
      && breakEven !== null
      && args.modelProbability >= breakEven
    : args.currentActionable || positiveEv;
  const promoted = actionable && !args.currentActionable;
  const demoted = !actionable && args.currentActionable;
  return {
    actionable,
    promoted,
    demoted,
    ruleId: inRawChampionReplacementScope
      ? MLB_MONEYLINE_RAW_CHAMPION_ACTION_RULE_ID
      : promoted
        ? MLB_MONEYLINE_POSITIVE_EV_FAVORITE_RULE_ID
        : null,
  };
}

export function calibrateMlbTotalPickedProbability(args: {
  rawPickedProbability: number | null;
  oddsAmerican: number | null;
  selectedSide: "over" | "under" | null;
}): number | null {
  const breakEven = americanBreakEvenProbability(args.oddsAmerican);
  if (!finite(args.rawPickedProbability) || breakEven === null || args.selectedSide === null) return null;
  const side = args.selectedSide === "over" ? 1 : -1;
  const currentLogit = logit(args.rawPickedProbability);
  const fittedLogit =
    -0.14895836
    + 1.46328019 * currentLogit
    - 0.28675006 * logit(breakEven)
    - 2.55686481 * (args.rawPickedProbability - breakEven)
    - 0.06540133 * side
    - 0.10104962 * currentLogit * side;
  return Math.max(0.5, clampProbability(sigmoid(fittedLogit)));
}

export function resolveWnbaMoneylineChampionAction(args: {
  currentActionable: boolean;
  modelProbability: number | null;
  oddsAmerican: number | null;
}): { actionable: boolean; promoted: boolean; ruleId: string | null } {
  if (args.currentActionable) return { actionable: true, promoted: false, ruleId: null };
  const breakEven = americanBreakEvenProbability(args.oddsAmerican);
  const promoted =
    finite(args.modelProbability)
    && breakEven !== null
    && args.modelProbability >= breakEven;
  return {
    actionable: promoted,
    promoted,
    ruleId: promoted ? WNBA_MONEYLINE_POSITIVE_EV_ADDITION_RULE_ID : null,
  };
}

export function resolveWnbaTotalReflectedProjectionChampion(args: {
  rawProjectedTotal: number | null;
  marketTotal: number | null;
  overOdds: number | null;
  underOdds: number | null;
}):
  | {
      applied: true;
      ruleId: typeof WNBA_TOTAL_REFLECTED_PROJECTION_CHAMPION_RULE_ID;
      side: "over" | "under";
      oddsAmerican: number;
      projectedTotal: number;
      selectedProbability: number;
      overProbability: number;
    }
  | { applied: false; reason: string } {
  if (!finite(args.rawProjectedTotal) || !finite(args.marketTotal)) {
    return { applied: false, reason: "missing_projection_or_market_total" };
  }
  const rawEdge = args.rawProjectedTotal - args.marketTotal;
  if (Math.abs(rawEdge) < 1e-9) return { applied: false, reason: "zero_projection_edge" };
  const incumbentSide: "over" | "under" = rawEdge > 0 ? "over" : "under";
  const incumbentProbability = clampProbability(sigmoid(-0.30122681 + 0.0380106 * Math.abs(rawEdge)));
  if (incumbentProbability >= 0.5) {
    return { applied: false, reason: "incumbent_projection_side_retained" };
  }
  const side = incumbentSide === "over" ? "under" : "over";
  const oddsAmerican = side === "over" ? args.overOdds : args.underOdds;
  if (!finite(oddsAmerican)) return { applied: false, reason: "missing_exact_opposite_price" };
  const selectedProbability = 1 - incumbentProbability;
  return {
    applied: true,
    ruleId: WNBA_TOTAL_REFLECTED_PROJECTION_CHAMPION_RULE_ID,
    side,
    oddsAmerican,
    projectedTotal: 2 * args.marketTotal - args.rawProjectedTotal,
    selectedProbability,
    overProbability: side === "over" ? selectedProbability : 1 - selectedProbability,
  };
}

export function calibrateWnbaSpreadPickedProbability(args: {
  rawPickedProbability: number | null;
  oddsAmerican: number | null;
  selectedSide: "home" | "away" | null;
}): number | null {
  const breakEven = americanBreakEvenProbability(args.oddsAmerican);
  if (!finite(args.rawPickedProbability) || breakEven === null || args.selectedSide === null) return null;
  const side = args.selectedSide === "home" ? 1 : -1;
  const currentLogit = logit(args.rawPickedProbability);
  const fittedLogit =
    -0.23100632
    - 0.67033554 * currentLogit
    + 3.27555417 * logit(breakEven)
    - 6.25046915 * (args.rawPickedProbability - breakEven)
    + 0.38661981 * side
    + 0.32470567 * currentLogit * side;
  return Math.max(0.5, clampProbability(sigmoid(fittedLogit)));
}

export function resolveWnbaSpreadChampionAction(args: {
  calibratedProbability: number | null;
  oddsAmerican: number | null;
}): { actionable: boolean; ruleId: string } {
  const breakEven = americanBreakEvenProbability(args.oddsAmerican);
  return {
    actionable:
      finite(args.calibratedProbability)
      && breakEven !== null
      && args.calibratedProbability >= breakEven + WNBA_SPREAD_POLICY_MIN_EDGE,
    ruleId: WNBA_SPREAD_PRICE_CHAMPION_RULE_ID,
  };
}
