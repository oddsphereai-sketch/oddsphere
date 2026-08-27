import type { NcaafGame } from "../../lib/services/football/balldontlieNcaafSlate";
import { fetchSharpApiNcaafOddsFallback } from "../../lib/services/football/cfbSharpApiOdds";

const game: NcaafGame = {
  providerGameId: "457612",
  providerWeek: 1,
  season: 2026,
  scheduledStart: "2026-08-29T19:00:00.000Z",
  status: "scheduled",
  awayScore: null,
  homeScore: null,
  away: { id: 101, conferenceId: 7, abbreviation: "SJSU", name: "San José State Spartans", fbs: true },
  home: { id: 63, conferenceId: 3, abbreviation: "USC", name: "USC Trojans", fbs: true },
};

void main();

async function main(): Promise<void> {
  const result = await fetchSharpApiNcaafOddsFallback({ games: [game], maximumRequests: 16 });
  const books = result.booksByGame[game.providerGameId] ?? [];

  console.log(JSON.stringify({
    release: result.release,
    readOnly: true,
    writes: 0,
    games: result.attemptedGames,
    matchedGames: result.matchedGames,
    requests: result.requests,
    eventId: result.eventIdsByGame[game.providerGameId],
    books: books.map((book) => ({
      sportsbook: book.sportsbook,
      targetEligible: book.targetEligible !== false,
      observedAt: book.observedAt,
      moneylineComplete: book.moneyline !== null,
      spread: book.spread && {
        awayLine: book.spread.awayLine,
        awayPrice: book.spread.awayPrice,
        homeLine: book.spread.homeLine,
        homePrice: book.spread.homePrice,
      },
      total: book.total,
    })),
  }, null, 2));
}
