import assert from "node:assert/strict";
import {
  evaluateNbaMarketCandidates,
  summarizeNbaMarketEvidence,
  type NbaMarketAuditPriceRow,
  type NbaMarketAuditSplitRow,
} from "../lib/services/nba/nbaMarketReaderAudit";

const eventId = "nba-1";
const asOf = "2026-10-15T18:00:00.000Z";
const splitSources: Array<{
  book: "draftkings" | "betmgm";
  sourceType: "retail_book";
  bets: number;
  money: number | null;
}> = [
  { book: "draftkings", sourceType: "retail_book", bets: 0.4, money: 0.65 },
  { book: "betmgm", sourceType: "retail_book", bets: 0.42, money: null },
];
const splitRows: NbaMarketAuditSplitRow[] = splitSources.flatMap(
  ({ book, sourceType, bets, money }) => ["home", "away"].map((selection, index) => ({
  canonical_event_id: eventId,
  provider: "sharpapi" as const,
  source_book: book,
  source_type: sourceType,
  market_type: "moneyline" as const,
  selection_key: `${eventId}:moneyline:${selection}`,
  bets_pct: index === 0 ? bets as number : 1 - (bets as number),
  money_pct: money === null ? null : index === 0 ? money : 1 - money,
  market_line: null,
  market_price: index === 0 ? -140 : 120,
  split_line_basis: "provider_explicit" as const,
  books_used: null,
  source_observed_at: "2026-10-15T17:45:00.000Z",
  fetched_at: "2026-10-15T17:46:00.000Z",
  })),
);

const priceRows: NbaMarketAuditPriceRow[] = [
  ["draftkings", "home", -130, "2026-10-15T16:00:00.000Z"],
  ["draftkings", "away", 115, "2026-10-15T16:00:00.000Z"],
  ["draftkings", "home", -140, "2026-10-15T17:45:00.000Z"],
  ["draftkings", "away", 120, "2026-10-15T17:45:00.000Z"],
  ["pinnacle", "home", -138, "2026-10-15T17:44:00.000Z"],
  ["pinnacle", "away", 121, "2026-10-15T17:44:00.000Z"],
].map(([sportsbook, selection, price, time]) => ({
  canonical_event_id: eventId,
  sportsbook: sportsbook as string,
  sharp_book: sportsbook === "pinnacle",
  market_type: "moneyline" as const,
  selection_key: `${eventId}:moneyline:${selection}`,
  american_price: price as number,
  no_vig_probability: null,
  line: null,
  provider_timestamp: time as string,
  fetched_at: time as string,
}));

const summary = summarizeNbaMarketEvidence({
  events: [{ canonicalEventId: eventId, startTime: "2026-10-16T00:00:00.000Z" }],
  splitRows,
  priceRows,
  asOf,
}) as {
  integrity: {
    sharpApiRowsWithSourceBook: number;
    ticketOnlyRowsPreserved: number;
    missingMoneyRowsImputed: number;
    crossBookMovementAllowed: boolean;
  };
  markets: {
    moneyline: {
      coherentSameBookPairs: number;
      sameBookSelectionMovementTrails: number;
      sameBookMovementEvents: number;
    };
  };
  authority: { predictionEffectAuthorized: boolean };
};
assert.equal(summary.integrity.sharpApiRowsWithSourceBook, 4);
assert.equal(summary.integrity.ticketOnlyRowsPreserved, 2);
assert.equal(summary.integrity.missingMoneyRowsImputed, 0);
assert.equal(summary.integrity.crossBookMovementAllowed, false);
assert.equal(summary.markets.moneyline.coherentSameBookPairs, 2);
assert.equal(summary.markets.moneyline.sameBookSelectionMovementTrails, 2);
assert.equal(summary.markets.moneyline.sameBookMovementEvents, 1);
assert.equal(summary.authority.predictionEffectAuthorized, false);

const evaluated = evaluateNbaMarketCandidates({
  candidates: [{
    canonicalEventId: eventId,
    marketType: "moneyline",
    selectionKey: `${eventId}:moneyline:home`,
    selectedLine: null,
    selectedPrice: -140,
    recommendationLockedAt: null,
    eventStartTime: "2026-10-16T00:00:00.000Z",
  }],
  splitRows,
  priceRows,
  asOf,
});
assert.equal(evaluated.length, 1);
assert.equal(evaluated[0]?.resolved.evidence.sharpApiSourceSpecific.sources.length, 2);
assert.ok(evaluated[0]?.resolved.evidence.trace.evidenceUsed.some((value) => value.includes("sharpapi")));

console.log("NBA market reader audit tests passed");
