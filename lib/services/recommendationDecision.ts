import { createHash } from "crypto";
import type { MarketReadV2Dto } from "../types/domain/MarketIntelligenceV2";
import type {
  MarketDecision,
  MarketSplitDisplaySection,
  PlayGradeLabel,
  RecommendationDecision,
  ResolvedMarketRead,
  SplitSideDisplay,
} from "../types/domain/RecommendationDecision";
import {
  dailyEdgeMarketCapabilities,
  sportExpectsSharpBookContext,
} from "@/lib/services/dailyEdge/dailyEdgeSportCapabilities";

type MarketInput = {
  key: "moneyline" | "total" | "firstInning";
  pick: string | null;
  selectedSide: "home" | "away" | "over" | "under" | null;
  modelProbability: number | null;
  marketImplied: number | null;
  edgePp: number | null;
  price: number | null;
  playGrade: PlayGradeLabel | string | null;
  quickRead: string;
  riskNote: string;
  publicSplits: SplitSideDisplay[];
  marketReadV2: MarketReadV2Dto | null;
  marketReadV2Enabled: boolean;
  consensusSplitsOverride?: MarketSplitDisplaySection | null;
  sharpBookSplitsOverride?: MarketSplitDisplaySection | null;
  lineMovementOverride?: "support" | "resistance" | "neutral" | null;
  allowBestAngleMarketConflict?: boolean;
};

export type BuildRecommendationDecisionInput = {
  sport: string;
  slateDate: string;
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  projectedScore?: { away: number; home: number } | null;
  markets: MarketInput[];
};

const PLAY_GRADES: PlayGradeLabel[] = ["No Play", "Caution", "Watchlist", "Lean", "Best Angle"];
const BEST_ANGLE_CONFLICT_OVERRIDE_EDGE_PP = 8;

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizePct(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const pct = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function normalizeGrade(value: string | null | undefined): PlayGradeLabel {
  if (value === "best_angle") return "Best Angle";
  if (value === "market_watch" || value === "model_only" || value === "provisional" || value === "market_aligned") return "Watchlist";
  if (value === "lean") return "Lean";
  if (value === "caution") return "Caution";
  if (value === "no_play" || value === "no_bet" || value === "held" || value === null || value === undefined) return "No Play";
  return PLAY_GRADES.includes(value as PlayGradeLabel) ? (value as PlayGradeLabel) : "No Play";
}

function oppositeSide(side: MarketInput["selectedSide"]): MarketInput["selectedSide"] {
  if (side === "home") return "away";
  if (side === "away") return "home";
  if (side === "over") return "under";
  if (side === "under") return "over";
  return null;
}

function splitLastUpdated(rows: SplitSideDisplay[]): string | null {
  return rows.reduce<string | null>((latest, row) => {
    if (!row.observedAt) return latest;
    return latest === null || row.observedAt > latest ? row.observedAt : latest;
  }, null);
}

function consensusSection(market: MarketInput): MarketSplitDisplaySection | null {
  if (market.consensusSplitsOverride !== undefined) return market.consensusSplitsOverride;
  const read = market.marketReadV2?.consensus ?? null;
  if (read !== null && market.selectedSide !== null) {
    const money = normalizePct(read.moneyPct);
    const bets = normalizePct(read.betsPct);
    if (money !== null || bets !== null) {
      const opposite = oppositeSide(market.selectedSide);
      const rows = market.publicSplits.map((row) => {
        if (row.side === market.selectedSide) {
          return { ...row, moneyPct: money ?? row.moneyPct, betsPct: bets ?? row.betsPct };
        }
        if (row.side === opposite) {
          return {
            ...row,
            moneyPct: money !== null ? 100 - money : row.moneyPct,
            betsPct: bets !== null ? 100 - bets : row.betsPct,
          };
        }
        return row;
      });
      return { label: "Consensus Splits", rows, signal: null, lastUpdated: market.marketReadV2?.evidenceAsOf ?? splitLastUpdated(rows) };
    }
  }
  if (market.publicSplits.length === 0) return null;
  return { label: "Consensus Splits", rows: market.publicSplits, signal: null, lastUpdated: splitLastUpdated(market.publicSplits) };
}

function sharpSection(market: MarketInput): MarketSplitDisplaySection | null {
  if (market.sharpBookSplitsOverride !== undefined) return market.sharpBookSplitsOverride;
  const summary = market.marketReadV2?.sourceSummary.sharpMoney ?? null;
  if (!summary) return null;
  const signal = summary
    .replace(/^Sharp Money:\s*/i, "")
    .replace(/\bsharp money\b/gi, "sharp-book splits")
    .replace(/\bsource-specific money\b/gi, "sharp-book splits")
    .replace(/\bwith our pick\b/gi, `with ${market.pick ?? "the pick"}`)
    .replace(/\bagainst our pick\b/gi, `against ${market.pick ?? "the pick"}`);
  return {
    label: "Sharp Book Signal",
    rows: [],
    signal,
    lastUpdated: market.marketReadV2?.evidenceAsOf ?? null,
  };
}

function sideLean(section: MarketSplitDisplaySection | null, side: MarketInput["selectedSide"]): "support" | "resistance" | "mixed" | "none" {
  if (!section || !side) return "none";
  const row = section.rows.find((r) => r.side === side) ?? null;
  if (row) {
    const money = row.moneyPct;
    const bets = row.betsPct;
    if (money !== null && bets !== null) {
      if (money >= 50 && bets >= 50) return "support";
      if (money < 50 && bets < 50) return "resistance";
      return "mixed";
    }
    const v = money ?? bets;
    if (v !== null) return v >= 50 ? "support" : "resistance";
  }
  const signal = (section.signal ?? "").toLowerCase();
  if (signal.includes("against") || signal.includes("resistance")) return "resistance";
  if (signal.includes("with") || signal.includes("support")) return "support";
  if (signal.includes("mixed")) return "mixed";
  return "none";
}

function resolveMarketRead(sport: string, market: MarketInput, consensus: MarketSplitDisplaySection | null, sharp: MarketSplitDisplaySection | null): ResolvedMarketRead {
  const caps = dailyEdgeMarketCapabilities(sport, market.key);
  const consensusLean = sideLean(consensus, market.selectedSide);
  const sharpLean = sideLean(sharp, market.selectedSide);
  const movement = market.lineMovementOverride ?? market.marketReadV2?.movement?.directionRelativeToPick ?? "neutral";
  const pick = market.pick ?? "the pick";
  const sharpAvailable = sharp !== null;
  const hasCoreFirstInningEvidence =
    caps.isFirstInning &&
    (market.price !== null ||
      market.modelProbability !== null ||
      market.marketImplied !== null ||
      market.edgePp !== null);
  const hasCoreMarketEvidence =
    market.price !== null ||
    market.modelProbability !== null ||
    market.marketImplied !== null ||
    market.edgePp !== null;

  if (!caps.expectsConsensusSplits && !caps.expectsSharpBookContext) {
    const lineMovementCopy =
      movement === "support"
        ? " Price movement is not fighting the prediction."
        : movement === "resistance"
          ? " Price movement adds some resistance."
          : "";
    if (!hasCoreMarketEvidence) {
      return {
        status: "insufficient_data",
        label: "No Clear Signal",
        tone: "gray",
        copy: `Core ${caps.marketContextName} evidence is incomplete.`,
      };
    }
    if (movement === "support") {
      return {
        status: "aligned",
        label: "Market Support",
        tone: "emerald",
        copy: `${caps.marketContextName === "BTTS" ? "BTTS" : "The market"} has price movement toward ${pick}.`,
      };
    }
    if (movement === "resistance") {
      return {
        status: "resistance",
        label: "Market Resistance",
        tone: "amber",
        copy: `${caps.marketContextName === "BTTS" ? "BTTS" : "The market"} has price/movement resistance against ${pick}.`,
      };
    }
    return {
      status: "no_clear_signal",
      label: "No Clear Signal",
      tone: "gray",
      copy: `${caps.marketContextName === "BTTS" ? "BTTS" : "This read"} is driven by model value, price, and movement context.${lineMovementCopy}`,
    };
  }

  if (sharpAvailable && ((consensusLean === "support" && sharpLean === "resistance") || (consensusLean === "resistance" && sharpLean === "support"))) {
    const moveCopy = movement === "support" ? " and line movement" : "";
    return {
      status: "mixed",
      label: "Mixed",
      tone: "gray",
      copy: consensusLean === "support"
        ? `Consensus splits${moveCopy} support ${pick}, but sharp book splits show resistance.`
        : `Sharp book splits support ${pick}, but consensus splits show resistance.`,
    };
  }
  if (sharpAvailable && (consensusLean === "resistance" || sharpLean === "resistance" || movement === "resistance")) {
    return { status: "resistance", label: "Market Resistance", tone: "amber", copy: `Market signals show resistance against ${pick}.` };
  }
  if (sharpAvailable && (consensusLean === "support" || sharpLean === "support" || movement === "support")) {
    return { status: "aligned", label: "Market Support", tone: "emerald", copy: `Market signals support ${pick}.` };
  }
  if (!sharpAvailable && consensusLean === "support") {
    return { status: "consensus_support", label: "Consensus Support", tone: "emerald", copy: `Consensus splits support ${pick}.` };
  }
  if (!sharpAvailable && consensusLean === "resistance") {
    return { status: "consensus_resistance", label: "Consensus Resistance", tone: "amber", copy: `Consensus splits show resistance against ${pick}.` };
  }
  return {
    status: consensus === null && !hasCoreFirstInningEvidence ? "insufficient_data" : "no_clear_signal",
    label: "No Clear Signal",
    tone: "gray",
    copy: "No clear market signal.",
  };
}

function hasProviderLeak(value: unknown): boolean {
  return JSON.stringify(value).match(/\b(playbook|sharpapi)\b/i) !== null;
}

function buildMarketDecision(sport: string, market: MarketInput, projectedScore: { away: number; home: number } | null | undefined): MarketDecision {
  const caps = dailyEdgeMarketCapabilities(sport, market.key);
  const consensus = consensusSection(market);
  const sharp = sharpSection(market);
  const read = resolveMarketRead(sport, market, consensus, sharp);
  const rawGrade = normalizeGrade(market.playGrade);
  const sourceConflict = read.status === "mixed";
  const hasBestAngleConflict =
    rawGrade === "Best Angle" &&
    (read.status === "mixed" || read.status === "resistance" || read.status === "consensus_resistance");
  const hasExplicitOverride =
    hasBestAngleConflict &&
    typeof market.edgePp === "number" &&
    market.edgePp >= BEST_ANGLE_CONFLICT_OVERRIDE_EDGE_PP &&
    market.price !== null;
  const hasOfficialGradeOverride = hasBestAngleConflict && market.allowBestAngleMarketConflict === true;
  const grade: PlayGradeLabel =
    hasBestAngleConflict && !hasExplicitOverride && !hasOfficialGradeOverride
      ? read.status === "resistance" || read.status === "consensus_resistance"
        ? "Caution"
        : "Lean"
      : rawGrade;
  const reasonCodes = [
    caps.expectsConsensusSplits
      ? consensus ? "consensus_splits_available" : "consensus_splits_unavailable"
      : "consensus_splits_not_required",
    caps.expectsSharpBookContext
      ? sharp ? "sharp_book_splits_available" : "sharp_book_splits_unavailable"
      : "sharp_book_splits_not_required",
    `market_read_${read.status}`,
    `grade_${grade.toLowerCase().replaceAll(" ", "_")}`,
    ...(sourceConflict ? ["source_conflict"] : []),
    ...(read.status === "resistance" || read.status === "consensus_resistance" ? ["market_resistance"] : []),
    ...(hasBestAngleConflict
      ? [
          hasExplicitOverride
            ? "best_angle_model_edge_override"
            : hasOfficialGradeOverride
              ? "best_angle_official_writer_override"
              : "best_angle_capped_by_market_conflict",
        ]
      : []),
  ];
  const evidence = [
    ...(caps.expectsConsensusSplits
      ? [consensus ? "Consensus splits reviewed." : "Consensus splits unavailable."]
      : []),
    ...(caps.expectsSharpBookContext
      ? [sharp ? "Sharp book splits reviewed." : "Sharp book splits unavailable."]
      : []),
    read.copy,
  ];
  const quickRead =
    read.status === "mixed"
      ? `Mixed market signals: ${read.copy}`
      : read.status === "resistance" || read.status === "consensus_resistance"
        ? `Market resistance: ${read.copy}`
        : hasExplicitOverride
          ? `Model-edge override: ${read.copy}`
          : market.quickRead || read.copy;
  return {
    pick: market.pick,
    modelProbability: market.modelProbability,
    marketImplied: market.marketImplied,
    edgePp: market.edgePp,
    price: market.price,
    projectedScore: projectedScore ?? null,
    consensusSplits: consensus,
    sharpBookSplits: sharp,
    lineMovement: market.lineMovementOverride ?? market.marketReadV2?.movement?.directionRelativeToPick ?? null,
    resolvedMarketRead: read,
    sourceConflict,
    playGrade: grade,
    quickRead,
    supportingEvidence: evidence,
    riskNote: market.riskNote,
    reasonCodes,
  };
}

export function buildRecommendationDecision(input: BuildRecommendationDecisionInput): RecommendationDecision {
  const marketEntries = input.markets.map((m) => [m.key, buildMarketDecision(input.sport, m, input.projectedScore)] as const);
  const markets: RecommendationDecision["markets"] = {};
  for (const [key, decision] of marketEntries) markets[key] = decision;

  const decisions = marketEntries.map(([, decision]) => decision);
  const consensusSplitsAvailable = decisions.some((d) => d.consensusSplits !== null);
  const sharpBookSplitsAvailable = decisions.some((d) => d.sharpBookSplits !== null);
  const sourceConflict = decisions.some((d) => d.sourceConflict);
  const staleSources = decisions.flatMap((d) => [
    ...(d.consensusSplits?.rows.some((r) => r.isStale) ? ["Consensus Splits"] : []),
    ...(d.sharpBookSplits?.rows.some((r) => r.isStale) ? ["Sharp Book Splits"] : []),
  ]);
  const missingExpectedSources =
    sportExpectsSharpBookContext(input.sport) && !sharpBookSplitsAvailable ? ["Sharp Book Splits"] : [];
  const issues = decisions.flatMap((d) => {
    const out: string[] = [];
    if (!PLAY_GRADES.includes(d.playGrade)) out.push("invalid_play_grade");
    if (
      d.playGrade === "Best Angle" &&
      (d.resolvedMarketRead.status === "mixed" || d.resolvedMarketRead.status === "resistance") &&
      !d.reasonCodes.includes("best_angle_model_edge_override") &&
      !d.reasonCodes.includes("best_angle_official_writer_override")
    ) out.push("best_angle_market_conflict");
    if (hasProviderLeak(d)) out.push("provider_name_leak");
    return out;
  });
  const deterministicStatus = issues.some((x) => x === "provider_name_leak" || x === "invalid_play_grade") ? "block" : issues.length > 0 ? "warn" : "pass";
  const compactPayload = {
    sport: input.sport,
    slateDate: input.slateDate,
    gameId: input.gameId,
    markets,
    sourceState: { consensusSplitsAvailable, sharpBookSplitsAvailable, staleSources, missingExpectedSources, sourceConflict },
  };

  return {
    sport: input.sport,
    slateDate: input.slateDate,
    gameId: input.gameId,
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    markets,
    sourceState: {
      consensusSplitsAvailable,
      sharpBookSplitsAvailable,
      staleSources: Array.from(new Set(staleSources)),
      missingExpectedSources,
      sourceConflict,
    },
    audit: {
      deterministicStatus,
      aiStatus: "skipped",
      payloadHash: stableHash(compactPayload),
      canPublish: deterministicStatus !== "block",
    },
  };
}
