export const MLB_TOTAL_MARKET_ANCHOR_EDGE_WEIGHT = 0.25;

export type MlbTotalMarketAnchorInput = {
  marketTotal: number | null;
  rawProjectedAwayScore: number;
  rawProjectedHomeScore: number;
  edgeWeight?: number;
  homeStarterEraFactor?: number | null;
  awayStarterEraFactor?: number | null;
  homeBullpenFactor?: number | null;
  awayBullpenFactor?: number | null;
  homeStarterWorkloadRole?: string | null;
  awayStarterWorkloadRole?: string | null;
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
  runEnvironmentCorrectionRuns: number;
  runEnvironmentCorrectionReasons: string[];
};

function finite(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function avgFinite(a: number | null | undefined, b: number | null | undefined): number | null {
  if (finite(a) && finite(b)) return (a + b) / 2;
  if (finite(a)) return a;
  if (finite(b)) return b;
  return null;
}

function workloadShortOrReliever(role: string | null | undefined): boolean {
  const s = String(role ?? "").toLowerCase();
  return s.includes("short") || s.includes("opener") || s.includes("reliever");
}

function totalRunEnvironmentCorrection(input: MlbTotalMarketAnchorInput): {
  runs: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let runs = 0.25;
  reasons.push("launch_window_scoring_underprojection_plus_0.25");

  const starterAvg = avgFinite(input.homeStarterEraFactor, input.awayStarterEraFactor);
  if (starterAvg !== null && starterAvg <= 1.1) {
    runs += 0.2;
    reasons.push("good_or_neutral_starter_underprojection_plus_0.20");
  } else if (starterAvg !== null && starterAvg > 1.1) {
    runs -= 0.15;
    reasons.push("bad_starter_overprojection_minus_0.15");
  }

  const bullpenAvg = avgFinite(input.homeBullpenFactor, input.awayBullpenFactor);
  if (bullpenAvg !== null && bullpenAvg < 0.92) {
    runs += 0.2;
    reasons.push("strong_bullpen_underprojection_plus_0.20");
  } else if (bullpenAvg !== null && bullpenAvg > 1.08) {
    runs -= 0.15;
    reasons.push("weak_bullpen_overprojection_minus_0.15");
  }

  if (
    workloadShortOrReliever(input.homeStarterWorkloadRole) ||
    workloadShortOrReliever(input.awayStarterWorkloadRole)
  ) {
    runs += 0.35;
    reasons.push("short_or_reliever_starter_underprojection_plus_0.35");
  }

  const bounded = Math.max(-0.3, Math.min(0.8, runs));
  if (bounded !== runs) reasons.push("run_environment_correction_bounded");
  return { runs: round1(bounded), reasons };
}

export function calibrateMlbTotalProjectionToMarket(
  input: MlbTotalMarketAnchorInput,
): MlbTotalMarketAnchorOutput {
  const edgeWeight = input.edgeWeight ?? MLB_TOTAL_MARKET_ANCHOR_EDGE_WEIGHT;
  const rawProjectedTotal = input.rawProjectedAwayScore + input.rawProjectedHomeScore;
  const envCorrection = totalRunEnvironmentCorrection(input);
  if (!finite(input.marketTotal) || rawProjectedTotal <= 0) {
    const calibratedTotal = rawProjectedTotal + envCorrection.runs;
    const rawHomeShare = rawProjectedTotal > 0 ? input.rawProjectedHomeScore / rawProjectedTotal : 0.5;
    const rawAwayShare = rawProjectedTotal > 0 ? input.rawProjectedAwayScore / rawProjectedTotal : 0.5;
    return {
      enabled: false,
      formula: "market_total_plus_weighted_model_edge",
      edgeWeight,
      rawProjectedTotal: round1(rawProjectedTotal),
      marketTotal: input.marketTotal,
      calibratedTotal: round1(calibratedTotal),
      calibratedAwayScore: round1(calibratedTotal * rawAwayShare),
      calibratedHomeScore: round1(calibratedTotal * rawHomeShare),
      modelEdgeRuns: null,
      runEnvironmentCorrectionRuns: envCorrection.runs,
      runEnvironmentCorrectionReasons: envCorrection.reasons,
    };
  }

  const calibratedTotal = input.marketTotal + edgeWeight * (rawProjectedTotal - input.marketTotal) + envCorrection.runs;
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
    runEnvironmentCorrectionRuns: envCorrection.runs,
    runEnvironmentCorrectionReasons: envCorrection.reasons,
  };
}
