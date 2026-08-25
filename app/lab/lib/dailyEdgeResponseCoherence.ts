import type {
  DailyEdgeResponse,
  MarketEdgeDto,
  OddsTrailStopDto,
} from "./labTypes";
import type { MarketSplitDisplaySection } from "@/lib/types/domain/RecommendationDecision";

export type DailyEdgeCoherenceIssue = {
  gameId: string;
  market: "moneyline" | "total" | "first_inning";
  code: string;
};

function sameNumber(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) < 0.001;
}

function terminalStop(stops: OddsTrailStopDto[] | undefined): OddsTrailStopDto | null {
  return [...(stops ?? [])].reverse().find((stop) => stop.label === "current" || stop.label === "locked") ?? null;
}

function selectedSide(
  game: DailyEdgeResponse["games"][number],
  marketKey: DailyEdgeCoherenceIssue["market"],
): "home" | "away" | "over" | "under" | null {
  const pick = game.markets[marketKey].pick?.trim().toLowerCase() ?? "";
  if (marketKey === "moneyline") {
    if (pick === game.homeTeam.toLowerCase()) return "home";
    if (pick === game.awayTeam.toLowerCase()) return "away";
  }
  if (marketKey === "total") {
    if (pick.startsWith("over")) return "over";
    if (pick.startsWith("under")) return "under";
  }
  return null;
}

function expectedCurrentPrice(market: MarketEdgeDto, locked: boolean): number | null {
  if (!locked && typeof market.currentPriceAmerican === "number") return market.currentPriceAmerican;
  if (locked && typeof market.lockedLineAmerican === "number") return market.lockedLineAmerican;
  return typeof market.priceAmerican === "number" ? market.priceAmerican : null;
}

function expectedCurrentBook(market: MarketEdgeDto, locked: boolean): string | null {
  if (!locked && market.currentPriceSportsbook) return market.currentPriceSportsbook;
  return terminalStop(market.oddsTrail)?.sportsbook ?? null;
}

function sectionIsStale(section: MarketSplitDisplaySection | null, nowMs: number): boolean {
  if (!section) return false;
  if (section.rows.some((row) => row.isStale === true)) return true;
  const latest = section.lastUpdated ?? section.rows
    .map((row) => row.freshnessCheckedAt ?? row.observedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  if (!latest) return false;
  const latestMs = Date.parse(latest);
  return Number.isFinite(latestMs) && nowMs - latestMs > 75 * 60_000;
}

function fallbackSharpAvailability(
  marketKey: DailyEdgeCoherenceIssue["market"],
  section: MarketSplitDisplaySection | null,
  nowMs: number,
): NonNullable<MarketEdgeDto["sharpBookAvailability"]> {
  if (marketKey === "first_inning") {
    return {
      status: "unavailable",
      message: "The current provider does not offer verified first-inning Sharp-book split percentages.",
      lastUpdated: null,
    };
  }
  if (sectionIsStale(section, nowMs)) {
    return {
      status: "stale",
      message: "The last authentic Sharp-book observation is too old to present as current.",
      lastUpdated: section?.lastUpdated ?? null,
    };
  }
  if (section?.rows.length === 2 && section.rows.every((row) => row.moneyPct !== null && row.betsPct !== null)) {
    return {
      status: "complete",
      message: "Complete two-sided SharpAPI money and ticket percentages are available.",
      lastUpdated: section.lastUpdated,
    };
  }
  if (section && (section.rows.length > 0 || section.signal)) {
    return {
      status: "provider_limited",
      message: section.signal ?? "SharpAPI supplied only part of the two-sided money-and-ticket pair; missing percentages are withheld.",
      lastUpdated: section.lastUpdated,
    };
  }
  return {
    status: "pending",
    message: "Sharp-book split data has not arrived from SharpAPI for this market yet.",
    lastUpdated: null,
  };
}

function limitMarketEvidence(opts: {
  market: MarketEdgeDto;
  reasons: string[];
  currentPrice: number | null;
  currentLine: number | null;
  observedAt: string | null;
}): void {
  const { market, reasons, currentPrice, currentLine, observedAt } = opts;
  if (market.marketReadV2) {
    market.marketReadV2 = {
      ...market.marketReadV2,
      label: "Movement history limited",
      score: 0,
      tone: "gray",
      explanation: "The current selected quote is verified, but incompatible opening or prior movement evidence was withheld.",
      exactLineEvidenceStatus: "display_current_quote_only",
      validityStatus: "valid_nondirectional",
      movement: currentPrice === null && currentLine === null ? null : {
        firstTrackedLine: null,
        firstTrackedPrice: null,
        currentLine,
        currentPrice,
        directionRelativeToPick: "neutral",
        observedAt,
      },
      sourceSummary: {
        ...market.marketReadV2.sourceSummary,
        priceAction: "Current quote verified; incompatible movement history withheld.",
      },
    };
  }
  market.lastMovePrevAmerican = null;
  market.lastMoveNextAmerican = currentPrice;
  market.lastMoveLinePrev = null;
  market.lastMoveLineNext = currentLine;
  market.evidenceCoherence = {
    status: "limited",
    reasonCodes: [...new Set(reasons)],
    note: "Current selected quote verified; incompatible movement history withheld.",
  };
}

/**
 * Final member-response boundary. It never changes a prediction, probability,
 * selected side, evaluated price, grade, or stake. Incompatible display-only
 * evidence is withheld inside the affected market; no single bad market can
 * suppress the remaining coherent slate.
 */
export function finalizeDailyEdgeResponseCoherence(body: DailyEdgeResponse): DailyEdgeResponse {
  if (body.sport !== "mlb") return body;
  const nowMs = Date.parse(body.as_of) || Date.now();
  for (const game of body.games) {
    for (const marketKey of ["moneyline", "total", "first_inning"] as const) {
      const market = game.markets[marketKey];
      market.sharpBookAvailability ??= fallbackSharpAvailability(
        marketKey,
        market.recommendationDecision?.sharpBookSplits ?? null,
        nowMs,
      );

      const reasons: string[] = [];
      const locked = game.lockState === "locked";
      const currentPrice = expectedCurrentPrice(market, locked);
      const currentBook = expectedCurrentBook(market, locked);
      const currentLine = marketKey === "total" ? market.line : null;
      const endpoint = terminalStop(market.oddsTrail);
      const lineEndpoint = terminalStop(market.lineTrail);

      if (endpoint && currentPrice !== null && endpoint.american !== currentPrice) reasons.push("selected_trail_price_mismatch");
      if (endpoint && currentBook && endpoint.sportsbook && endpoint.sportsbook !== currentBook) reasons.push("selected_trail_book_mismatch");
      if (marketKey === "total" && endpoint?.line != null && !sameNumber(endpoint.line, currentLine)) reasons.push("selected_trail_line_mismatch");
      if (marketKey === "total" && lineEndpoint?.line != null && !sameNumber(lineEndpoint.line, currentLine)) reasons.push("point_trail_terminal_mismatch");

      const movement = market.marketReadV2?.movement;
      if (movement) {
        if (currentPrice !== null && movement.currentPrice !== null && movement.currentPrice !== currentPrice) reasons.push("market_read_price_mismatch");
        if (marketKey === "total" && movement.currentLine !== null && !sameNumber(movement.currentLine, currentLine)) reasons.push("market_read_line_mismatch");
      }

      const side = selectedSide(game, marketKey);
      const expectedOpponent = side === "home" ? "away" : side === "away" ? "home" : side === "over" ? "under" : side === "under" ? "over" : null;
      if (market.opposingOddsTrail && expectedOpponent && market.opposingOddsTrail.side !== expectedOpponent) {
        market.opposingOddsTrail = null;
        reasons.push("opposing_side_mismatch");
      }

      if (reasons.includes("selected_trail_price_mismatch") || reasons.includes("selected_trail_book_mismatch") || reasons.includes("selected_trail_line_mismatch")) {
        market.oddsTrail = [];
      }
      if (reasons.includes("point_trail_terminal_mismatch")) market.lineTrail = [];
      if (reasons.length > 0) {
        limitMarketEvidence({
          market,
          reasons,
          currentPrice,
          currentLine,
          observedAt: market.currentPriceObservedAt ?? endpoint?.observedAt ?? market.priceObservedAt ?? null,
        });
      } else {
        market.evidenceCoherence = { status: "coherent", reasonCodes: [], note: null };
      }
    }
  }
  return body;
}

export function auditDailyEdgeResponseCoherence(body: DailyEdgeResponse): DailyEdgeCoherenceIssue[] {
  const issues: DailyEdgeCoherenceIssue[] = [];
  for (const game of body.games) {
    for (const marketKey of ["moneyline", "total", "first_inning"] as const) {
      const market = game.markets[marketKey];
      if (!market.evidenceCoherence) issues.push({ gameId: game.id, market: marketKey, code: "coherence_status_missing" });
      if (!market.sharpBookAvailability) issues.push({ gameId: game.id, market: marketKey, code: "sharp_coverage_status_missing" });
      const currentPrice = expectedCurrentPrice(market, game.lockState === "locked");
      const currentBook = expectedCurrentBook(market, game.lockState === "locked");
      const endpoint = terminalStop(market.oddsTrail);
      const lineEndpoint = terminalStop(market.lineTrail);
      if (endpoint && currentPrice !== null && endpoint.american !== currentPrice) issues.push({ gameId: game.id, market: marketKey, code: "selected_trail_price_mismatch" });
      if (endpoint && currentBook && endpoint.sportsbook && endpoint.sportsbook !== currentBook) issues.push({ gameId: game.id, market: marketKey, code: "selected_trail_book_mismatch" });
      if (marketKey === "total" && endpoint?.line != null && !sameNumber(endpoint.line, market.line)) issues.push({ gameId: game.id, market: marketKey, code: "selected_trail_line_mismatch" });
      if (marketKey === "total" && lineEndpoint?.line != null && !sameNumber(lineEndpoint.line, market.line)) issues.push({ gameId: game.id, market: marketKey, code: "point_trail_terminal_mismatch" });
      const movement = market.marketReadV2?.movement;
      if (movement?.currentPrice != null && currentPrice !== null && movement.currentPrice !== currentPrice) issues.push({ gameId: game.id, market: marketKey, code: "market_read_price_mismatch" });
      if (marketKey === "total" && movement?.currentLine != null && !sameNumber(movement.currentLine, market.line)) issues.push({ gameId: game.id, market: marketKey, code: "market_read_line_mismatch" });
      const side = selectedSide(game, marketKey);
      const expectedOpponent = side === "home" ? "away" : side === "away" ? "home" : side === "over" ? "under" : side === "under" ? "over" : null;
      if (market.opposingOddsTrail && expectedOpponent && market.opposingOddsTrail.side !== expectedOpponent) issues.push({ gameId: game.id, market: marketKey, code: "opposing_side_mismatch" });
    }
  }
  return issues;
}
