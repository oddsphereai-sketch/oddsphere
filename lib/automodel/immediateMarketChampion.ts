export const IMMEDIATE_MARKET_CHAMPION_POLICY_VERSION =
  "immediate_market_champion_policy_v1_2026_08_15" as const;

export const MLB_MONEYLINE_POSITIVE_EV_FAVORITE_RULE_ID =
  "mlb_moneyline_positive_ev_favorite_addition_v1_2026_08_15" as const;
export const MLB_TOTAL_PRICE_CALIBRATION_RULE_ID =
  "mlb_total_price_calibration_side_floor_v1_2026_08_15" as const;
export const WNBA_MONEYLINE_POSITIVE_EV_ADDITION_RULE_ID =
  "wnba_moneyline_positive_ev_addition_v1_2026_08_15" as const;
export const WNBA_SPREAD_PRICE_CHAMPION_RULE_ID =
  "wnba_spread_price_champion_v1_2026_08_15" as const;

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

export function resolveMlbMoneylineChampionAction(args: {
  currentActionable: boolean;
  blocked: boolean;
  modelProbability: number | null;
  oddsAmerican: number | null;
}): { actionable: boolean; promoted: boolean; ruleId: string | null } {
  if (args.blocked) return { actionable: false, promoted: false, ruleId: null };
  if (args.currentActionable) return { actionable: true, promoted: false, ruleId: null };
  const breakEven = americanBreakEvenProbability(args.oddsAmerican);
  const promoted =
    finite(args.modelProbability)
    && finite(args.oddsAmerican)
    && args.oddsAmerican < 0
    && breakEven !== null
    && args.modelProbability >= breakEven;
  return {
    actionable: promoted,
    promoted,
    ruleId: promoted ? MLB_MONEYLINE_POSITIVE_EV_FAVORITE_RULE_ID : null,
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
