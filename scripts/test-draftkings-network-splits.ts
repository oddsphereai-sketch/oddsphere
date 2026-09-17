import assert from "node:assert/strict";
import type { DailyEdgeResponse, MarketEdgeDto } from "../app/lab/lib/labTypes";
import {
  applyDraftKingsNetworkSplitFallback,
  parseDraftKingsNetworkSplitsHtml,
  type DraftKingsNetworkSplitFeed,
  type DraftKingsNetworkSplitMarket,
} from "../lib/providers/draftkings/draftKingsNetworkSplits";

const side = (label: string, handle: number, bets: number) => `
  <div class="tb-sodd flex">
    <div class="tb-slipline flex-1 font-medium">${label}</div>
    <div class="flex-1"><a class="tb-odd-s">-110</a></div>
    <div class="flex-1">${handle}%<div class="tb-progress"></div></div>
    <div class="flex-1">${bets}%<div class="tb-progress"></div></div>
  </div>`;

const market = (label: string, rows: string) => `
  <div class="tb-se-head flex"><div class="flex-1">${label}</div><div>Odds</div><div>% Handle</div><div>% Bets</div></div>
  <div class="tb-sm bg-neutral-300">${rows}</div>`;

const html = `
  <div class="tb-se border-b px-2 py-4">
    <div class="tb-se-title flex">
      <h5><a href="https://sportsbook.draftkings.com/event/123456">LA Dodgers @ CIN Reds</a></h5>
      <span>9/17, 12:40PM</span>
    </div>
    <div class="tb-market-wrap">
      ${market("Moneyline", side("CIN Reds", 12, 20) + side("LA Dodgers", 88, 80))}
      ${market("Run Line", side("LA Dodgers -1.5", 70, 60) + side("CIN Reds +1.5", 30, 40))}
      ${market("Total", side("Over 9.5", 55, 45) + side("Under 9.5", 45, 55))}
    </div>
  </div>`;

const parsed = parseDraftKingsNetworkSplitsHtml(html);
assert.equal(parsed.length, 1);
assert.equal(parsed[0]?.providerEventId, "123456");
assert.equal(parsed[0]?.awayName, "LA Dodgers");
assert.equal(parsed[0]?.homeName, "CIN Reds");
assert.deepEqual(Object.keys(parsed[0]?.markets ?? {}), ["moneyline", "spread", "total"]);
assert.deepEqual(parsed[0]?.markets.moneyline?.sides, [
  { label: "CIN Reds", moneyPct: 12, betsPct: 20 },
  { label: "LA Dodgers", moneyPct: 88, betsPct: 80 },
]);

const emptyMarket = (): MarketEdgeDto => ({
  sportsbookSplits: null,
  recommendationDecision: { sharpBookSplits: null },
} as unknown as MarketEdgeDto);

const response = {
  as_of: "2026-09-17T15:00:00.000Z",
  sport: "mlb",
  date: "2026-09-17",
  requested_date: "2026-09-17",
  fallback_used: false,
  slateState: "current",
  slate_status: "published",
  last_slate_update_at: "2026-09-17T15:00:00.000Z",
  games: [{
    id: "mlb-1",
    sport: "mlb",
    external_id: 1,
    awayTeam: "LAD",
    homeTeam: "CIN",
    gameTime: "12:40 PM",
    gameStartAt: "2026-09-17T16:40:00.000Z",
    markets: {
      moneyline: emptyMarket(),
      total: emptyMarket(),
      first_inning: emptyMarket(),
    },
  }],
} as unknown as DailyEdgeResponse;

const feed: DraftKingsNetworkSplitFeed = {
  source: "draftkings_network",
  sport: "MLB",
  fetchedAt: "2026-09-17T15:01:00.000Z",
  games: parsed,
};

const applied = applyDraftKingsNetworkSplitFallback(response, feed);
assert.deepEqual(applied, { matchedGames: 1, populatedMarkets: 2 });
assert.equal(response.games[0]?.markets.moneyline.sportsbookSplits?.label, "DraftKings Splits");
assert.deepEqual(response.games[0]?.markets.moneyline.sportsbookSplits?.rows.map((row) => [row.side, row.moneyPct, row.betsPct]), [
  ["home", 12, 20],
  ["away", 88, 80],
]);
assert.equal(response.games[0]?.markets.total.sportsbookSplits?.rows.length, 2);
assert.equal(response.games[0]?.markets.first_inning.sportsbookSplits, null, "MLB run line must not fill the first-inning slot");
assert.equal(response.games[0]?.markets.moneyline.recommendationDecision?.sharpBookSplits, null, "fallback must remain display-only");

response.games[0]!.markets.moneyline.sportsbookSplits = {
  label: "DraftKings Splits",
  rows: [],
  signal: null,
  lastUpdated: "2026-09-17T15:02:00.000Z",
};
const older = applyDraftKingsNetworkSplitFallback(response, feed);
assert.equal(older.populatedMarkets, 0, "an older fetch must not replace newer source-specific rows");

const invalid = parseDraftKingsNetworkSplitsHtml(html.replace("88%", "70%"));
assert.equal(invalid[0]?.markets.moneyline, undefined, "non-complementary percentage pairs fail closed");

const footballMarket = (marketName: "moneyline" | "spread" | "total", first: string, second: string): DraftKingsNetworkSplitMarket => ({
  market: marketName,
  sides: [
    { label: first, moneyPct: 60, betsPct: 55 },
    { label: second, moneyPct: 40, betsPct: 45 },
  ],
});
const footballResponse = (sport: "nfl" | "cfb", awayTeam: string, homeTeam: string, awayTeamDisplayName?: string, homeTeamDisplayName?: string) => ({
  as_of: "2026-09-17T15:00:00.000Z",
  sport,
  date: "2026-09-19",
  requested_date: "2026-09-19",
  fallback_used: false,
  slateState: "current",
  slate_status: "published",
  last_slate_update_at: "2026-09-17T15:00:00.000Z",
  games: [{
    id: `${sport}-1`, sport, external_id: 1, awayTeam, homeTeam,
    awayTeamDisplayName, homeTeamDisplayName,
    gameTime: "1:00 PM", gameStartAt: "2026-09-19T17:00:00.000Z",
    markets: { moneyline: emptyMarket(), total: emptyMarket(), first_inning: emptyMarket() },
  }],
} as unknown as DailyEdgeResponse);

const nfl = footballResponse("nfl", "GB", "NYJ");
const nflApplied = applyDraftKingsNetworkSplitFallback(nfl, {
  source: "draftkings_network", sport: "NFL", fetchedAt: "2026-09-17T15:01:00.000Z",
  games: [{
    providerEventId: "nfl-1", awayName: "GB Packers", homeName: "NY Jets", monthDay: "9/19",
    markets: {
      moneyline: footballMarket("moneyline", "GB Packers", "NY Jets"),
      spread: footballMarket("spread", "GB Packers +1.5", "NY Jets -1.5"),
      total: footballMarket("total", "Over 44.5", "Under 44.5"),
    },
  }],
});
assert.deepEqual(nflApplied, { matchedGames: 1, populatedMarkets: 3 }, "NFL provider abbreviations must resolve to canonical teams");

const cfb = footballResponse("cfb", "MIA", "WAKE", "Miami Hurricanes", "Wake Forest Demon Deacons");
const cfbApplied = applyDraftKingsNetworkSplitFallback(cfb, {
  source: "draftkings_network", sport: "NCAA Football", fetchedAt: "2026-09-17T15:01:00.000Z",
  games: [{
    providerEventId: "cfb-1", awayName: "Miami FL", homeName: "Wake Forest", monthDay: "9/19",
    markets: {
      moneyline: footballMarket("moneyline", "Miami FL", "Wake Forest"),
      spread: footballMarket("spread", "Miami FL -3.5", "Wake Forest +3.5"),
      total: footballMarket("total", "Over 51.5", "Under 51.5"),
    },
  }],
});
assert.deepEqual(cfbApplied, { matchedGames: 1, populatedMarkets: 3 }, "CFB provider school aliases must resolve without guessing across Miami teams");

const lowerPriority = footballResponse("nfl", "WSH", "DAL");
lowerPriority.games[0]!.markets.moneyline.sportsbookSplits = {
  label: "BetMGM Splits", rows: [], signal: null, lastUpdated: "2026-09-17T15:02:00.000Z",
};
const hierarchyApplied = applyDraftKingsNetworkSplitFallback(lowerPriority, {
  source: "draftkings_network", sport: "NFL", fetchedAt: "2026-09-17T15:01:00.000Z",
  games: [{
    providerEventId: "nfl-2", awayName: "WAS Commanders", homeName: "DAL Cowboys", monthDay: "9/19",
    markets: { moneyline: footballMarket("moneyline", "WAS Commanders", "DAL Cowboys") },
  }],
});
assert.equal(hierarchyApplied.populatedMarkets, 1, "DraftKings must outrank a lower-priority named-book fallback");
assert.equal(lowerPriority.games[0]!.markets.moneyline.sportsbookSplits?.label, "DraftKings Splits");

console.log("DraftKings Network split parser and silent fallback overlay tests passed.");
