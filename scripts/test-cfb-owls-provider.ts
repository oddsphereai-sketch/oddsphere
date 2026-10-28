import assert from "node:assert/strict";
import { fetchCfbOwlsProvider, mapCfbOwlsProvider } from "../lib/services/football/cfbOwlsProvider";
import { cfbModelSharpSplits } from "../lib/services/football/cfbForwardEvidenceWriter";
import {
  CFB_OWLS_SPLITS_RELEASE,
  CFB_SHARP_API_SPLITS_RELEASE,
  type CfbSharpApiSplitRecord,
} from "../lib/services/football/cfbSharpApiSplits";
import { fetchBalldontlieNcaafSlate, type NcaafGame } from "../lib/services/football/balldontlieNcaafSlate";

const game: NcaafGame = {
  providerGameId: "123",
  providerWeek: 9,
  season: 2026,
  scheduledStart: "2026-10-28T23:30:00.000Z",
  status: "Scheduled",
  awayScore: null,
  homeScore: null,
  away: { id: 1, conferenceId: 1, abbreviation: "KENN", name: "Kennesaw State Owls", fbs: true },
  home: { id: 2, conferenceId: 2, abbreviation: "MTSU", name: "Middle Tennessee Blue Raiders", fbs: true },
};

const result = mapCfbOwlsProvider({
  games: [game],
  odds: {
    success: true,
    data: {
      ncaaf: [{
        id: "owls-odds-123",
        eventId: "ncaaf:Kennesaw State Owls@Middle Tennessee Blue Raiders-20261028",
        sport: "ncaaf",
        commence_time: game.scheduledStart,
        away_team: game.away.name,
        home_team: game.home.name,
        bookmakers: ["circa", "pinnacle"].map((key) => ({
          key,
          last_update: "2026-10-27T23:40:00.000Z",
          markets: [
            { key: "h2h", outcomes: [{ name: game.away.name, price: 145 }, { name: game.home.name, price: -165 }] },
            { key: "spreads", outcomes: [{ name: game.away.name, point: 3.5, price: -110 }, { name: game.home.name, point: -3.5, price: -110 }] },
            { key: "totals", outcomes: [{ name: "Over", point: 51.5, price: -105 }, { name: "Under", point: 51.5, price: -115 }] },
          ],
        })),
      }],
    },
  },
  splits: {
    sport: "ncaaf",
    data: [{
      event_id: "ncaaf:Kennesaw State Owls@Middle Tennessee Blue Raiders-20261028",
      away_team: game.away.name,
      home_team: game.home.name,
      splits: ["circa", "betmgm"].map((book) => ({
        book,
        as_of: "2026-10-27T23:41:00.000Z",
        moneyline: {
          away_price: 145, home_price: -165,
          away_bets_pct: 44, home_bets_pct: 56,
          away_handle_pct: 61, home_handle_pct: 39,
        },
        spread: {
          away_line: 3.5, home_line: -3.5,
          away_bets_pct: 48, home_bets_pct: 52,
          away_handle_pct: 63, home_handle_pct: 37,
        },
        total: {
          line: 51.5,
          over_bets_pct: 54, under_bets_pct: 46,
          over_handle_pct: 57, under_handle_pct: 43,
        },
      })),
    }],
    meta: { status: "ok", books: ["circa", "betmgm"], total_games: 1 },
  },
});

assert.equal(result.requests, 2);
assert.equal(result.matchedOddsGames, 1);
assert.equal(result.matchedSplitGames, 1);
assert.equal(result.booksByGame[game.providerGameId]?.length, 2);
assert.deepEqual(result.booksByGame[game.providerGameId]?.map((book) => book.sportsbook), ["circa", "pinnacle"]);
assert.ok(result.booksByGame[game.providerGameId]?.every((book) =>
  book.provider === "owls" && book.targetEligible === false && book.marketReadingEligible === false));
assert.equal(result.booksByGame[game.providerGameId]?.[0]?.spread?.homeLine, -3.5);
assert.equal(result.booksByGame[game.providerGameId]?.[0]?.total?.line, 51.5);

const owlsSplits = result.splitRecordsByGame[game.providerGameId] ?? [];
assert.deepEqual(owlsSplits.map((row) => row.sportsbook), ["betmgm", "circa"]);
assert.ok(owlsSplits.every((row) => row.provider === "owls" && row.release === CFB_OWLS_SPLITS_RELEASE));
assert.equal(owlsSplits.find((row) => row.sportsbook === "circa")?.moneyline?.away.moneyPct, 61);
assert.equal(owlsSplits.find((row) => row.sportsbook === "circa")?.spread?.homeLine, -3.5);

const legacy: CfbSharpApiSplitRecord = {
  ...owlsSplits[0]!,
  release: CFB_SHARP_API_SPLITS_RELEASE,
  provider: "sharpapi",
};
assert.deepEqual(cfbModelSharpSplits([...owlsSplits, legacy]), [legacy],
  "Owls evidence must remain outside prediction/grade authority in this migration");

console.log("CFB Owls capture: exact identity, complete prices/splits, and production neutrality passed.");

async function runLiveProbe(): Promise<void> {
  const startDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const end = new Date(`${startDate}T12:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  const endDate = end.toISOString().slice(0, 10);
  const slate = await fetchBalldontlieNcaafSlate({ season: 2026, startDate, endDate });
  const live = await fetchCfbOwlsProvider({ games: slate.games });
  console.log(JSON.stringify({
    startDate,
    endDate,
    canonicalGames: slate.games.length,
    oddsEvents: live.oddsEvents,
    splitEvents: live.splitEvents,
    matchedOddsGames: live.matchedOddsGames,
    matchedSplitGames: live.matchedSplitGames,
    gamesWithCirca: Object.values(live.booksByGame).filter((books) => books.some((book) => book.sportsbook === "circa")).length,
    gamesWithPinnacle: Object.values(live.booksByGame).filter((books) => books.some((book) => book.sportsbook === "pinnacle")).length,
    gamesWithOwlsSplits: Object.values(live.splitRecordsByGame).filter((rows) => rows.length > 0).length,
    rejected: live.rejected.slice(0, 20),
  }, null, 2));
}

if (process.argv.includes("--live")) {
  runLiveProbe().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
