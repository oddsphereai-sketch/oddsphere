export const MLB_TOTAL_MARKET_ANCHOR_EDGE_WEIGHT = 0.25;

export type MlbTotalMarketAnchorInput = {
  marketTotal: number | null;
  rawProjectedAwayScore: number;
  rawProjectedHomeScore: number;
  edgeWeight?: number;
};

export type MlbTotalMarketAnchorOutput = {
  enabled: boolean;
  formula: "market_total_plus_weighted_model_edge";
  edgeWeight: number;
  rawProjectedTotal: number;
  marketTotal: number | null;
  calibratedTotal: number;
  calibratedAwayScore: number;
  calibratedHomeScore: number;
  modelEdgeRuns: number | null;
};

function finite(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function calibrateMlbTotalProjectionToMarket(
  input: MlbTotalMarketAnchorInput,
): MlbTotalMarketAnchorOutput {
  const edgeWeight = input.edgeWeight ?? MLB_TOTAL_MARKET_ANCHOR_EDGE_WEIGHT;
  const rawProjectedTotal = input.rawProjectedAwayScore + input.rawProjectedHomeScore;
  if (!finite(input.marketTotal) || rawProjectedTotal <= 0) {
    return {
      enabled: false,
      formula: "market_total_plus_weighted_model_edge",
      edgeWeight,
      rawProjectedTotal: round1(rawProjectedTotal),
      marketTotal: input.marketTotal,
      calibratedTotal: round1(rawProjectedTotal),
      calibratedAwayScore: round1(input.rawProjectedAwayScore),
      calibratedHomeScore: round1(input.rawProjectedHomeScore),
      modelEdgeRuns: null,
    };
  }

  const calibratedTotal = input.marketTotal + edgeWeight * (rawProjectedTotal - input.marketTotal);
  const rawHomeShare = input.rawProjectedHomeScore / rawProjectedTotal;
  const rawAwayShare = input.rawProjectedAwayScore / rawProjectedTotal;
  return {
    enabled: true,
    formula: "market_total_plus_weighted_model_edge",
    edgeWeight,
    rawProjectedTotal: round1(rawProjectedTotal),
    marketTotal: input.marketTotal,
    calibratedTotal: round1(calibratedTotal),
    calibratedAwayScore: round1(calibratedTotal * rawAwayShare),
    calibratedHomeScore: round1(calibratedTotal * rawHomeShare),
    modelEdgeRuns: round1(rawProjectedTotal - input.marketTotal),
  };
}
