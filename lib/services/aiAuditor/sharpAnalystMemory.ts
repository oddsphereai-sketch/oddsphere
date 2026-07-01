import { readFileSync } from "node:fs";
import path from "node:path";
import type { AiAuditorCompactMarketPayload } from "@/lib/services/aiAuditor/costPreview";
import { scanPromotionCandidate } from "@/lib/services/aiAuditor/promotionCandidateScanner";

export const AI_SHARP_ANALYST_V3_VARIANT = "ai_v3_sharp_analyst_memory" as const;

export type SharpAnalystMarket = "moneyline" | "total" | "first_inning";

type BucketSummary = {
  count?: number;
  settled?: number;
  wins?: number;
  losses?: number;
  pushes?: number;
  voids?: number;
  pending?: number;
  units?: number;
  roi?: number | null;
  winRate?: number | null;
  avgModelProbabilityPct?: number | null;
  avgEdgePct?: number | null;
  avgPrice?: number | null;
  brier?: number | null;
  logLoss?: number | null;
};

type CompactBucketSummary = {
  count: number;
  settled: number;
  record: string;
  units: number;
  roi: number | null;
  winRate: number | null;
  avgModelProbabilityPct: number | null;
  avgEdgePct: number | null;
  avgPrice: number | null;
};

type ResearchPack = {
  sharpAnalystPrinciples?: string[];
  modelMemoryPack?: Record<string, {
    sample?: BucketSummary;
    modelCalibration?: {
      overconfidenceZones?: unknown[];
      underconfidenceZones?: unknown[];
    };
    profitability?: {
      byGrade?: Record<string, BucketSummary>;
      byDirection?: Record<string, BucketSummary>;
      byPriceBand?: Record<string, BucketSummary>;
    };
    marketContext?: {
      byMarketRead?: Record<string, BucketSummary>;
      byDataWarnings?: Record<string, BucketSummary>;
      byMissingHistoricalSource?: Record<string, BucketSummary>;
    };
    gradeQuality?: {
      badBestAnglePatterns?: Record<string, BucketSummary>;
      profitableLeanPatterns?: Record<string, BucketSummary>;
      underGradedWinnerPatterns?: Record<string, BucketSummary>;
      overGradedLoserPatterns?: Record<string, BucketSummary>;
    };
  }>;
  marketSpecificPlaybooks?: Record<string, unknown>;
};

export type SharpAnalystMemoryModule = {
  market: SharpAnalystMarket;
  title: string;
  historicalGradePerformance: Record<string, CompactBucketSummary | null>;
  modelAndGradeSystemMistakes: string[];
  promotionLessons: string[];
  downgradeCapLessons: string[];
  missingSourceMateriality: string[];
  marketSpecificBettingPrinciples: string[];
  cohortFacts: Record<string, unknown>;
};

export function loadSharpAnalystResearchPack(packPath = "ops-local/ai-sharp-analyst/mlb-sharp-analyst-research-pack.json"): ResearchPack {
  const abs = path.isAbsolute(packPath) ? packPath : path.join(process.cwd(), packPath);
  return JSON.parse(readFileSync(abs, "utf8")) as ResearchPack;
}

function rec(pack: ResearchPack, market: SharpAnalystMarket, grade: string): BucketSummary | null {
  return pack.modelMemoryPack?.[market]?.profitability?.byGrade?.[grade] ?? null;
}

function recordLine(label: string, row: BucketSummary | null): string {
  if (!row) return `${label}: not enough persisted sample`;
  return `${label}: ${row.wins ?? 0}-${row.losses ?? 0}, units=${row.units ?? 0}, ROI=${row.roi ?? "n/a"}, winRate=${row.winRate ?? "n/a"}, settled=${row.settled ?? 0}`;
}

function compact(row: BucketSummary | null | undefined): CompactBucketSummary | null {
  if (!row) return null;
  return {
    count: row.count ?? 0,
    settled: row.settled ?? 0,
    record: `${row.wins ?? 0}-${row.losses ?? 0}`,
    units: row.units ?? 0,
    roi: row.roi ?? null,
    winRate: row.winRate ?? null,
    avgModelProbabilityPct: row.avgModelProbabilityPct ?? null,
    avgEdgePct: row.avgEdgePct ?? null,
    avgPrice: row.avgPrice ?? null,
  };
}

function roi(row: BucketSummary | null): number {
  return typeof row?.roi === "number" ? row.roi : -999;
}

function topKeys(obj: Record<string, BucketSummary> | undefined, n = 4): Array<{ key: string; summary: CompactBucketSummary | null }> {
  return Object.entries(obj ?? {})
    .sort(([, a], [, b]) => Math.abs(Number(b.units ?? 0)) - Math.abs(Number(a.units ?? 0)))
    .slice(0, n)
    .map(([key, summary]) => ({ key, summary: compact(summary) }));
}

function compactRecordMap(obj: Record<string, BucketSummary> | undefined, keys?: string[]): Record<string, CompactBucketSummary | null> {
  const entries = keys ?? Object.keys(obj ?? {});
  return Object.fromEntries(entries.map((key) => [key, compact(obj?.[key])]));
}

function compactZones(zones: unknown[] | undefined) {
  return (zones ?? []).slice(0, 5);
}

function mlMemory(pack: ResearchPack): SharpAnalystMemoryModule {
  const ba = rec(pack, "moneyline", "Best Angle");
  const lean = rec(pack, "moneyline", "Lean");
  const watch = rec(pack, "moneyline", "Watchlist");
  const noPlay = rec(pack, "moneyline", "No Play");
  const mem = pack.modelMemoryPack?.moneyline;
  return {
    market: "moneyline",
    title: "MLB Moneyline Sharp Analyst Memory",
    historicalGradePerformance: { "Best Angle": compact(ba), Lean: compact(lean), Watchlist: compact(watch), "No Play": compact(noPlay), Caution: compact(rec(pack, "moneyline", "Caution")) },
    modelAndGradeSystemMistakes: [
      recordLine("ML Best Angle", ba),
      recordLine("ML Lean", lean),
      recordLine("ML Watchlist", watch),
      "ML Best Angle has negative units/ROI despite a decent raw win rate; do not blindly trust Best Angle.",
      "ML Watchlist has been positive and may contain under-graded opportunities.",
      "ML No Play has some winners; treat it as non-actionable by default but review for mispriced/under-graded setups.",
    ],
    promotionLessons: [
      "Review Watchlist dogs or near-even prices when model edge is real, price is playable, data is clean, and resistance is non-material.",
      "Promotion candidate: meaningful edge versus market implied, reasonable juice, no critical data issue, and market resistance either absent or historically noisy.",
      "Block promotion when heavy juice eats EV, edge is thin, price is missing, data is stale/critical, or market resistance is material.",
      "No Play can move to Watchlist only when the card has real price/edge support; do not jump No Play to Best Angle.",
    ],
    downgradeCapLessons: [
      "Best Angle is suspect when price is heavy favorite juice without elite edge.",
      "Cap/downgrade Best Angle when market resistance or source conflict is material relative to edge and price.",
      "A Lean is not actionable when the price is poor, the edge is mostly raw probability, or the market is fighting the pick and historical cohort is weak.",
      "Do not downgrade just because the setup is imperfect; downgrade only if risk hurts EV or confidence.",
    ],
    missingSourceMateriality: [
      "Historical sharp-book fields were not meaningfully persisted in the research pack; treat historical missing sharp as replay limitation.",
      "Live Consensus Splits and Sharp Book Splits/Signal should be used when present and fresh.",
      "Missing live sharp source is a caution input only if that source is expected for the market and material to the bet.",
    ],
    marketSpecificBettingPrinciples: [
      "Price/juice discipline comes first.",
      "Favorite/dog logic matters: high win probability can still be bad EV at heavy juice.",
      "Compare model probability to no-vig/market implied probability and price quality.",
      "Heavy favorites need stronger edge and cleaner support.",
      "Watchlist is not weak by default; review it for promotion.",
    ],
    cohortFacts: {
      sample: compact(mem?.sample),
      priceBands: compactRecordMap(mem?.profitability?.byPriceBand, ["near_even", "dog_101_150", "juice_111_130", "juice_131_150", "juice_151_175", "juice_176_200", "heavy_juice_200_plus", "missing_price"]),
      favoriteDog: compactRecordMap(mem?.profitability?.byDirection, ["favorite", "dog"]),
      overconfidenceZones: compactZones(mem?.modelCalibration?.overconfidenceZones),
      underconfidenceZones: compactZones(mem?.modelCalibration?.underconfidenceZones),
      badBestAnglePatterns: topKeys(mem?.gradeQuality?.badBestAnglePatterns),
      underGradedWinnerPatterns: topKeys(mem?.gradeQuality?.underGradedWinnerPatterns),
    },
  };
}

function totalMemory(pack: ResearchPack): SharpAnalystMemoryModule {
  const ba = rec(pack, "total", "Best Angle");
  const lean = rec(pack, "total", "Lean");
  const watch = rec(pack, "total", "Watchlist");
  const noPlay = rec(pack, "total", "No Play");
  const mem = pack.modelMemoryPack?.total;
  return {
    market: "total",
    title: "MLB Totals Sharp Analyst Memory",
    historicalGradePerformance: { "Best Angle": compact(ba), Lean: compact(lean), Watchlist: compact(watch), "No Play": compact(noPlay), Caution: compact(rec(pack, "total", "Caution")) },
    modelAndGradeSystemMistakes: [
      recordLine("Totals Best Angle", ba),
      recordLine("Totals Lean", lean),
      recordLine("Totals Watchlist", watch),
      "Totals Watchlist has outperformed Totals Best Angle and Lean in the research pack.",
      "Totals Best Angle/Lean are not automatically actionable; verify line, price, and edge against the exact number.",
      "Some Totals No Plays/Watchlists may be under-graded when price is near-even and edge is real.",
    ],
    promotionLessons: [
      "Review Watchlist totals when model edge is clear, price is near-even/playable, data is clean, and line movement does not materially oppose the pick.",
      "Promotion candidate: model projection/probability beats the current total line, playable price, and market conflict is noise rather than strong resistance.",
      "Block promotion when edge is thin, price is bad, line moved against the pick materially, or source/data warning affects the total projection.",
      "Mixed market alone does not block promotion; assess whether the conflict is material to EV.",
    ],
    downgradeCapLessons: [
      "Cap Totals Best Angle if edge is thin, market resistance is material, or the number/price is no longer playable.",
      "A Lean is not actionable when the projection edge is small and the market price has deteriorated.",
      "Do not downgrade Totals Lean just because market is mixed if the historical cohort and price/edge support the bet.",
      "Over/Under direction should be analyzed separately; do not assume one side is inherently better.",
    ],
    missingSourceMateriality: [
      "Historical sharp-book fields were not meaningfully persisted; label this as replay limitation, not live data failure.",
      "Use live Consensus Splits and Sharp Book Splits/Signal when present and fresh.",
      "If total split/sharp sources are live-missing where expected, treat as a data warning, not automatic downgrade.",
    ],
    marketSpecificBettingPrinciples: [
      "Projection versus current total line is the core bet thesis.",
      "Edge size matters more than generic confidence.",
      "Line movement and price movement can confirm value or show missed number.",
      "Over/Under direction and price band matter.",
      "Watchlist deserves active promotion review because historical Watchlist has been strong.",
    ],
    cohortFacts: {
      sample: compact(mem?.sample),
      priceBands: compactRecordMap(mem?.profitability?.byPriceBand, ["near_even", "juice_111_130", "juice_131_150", "missing_price"]),
      overUnder: compactRecordMap(mem?.profitability?.byDirection, ["over", "under"]),
      marketReads: compactRecordMap(mem?.marketContext?.byMarketRead),
      overconfidenceZones: compactZones(mem?.modelCalibration?.overconfidenceZones),
      underconfidenceZones: compactZones(mem?.modelCalibration?.underconfidenceZones),
      badBestAnglePatterns: topKeys(mem?.gradeQuality?.badBestAnglePatterns),
      underGradedWinnerPatterns: topKeys(mem?.gradeQuality?.underGradedWinnerPatterns),
    },
  };
}

function fiMemory(pack: ResearchPack): SharpAnalystMemoryModule {
  const lean = rec(pack, "first_inning", "Lean");
  const watch = rec(pack, "first_inning", "Watchlist");
  const noPlay = rec(pack, "first_inning", "No Play");
  const mem = pack.modelMemoryPack?.first_inning;
  return {
    market: "first_inning",
    title: "MLB First Inning Sharp Analyst Memory",
    historicalGradePerformance: { "Best Angle": compact(rec(pack, "first_inning", "Best Angle")), Lean: compact(lean), Watchlist: compact(watch), "No Play": compact(noPlay), Caution: compact(rec(pack, "first_inning", "Caution")) },
    modelAndGradeSystemMistakes: [
      recordLine("FI Lean", lean),
      recordLine("FI Watchlist", watch),
      recordLine("FI No Play", noPlay),
      "FI Lean is a cohort to protect; do not downgrade it for missing FI splits alone.",
      "FI missing splits are universal historically and should be low materiality by default.",
      "FI price availability is uneven; price-missing rows are not good betting candidates.",
    ],
    promotionLessons: [
      "Review FI Watchlist for Lean when price exists, edge/probability is real, and starter/top-order context is fresh.",
      "Promotion candidate: playable NRFI/YRFI price, real edge, no critical starter/lineup/stale-data warning.",
      "Block promotion when price is missing/unplayable, edge is thin, or starter/top-order context is stale/critical.",
      "Missing FI split source alone should not block promotion.",
    ],
    downgradeCapLessons: [
      "Protect FI Lean unless a high-materiality issue exists.",
      "Downgrade FI Lean only for critical starter/lineup issue, stale data, bad price, thin/no edge, or real opposing market read if available.",
      "YRFI/NRFI heavy juice can make a good prediction non-actionable.",
      "Do not treat FI insufficient_data market read as equivalent to bad market signal when the missing field is just split coverage.",
    ],
    missingSourceMateriality: [
      "FI consensus/sharp split source is missing historically; this is low materiality by itself.",
      "Live FI price, model edge, starter/top-order freshness, and data quality matter more than missing split rows.",
      "If live FI split/sharp source becomes available, use it, but do not require it for Lean.",
    ],
    marketSpecificBettingPrinciples: [
      "Protect profitable FI Lean cohort.",
      "Analyze NRFI/YRFI separately.",
      "Starter/top-order context is high materiality.",
      "Missing FI splits are low materiality.",
      "Price and edge must still justify actionability.",
    ],
    cohortFacts: {
      sample: compact(mem?.sample),
      nrfiYrfi: compactRecordMap(mem?.profitability?.byDirection, ["nrfi", "yrfi", "unknown"]),
      priceBands: compactRecordMap(mem?.profitability?.byPriceBand, ["near_even", "juice_111_130", "juice_131_150", "juice_151_175", "missing_price"]),
      dataWarnings: compactRecordMap(mem?.marketContext?.byDataWarnings),
      overconfidenceZones: compactZones(mem?.modelCalibration?.overconfidenceZones),
      underconfidenceZones: compactZones(mem?.modelCalibration?.underconfidenceZones),
      profitableLeanPatterns: topKeys(mem?.gradeQuality?.profitableLeanPatterns),
      underGradedWinnerPatterns: topKeys(mem?.gradeQuality?.underGradedWinnerPatterns),
    },
  };
}

export function buildSharpAnalystMemoryModules(pack = loadSharpAnalystResearchPack()): Record<SharpAnalystMarket, SharpAnalystMemoryModule> {
  return {
    moneyline: mlMemory(pack),
    total: totalMemory(pack),
    first_inning: fiMemory(pack),
  };
}

export function sharpAnalystPrinciples(pack = loadSharpAnalystResearchPack()): string[] {
  return pack.sharpAnalystPrinciples ?? [
    "A good prediction is not automatically a good bet.",
    "Price and juice matter.",
    "Mixed market does not automatically mean Caution.",
    "Market resistance does not automatically mean No Play.",
    "Missing FI market/split signal does not downgrade FI by itself.",
    "Promote only when edge, price, data quality, and market context justify it.",
    "Downgrade only when risk materially hurts EV or confidence.",
  ];
}

export function buildSharpAnalystV3SystemPrompt(): string {
  return [
    "You are the OddSphere Sharp Analyst v3 in offline evaluation mode.",
    "You are a professional betting analyst using OddSphere historical memory, not a generic cautious card reviewer.",
    "Your goal is profitable classification: No Play / Caution / Watchlist / Lean / Best Angle.",
    "Do not blindly trust current grade. Current Best Angle is not automatically good; current Watchlist is not automatically weak; current No Play can include useful information but is not automatically actionable.",
    "Actively look for both bad promoted plays to cap/downgrade and under-graded setups to promote.",
    "Use current/rehydrated card payload, deterministic feature scores, relevant market memory, sharp principles, and market playbook.",
    "Never use postgame results, final score, winner, graded result, units, or ROI in current card inputs.",
    "Never flip picks, change probabilities, change projected scores, expose provider names, or apply live changes.",
    "Evaluate: Data Integrity, Market Read, Betting Value, Promotion Review, Downgrade Review, Play Grade Recommendation, Card Coherence.",
    "Promotion Candidate rule: when deterministicPromotionScans marks a market promotionCandidate=true, you must explicitly review it as an upgrade candidate. You may reject it only with a material blocker tied to price, edge, data quality, market resistance, or movement.",
    "If promotionCandidate=true and blockerMateriality is low, generally promote or set maxReasonableGrade above the current grade unless another material issue exists.",
    "Do not require perfect market alignment for promotion. Mixed but explainable market context can still be playable when edge and price are strong.",
    "FI rule: missing FI consensus/sharp splits is low materiality by itself and should_affect_grade=false unless paired with missing price, stale starter/lineup context, thin edge, or unplayable juice.",
    "Market Read validation: if consensus and sharp both exist, do not use insufficient_data; if they disagree, use mixed/source-conflict language; if they oppose the pick, use resistance/consensus_resistance/mixed, not insufficient_data.",
    "FI Market Read hard rule: if FI has price, model probability, market implied probability, edge, and usable FI context, do not label Market Read as insufficient_data. Use no_clear_signal when split bars are absent but FI core betting context exists.",
    "Echo validation: currentPlayGrade must exactly match the provided payload grade for that market.",
    "For every Watchlist/Caution/No Play, answer: is it under-graded, is there real edge, is price playable, does memory suggest this cohort is stronger than grade, max reasonable grade, and what blocks promotion.",
    "For Best Angle/Lean, ask whether price, edge, market context, data quality, and historical cohort support the current public grade.",
    "Return strict JSON in the configured schema when paid evaluation is explicitly enabled. In preview, this prompt is shown only for inspection.",
  ].join("\n");
}

export function marketMemoryForPayload(
  market: AiAuditorCompactMarketPayload,
  modules: Record<SharpAnalystMarket, SharpAnalystMemoryModule>,
): SharpAnalystMemoryModule {
  return modules[market.market];
}

export function buildSharpAnalystV3UserContext(args: {
  cardPayload: unknown;
  marketMemories: SharpAnalystMemoryModule[];
  principles: string[];
}) {
  const deterministicPromotionScans = Array.isArray((args.cardPayload as { markets?: unknown[] })?.markets)
    ? (args.cardPayload as { markets: AiAuditorCompactMarketPayload[] }).markets.map((market) => ({
      market: market.market,
      pick: market.pick,
      currentGrade: market.playGrade,
      ...scanPromotionCandidate(market),
    }))
    : [];
  return {
    variant: AI_SHARP_ANALYST_V3_VARIANT,
    mode: "offline_preview_or_paid_eval_only",
    applied: false,
    guardrails: {
      noLiveChanges: true,
      noMemberFacingChanges: true,
      noPickFlips: true,
      noProbabilityChanges: true,
      noProjectedScoreChanges: true,
      noProviderNames: true,
      noPostgameResultsIncluded: true,
      noBlindDowngrades: true,
      noBlindPromotions: true,
    },
    sharpAnalystPrinciples: args.principles,
    marketMemoryModules: args.marketMemories,
    evaluationJobs: [
      "Data Integrity",
      "Market Read",
      "Betting Value",
      "Promotion Review",
      "Downgrade Review",
      "Play Grade Recommendation",
      "Card Coherence",
    ],
    requiredPromotionReviewForWatchlistCautionNoPlay: {
      questions: [
        "Is this under-graded?",
        "Is there a real edge?",
        "Is price playable?",
        "Does historical memory suggest this cohort is stronger than its current grade?",
        "What is the max reasonable grade?",
        "What blocks promotion?",
      ],
    },
    deterministicPromotionScans,
    highlightedPromotionCandidatesForForcedReview: deterministicPromotionScans
      .filter((scan) => scan.promotionCandidate)
      .map((scan) => ({
        market: scan.market,
        pick: scan.pick,
        currentGrade: scan.currentGrade,
        maxCandidateGrade: scan.maxCandidateGrade,
        promotionScore: scan.promotionScore,
        reasonCodes: scan.promotionReasonCodes,
        blockers: scan.promotionBlockers,
        requiredQuestions: [
          "Should this promote to Lean?",
          "If not, what is the material blocker?",
          "Is the blocker strong enough to override the scanner?",
          "Is the blocker actually supported by price/market/edge/data?",
        ],
      })),
    marketReadValidationHints: Array.isArray((args.cardPayload as { markets?: unknown[] })?.markets)
      ? (args.cardPayload as { markets: AiAuditorCompactMarketPayload[] }).markets.map((market) => ({
        market: market.market,
        pick: market.pick,
        consensusPresent: market.consensusSplits !== null,
        sharpPresent: market.sharpBookSplits !== null,
        sourceConflict: market.sourceConflict,
        coreFieldsPresent: market.displayPriceAmerican !== null &&
          market.modelProbabilityPct !== null &&
          market.marketProbabilityPct !== null &&
          market.modelMarketGapPct !== null,
        fiCoreContextPresent: market.market === "first_inning" &&
          market.displayPriceAmerican !== null &&
          market.modelProbabilityPct !== null &&
          market.marketProbabilityPct !== null &&
          market.modelMarketGapPct !== null &&
          market.fiContext.expectedRunsAvailable === true,
        invalidLabels: market.market === "first_inning" &&
          market.displayPriceAmerican !== null &&
          market.modelProbabilityPct !== null &&
          market.marketProbabilityPct !== null &&
          market.modelMarketGapPct !== null &&
          market.fiContext.expectedRunsAvailable === true
          ? ["insufficient_data"]
          : market.consensusSplits !== null || market.sharpBookSplits !== null
            ? ["insufficient_data"]
            : [],
        preferredIfNoClearSignal: "no_clear_signal",
      }))
      : [],
    blindCardPayload: args.cardPayload,
  };
}
