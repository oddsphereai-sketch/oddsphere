import type { MarketReadV2Dto } from "@/lib/types/domain/MarketIntelligenceV2";
import type { Grade } from "@/lib/types/domain/Grade";
import type { Verdict } from "@/lib/services/verdictDerivation";

export type DailyEdgeActionabilityMarket =
  | "moneyline"
  | "total"
  | "first_inning"
  | "spread"
  | "soccer_moneyline"
  | "soccer_total"
  | "soccer_btts";

export type DailyEdgeActionabilityInput = {
  market: DailyEdgeActionabilityMarket;
  rawVerdict: { key: Verdict; label: string; warning?: string | null };
  rawGrade: Grade | null;
  rawRecScore: number | null;
  modelMarketGapPct: number | null;
  marketReadV2: MarketReadV2Dto | null;
  hasPick: boolean;
  held: boolean;
  dataQualityTier: "high" | "medium" | "low" | "fallback";
  priceAmerican: number | null;
  priceUnavailableAtLock?: boolean;
};

export type DailyEdgeActionabilityResult = {
  rawGrade: Grade | null;
  rawRecScore: number | null;
  capReasons: string[];
  finalGrade: Grade | null;
  finalVerdict: { key: Verdict; label: string; warning?: string | null };
  finalRecScore: number | null;
  actionabilityLabel: string;
  displayReason: string | null;
};

const VERDICT_LABEL: Record<Verdict, string> = {
  best_angle: "Best Angle",
  lean: "Lean",
  watchlist: "Watchlist",
  caution: "Caution",
  no_play: "No Play",
};

const MIN_REC_BY_VERDICT: Record<Exclude<Verdict, "caution" | "no_play">, number> = {
  best_angle: 60,
  lean: 45,
  watchlist: 0,
};

function clampRecForTier(rec: number | null, tier: DailyEdgeActionabilityInput["dataQualityTier"]): number | null {
  if (rec === null || !Number.isFinite(rec)) return null;
  const cap =
    tier === "fallback" ? 35 :
    tier === "low" ? 50 :
    tier === "medium" ? 65 :
    100;
  return Math.min(rec, cap);
}

function verdictForRec(rec: number | null, hasPick: boolean): Verdict {
  if (!hasPick) return "no_play";
  if (rec === null) return "no_play";
  if (rec >= MIN_REC_BY_VERDICT.best_angle) return "best_angle";
  if (rec >= MIN_REC_BY_VERDICT.lean) return "lean";
  if (rec >= 25) return "watchlist";
  return "no_play";
}

function gradeForVerdict(verdict: Verdict, rawGrade: Grade | null): Grade | null {
  if (verdict === "best_angle") return "best_signal";
  if (verdict === "caution") return "sharp_conflict";
  if (verdict === "no_play") return rawGrade === null ? null : "market_watch";
  if (verdict === "watchlist") return "market_watch";
  return rawGrade === "best_signal" ? "model_only" : (rawGrade ?? "model_only");
}

function explainCap(reason: string): string {
  switch (reason) {
    case "low_action_score":
      return "the action score is too low";
    case "missing_price":
      return "the current price is not reliable";
    case "fallback_data_cap":
      return "key model inputs are using fallback data";
    case "degraded_data_cap":
      return "the data quality is capped";
    case "market_resistance":
      return "the market has moved against the pick";
    case "first_inning_volatility_cap":
      return "first-inning volatility is too high for an actionable play";
    case "no_pick_or_held":
      return "the model is not making an official play";
    default:
      return reason.replaceAll("_", " ");
  }
}

export function normalizeDailyEdgeActionability(
  input: DailyEdgeActionabilityInput,
): DailyEdgeActionabilityResult {
  const capReasons: string[] = [];
  const hasPick = input.hasPick && !input.held;
  const recAfterDataCap = clampRecForTier(input.rawRecScore, input.dataQualityTier);

  if (!hasPick) capReasons.push("no_pick_or_held");
  if (input.priceUnavailableAtLock === true || (hasPick && input.priceAmerican === null)) {
    capReasons.push("missing_price");
  }
  if (input.dataQualityTier === "fallback") capReasons.push("fallback_data_cap");
  if (input.dataQualityTier === "low") capReasons.push("degraded_data_cap");

  const readDirection = input.marketReadV2?.movement?.directionRelativeToPick ?? null;
  if (readDirection === "resistance" && input.rawVerdict.key === "best_angle") {
    capReasons.push("market_resistance");
  }
  if (input.market === "first_inning" && (recAfterDataCap ?? 0) < MIN_REC_BY_VERDICT.lean) {
    capReasons.push("first_inning_volatility_cap");
  }

  let finalVerdictKey = input.rawVerdict.key;
  if (!hasPick || input.rawRecScore === null) {
    finalVerdictKey = "no_play";
  } else if (finalVerdictKey === "best_angle" && (recAfterDataCap ?? 0) < MIN_REC_BY_VERDICT.best_angle) {
    capReasons.push("low_action_score");
    finalVerdictKey = verdictForRec(recAfterDataCap, hasPick);
  } else if (finalVerdictKey === "lean" && (recAfterDataCap ?? 0) < MIN_REC_BY_VERDICT.lean) {
    capReasons.push("low_action_score");
    finalVerdictKey = verdictForRec(recAfterDataCap, hasPick);
  }

  if (capReasons.includes("market_resistance") && finalVerdictKey === "best_angle") {
    finalVerdictKey = "lean";
  }
  if ((capReasons.includes("fallback_data_cap") || capReasons.includes("degraded_data_cap")) && finalVerdictKey === "best_angle") {
    finalVerdictKey = "lean";
  }
  if (capReasons.includes("first_inning_volatility_cap") && (finalVerdictKey === "lean" || finalVerdictKey === "best_angle")) {
    finalVerdictKey = (recAfterDataCap ?? 0) >= 25 ? "watchlist" : "no_play";
  }
  if (capReasons.includes("missing_price") && (finalVerdictKey === "best_angle" || finalVerdictKey === "lean")) {
    finalVerdictKey = "watchlist";
  }

  const finalRecScore = recAfterDataCap;
  const finalGrade = gradeForVerdict(finalVerdictKey, input.rawGrade);
  const positiveDisplayedEdge = input.modelMarketGapPct !== null && input.modelMarketGapPct > 2;
  if (finalVerdictKey === "no_play" && positiveDisplayedEdge && capReasons.length === 0) {
    capReasons.push("low_action_score");
  }
  const primaryReason = capReasons[0] ?? null;
  const displayReason =
    finalVerdictKey === "no_play" && positiveDisplayedEdge && primaryReason !== null
      ? `Edge exists, but we are skipping because ${explainCap(primaryReason)}.`
      : primaryReason !== null && finalVerdictKey !== input.rawVerdict.key
        ? `Capped to ${VERDICT_LABEL[finalVerdictKey]} because ${explainCap(primaryReason)}.`
        : null;

  return {
    rawGrade: input.rawGrade,
    rawRecScore: input.rawRecScore,
    capReasons: Array.from(new Set(capReasons)),
    finalGrade,
    finalVerdict: {
      ...input.rawVerdict,
      key: finalVerdictKey,
      label: VERDICT_LABEL[finalVerdictKey],
    },
    finalRecScore,
    actionabilityLabel: VERDICT_LABEL[finalVerdictKey],
    displayReason,
  };
}
