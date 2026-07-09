import type { MarketEdgeDto } from "@/app/lab/lib/labTypes";
import type { Grade } from "@/lib/types/domain/Grade";
import type { Verdict } from "@/lib/services/verdictDerivation";

export type MlbGradeGuardrailRule =
  | "fi_tossup_no_play"
  | "fi_missing_price_blocks_grade_strengthening"
  | "totals_thin_gap_lean_cap"
  | "ml_best_angle_movement_edge_cap";

export type MlbGradeGuardrailResult = {
  market: MarketEdgeDto;
  appliedRules: MlbGradeGuardrailRule[];
};

const VERDICT_LABEL: Record<Verdict, string> = {
  best_angle: "Best Angle",
  lean: "Lean",
  watchlist: "Watchlist",
  caution: "Caution",
  no_play: "No Play",
};

function flagEnabled(name: string): boolean {
  return process.env[name] === "true";
}

function gradeForVerdict(verdict: Verdict, rawGrade: Grade | null): Grade | null {
  if (verdict === "best_angle") return "best_signal";
  if (verdict === "caution") return "sharp_conflict";
  if (verdict === "watchlist") return "market_watch";
  if (verdict === "no_play") return rawGrade === null ? null : "market_watch";
  return rawGrade === "best_signal" ? "model_only" : (rawGrade ?? "model_only");
}

function capMarket(
  market: MarketEdgeDto,
  verdict: Verdict,
  reason: string,
): MarketEdgeDto {
  const capReasons = Array.from(new Set([...(market.capReasons ?? []), reason]));
  return {
    ...market,
    verdict: {
      ...market.verdict,
      key: verdict,
      label: VERDICT_LABEL[verdict],
    },
    finalGrade: gradeForVerdict(verdict, market.rawGrade ?? market.grade ?? null),
    actionabilityLabel: VERDICT_LABEL[verdict],
    displayReason: `Capped to ${VERDICT_LABEL[verdict]} because ${reason.replaceAll("_", " ")}.`,
    capReasons,
  };
}

function isLean(market: MarketEdgeDto): boolean {
  return market.verdict.key === "lean" || market.verdict.label === "Lean" || market.actionabilityLabel === "Lean";
}

function isBestAngle(market: MarketEdgeDto): boolean {
  return market.verdict.key === "best_angle" || market.verdict.label === "Best Angle" || market.actionabilityLabel === "Best Angle";
}

function isActionable(market: MarketEdgeDto): boolean {
  return isBestAngle(market) || isLean(market);
}

function totalProjectionGap(market: MarketEdgeDto): number | null {
  if (typeof market.modelTotal !== "number" || typeof market.line !== "number") return null;
  return Math.abs(market.modelTotal - market.line);
}

function americanToImpliedProbability(american: number | null | undefined): number | null {
  if (typeof american !== "number" || !Number.isFinite(american) || american === 0) return null;
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

function pickedSideMovementDirectionFromOdds(market: MarketEdgeDto): "toward" | "against" | "neutral" | "unknown" {
  const trail = market.oddsTrail?.filter((point) => typeof point.american === "number" && Number.isFinite(point.american)) ?? [];
  const first = trail[0]?.american ?? market.lineOpenAmerican ?? market.marketReadV2?.movement?.firstTrackedPrice ?? null;
  const current =
    market.lockedLineAmerican ??
    market.priceAmerican ??
    trail[trail.length - 1]?.american ??
    market.marketReadV2?.movement?.currentPrice ??
    null;
  const firstImplied = americanToImpliedProbability(first);
  const currentImplied = americanToImpliedProbability(current);
  if (firstImplied === null || currentImplied === null) return "unknown";
  const delta = currentImplied - firstImplied;
  if (Math.abs(delta) < 0.005) return "neutral";
  return delta > 0 ? "toward" : "against";
}

function mlMovementKnownNotToward(market: MarketEdgeDto): boolean {
  const direction = market.marketReadV2?.movement?.directionRelativeToPick ?? null;
  if (direction === "neutral" || direction === "resistance") return true;
  if (direction === "support") return false;
  const oddsDirection = pickedSideMovementDirectionFromOdds(market);
  return oddsDirection === "neutral" || oddsDirection === "against";
}

export function applyMlbSameDayGradeGuardrail(args: {
  market: "moneyline" | "total" | "first_inning";
  dto: MarketEdgeDto;
}): MlbGradeGuardrailResult {
  let market = args.dto;
  const appliedRules: MlbGradeGuardrailRule[] = [];

  if (
    args.market === "first_inning" &&
    flagEnabled("MLB_FI_TOSSUP_FORCE_NO_PLAY_ENABLED") &&
    /\btoss[- ]?up\b/i.test(market.pick ?? "")
  ) {
    if (market.verdict.key !== "no_play") {
      market = capMarket(market, "no_play", "fi_tossup_no_play");
    }
    appliedRules.push("fi_tossup_no_play");
  }

  if (
    args.market === "first_inning" &&
    flagEnabled("MLB_FI_MISSING_PRICE_BLOCKS_GRADE_STRENGTHENING_ENABLED") &&
    market.priceAmerican === null &&
    isActionable(market)
  ) {
    market = capMarket(market, "watchlist", "fi_missing_price_blocks_grade_strengthening");
    appliedRules.push("fi_missing_price_blocks_grade_strengthening");
  }

  if (
    args.market === "total" &&
    flagEnabled("MLB_TOTALS_THIN_GAP_LEAN_CAP_ENABLED") &&
    isLean(market)
  ) {
    const gap = totalProjectionGap(market);
    if (gap !== null && gap < 0.5) {
      market = capMarket(market, "watchlist", "totals_thin_gap_lean_cap");
      appliedRules.push("totals_thin_gap_lean_cap");
    }
  }

  if (
    args.market === "moneyline" &&
    flagEnabled("MLB_ML_BEST_ANGLE_MOVEMENT_EDGE_CAP_ENABLED") &&
    isBestAngle(market) &&
    mlMovementKnownNotToward(market) &&
    typeof market.modelMarketGapPct === "number" &&
    market.modelMarketGapPct < 8
  ) {
    market = capMarket(market, "lean", "ml_best_angle_movement_edge_cap");
    appliedRules.push("ml_best_angle_movement_edge_cap");
  }

  return { market, appliedRules };
}

export function applyMlbSameDayGradeGuardrails(args: {
  moneyline: MarketEdgeDto;
  total: MarketEdgeDto;
  firstInning: MarketEdgeDto;
}): {
  moneyline: MarketEdgeDto;
  total: MarketEdgeDto;
  firstInning: MarketEdgeDto;
  appliedRulesByMarket: {
    moneyline: MlbGradeGuardrailRule[];
    total: MlbGradeGuardrailRule[];
    firstInning: MlbGradeGuardrailRule[];
  };
} {
  const moneyline = applyMlbSameDayGradeGuardrail({ market: "moneyline", dto: args.moneyline });
  const total = applyMlbSameDayGradeGuardrail({ market: "total", dto: args.total });
  const firstInning = applyMlbSameDayGradeGuardrail({ market: "first_inning", dto: args.firstInning });
  return {
    moneyline: moneyline.market,
    total: total.market,
    firstInning: firstInning.market,
    appliedRulesByMarket: {
      moneyline: moneyline.appliedRules,
      total: total.appliedRules,
      firstInning: firstInning.appliedRules,
    },
  };
}
