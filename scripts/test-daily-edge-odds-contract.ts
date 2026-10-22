import assert from "node:assert/strict";
import { auditDailyEdgeBoards } from "../lib/services/dailyEdgeDeepAudit";
import { isVerifiedEventOpening } from "../lib/services/dailyEdge/marketCycleOpening";
import { verifiedTrailMovementDirection } from "../lib/services/dailyEdge/verifiedTrailMovement";
import {
  NHL_CURRENT_QUOTE_RELATIVE_FRESH_MINUTES,
  selectNhlBestPriceQuote,
} from "../lib/services/nhl/nhlLineBoard";
import { buildNhlTwoSidedPriceTrail } from "../lib/services/nhl/nhlPriceTrail";

const kickoff = "2026-10-23T00:15:00.000Z";
assert.equal(isVerifiedEventOpening({
  openingObservedAt: "2026-10-13T00:15:00.000Z",
  gameStartAt: kickoff,
  locked: false,
}), true, "a real game-week opener remains eligible");
assert.equal(isVerifiedEventOpening({
  openingObservedAt: "2026-08-05T00:11:14.898Z",
  gameStartAt: kickoff,
  locked: false,
}), true, "an exact-event provider opener remains eligible regardless of age");
assert.equal(isVerifiedEventOpening({
  openingObservedAt: "2026-10-23T00:16:00.000Z",
  gameStartAt: kickoff,
  locked: false,
}), false, "a post-kickoff quote cannot be called an opening");
assert.equal(isVerifiedEventOpening({
  openingObservedAt: "2026-08-05T00:11:14.898Z",
  gameStartAt: kickoff,
  locked: true,
}), true, "a later reader release cannot reinterpret a locked trail");

const neMoneylineTrail = [
  { american: -105, line: null, observedAt: "2026-08-05T00:11:14.898Z", sportsbook: "caesars" },
  { american: 136, line: null, observedAt: "2026-10-22T11:00:00.000Z", sportsbook: "Caesars" },
];
assert.equal(verifiedTrailMovementDirection({
  market: "moneyline",
  pick: "NE",
  trail: neMoneylineTrail,
}), "resistance", "the exact NE price move is reader resistance");
assert.equal(verifiedTrailMovementDirection({
  market: "spread",
  pick: "NE +3",
  trail: [
    { american: -112, line: 2.5, observedAt: "2026-10-13T21:04:03.235Z", sportsbook: "betrivers" },
    { american: -110, line: 3, observedAt: "2026-10-22T11:00:00.000Z", sportsbook: "BetRivers" },
  ],
}), "resistance", "a selected-side spread moving +2.5 to +3 is reader resistance");

const currentRows = [
  { game_id: 1, market_type: "total", sportsbook: "hardrock", side: "over", line_value: 6.5, odds_american: -110, observed_at: "2026-10-22T04:18:27.000Z" },
  { game_id: 1, market_type: "total", sportsbook: "hardrock", side: "under", line_value: 6.5, odds_american: -110, observed_at: "2026-10-22T04:18:27.000Z" },
  { game_id: 1, market_type: "total", sportsbook: "pinnacle", side: "over", line_value: 6.5, odds_american: -115, observed_at: "2026-10-22T10:18:27.000Z" },
  { game_id: 1, market_type: "total", sportsbook: "pinnacle", side: "under", line_value: 6.5, odds_american: -105, observed_at: "2026-10-22T10:18:27.000Z" },
];
assert.equal(NHL_CURRENT_QUOTE_RELATIVE_FRESH_MINUTES, 120);
assert.deepEqual(selectNhlBestPriceQuote({
  rows: currentRows,
  market: "total",
  side: "over",
  line: 6.5,
}), {
  market_type: "total",
  sportsbook: "pinnacle",
  side: "over",
  line_value: 6.5,
  odds_american: -115,
  observed_at: "2026-10-22T10:18:27.000Z",
}, "an abandoned best-looking price cannot beat a fresh complete pair");

const trail = buildNhlTwoSidedPriceTrail({
  live: currentRows,
  history: [
    { market_type: "total", sportsbook: "pinnacle", side: "over", line_value: 6.5, odds_american: -112, observed_at: "2026-10-22T10:00:00.000Z" },
    { market_type: "total", sportsbook: "pinnacle", side: "under", line_value: 6.5, odds_american: -108, observed_at: "2026-10-22T10:00:00.000Z" },
    { market_type: "total", sportsbook: "pinnacle", side: "over", line_value: 6.5, odds_american: -115, observed_at: "2026-10-22T10:20:00.000Z" },
    { market_type: "total", sportsbook: "pinnacle", side: "under", line_value: 6.5, odds_american: -105, observed_at: "2026-10-22T10:20:00.000Z" },
  ],
  market: "total",
  selectedSide: "over",
  opposingSide: "under",
  selectedLine: 6.5,
  opposingLine: 6.5,
  preferredBook: "pinnacle",
});
assert.deepEqual(trail.selected.map((stop) => stop.observedAt), [
  "2026-10-22T10:00:00.000Z",
  "2026-10-22T10:18:27.000Z",
], "history observed after the current endpoint is excluded rather than producing an inverted trail");

const audit = auditDailyEdgeBoards({
  nhl: {
    games: [{
      awayTeam: "SJS",
      homeTeam: "OTT",
      gameStartAt: "2026-10-22T23:00:00.000Z",
      lockState: "open",
      markets: {
        total: {
          pick: "Under 6.5",
          grade: "market_watch",
          verdict: { key: "watchlist" },
          publicSplits: [],
          currentPriceAmerican: -110,
          currentPriceSportsbook: "hardrock",
          currentPriceObservedAt: "2026-10-22T04:18:27.000Z",
          oddsTrail: [
            { label: "first", american: -110, line: 6.5, sportsbook: "hardrock", source: "line_history", observedAt: "2026-10-22T04:18:50.000Z" },
            { label: "current", american: -110, line: 6.5, sportsbook: "hardrock", source: "current_line", observedAt: "2026-10-22T04:18:27.000Z" },
          ],
        },
      },
    }],
  },
}, { generatedAt: "2026-10-22T11:13:00.000Z" });
assert.equal(audit.summary.issueCounts.current_quote_not_recently_verified, 1);
assert.equal(audit.summary.issueCounts.odds_trail_chronology_inverted, 1);

const longRangeAudit = auditDailyEdgeBoards({
  nfl: {
    games: [{
      awayTeam: "NE",
      homeTeam: "CHI",
      gameStartAt: kickoff,
      lockState: "open",
      markets: {
        moneyline: {
          pick: "NE ML",
          grade: "market_watch",
          verdict: { key: "watchlist" },
          publicSplits: [],
          currentPriceAmerican: 136,
          currentPriceSportsbook: "caesars",
          currentPriceObservedAt: "2026-10-22T11:00:00.000Z",
          oddsTrail: [
            { label: "open", american: -105, sportsbook: "caesars", source: "provider_opening", observedAt: "2026-08-05T00:11:14.898Z" },
            { label: "current", american: 136, sportsbook: "caesars", source: "current_line", observedAt: "2026-10-22T11:00:00.000Z" },
          ],
          writerMovementDirection: "resistance",
          readerMovementSource: "displayed_same_book_trail",
          recommendationDecision: {
            lineMovement: "resistance",
            resolvedMarketRead: { status: "resistance", label: "Market Resistance" },
          },
        },
      },
    }],
  },
}, { generatedAt: "2026-10-22T11:13:00.000Z" });
assert.equal(longRangeAudit.summary.criticalIssues, 0, "a verified long-range exact-event opener is valid");

const omittedReaderMovement = auditDailyEdgeBoards({
  nfl: {
    games: [{
      awayTeam: "NE",
      homeTeam: "CHI",
      gameStartAt: kickoff,
      lockState: "open",
      markets: {
        moneyline: {
          pick: "NE",
          grade: "market_watch",
          verdict: { key: "watchlist" },
          publicSplits: [],
          currentPriceAmerican: 136,
          currentPriceSportsbook: "caesars",
          currentPriceObservedAt: "2026-10-22T11:00:00.000Z",
          oddsTrail: neMoneylineTrail,
          writerMovementDirection: "resistance",
          readerMovementSource: "displayed_same_book_trail",
          recommendationDecision: {
            lineMovement: null,
            resolvedMarketRead: { status: "resistance", label: "Market Resistance" },
          },
        },
      },
    }],
  },
}, { generatedAt: "2026-10-22T11:13:00.000Z" });
assert.equal(omittedReaderMovement.summary.issueCounts.active_reader_omits_verified_movement, 1);

const invertedReaderMovement = auditDailyEdgeBoards({
  nfl: {
    games: [{
      awayTeam: "NE",
      homeTeam: "CHI",
      gameStartAt: kickoff,
      lockState: "open",
      markets: {
        moneyline: {
          pick: "NE",
          grade: "market_watch",
          verdict: { key: "watchlist" },
          publicSplits: [],
          currentPriceAmerican: 136,
          currentPriceSportsbook: "caesars",
          currentPriceObservedAt: "2026-10-22T11:00:00.000Z",
          oddsTrail: neMoneylineTrail,
          writerMovementDirection: "resistance",
          readerMovementSource: "displayed_same_book_trail",
          recommendationDecision: {
            lineMovement: "support",
            resolvedMarketRead: { status: "support", label: "Market Support" },
          },
        },
      },
    }],
  },
}, { generatedAt: "2026-10-22T11:13:00.000Z" });
assert.equal(invertedReaderMovement.summary.issueCounts.active_reader_movement_wrong_for_visible_trail, 1);

console.log("Daily Edge odds-contract tests passed.");
