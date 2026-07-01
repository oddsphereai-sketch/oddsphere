import crypto from "node:crypto";
import type {
  DailyEdgeGameDto,
  DailyEdgeResponse,
  MarketEdgeDto,
} from "@/app/lab/lib/labTypes";
import type { Sport } from "@/lib/types/domain/Sport";
import {
  currentMonthKey,
  resolveAiAuditorBudgetMode,
  type AiAuditorBudgetMode,
} from "@/lib/services/aiAuditCostControl";
import {
  miniEscalationCostUsd,
  summarizeAiAuditorEscalations,
  type AiAuditorEscalationSummary,
} from "@/lib/services/aiAuditor/escalationRouter";

export type AiAuditorMarketKey = "moneyline" | "total" | "first_inning";

export type AiAuditorCostPreviewOptions = {
  sport: Sport;
  from: string;
  to: string;
  markets: AiAuditorMarketKey[];
  refreshesPerDay: number;
  miniEscalationRates: number[];
  skipUnchangedPayloads: boolean;
  oneCallPerGameCard: boolean;
  includePeakSlateAssumptions: boolean;
  payloadsByDate: Array<{ date: string; response: DailyEdgeResponse }>;
  existingPayloadHashes?: Set<string>;
};

export type AiAuditorCompactMarketPayload = {
  market: AiAuditorMarketKey;
  pick: string | null;
  playGrade: string | null;
  modelProbabilityPct: number | null;
  marketProbabilityPct: number | null;
  probabilityUnits: "percent_0_100";
  modelMarketGapPct: number | null;
  priceAmerican: number | null;
  displayPriceAmerican: number | null;
  priceSource: "current_recommendation" | "market_read_v2_movement" | "locked_snapshot" | "unavailable";
  priceNullReason: string | null;
  line: number | null;
  lineValue: number | null;
  openLineValue: number | null;
  currentLineValue: number | null;
  lineValueSource: "market_edge" | "market_read_v2_movement" | "last_move" | "unavailable";
  lineValueNullReason: string | null;
  verdict: string | null;
  quickRead: string | null;
  marketRead: {
    status: string;
    label: string;
    copy: string;
  } | null;
  sourceConflict: boolean | null;
  reasonCodes: string[];
  consensusSplits: unknown;
  sharpBookSplits: unknown;
  lineMovement: {
    openAmerican: number | null;
    currentAmerican: number | null;
    displayCurrentAmerican: number | null;
    lockedAmerican: number | null;
    firstTrackedLine: number | null;
    currentLine: number | null;
    lastMovePreviousAmerican: number | null;
    lastMoveCurrentAmerican: number | null;
    lastMovePreviousLine: number | null;
    lastMoveCurrentLine: number | null;
    directionRelativeToPick: string | null;
    lastMoveAt: string | null;
  };
  dataQuality: {
    held: boolean;
    marketDataQuality: string | null;
    reviewFlags: string[];
    reviewActionSummary: string | null;
  };
  deterministicPreScore: {
    modelEdgeScore: number;
    priceQualityScore: number;
    marketAlignmentScore: number;
    marketResistanceScore: number;
    dataQualityScore: number;
    lineMovementScore: number;
    historicalCohortScore: number;
    finalGradeCandidateScore: number;
    notes: string[];
  };
  fiContext: {
    isFirstInning: boolean;
    expectedRunsAvailable: boolean | null;
    fiMarketSignalExpected: boolean;
    fiMarketSignalNullReason: string | null;
  };
};

export type AiAuditorCompactPayload = {
  schemaVersion: "ai-auditor-cost-preview-v1";
  auditMode: "cost_preview";
  sport: Sport;
  slateDate: string;
  gameId: string;
  externalId: number;
  teams: {
    away: string;
    home: string;
  };
  gameTime: string;
  lockState: string;
  lockedAt: string | null;
  updatedAt: string | null;
  asOfTimestamp: string;
  projectedScore: {
    away: number;
    home: number;
  } | null;
  sourceState: unknown;
  markets: AiAuditorCompactMarketPayload[];
  guardrails: {
    noMemberFacingChanges: true;
    noProviderNames: true;
    noPostgameResultsIncluded: true;
    oneCallPerGameCard: boolean;
  };
};

export type AiAuditorPayloadEstimate = {
  date: string;
  sport: Sport;
  gameId: string;
  externalId: number;
  matchup: string;
  marketCount: number;
  markets: AiAuditorMarketKey[];
  payloadHash: string;
  payloadBytes: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  cacheSkipped: boolean;
  skipReason: string | null;
  payload: AiAuditorCompactPayload;
};

export type AiAuditorCostPreviewSummary = {
  mode: "cost_preview";
  noOpenAiCalls: true;
  costPreviewOnly: boolean;
  generatedAt: string;
  sport: Sport;
  from: string;
  to: string;
  markets: AiAuditorMarketKey[];
  refreshesPerDay: number;
  days: number;
  gamesFound: number;
  gameCardPayloadsBuilt: number;
  auditOpportunities: {
    baseGameCards: number;
    refreshesRequested: number;
    hourlyAuditOpportunities: number;
    lockAudits: number;
    totalAuditOpportunities: number;
    historicalChangeSimulationAvailable: boolean;
    note: string | null;
  };
  estimatedAiCalls: number;
  estimatedCacheSkips: number;
  estimatedNanoCalls: number;
  estimatedMiniEscalationCalls: Record<string, number>;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedNanoCostUsd: number;
  estimatedMiniEscalationCostUsd: Record<string, number>;
  estimatedTotalCostUsd: Record<string, number>;
  escalationRouter: AiAuditorEscalationSummary & {
    estimatedMiniCostUsd: number;
    estimatedTotalCostWithRouterUsd: number;
    conservativeTotalCostWithRouterUsd: number;
  };
  costBySport: Record<string, number>;
  costByMarketCardType: Record<string, number>;
  highestCostDates: Array<{ date: string; estimatedCostUsd: number; gameCards: number }>;
  costScenarios: {
    onePassCostUsd: number;
    hourlyRefreshWorstCaseCostUsd: number;
    hourlyPlusLockWorstCaseCostUsd: number;
    changedOnlyCacheAdjustedCostUsd: number;
    realisticChangedOnlyCostUsd: number;
    messy10PctMiniEscalationUsd: number;
    messy20PctMiniEscalationUsd: number;
    dailyBestCaseChangedOnlyUsd: number;
    dailyRealisticHourlyChangesUsd: number;
    dailyMessy10PctMiniEscalationUsd: number;
    dailyBadCaseNoCacheUsd: number;
  };
  conservativeCostScenarios: {
    multiplier: number;
    onePassCostUsd: number;
    hourlyRefreshWorstCaseCostUsd: number;
    hourlyPlusLockWorstCaseCostUsd: number;
    changedOnlyCacheAdjustedCostUsd: number;
    messy10PctMiniEscalationUsd: number;
    messy20PctMiniEscalationUsd: number;
    projectedMonthlyRealisticHourlyChangesUsd: number;
    projectedMonthlyBadCaseNoCacheUsd: number;
  };
  projectedMonthlyCostUsd: {
    bestCaseWithCacheSkips: number;
    realisticCaseFromHistoricalPayloads: number;
    realisticHourlyChangesOnMostCards: number;
    messyCase10PctMiniEscalation: number;
    worstCaseEveryHourlyRefresh: number;
    badCaseNoCacheHourlyPlusLock: number;
  };
  projectedPeakSlateCostUsd: Array<{
    label: string;
    assumedGameCards: number;
    refreshes: number;
    lockAudits: number;
    hourlyAuditOpportunities: number;
    totalAuditOpportunities: number;
    estimatedOnePassCostUsd: number;
    estimatedHourlyRefreshCostUsd: number;
    estimatedHourlyPlusLockCostUsd: number;
    estimatedMessy10PctMiniEscalationUsd: number;
    estimatedMessy20PctMiniEscalationUsd: number;
    conservativeHourlyPlusLockCostUsd: number;
    synthetic: boolean;
  }>;
  budgetModeByScenario: Record<string, AiAuditorBudgetMode>;
  pricing: {
    nanoModel: string;
    miniModel: string;
    nanoInputUsdPerMillion: number;
    nanoOutputUsdPerMillion: number;
    miniInputUsdPerMillion: number;
    miniOutputUsdPerMillion: number;
    pricingMode: "standard" | "batch";
    conservativeMultiplier: number;
    source: "env_or_configurable_default";
  };
  tokenAssumptions: {
    charsPerToken: number;
    inputSafetyMultiplier: number;
    outputTokensPerGameCard: number;
    miniOutputTokensPerEscalation: number;
  };
  payloads: AiAuditorPayloadEstimate[];
};

const MARKET_ALIASES: Record<string, AiAuditorMarketKey> = {
  ML: "moneyline",
  MONEYLINE: "moneyline",
  TOTAL: "total",
  TOTALS: "total",
  OU: "total",
  "O/U": "total",
  FI: "first_inning",
  FIRST_INNING: "first_inning",
  FIRST: "first_inning",
  SPREAD: "first_inning",
  PL: "first_inning",
  BTTS: "first_inning",
};

export const DEFAULT_AI_AUDITOR_MARKETS: AiAuditorMarketKey[] = [
  "moneyline",
  "total",
  "first_inning",
];

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw.toLowerCase() === "true";
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envString(name: string, fallback: string): string {
  return process.env[name] && process.env[name]!.trim().length > 0
    ? process.env[name]!.trim()
    : fallback;
}

export function parseAiAuditorMarkets(raw: string | null | undefined): AiAuditorMarketKey[] {
  if (!raw) return DEFAULT_AI_AUDITOR_MARKETS;
  const next = raw
    .split(",")
    .map((part) => MARKET_ALIASES[part.trim().toUpperCase()])
    .filter((part): part is AiAuditorMarketKey => part !== undefined);
  return next.length > 0 ? Array.from(new Set(next)) : DEFAULT_AI_AUDITOR_MARKETS;
}

export function eachDateInclusive(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`Invalid date range: ${from} to ${to}`);
  }
  if (start > end) throw new Error(`Invalid date range: from ${from} is after to ${to}`);
  const out: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function resolveAiAuditorPricing() {
  return {
    nanoModel: envString("AI_AUDITOR_NANO_MODEL", envString("AI_AUDITOR_PRIMARY_MODEL", "gpt-5.4-nano")),
    miniModel: envString("AI_AUDITOR_MINI_MODEL", "gpt-5.4-mini"),
    nanoInputUsdPerMillion: envNumber("AI_AUDITOR_NANO_INPUT_USD_PER_M", 0.20),
    nanoOutputUsdPerMillion: envNumber("AI_AUDITOR_NANO_OUTPUT_USD_PER_M", 1.25),
    miniInputUsdPerMillion: envNumber("AI_AUDITOR_MINI_INPUT_USD_PER_M", 0.75),
    miniOutputUsdPerMillion: envNumber("AI_AUDITOR_MINI_OUTPUT_USD_PER_M", 4.50),
    pricingMode: envString("AI_AUDITOR_PRICING_MODE", "standard") === "batch" ? "batch" as const : "standard" as const,
    conservativeMultiplier: envNumber("AI_AUDITOR_CONSERVATIVE_PRICE_MULTIPLIER", 2),
    source: "env_or_configurable_default" as const,
  };
}

export function resolveAiAuditorTokenAssumptions() {
  return {
    charsPerToken: envNumber("AI_AUDITOR_ESTIMATE_CHARS_PER_TOKEN", 4),
    inputSafetyMultiplier: envNumber("AI_AUDITOR_INPUT_TOKEN_SAFETY_MULTIPLIER", 1.15),
    outputTokensPerGameCard: envNumber("AI_AUDITOR_ESTIMATED_OUTPUT_TOKENS_PER_GAME_CARD", 700),
    miniOutputTokensPerEscalation: envNumber("AI_AUDITOR_ESTIMATED_MINI_OUTPUT_TOKENS", 450),
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export function auditPayloadHash(payload: AiAuditorCompactPayload): string {
  return crypto.createHash("sha256").update(stableJson(payload)).digest("hex");
}

function estimateInputTokens(payloadJson: string): number {
  const assumptions = resolveAiAuditorTokenAssumptions();
  return Math.ceil((Buffer.byteLength(payloadJson, "utf8") / assumptions.charsPerToken) * assumptions.inputSafetyMultiplier);
}

function toPct(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return +(value <= 1 ? value * 100 : value).toFixed(2);
}

function compactMarketPrice(dto: MarketEdgeDto): {
  displayPriceAmerican: number | null;
  priceSource: AiAuditorCompactMarketPayload["priceSource"];
  priceNullReason: string | null;
} {
  const movement = dto.marketReadV2?.movement ?? null;
  if (dto.priceAmerican !== null) {
    return { displayPriceAmerican: dto.priceAmerican, priceSource: "current_recommendation", priceNullReason: null };
  }
  if (movement?.currentPrice !== null && movement?.currentPrice !== undefined) {
    return { displayPriceAmerican: movement.currentPrice, priceSource: "market_read_v2_movement", priceNullReason: null };
  }
  if (dto.lockedLineAmerican !== null && dto.lockedLineAmerican !== undefined) {
    return { displayPriceAmerican: dto.lockedLineAmerican, priceSource: "locked_snapshot", priceNullReason: null };
  }
  return {
    displayPriceAmerican: null,
    priceSource: "unavailable",
    priceNullReason: dto.priceUnavailableAtLock === true
      ? "no_price_recorded_at_lock"
      : dto.marketDataQuality === "unavailable"
        ? "market_data_unavailable"
        : "no_current_or_movement_price_available",
  };
}

function compactMarketLineValue(market: AiAuditorMarketKey, dto: MarketEdgeDto): {
  lineValue: number | null;
  openLineValue: number | null;
  currentLineValue: number | null;
  lineValueSource: AiAuditorCompactMarketPayload["lineValueSource"];
  lineValueNullReason: string | null;
} {
  const movement = dto.marketReadV2?.movement ?? null;
  const lineValue = dto.line ?? dto.marketTotal ?? movement?.currentLine ?? dto.lastMoveLineNext ?? null;
  const openLineValue = movement?.firstTrackedLine ?? dto.lastMoveLinePrev ?? null;
  const currentLineValue = dto.line ?? movement?.currentLine ?? dto.lastMoveLineNext ?? null;
  if (lineValue !== null) {
    return {
      lineValue,
      openLineValue,
      currentLineValue,
      lineValueSource: dto.line !== null || dto.marketTotal !== null
        ? "market_edge"
        : movement?.currentLine !== null && movement?.currentLine !== undefined
          ? "market_read_v2_movement"
          : "last_move",
      lineValueNullReason: null,
    };
  }
  return {
    lineValue: null,
    openLineValue,
    currentLineValue,
    lineValueSource: "unavailable",
    lineValueNullReason: market === "moneyline"
      ? "moneyline_has_no_point_line"
      : market === "first_inning"
        ? "first_inning_line_not_available_in_current_dto"
        : "no_total_line_available",
  };
}

function compactMarket(market: AiAuditorMarketKey, dto: MarketEdgeDto): AiAuditorCompactMarketPayload {
  const decision = dto.recommendationDecision;
  const price = compactMarketPrice(dto);
  const lineValue = compactMarketLineValue(market, dto);
  const modelProbabilityPct = toPct(dto.modelProb);
  const marketProbabilityPct = dto.marketImpliedPct ?? toPct(dto.marketFairProb);
  const modelEdgeScore = scoreModelEdge(dto.modelMarketGapPct ?? null, modelProbabilityPct);
  const priceQualityScore = scorePriceQuality(market, price.displayPriceAmerican);
  const marketAlignmentScore = scoreMarketAlignment(decision?.resolvedMarketRead?.status ?? null);
  const marketResistanceScore = scoreMarketResistance(decision?.resolvedMarketRead?.status ?? null, decision?.sourceConflict ?? false);
  const dataQualityScore = scoreDataQuality(dto.reviewFlags ?? [], dto.marketDataQuality ?? null, decision?.sharpBookSplits ?? null, market);
  const lineMovementScore = scoreLineMovement(dto.lineOpenAmerican, dto.priceAmerican, dto.pick);
  const historicalCohortScore = scoreHistoricalCohort(market, decision?.playGrade ?? dto.verdict?.label ?? dto.grade ?? null);
  const finalGradeCandidateScore = clampScore(
    modelEdgeScore * 0.3 +
    priceQualityScore * 0.15 +
    marketAlignmentScore * 0.15 +
    marketResistanceScore * 0.1 +
    dataQualityScore * 0.15 +
    lineMovementScore * 0.05 +
    historicalCohortScore * 0.1,
  );
  return {
    market,
    pick: dto.pick,
    playGrade: decision?.playGrade ?? dto.verdict?.label ?? dto.grade ?? null,
    modelProbabilityPct,
    marketProbabilityPct,
    probabilityUnits: "percent_0_100",
    modelMarketGapPct: dto.modelMarketGapPct ?? null,
    priceAmerican: dto.priceAmerican,
    displayPriceAmerican: price.displayPriceAmerican,
    priceSource: price.priceSource,
    priceNullReason: price.priceNullReason,
    line: dto.line,
    lineValue: lineValue.lineValue,
    openLineValue: lineValue.openLineValue,
    currentLineValue: lineValue.currentLineValue,
    lineValueSource: lineValue.lineValueSource,
    lineValueNullReason: lineValue.lineValueNullReason,
    verdict: dto.verdict?.label ?? null,
    quickRead: decision?.quickRead ?? null,
    marketRead: decision?.resolvedMarketRead
      ? {
          status: decision.resolvedMarketRead.status,
          label: decision.resolvedMarketRead.label,
          copy: decision.resolvedMarketRead.copy,
        }
      : null,
    sourceConflict: decision?.sourceConflict ?? null,
    reasonCodes: decision?.reasonCodes ?? [],
    consensusSplits: decision?.consensusSplits ?? null,
    sharpBookSplits: decision?.sharpBookSplits ?? null,
    lineMovement: {
      openAmerican: dto.lineOpenAmerican,
      currentAmerican: dto.priceAmerican,
      displayCurrentAmerican: price.displayPriceAmerican,
      lockedAmerican: dto.lockedLineAmerican ?? null,
      firstTrackedLine: dto.marketReadV2?.movement?.firstTrackedLine ?? null,
      currentLine: dto.marketReadV2?.movement?.currentLine ?? null,
      lastMovePreviousAmerican: dto.lastMovePrevAmerican ?? null,
      lastMoveCurrentAmerican: dto.lastMoveNextAmerican ?? null,
      lastMovePreviousLine: dto.lastMoveLinePrev ?? null,
      lastMoveCurrentLine: dto.lastMoveLineNext ?? null,
      directionRelativeToPick: dto.marketReadV2?.movement?.directionRelativeToPick ?? null,
      lastMoveAt: dto.lastMoveAtIso ?? null,
    },
    dataQuality: {
      held: dto.held,
      marketDataQuality: dto.marketDataQuality ?? null,
      reviewFlags: dto.reviewFlags ?? [],
      reviewActionSummary: dto.reviewActionSummary ?? null,
    },
    deterministicPreScore: {
      modelEdgeScore,
      priceQualityScore,
      marketAlignmentScore,
      marketResistanceScore,
      dataQualityScore,
      lineMovementScore,
      historicalCohortScore,
      finalGradeCandidateScore,
      notes: deterministicPreScoreNotes({
        market,
        grade: decision?.playGrade ?? dto.verdict?.label ?? dto.grade ?? null,
        marketRead: decision?.resolvedMarketRead?.status ?? null,
        sourceConflict: decision?.sourceConflict ?? false,
        reviewFlags: dto.reviewFlags ?? [],
        sharpBookSplits: decision?.sharpBookSplits ?? null,
      }),
    },
    fiContext: {
      isFirstInning: market === "first_inning",
      expectedRunsAvailable: market === "first_inning"
        ? dto.keyStats.some((row) => /expected|run/i.test(row.label) && (row.awayValue !== null || row.homeValue !== null))
        : null,
      fiMarketSignalExpected: false,
      fiMarketSignalNullReason: market === "first_inning"
        ? "MLB first-inning split/sharp source is not expected in current provider coverage; do not treat missing FI split signal as material by itself."
        : null,
    },
  };
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, +value.toFixed(1)));
}

function scoreModelEdge(gapPct: number | null, modelProbPct: number | null): number {
  const gap = Math.abs(Number(gapPct ?? 0));
  const prob = Number(modelProbPct ?? 0);
  const probBonus = prob >= 60 ? 15 : prob >= 56 ? 8 : prob >= 53 ? 4 : 0;
  return clampScore(Math.min(75, gap * 7.5) + probBonus);
}

function scorePriceQuality(market: AiAuditorMarketKey, price: number | null): number {
  if (price === null || !Number.isFinite(price)) return market === "first_inning" ? 55 : 45;
  if (price > 0) return clampScore(70 + Math.min(20, price / 20));
  const juice = Math.abs(price);
  if (juice <= 115) return 80;
  if (juice <= 135) return 65;
  if (juice <= 155) return 48;
  return 30;
}

function scoreMarketAlignment(status: string | null): number {
  if (status === "aligned" || status === "consensus_support") return 80;
  if (status === "mixed" || status === "no_clear_signal") return 55;
  if (status === "resistance" || status === "consensus_resistance") return 35;
  if (status === "insufficient_data") return 45;
  return 50;
}

function scoreMarketResistance(status: string | null, sourceConflict: boolean): number {
  if (sourceConflict || status === "mixed") return 40;
  if (status === "resistance" || status === "consensus_resistance") return 25;
  if (status === "aligned" || status === "consensus_support") return 80;
  return 55;
}

function scoreDataQuality(
  reviewFlags: string[],
  marketDataQuality: string | null,
  sharpBookSplits: unknown,
  market: AiAuditorMarketKey,
): number {
  const joined = `${reviewFlags.join(" ")} ${marketDataQuality ?? ""}`.toLowerCase();
  if (/starter|lineup|injury|reversed|mismatch/.test(joined)) return 30;
  if (/stale|partial|missing/.test(joined)) return 45;
  if (!sharpBookSplits && market === "first_inning") return 70;
  if (!sharpBookSplits) return 58;
  return 82;
}

function scoreLineMovement(openAmerican: number | null, currentAmerican: number | null, pick: string | null): number {
  if (openAmerican === null || currentAmerican === null || !pick) return 50;
  const delta = currentAmerican - openAmerican;
  if (Math.abs(delta) < 8) return 55;
  const pickLooksFavorite = currentAmerican < 0;
  const towardPick = pickLooksFavorite ? delta < 0 : delta > 0;
  return towardPick ? 75 : 35;
}

function scoreHistoricalCohort(market: AiAuditorMarketKey, grade: string | null): number {
  if (market === "first_inning" && grade === "Lean") return 88;
  if (market === "total" && grade === "Lean") return 72;
  if (market === "moneyline" && grade === "Lean") return 45;
  if (grade === "Best Angle") return 42;
  if (grade === "Watchlist") return 60;
  if (grade === "Caution") return 45;
  return 50;
}

function deterministicPreScoreNotes(args: {
  market: AiAuditorMarketKey;
  grade: string | null;
  marketRead: string | null;
  sourceConflict: boolean;
  reviewFlags: string[];
  sharpBookSplits: unknown;
}): string[] {
  const notes: string[] = [];
  if (args.market === "first_inning" && !args.sharpBookSplits) {
    notes.push("FI missing sharp source is low-materiality by default; do not auto-downgrade without price/starter/data issue.");
  }
  if (args.market === "first_inning" && args.grade === "Lean") {
    notes.push("Recent replay cohort: original MLB FI Leans performed strongly; require high-materiality issue before downgrade.");
  }
  if (args.market === "total" && args.grade === "Lean") {
    notes.push("Recent replay cohort: MLB Totals Leans were positive; mixed market alone is not enough to downgrade.");
  }
  if (args.grade === "Best Angle") {
    notes.push("Recent replay cohort: Best Angle underperformed; verify price, edge, and market resistance carefully.");
  }
  if (args.marketRead === "resistance" || args.marketRead === "consensus_resistance") {
    notes.push("Market resistance present; downgrade only when material relative to model edge and price.");
  }
  if (args.sourceConflict) notes.push("Source conflict present; evaluate materiality before changing grade.");
  if (args.reviewFlags.length > 0) notes.push(`Data flags: ${args.reviewFlags.join(", ")}`);
  return notes;
}

export function buildAiAuditorCompactPayload(args: {
  response: DailyEdgeResponse;
  game: DailyEdgeGameDto;
  markets: AiAuditorMarketKey[];
  oneCallPerGameCard: boolean;
}): AiAuditorCompactPayload {
  const marketPayloads = args.markets
    .map((market) => {
      const dto = args.game.markets[market];
      return dto ? compactMarket(market, dto) : null;
    })
    .filter((market): market is AiAuditorCompactMarketPayload => market !== null);

  return {
    schemaVersion: "ai-auditor-cost-preview-v1",
    auditMode: "cost_preview",
    sport: args.response.sport,
    slateDate: args.response.date,
    gameId: args.game.id,
    externalId: args.game.external_id,
    teams: {
      away: args.game.awayTeam,
      home: args.game.homeTeam,
    },
    gameTime: args.game.gameTime,
    lockState: args.game.lockState,
    lockedAt: args.game.lockedAt,
    updatedAt: args.game.updatedAt,
    asOfTimestamp: args.game.lockedAt ?? args.game.updatedAt ?? args.response.as_of,
    projectedScore: args.game.projected ?? null,
    sourceState: args.game.recommendationDecision?.sourceState ?? null,
    markets: marketPayloads,
    guardrails: {
      noMemberFacingChanges: true,
      noProviderNames: true,
      noPostgameResultsIncluded: true,
      oneCallPerGameCard: args.oneCallPerGameCard,
    },
  };
}

export function estimateCostUsd(inputTokens: number, outputTokens: number, inputPerM: number, outputPerM: number): number {
  return +(((inputTokens / 1_000_000) * inputPerM) + ((outputTokens / 1_000_000) * outputPerM)).toFixed(6);
}

function multiplyCost(value: number, multiplier: number): number {
  return +(value * multiplier).toFixed(6);
}

function addNumber(map: Record<string, number>, key: string, value: number): void {
  map[key] = +(Number(map[key] ?? 0) + value).toFixed(6);
}

function addDateCost(
  map: Record<string, { cost: number; cards: number }>,
  key: string,
  value: number,
): void {
  const previous = map[key] ?? { cost: 0, cards: 0 };
  map[key] = {
    cost: +(previous.cost + value).toFixed(6),
    cards: previous.cards + 1,
  };
}

function countBudgetMode(projectedSpend: number): AiAuditorBudgetMode {
  return resolveAiAuditorBudgetMode({
    total_spend_usd: 0,
    projected_spend_usd: projectedSpend,
  });
}

export function buildAiAuditorCostPreview(options: AiAuditorCostPreviewOptions): AiAuditorCostPreviewSummary {
  if (envBool("AI_AUDITOR_COST_PREVIEW_ONLY", true) !== true) {
    throw new Error("Cost preview requires AI_AUDITOR_COST_PREVIEW_ONLY=true");
  }
  const pricing = resolveAiAuditorPricing();
  const tokenAssumptions = resolveAiAuditorTokenAssumptions();
  const outputTokensPerPayload = Math.ceil(tokenAssumptions.outputTokensPerGameCard);
  const payloads: AiAuditorPayloadEstimate[] = [];
  const costByMarketCardType: Record<string, number> = {};
  const dateCosts: Record<string, { cost: number; cards: number }> = {};

  for (const { date, response } of options.payloadsByDate) {
    for (const game of response.games ?? []) {
      const payload = buildAiAuditorCompactPayload({
        response,
        game,
        markets: options.markets,
        oneCallPerGameCard: options.oneCallPerGameCard,
      });
      if (payload.markets.length === 0) continue;
      const json = stableJson(payload);
      const hash = auditPayloadHash(payload);
      const cacheSkipped =
        options.skipUnchangedPayloads &&
        options.existingPayloadHashes !== undefined &&
        options.existingPayloadHashes.has(hash);
      const inputTokens = estimateInputTokens(json);
      const nanoCost = cacheSkipped
        ? 0
        : estimateCostUsd(inputTokens, outputTokensPerPayload, pricing.nanoInputUsdPerMillion, pricing.nanoOutputUsdPerMillion);
      addDateCost(dateCosts, date, nanoCost);
      for (const market of payload.markets) {
        addNumber(costByMarketCardType, market.market, nanoCost / payload.markets.length);
      }
      payloads.push({
        date,
        sport: response.sport,
        gameId: game.id,
        externalId: game.external_id,
        matchup: `${game.awayTeam} @ ${game.homeTeam}`,
        marketCount: payload.markets.length,
        markets: payload.markets.map((market) => market.market),
        payloadHash: hash,
        payloadBytes: Buffer.byteLength(json, "utf8"),
        estimatedInputTokens: inputTokens,
        estimatedOutputTokens: outputTokensPerPayload,
        cacheSkipped,
        skipReason: cacheSkipped ? "audit_payload_hash_seen" : null,
        payload,
      });
    }
  }

  const activePayloads = payloads.filter((payload) => !payload.cacheSkipped);
  const allInputTokens = payloads.reduce((sum, payload) => sum + payload.estimatedInputTokens, 0);
  const allOutputTokens = payloads.reduce((sum, payload) => sum + payload.estimatedOutputTokens, 0);
  const onePassCostUsd = estimateCostUsd(
    allInputTokens,
    allOutputTokens,
    pricing.nanoInputUsdPerMillion,
    pricing.nanoOutputUsdPerMillion,
  );
  const estimatedInputTokens = activePayloads.reduce((sum, payload) => sum + payload.estimatedInputTokens, 0);
  const estimatedOutputTokens = activePayloads.reduce((sum, payload) => sum + payload.estimatedOutputTokens, 0);
  const estimatedNanoCostUsd = estimateCostUsd(
    estimatedInputTokens,
    estimatedOutputTokens,
    pricing.nanoInputUsdPerMillion,
    pricing.nanoOutputUsdPerMillion,
  );
  const estimatedMiniEscalationCalls: Record<string, number> = {};
  const estimatedMiniEscalationCostUsd: Record<string, number> = {};
  const estimatedTotalCostUsd: Record<string, number> = {};
  for (const rate of options.miniEscalationRates) {
    const key = `${Math.round(rate * 100)}%`;
    const calls = Math.ceil(activePayloads.length * rate);
    estimatedMiniEscalationCalls[key] = calls;
    const avgInput = activePayloads.length > 0 ? Math.ceil(estimatedInputTokens / activePayloads.length) : 0;
    const miniCost = estimateCostUsd(
      calls * avgInput,
      calls * tokenAssumptions.miniOutputTokensPerEscalation,
      pricing.miniInputUsdPerMillion,
      pricing.miniOutputUsdPerMillion,
    );
    estimatedMiniEscalationCostUsd[key] = miniCost;
    estimatedTotalCostUsd[key] = +(estimatedNanoCostUsd + miniCost).toFixed(6);
  }
  const provisionalProjected = +(estimatedNanoCostUsd / Math.max(1, options.payloadsByDate.length) * 31).toFixed(6);
  const budgetModeForRouter = resolveAiAuditorBudgetMode({
    total_spend_usd: 0,
    projected_spend_usd: provisionalProjected,
  });
  const routerBase = summarizeAiAuditorEscalations({
    payloads: activePayloads,
    budgetMode: budgetModeForRouter,
  });
  const averageInputTokens = activePayloads.length > 0 ? Math.ceil(estimatedInputTokens / activePayloads.length) : 0;
  const routerMiniCost = miniEscalationCostUsd({
    miniCalls: routerBase.estimatedMiniCalls,
    averageInputTokens,
    outputTokensPerEscalation: tokenAssumptions.miniOutputTokensPerEscalation,
    inputUsdPerMillion: pricing.miniInputUsdPerMillion,
    outputUsdPerMillion: pricing.miniOutputUsdPerMillion,
  });

  const refreshes = Math.max(1, options.refreshesPerDay);
  const baseGameCards = payloads.length;
  const hourlyAuditOpportunities = baseGameCards * refreshes;
  const lockAudits = baseGameCards;
  const totalAuditOpportunities = hourlyAuditOpportunities + lockAudits;
  const bestCaseWithCacheSkips = estimatedNanoCostUsd;
  const hourlyRefreshWorstCaseCostUsd = multiplyCost(onePassCostUsd, refreshes);
  const hourlyPlusLockWorstCaseCostUsd = multiplyCost(onePassCostUsd, refreshes + 1);
  const uniqueHashes = new Set(payloads.map((payload) => payload.payloadHash)).size;
  const historicalChangeSimulationAvailable = options.payloadsByDate.length > 1;
  const avgPayloadCost = payloads.length > 0 ? onePassCostUsd / payloads.length : 0;
  const realisticCaseFromHistoricalPayloads = +(uniqueHashes * avgPayloadCost).toFixed(6);
  const realisticHourlyChangesOnMostCards = multiplyCost(onePassCostUsd, Math.max(1, Math.ceil(refreshes * 0.75)));
  const mini10 = estimatedMiniEscalationCostUsd["10%"] ?? 0;
  const mini20 = estimatedMiniEscalationCostUsd["20%"] ?? 0;
  const messy10PctMiniEscalationUsd = +(realisticHourlyChangesOnMostCards + multiplyCost(mini10, refreshes)).toFixed(6);
  const messy20PctMiniEscalationUsd = +(realisticHourlyChangesOnMostCards + multiplyCost(mini20, refreshes)).toFixed(6);
  const averageCardsPerDate = options.payloadsByDate.length > 0 ? payloads.length / options.payloadsByDate.length : 0;
  const avgInputTokensPerPayload = payloads.length > 0 ? Math.ceil(allInputTokens / payloads.length) : 0;
  const peakSlate = (label: string, cards: number, peakRefreshes: number, synthetic: boolean) => {
    const totalOps = cards * peakRefreshes + cards;
    const hourlyPlusLock = multiplyCost(avgPayloadCost, totalOps);
    const miniCostFor = (rate: number) => {
      const miniCalls = Math.ceil(totalOps * rate);
      return estimateCostUsd(
        miniCalls * avgInputTokensPerPayload,
        miniCalls * tokenAssumptions.miniOutputTokensPerEscalation,
        pricing.miniInputUsdPerMillion,
        pricing.miniOutputUsdPerMillion,
      );
    };
    return {
      label,
      assumedGameCards: cards,
      refreshes: peakRefreshes,
      lockAudits: cards,
      hourlyAuditOpportunities: cards * peakRefreshes,
      totalAuditOpportunities: totalOps,
      estimatedOnePassCostUsd: multiplyCost(avgPayloadCost, cards),
      estimatedHourlyRefreshCostUsd: multiplyCost(avgPayloadCost, cards * peakRefreshes),
      estimatedHourlyPlusLockCostUsd: hourlyPlusLock,
      estimatedMessy10PctMiniEscalationUsd: +(hourlyPlusLock + miniCostFor(0.10)).toFixed(6),
      estimatedMessy20PctMiniEscalationUsd: +(hourlyPlusLock + miniCostFor(0.20)).toFixed(6),
      conservativeHourlyPlusLockCostUsd: multiplyCost(hourlyPlusLock, pricing.conservativeMultiplier),
      synthetic,
    };
  };

  const projectedMonthlyWorst = +(hourlyRefreshWorstCaseCostUsd / Math.max(1, options.payloadsByDate.length) * 31).toFixed(6);
  const projectedMonthlyBest = +(bestCaseWithCacheSkips / Math.max(1, options.payloadsByDate.length) * 31).toFixed(6);
  const projectedMonthlyRealistic = +(realisticCaseFromHistoricalPayloads / Math.max(1, options.payloadsByDate.length) * 31).toFixed(6);
  const projectedMonthlyHourlyChanges = +(realisticHourlyChangesOnMostCards / Math.max(1, options.payloadsByDate.length) * 31).toFixed(6);
  const projectedMonthlyMessy10 = +(messy10PctMiniEscalationUsd / Math.max(1, options.payloadsByDate.length) * 31).toFixed(6);
  const projectedMonthlyBad = +(hourlyPlusLockWorstCaseCostUsd / Math.max(1, options.payloadsByDate.length) * 31).toFixed(6);
  const conservative = (value: number) => multiplyCost(value, pricing.conservativeMultiplier);

  return {
    mode: "cost_preview",
    noOpenAiCalls: true,
    costPreviewOnly: true,
    generatedAt: new Date().toISOString(),
    sport: options.sport,
    from: options.from,
    to: options.to,
    markets: options.markets,
    refreshesPerDay: refreshes,
    days: eachDateInclusive(options.from, options.to).length,
    gamesFound: payloads.length,
    gameCardPayloadsBuilt: payloads.length,
    auditOpportunities: {
      baseGameCards,
      refreshesRequested: refreshes,
      hourlyAuditOpportunities,
      lockAudits,
      totalAuditOpportunities,
      historicalChangeSimulationAvailable,
      note: historicalChangeSimulationAvailable
        ? null
        : "Only one payload snapshot per game card is available in this preview, so hourly distinct changes cannot be replayed. Worst-case refresh cost is still projected as a multiplier.",
    },
    estimatedAiCalls: activePayloads.length,
    estimatedCacheSkips: payloads.length - activePayloads.length,
    estimatedNanoCalls: activePayloads.length,
    estimatedMiniEscalationCalls,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedNanoCostUsd,
    estimatedMiniEscalationCostUsd,
    estimatedTotalCostUsd,
    escalationRouter: {
      ...routerBase,
      estimatedMiniCostUsd: routerMiniCost,
      estimatedTotalCostWithRouterUsd: +(estimatedNanoCostUsd + routerMiniCost).toFixed(6),
      conservativeTotalCostWithRouterUsd: multiplyCost(estimatedNanoCostUsd + routerMiniCost, pricing.conservativeMultiplier),
    },
    costBySport: { [options.sport]: estimatedNanoCostUsd },
    costByMarketCardType,
    highestCostDates: Object.entries(dateCosts)
      .map(([date, value]) => ({ date, estimatedCostUsd: +value.cost.toFixed(6), gameCards: value.cards }))
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd)
      .slice(0, 10),
    costScenarios: {
      onePassCostUsd,
      hourlyRefreshWorstCaseCostUsd,
      hourlyPlusLockWorstCaseCostUsd,
      changedOnlyCacheAdjustedCostUsd: bestCaseWithCacheSkips,
      realisticChangedOnlyCostUsd: realisticCaseFromHistoricalPayloads,
      messy10PctMiniEscalationUsd,
      messy20PctMiniEscalationUsd,
      dailyBestCaseChangedOnlyUsd: bestCaseWithCacheSkips,
      dailyRealisticHourlyChangesUsd: realisticHourlyChangesOnMostCards,
      dailyMessy10PctMiniEscalationUsd: messy10PctMiniEscalationUsd,
      dailyBadCaseNoCacheUsd: hourlyPlusLockWorstCaseCostUsd,
    },
    conservativeCostScenarios: {
      multiplier: pricing.conservativeMultiplier,
      onePassCostUsd: conservative(onePassCostUsd),
      hourlyRefreshWorstCaseCostUsd: conservative(hourlyRefreshWorstCaseCostUsd),
      hourlyPlusLockWorstCaseCostUsd: conservative(hourlyPlusLockWorstCaseCostUsd),
      changedOnlyCacheAdjustedCostUsd: conservative(bestCaseWithCacheSkips),
      messy10PctMiniEscalationUsd: conservative(messy10PctMiniEscalationUsd),
      messy20PctMiniEscalationUsd: conservative(messy20PctMiniEscalationUsd),
      projectedMonthlyRealisticHourlyChangesUsd: conservative(projectedMonthlyHourlyChanges),
      projectedMonthlyBadCaseNoCacheUsd: conservative(projectedMonthlyBad),
    },
    projectedMonthlyCostUsd: {
      bestCaseWithCacheSkips: projectedMonthlyBest,
      realisticCaseFromHistoricalPayloads: projectedMonthlyRealistic,
      realisticHourlyChangesOnMostCards: projectedMonthlyHourlyChanges,
      messyCase10PctMiniEscalation: projectedMonthlyMessy10,
      worstCaseEveryHourlyRefresh: projectedMonthlyWorst,
      badCaseNoCacheHourlyPlusLock: projectedMonthlyBad,
    },
    projectedPeakSlateCostUsd: options.includePeakSlateAssumptions
      ? [
          peakSlate("Current average slate", Math.ceil(averageCardsPerDate), refreshes, false),
          peakSlate("CFB peak day assumption", 150, refreshes, true),
          peakSlate("CBB peak day assumption", 200, refreshes, true),
        ]
      : [],
    budgetModeByScenario: {
      bestCaseWithCacheSkips: countBudgetMode(projectedMonthlyBest),
      realisticCaseFromHistoricalPayloads: countBudgetMode(projectedMonthlyRealistic),
      realisticHourlyChangesOnMostCards: countBudgetMode(projectedMonthlyHourlyChanges),
      messyCase10PctMiniEscalation: countBudgetMode(projectedMonthlyMessy10),
      worstCaseEveryHourlyRefresh: countBudgetMode(projectedMonthlyWorst),
      badCaseNoCacheHourlyPlusLock: countBudgetMode(projectedMonthlyBad),
    },
    pricing,
    tokenAssumptions,
    payloads,
  };
}

export async function loadExistingAiAuditPayloadHashes(args: {
  from: string;
  to: string;
  sport?: Sport;
}): Promise<Set<string>> {
  const { supabase } = await import("@/lib/db/supabase");
  const query = supabase
    .from("ai_audit_usage_ledger")
    .select("payload_hash")
    .gte("slate_date", args.from)
    .lte("slate_date", args.to)
    .not("payload_hash", "is", null)
    .limit(10_000);
  const { data, error } = args.sport ? await query.eq("sport", args.sport) : await query;
  if (error) throw new Error(`Failed to load AI audit payload hashes: ${error.message}`);
  return new Set((data ?? []).map((row) => row.payload_hash).filter((hash): hash is string => typeof hash === "string"));
}

export async function buildDailyEdgeResponseForCostPreview(args: {
  sport: Sport;
  date: string;
}): Promise<DailyEdgeResponse> {
  const { GET } = await import("@/app/api/lab/daily-edge/route");
  const url = `http://oddsphere.local/api/lab/daily-edge?sport=${encodeURIComponent(args.sport)}&date=${encodeURIComponent(args.date)}&allowStale=false`;
  const response = await GET(new Request(url));
  if (!response.ok) {
    throw new Error(`Daily Edge route failed for ${args.sport} ${args.date}: HTTP ${response.status}`);
  }
  return await response.json() as DailyEdgeResponse;
}

export async function buildAiAuditorCostPreviewFromDailyEdge(args: {
  sport: Sport;
  from: string;
  to: string;
  markets?: AiAuditorMarketKey[];
  refreshesPerDay?: number;
  loadExistingHashes?: boolean;
}): Promise<AiAuditorCostPreviewSummary> {
  const dates = eachDateInclusive(args.from, args.to);
  const payloadsByDate: Array<{ date: string; response: DailyEdgeResponse }> = [];
  for (const date of dates) {
    payloadsByDate.push({
      date,
      response: await buildDailyEdgeResponseForCostPreview({ sport: args.sport, date }),
    });
  }
  const existingPayloadHashes = args.loadExistingHashes === false
    ? undefined
    : await loadExistingAiAuditPayloadHashes({ from: args.from, to: args.to, sport: args.sport });
  return buildAiAuditorCostPreview({
    sport: args.sport,
    from: args.from,
    to: args.to,
    markets: args.markets ?? DEFAULT_AI_AUDITOR_MARKETS,
    refreshesPerDay: args.refreshesPerDay ?? envNumber("AI_AUDITOR_COST_PREVIEW_REFRESHES", 8),
    miniEscalationRates: [0.05, 0.10, 0.20],
    skipUnchangedPayloads: envBool("AI_AUDITOR_SKIP_UNCHANGED_PAYLOADS", true),
    oneCallPerGameCard: envBool("AI_AUDITOR_ONE_CALL_PER_GAME_CARD", true),
    includePeakSlateAssumptions: true,
    payloadsByDate,
    existingPayloadHashes,
  });
}
