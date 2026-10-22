import assert from "node:assert/strict";
import { auditDailyEdgeBoards } from "../lib/services/dailyEdgeDeepAudit";
import {
  DAILY_EDGE_CURRENT_MARKET_CYCLE_OPENING_MAX_DAYS,
  isCurrentMarketCycleOpening,
} from "../lib/services/dailyEdge/marketCycleOpening";
import {
  NHL_CURRENT_QUOTE_RELATIVE_FRESH_MINUTES,
  selectNhlBestPriceQuote,
} from "../lib/services/nhl/nhlLineBoard";
import { buildNhlTwoSidedPriceTrail } from "../lib/services/nhl/nhlPriceTrail";

const kickoff = "2026-10-23T00:15:00.000Z";
assert.equal(DAILY_EDGE_CURRENT_MARKET_CYCLE_OPENING_MAX_DAYS, 14);
assert.equal(isCurrentMarketCycleOpening({
  openingObservedAt: "2026-10-13T00:15:00.000Z",
  gameStartAt: kickoff,
  locked: false,
}), true, "a real game-week opener remains eligible");
assert.equal(isCurrentMarketCycleOpening({
  openingObservedAt: "2026-08-05T00:11:14.898Z",
  gameStartAt: kickoff,
  locked: false,
}), false, "a preseason/look-ahead opener cannot anchor the current-cycle trail");
assert.equal(isCurrentMarketCycleOpening({
  openingObservedAt: "2026-08-05T00:11:14.898Z",
  gameStartAt: kickoff,
  locked: true,
}), true, "a later reader release cannot reinterpret a locked trail");

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
        },
      },
    }],
  },
}, { generatedAt: "2026-10-22T11:13:00.000Z" });
assert.equal(longRangeAudit.summary.issueCounts.long_range_opener_used_as_current_cycle, 1);

console.log("Daily Edge odds-contract tests passed.");
