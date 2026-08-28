import type { NcaafGame } from "../../lib/services/football/balldontlieNcaafSlate";
import { SharpApiClient } from "../../lib/providers/real_api/_sharpApiClient";
import {
  CFB_SHARP_FALLBACK_MAX_PAGES_PER_EVENT,
  CFB_SHARP_FALLBACK_MAX_ROWS_PER_EVENT,
  fetchSharpApiNcaafOddsFallback,
  normalizeSharpRows,
  sharpEventIdCandidates,
} from "../../lib/services/football/cfbSharpApiOdds";

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
  const allCandidates = process.argv.includes("--all-candidates")
    ? await probeAllCandidates(game)
    : null;

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
      marketSelection: book.marketSelection ?? null,
      marketObservedAt: book.marketObservedAt ?? null,
      moneylineComplete: book.moneyline !== null,
      spread: book.spread && {
        awayLine: book.spread.awayLine,
        awayPrice: book.spread.awayPrice,
        homeLine: book.spread.homeLine,
        homePrice: book.spread.homePrice,
      },
      total: book.total,
    })),
    allCandidates,
  }, null, 2));
}

async function probeAllCandidates(target: NcaafGame): Promise<Array<Record<string, unknown>>> {
  const key = process.env.SHARPAPI_KEY;
  if (!key) throw new Error("SHARPAPI_KEY is required for the all-candidate read-only probe.");
  const client = new SharpApiClient(key);
  const result: Array<Record<string, unknown>> = [];
  for (const eventId of sharpEventIdCandidates(target)) {
    const rows: unknown[] = [];
    let offset = 0;
    let complete = false;
    for (let page = 0; page < CFB_SHARP_FALLBACK_MAX_PAGES_PER_EVENT; page += 1) {
      const response = await client.fetch<unknown[]>({
        path: "/odds",
        query: {
          event_id: eventId,
          limit: CFB_SHARP_FALLBACK_MAX_ROWS_PER_EVENT,
          ...(offset > 0 ? { offset } : {}),
        },
        retryRateLimitInternally: false,
      });
      if (!Array.isArray(response.data)) throw new Error(`Malformed odds response for ${eventId}.`);
      rows.push(...response.data);
      if (response.pagination?.has_more !== true) {
        complete = true;
        break;
      }
      const next = response.pagination.next_offset;
      if (typeof next !== "number" || !Number.isInteger(next) || next <= offset) {
        throw new Error(`Invalid pagination cursor for ${eventId}.`);
      }
      offset = next;
    }
    if (!complete) throw new Error(`All-candidate probe exceeded its page cap for ${eventId}.`);
    const normalized = normalizeSharpRows({ game: target, eventId, rows });
    result.push({
      eventId,
      rawRows: rows.length,
      rawSportsbooks: summarizeRawSportsbooks(rows),
      pairedOffersByLine: summarizePairedOffers(rows),
      normalizedBooks: normalized.map((book) => ({
        sportsbook: book.sportsbook,
        targetEligible: book.targetEligible !== false,
        observedAt: book.observedAt,
        markets: {
          moneyline: book.moneyline !== null,
          spread: book.spread !== null,
          total: book.total !== null,
        },
      })),
    });
  }
  return result;
}

function summarizeRawSportsbooks(rows: unknown[]): Array<Record<string, unknown>> {
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const value of rows) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const sportsbook = typeof row.sportsbook === "string" ? row.sportsbook : "unknown";
    grouped.set(sportsbook, [...(grouped.get(sportsbook) ?? []), row]);
  }
  return [...grouped.entries()].sort(([first], [second]) => first.localeCompare(second)).map(([sportsbook, values]) => ({
    sportsbook,
    rows: values.length,
    markets: [...new Set(values.map((row) => row.market_type).filter((value): value is string => typeof value === "string"))].sort(),
    activeRows: values.filter((row) => row.is_active !== false).length,
    mainRows: values.filter((row) => row.is_main_line === true && row.is_alternate_line !== true).length,
    freshPregameRows: values.filter((row) => row.is_live !== true && row.is_stale_pregame_price !== true).length,
    latestTimestamp: values.map((row) => row.timestamp).filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value))).sort().at(-1) ?? null,
    mainGameRows: values
      .filter((row) => ["moneyline", "point_spread", "total_points"].includes(String(row.market_type ?? "")))
      .map((row) => ({
        marketType: row.market_type ?? null,
        selectionType: row.selection_type ?? null,
        teamSide: row.team_side ?? null,
        selection: row.selection ?? null,
        line: row.line ?? null,
        price: row.odds_american ?? null,
        homeTeam: row.home_team ?? null,
        awayTeam: row.away_team ?? null,
        eventStartTime: row.event_start_time ?? null,
        active: row.is_active ?? null,
        mainLine: row.is_main_line ?? null,
        alternateLine: row.is_alternate_line ?? null,
      })),
  }));
}

function summarizePairedOffers(rows: unknown[]): Array<Record<string, unknown>> {
  const grouped = new Map<string, Map<string, Set<string>>>();
  for (const value of rows) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    if (row.is_active === false || row.is_live === true || row.is_stale_pregame_price === true || row.is_player_prop === true) continue;
    const market = row.market_type === "point_spread" ? "spread" : row.market_type === "total_points" ? "total" : null;
    const side = typeof row.selection_type === "string" ? row.selection_type.toLowerCase() : null;
    const line = typeof row.line === "number" ? row.line : typeof row.line === "string" ? Number(row.line) : NaN;
    const sportsbook = typeof row.sportsbook === "string" ? row.sportsbook : null;
    if (!market || !sportsbook || !Number.isFinite(line) || !side) continue;
    const normalizedLine = market === "spread" ? Math.abs(line) : line;
    const key = `${market}|${normalizedLine}`;
    const byBook = grouped.get(key) ?? new Map<string, Set<string>>();
    const sides = byBook.get(sportsbook) ?? new Set<string>();
    sides.add(side);
    byBook.set(sportsbook, sides);
    grouped.set(key, byBook);
  }
  return [...grouped.entries()].flatMap(([key, byBook]) => {
    const [market, line] = key.split("|");
    const required = market === "spread" ? ["home", "away"] : ["over", "under"];
    const books = [...byBook.entries()].filter(([, sides]) => required.every((side) => sides.has(side))).map(([sportsbook]) => sportsbook).sort();
    return books.length === 0 ? [] : [{ market, line: Number(line), books, bookCount: books.length }];
  }).sort((first, second) => String(first.market).localeCompare(String(second.market)) || Number(first.line) - Number(second.line));
}
