import type {
  AiAuditorCompactMarketPayload,
  AiAuditorPayloadEstimate,
} from "@/lib/services/aiAuditor/costPreview";
import {
  marketMemoryForPayload,
  type SharpAnalystMarket,
  type SharpAnalystMemoryModule,
} from "@/lib/services/aiAuditor/sharpAnalystMemory";
import {
  scanPromotionCandidate,
  type PromotionCandidateScan,
} from "@/lib/services/aiAuditor/promotionCandidateScanner";

export type PredictionAnalystKind =
  | "moneyline_prediction_analyst"
  | "total_prediction_analyst"
  | "first_inning_prediction_analyst";

export type PredictionAnalystVariant =
  | "ai_v3_prediction_level_market_analyst"
  | "ai_v4_sharp_grade_rebuilder";

export type PredictionLevelAnalystPayload = {
  schemaVersion: "prediction-market-analyst-preview-v1";
  noOpenAiCalls: true;
  applied: false;
  analystKind: PredictionAnalystKind;
  sport: string;
  slateDate: string;
  gameId: string;
  externalId: number;
  game: string;
  teams: {
    away: string;
    home: string;
  };
  gameTime: string;
  market: SharpAnalystMarket;
  pick: string | null;
  currentGrade: string | null;
  originalGrade: string | null;
  pricing: {
    priceAmerican: number | null;
    priceSource: string;
    priceNullReason: string | null;
    marketImpliedProbability: number | null;
    favoriteDog: "favorite" | "dog" | "even_or_unknown";
  };
  model: {
    modelProbability: number | null;
    edge: number | null;
    projectedScore: { away: number; home: number } | null;
    projectedTotal: number | null;
    deterministicPreScore: AiAuditorCompactMarketPayload["deterministicPreScore"];
  };
  marketLine: {
    lineValue: number | null;
    openLineValue: number | null;
    currentLineValue: number | null;
    lockLineValue: number | null;
    lineValueSource: string;
    lineValueNullReason: string | null;
  };
  lineMovement: AiAuditorCompactMarketPayload["lineMovement"] & {
    movementTowardAgainstPick: string | null;
  };
  marketRead: AiAuditorCompactMarketPayload["marketRead"];
  sourceContext: {
    consensusSplits: unknown;
    sharpBookSplitsOrSignal: unknown;
    sourceConflict: boolean | null;
    sourceAgreement: "agree_or_no_conflict" | "disagree" | "not_applicable";
    missingSourceMateriality: "low" | "medium" | "high";
    missingSourceReason: string | null;
  };
  fiContext: AiAuditorCompactMarketPayload["fiContext"] & {
    consensusSharpRequired: boolean;
  };
  dataWarnings: string[];
  relevantModelStatSupport: {
    projectedScoreAvailable: boolean;
    projectedTotalAvailable: boolean;
    starterContextAvailable: boolean | null;
    topOrderContextAvailable: boolean | null;
    weatherParkContextAvailable: boolean | null;
    notes: string[];
  };
  marketMemoryModule: SharpAnalystMemoryModule;
  promotionScanner: PromotionCandidateScan;
  analystTasks: string[];
  memberFacingCopyRequirements: string[];
  validationRules: string[];
  gameCardCoherenceCheckInputs: {
    providerNamesHidden: true;
    marketSpecificSourceModel: PredictionAnalystKind;
    shouldNotDecideOtherMarketGrades: true;
  };
};

function analystKindFor(market: SharpAnalystMarket): PredictionAnalystKind {
  if (market === "moneyline") return "moneyline_prediction_analyst";
  if (market === "total") return "total_prediction_analyst";
  return "first_inning_prediction_analyst";
}

function favoriteDog(price: number | null): PredictionLevelAnalystPayload["pricing"]["favoriteDog"] {
  if (price === null || price === 0) return "even_or_unknown";
  return price < 0 ? "favorite" : "dog";
}

function sourceAgreement(market: AiAuditorCompactMarketPayload): PredictionLevelAnalystPayload["sourceContext"]["sourceAgreement"] {
  if (market.market === "first_inning" && !market.consensusSplits && !market.sharpBookSplits) return "not_applicable";
  return market.sourceConflict ? "disagree" : "agree_or_no_conflict";
}

function missingSourceReason(market: AiAuditorCompactMarketPayload): string | null {
  if (market.consensusSplits && market.sharpBookSplits) return null;
  if (market.market === "first_inning") {
    return market.fiContext.fiMarketSignalNullReason ?? "FI consensus/sharp split source is not expected in current coverage.";
  }
  return "Expected market split source missing for this market.";
}

function missingSourceMateriality(market: AiAuditorCompactMarketPayload): "low" | "medium" | "high" {
  if (market.market === "first_inning" && !market.consensusSplits && !market.sharpBookSplits) return "low";
  if (!market.consensusSplits || !market.sharpBookSplits) return "medium";
  return "low";
}

function projectedTotal(projectedScore: { away: number; home: number } | null): number | null {
  return projectedScore ? +(projectedScore.away + projectedScore.home).toFixed(2) : null;
}

function analystTasks(market: SharpAnalystMarket): string[] {
  if (market === "moneyline") {
    return [
      "Data Integrity Review",
      "ML Market Read",
      "Betting Value Review",
      "Promotion Review",
      "Downgrade Review",
      "Recommended Play Grade",
      "Member-facing ML market read copy",
      "Issue materiality and blockers",
    ];
  }
  if (market === "total") {
    return [
      "Data Integrity Review",
      "Totals Market Read",
      "Betting Value Review",
      "Promotion Review",
      "Downgrade Review",
      "Recommended Play Grade",
      "Member-facing Totals market read copy",
      "Issue materiality and blockers",
    ];
  }
  return [
    "FI Data Integrity Review",
    "FI Market/Context Read",
    "FI Betting Value Review",
    "Promotion Review",
    "Downgrade Review",
    "Recommended Play Grade",
    "Member-facing FI read copy",
    "Issue materiality and blockers",
  ];
}

function memberCopyRequirements(market: SharpAnalystMarket): string[] {
  return [
    "Clean, concise, user-facing betting language.",
    "No provider names, internal system names, or model names.",
    "Copy must match the analyst's market read, betting value conclusion, and recommended grade.",
    "Tone strength must match the Play Grade.",
    market === "first_inning"
      ? "Do not mention missing Consensus/Sharp split bars as a flaw by itself."
      : "Reflect Consensus Splits, Sharp Book Splits/Signal, movement, price, and edge without exposing providers.",
  ];
}

function validationRules(market: SharpAnalystMarket): string[] {
  if (market === "moneyline") {
    return [
      "If price/model/edge/market implied and consensus/sharp sources exist, Market Read cannot be insufficient_data.",
      "If consensus and sharp disagree, label mixed/source-conflict rather than insufficient_data.",
      "If holding/rejecting a promotion candidate, blockerMateriality must be medium/high or promotion_underreach is flagged.",
      "currentPlayGrade must exactly echo originalGrade.",
      "Do not require perfect market alignment when edge and price support a play.",
    ];
  }
  if (market === "total") {
    return [
      "If price/model/edge/line and consensus/sharp sources exist, Market Read cannot be insufficient_data.",
      "Mixed market alone does not block promotion.",
      "Projection versus total line and Over/Under direction must be considered.",
      "If holding/rejecting a promotion candidate, blockerMateriality must be medium/high or promotion_underreach is flagged.",
      "currentPlayGrade must exactly echo originalGrade.",
    ];
  }
  return [
    "Consensus/Sharp split bars are not required for FI.",
    "Missing FI consensus/sharp source must be low materiality and should_affect_grade=false by itself.",
    "If FI has price/model/market implied/edge/context, Market Read cannot be insufficient_data; use fi_no_clear_signal or another FI label.",
    "Allowed FI read labels: fi_model_support, fi_price_support, fi_line_movement_support, fi_mixed, fi_data_caution, fi_no_clear_signal, fi_insufficient_core_data.",
    "Downgrade FI only for high-materiality starter/lineup/stale/price/thin-edge/strong-opposing-signal issues.",
    "currentPlayGrade must exactly echo originalGrade.",
  ];
}

export function buildPredictionLevelAnalystPayload(args: {
  card: AiAuditorPayloadEstimate;
  market: AiAuditorCompactMarketPayload;
  memoryModules: Record<SharpAnalystMarket, SharpAnalystMemoryModule>;
}): PredictionLevelAnalystPayload {
  const { card, market, memoryModules } = args;
  return {
    schemaVersion: "prediction-market-analyst-preview-v1",
    noOpenAiCalls: true,
    applied: false,
    analystKind: analystKindFor(market.market),
    sport: card.sport,
    slateDate: card.date,
    gameId: card.gameId,
    externalId: card.externalId,
    game: card.matchup,
    teams: card.payload.teams,
    gameTime: card.payload.gameTime,
    market: market.market,
    pick: market.pick,
    currentGrade: market.playGrade,
    originalGrade: market.playGrade,
    pricing: {
      priceAmerican: market.displayPriceAmerican,
      priceSource: market.priceSource,
      priceNullReason: market.priceNullReason,
      marketImpliedProbability: market.marketProbabilityPct,
      favoriteDog: favoriteDog(market.displayPriceAmerican),
    },
    model: {
      modelProbability: market.modelProbabilityPct,
      edge: market.modelMarketGapPct,
      projectedScore: card.payload.projectedScore,
      projectedTotal: projectedTotal(card.payload.projectedScore),
      deterministicPreScore: market.deterministicPreScore,
    },
    marketLine: {
      lineValue: market.lineValue,
      openLineValue: market.openLineValue,
      currentLineValue: market.currentLineValue,
      lockLineValue: market.lineMovement.lockedAmerican,
      lineValueSource: market.lineValueSource,
      lineValueNullReason: market.lineValueNullReason,
    },
    lineMovement: {
      ...market.lineMovement,
      movementTowardAgainstPick: market.lineMovement.directionRelativeToPick,
    },
    marketRead: market.marketRead,
    sourceContext: {
      consensusSplits: market.market === "first_inning" ? null : market.consensusSplits,
      sharpBookSplitsOrSignal: market.market === "first_inning" ? null : market.sharpBookSplits,
      sourceConflict: market.market === "first_inning" ? false : market.sourceConflict,
      sourceAgreement: sourceAgreement(market),
      missingSourceMateriality: missingSourceMateriality(market),
      missingSourceReason: missingSourceReason(market),
    },
    fiContext: {
      ...market.fiContext,
      consensusSharpRequired: false,
    },
    dataWarnings: market.dataQuality.reviewFlags,
    relevantModelStatSupport: {
      projectedScoreAvailable: card.payload.projectedScore !== null,
      projectedTotalAvailable: projectedTotal(card.payload.projectedScore) !== null,
      starterContextAvailable: market.market === "first_inning" ? market.fiContext.expectedRunsAvailable : null,
      topOrderContextAvailable: null,
      weatherParkContextAvailable: null,
      notes: market.deterministicPreScore.notes,
    },
    marketMemoryModule: marketMemoryForPayload(market, memoryModules),
    promotionScanner: scanPromotionCandidate(market),
    analystTasks: analystTasks(market.market),
    memberFacingCopyRequirements: memberCopyRequirements(market.market),
    validationRules: validationRules(market.market),
    gameCardCoherenceCheckInputs: {
      providerNamesHidden: true,
      marketSpecificSourceModel: analystKindFor(market.market),
      shouldNotDecideOtherMarketGrades: true,
    },
  };
}

export function buildPredictionLevelAnalystPayloads(args: {
  cards: AiAuditorPayloadEstimate[];
  memoryModules: Record<SharpAnalystMarket, SharpAnalystMemoryModule>;
}): PredictionLevelAnalystPayload[] {
  return args.cards.flatMap((card) =>
    card.payload.markets.map((market) =>
      buildPredictionLevelAnalystPayload({ card, market, memoryModules: args.memoryModules }),
    ),
  );
}

export function predictionAnalystSystemPrompt(
  kind: PredictionAnalystKind,
  variant: PredictionAnalystVariant = "ai_v3_prediction_level_market_analyst",
): string {
  const shared = [
    variant === "ai_v4_sharp_grade_rebuilder"
      ? "You are the OddSphere Sharp Grade Rebuilder in offline evaluation mode."
      : "You are the OddSphere Prediction-Level Market Analyst in offline evaluation mode.",
    "Review exactly one prediction/market. Do not judge other markets on the game card.",
    "No live changes, no member-facing changes, applied=false.",
    "Never use postgame results, final score, winner, graded result, units, or ROI from the current prediction payload.",
    "Never flip picks, change probabilities, change projected scores, or expose provider names.",
    "Return strict JSON when paid evaluation is explicitly enabled.",
  ];
  const rebuilder = variant === "ai_v4_sharp_grade_rebuilder"
    ? [
      "This is not a conservative audit. Rebuild the Play Grade from evidence as if grading from scratch.",
      "The original Play Grade is only one input; it is not the target answer and should not be preserved by default.",
      "A historical Watchlist/No Play may become Lean or Best Angle when evidence supports public action.",
      "A historical Best Angle may be downgraded when price, resistance, risk, or cohort memory makes it weak.",
      "Populate sharp_grade_rebuild with independentSharpScore, bettingValueScore, marketSignalScore, priceQualityScore, modelEdgeScore, dataQualityScore, riskPenalty, slateRankCandidateScore, rebuiltPlayGrade, maxReasonableGrade, publicActionability, evidenceForUpgrade, evidenceForDowngrade, materialBlockers, priceVerdict, marketVerdict, modelEdgeVerdict, and finalSharpBettorSummary.",
      "Use rebuilt grade definitions: Best Angle = one of the strongest actionable slate positions; Lean = positive actionable bet; Watchlist = interesting but not actionable enough; Caution = contradictory/fragile/overpriced/risky; No Play = no actionable edge or insufficient core confidence.",
      "Do not downgrade everything. Do not promote unsupported plays. Reorganize the slate into betting-strength buckets.",
    ]
    : [];
  const specific: Record<PredictionAnalystKind, string[]> = {
    moneyline_prediction_analyst: [
      "ML: price/juice discipline, favorite/dog context, model edge, splits, sharp signal, and movement matter.",
      "ML Watchlist has been historically positive; actively review promotions.",
      "Current ML Best Angle has been historically weak; actively review caps.",
    ],
    total_prediction_analyst: [
      "Totals: projection versus line, Over/Under direction, edge size, price, splits, and movement matter.",
      "Totals Watchlist has been historically strong; actively review Watchlist to Lean.",
      "Mixed market is not an automatic downgrade.",
    ],
    first_inning_prediction_analyst: [
      "FI: price, model edge, starter/top-order/FI context, and FI movement matter.",
      "Do not require Consensus Splits, Sharp Book Splits, or Sharp Book Signal.",
      "Missing FI split sources must never create insufficient_data by itself.",
    ],
  };
  return [...shared, ...rebuilder, ...specific[kind]].join("\n");
}
