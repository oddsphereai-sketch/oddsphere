import assert from "node:assert/strict";
import { OwlsInsightClient } from "../lib/providers/owls/owlsInsightClient";
import { OwlsOddsProvider, inspectOwlsMlbOddsResponse } from "../lib/providers/real_api/OwlsOddsProvider";
import { OwlsSignalProvider } from "../lib/providers/real_api/OwlsSignalProvider";
import { assessObservedProviderDateAlignment } from "../lib/services/providerDateAlignment";
import { reconcileBdlVsSharpEv } from "../lib/services/slateReconciliation";

const asOf = new Date().toISOString();
const oddsBody = {
  success: true,
  data: {
    "2026-10-28": ["pinnacle", "draftkings"].map((key) => ({
      id: 1,
      eventId: "mlb:Milwaukee Brewers@Tampa Bay Rays-20261028",
      sport: "mlb",
      league: "MLB",
      commence_time: "2026-10-28T23:05:00.000Z",
      home_team: "Tampa Bay Rays",
      away_team: "Milwaukee Brewers",
      bookmakers: [{
        key,
        title: key,
        last_update: asOf,
        markets: [
          { key: "h2h", outcomes: [{ name: "Tampa Bay Rays", price: 130 }, { name: "Milwaukee Brewers", price: -145 }] },
          { key: "spreads", outcomes: [{ name: "Tampa Bay Rays", price: -140, point: 1.5 }, { name: "Milwaukee Brewers", price: 120, point: -1.5 }] },
          { key: "totals", outcomes: [{ name: "Over", price: -105, point: 7.5 }, { name: "Under", price: -110, point: 7.5 }] },
        ],
      }],
    })),
  },
  meta: {},
};

const splitsBody = {
  sport: "mlb",
  data: [{
    event_id: "mlb:Milwaukee Brewers@Tampa Bay Rays-20261028",
    home_team: "Tampa Bay Rays",
    away_team: "Milwaukee Brewers",
    splits: [{
      book: "betmgm",
      as_of: asOf,
      moneyline: { away_bets_pct: 76, home_bets_pct: 24, away_price: -145, home_price: 130 },
      total: { line: 7.5, over_bets_pct: 62, under_bets_pct: 38 },
    }],
  }],
  meta: { status: "partial", partial_reason: "book_unavailable", books: ["betmgm"] },
};

const openingBody = {
  success: true,
  data: {
    rows: ["pinnacle", "draftkings"].flatMap((book) => [
      { book, market: "h2h", side: "home", price: 140, point: null, recordedAt: asOf, inPlay: false },
      { book, market: "h2h", side: "away", price: -155, point: null, recordedAt: asOf, inPlay: false },
      { book, market: "spreads", side: "home", price: -135, point: 1.5, recordedAt: asOf, inPlay: false },
      { book, market: "spreads", side: "away", price: 115, point: -1.5, recordedAt: asOf, inPlay: false },
      { book, market: "totals", side: "over", price: -110, point: 8.5, recordedAt: asOf, inPlay: false },
      { book, market: "totals", side: "under", price: -105, point: 8.5, recordedAt: asOf, inPlay: false },
    ]),
  },
};

function clientFor(body: unknown, opening: unknown = body): OwlsInsightClient {
  return new OwlsInsightClient("test", {
    fetchImpl: (async (input) => new Response(JSON.stringify(String(input).includes("/history/odds") ? opening : body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch,
  });
}

const resolver = async () => 9001;

async function main(): Promise<void> {
const inspection = inspectOwlsMlbOddsResponse(oddsBody, "2026-10-28");
assert.equal(inspection.events.length, 1);
assert.deepEqual(inspection.pairs, [{ away: "MIL", home: "TB" }]);
const alignment = assessObservedProviderDateAlignment({
  sport: "mlb",
  expectedDate: "2026-10-28",
  providerLabel: "Owls",
  providerRowsTotal: inspection.stats.totalRows,
  matched: inspection.stats.matchedDate,
  wrongDate: inspection.stats.wrongDate,
  dateUnparseable: inspection.stats.dateUnparseable,
  nonMlb: inspection.stats.nonMlb,
  teamUnresolved: inspection.stats.teamUnresolved,
  slateSize: 1,
});
assert.equal(alignment.status, "ok");
const reconciliation = reconcileBdlVsSharpEv(
  [{ away_abbr: "MIL", home_abbr: "TB" }],
  inspection.pairs,
  { providerLabel: "Owls" },
);
assert.equal(reconciliation.status, "ok");
assert.match(reconciliation.reason, /Owls/);

const odds = await new OwlsOddsProvider("test", resolver, { client: clientFor(oddsBody) })
  .getGameLinesV2("2026-10-28", "mlb");
assert.equal(odds.records.length, 12);
assert.equal(odds.records.filter((row) => row.market_type === "spread").length, 4);
assert.equal(odds.records.filter((row) => row.sportsbook === "pinnacle").length, 6);
assert.ok(odds.records.every((row) => row.ev_percent !== null));
assert.equal(odds.discovery.discoverySource, "owls_current_odds");

const oddsWithOpeners = await new OwlsOddsProvider("test", resolver, { client: clientFor(oddsBody, openingBody) })
  .getGameLinesV2("2026-10-28", "mlb", { openingExternalIds: [9001] });
assert.equal(oddsWithOpeners.openingRecords.length, 12);
assert.equal(oddsWithOpeners.discovery.apiCallsMade, 2);

const signals = await new OwlsSignalProvider("test", resolver, { client: clientFor(splitsBody) })
  .getSharpSignals("2026-10-28");
assert.equal(signals.length, 4);
assert.deepEqual(signals.map((row) => row.public_betting_pct), [76, 24, 62, 38]);
assert.ok(signals.every((row) => row.public_money_pct === null));
assert.ok(signals.every((row) => row.has_reverse_line_movement === false));
assert.ok(signals.every((row) => row.has_steam_move === false));

console.log("✓ Owls production odds/splits adapters, exact-slate preflight, and partial-axis honesty");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
