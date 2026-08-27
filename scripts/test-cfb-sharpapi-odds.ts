import assert from "node:assert/strict";
import type { SharpApiRequestOptions, SharpApiResponse } from "../lib/providers/real_api/_sharpApiClient";
import type { NcaafGame } from "../lib/services/football/balldontlieNcaafSlate";
import {
  CFB_SHARP_FALLBACK_MAX_REQUESTS,
  cfbBooksNeedSharpFallback,
  fetchSharpApiNcaafOddsFallback,
  normalizeSharpRows,
  sharpEventIdCandidates,
} from "../lib/services/football/cfbSharpApiOdds";
import { buildCfbV1DecisionBundle, getCfbV1Forecast } from "../lib/services/football/cfbV1Decision";

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

const expectedEventId = "ncaaf_sanjosestatespartans_usctrojans_2026-08-29_b2";
assert.equal(sharpEventIdCandidates(game)[0], expectedEventId, "bounded discovery must try the empirically verified main named-book bucket first");
assert.equal(sharpEventIdCandidates(game).some((eventId) => eventId.includes("usctrojans_sanjosestatespartans")), false, "schedule-derived Sharp identities must retain the documented away-home order");

void main();

async function main(): Promise<void> {
const calls: SharpApiRequestOptions[] = [];
const client = {
  async fetch<T>(opts: SharpApiRequestOptions): Promise<SharpApiResponse<T>> {
    calls.push(opts);
    const eventId = String(opts.query?.event_id ?? "");
    const data = eventId === expectedEventId ? sharpRows(expectedEventId) : [];
    return { data: data as T, pagination: { limit: 200, offset: 0, count: data.length, has_more: false } };
  },
};

const result = await fetchSharpApiNcaafOddsFallback({ games: [game], client, maximumRequests: CFB_SHARP_FALLBACK_MAX_REQUESTS });
assert.equal(result.requests, 1, "the correct b2 exact-event candidate must not require league-wide pagination");
assert.equal(result.matchedGames, 1);
assert.equal(calls.every((call) => call.path === "/odds" && call.query?.event_id === expectedEventId), true);
const books = result.booksByGame[game.providerGameId]!;
assert.deepEqual(books.map((book) => book.sportsbook), ["betmgm", "onexbet", "pinnacle", "thescorebet"]);
assert.equal(books.find((book) => book.sportsbook === "betmgm")?.targetEligible, true, "BetMGM may be the displayed exact target");
assert.equal(books.find((book) => book.sportsbook === "pinnacle")?.targetEligible, false, "Pinnacle remains consensus/reference context, not a displayed US target");
assert.equal(books.every((book) => book.provider === "sharpapi" && book.providerEventId === expectedEventId), true);
assert.equal(books.find((book) => book.sportsbook === "betmgm")?.spread?.homeLine, -38.5);
assert.equal(books.find((book) => book.sportsbook === "betmgm")?.total?.line, 60.5);
assert.equal(books.some((book) => book.total?.line === 59.5), false, "alternate totals cannot enter the exact-price tuple");
assert.equal(cfbBooksNeedSharpFallback(books), true, "the missing two-sided Moneyline remains a genuine per-market deficiency");
const underdogHome = normalizeSharpRows({
  game,
  eventId: expectedEventId,
  rows: [
    row(expectedEventId, "betmgm", "point_spread", "home", 3.5, -110, "2026-08-26T12:12:00.000Z"),
    row(expectedEventId, "betmgm", "point_spread", "away", -3.5, -110, "2026-08-26T12:12:00.000Z"),
  ],
});
assert.equal(underdogHome[0]?.spread?.homeLine, 3.5, "Sharp spread normalization must preserve which team is the underdog");
assert.equal(underdogHome[0]?.spread?.awayLine, -3.5);

const bundle = buildCfbV1DecisionBundle({
  providerGameId: game.providerGameId,
  awayTeam: game.away.abbreviation,
  homeTeam: game.home.abbreviation,
  gameStartsAt: game.scheduledStart,
  comparableCurrentBooks: books,
  forecast: getCfbV1Forecast(game.providerGameId),
  contextLines: { homeSpread: -38.5, totalLine: 60.5 },
});
assert.deepEqual(bundle.evaluatedBets.map((decision) => decision.market), ["spread", "total"], "a missing extreme Moneyline cannot suppress complete Spread and Total tuples");
assert.deepEqual(bundle.heldMarkets, [{ market: "moneyline", reason: "named_two_sided_price_or_target_excluded_same_line_consensus_unavailable" }]);
assert.equal(bundle.evaluatedBets.every((decision) => decision.evaluatedQuote.provider === "sharpapi"), true);
assert.equal(bundle.evaluatedBets.every((decision) => decision.evaluatedQuote.sportsbook === "betmgm"), true);
const spreadDecision = bundle.evaluatedBets.find((decision) => decision.market === "spread");
const totalDecision = bundle.evaluatedBets.find((decision) => decision.market === "total");
assert.deepEqual(
  spreadDecision && {
    side: spreadDecision.side,
    line: spreadDecision.evaluatedQuote.line,
    price: spreadDecision.evaluatedQuote.price,
    grade: spreadDecision.grade,
  },
  { side: "USC -38.5", line: -38.5, price: -110, grade: "No Play" },
  "the normal Spread reader tuple must remain USC -38.5 -110 with its evidence-backed Bet grade",
);
assert.deepEqual(
  totalDecision && {
    side: totalDecision.side,
    line: totalDecision.evaluatedQuote.line,
    price: totalDecision.evaluatedQuote.price,
    grade: totalDecision.grade,
  },
  { side: "Under 60.5", line: 60.5, price: -110, grade: "Best Angle" },
  "the normal Total reader tuple must remain Under 60.5 -110 with its evidence-backed Bet grade",
);
assert.equal(bundle.trackingEnabled, false, "official tracking remains closed while any market lacks a coherent T-60 exact-price tuple");

await assert.rejects(
  fetchSharpApiNcaafOddsFallback({ games: [game], client: { async fetch<T>(): Promise<SharpApiResponse<T>> { return { data: [] as T, pagination: { has_more: false } }; } }, maximumRequests: 1 }),
  /exhausted its 1-request hard cap/,
  "bounded discovery must fail before the single writer can append partial evidence",
);

console.log("CFB SharpAPI exact-event named-book fallback tests passed.");
}

function sharpRows(eventId: string): unknown[] {
  const at = "2026-08-26T12:11:41.525Z";
  const rows = [
    row(eventId, "betmgm", "point_spread", "home", -38.5, -110, at),
    row(eventId, "betmgm", "point_spread", "away", 38.5, -110, at),
    row(eventId, "onexbet", "point_spread", "home", -38.5, -110, at),
    row(eventId, "onexbet", "point_spread", "away", 38.5, -110, at),
    row(eventId, "thescorebet", "point_spread", "home", -38.5, 100, at),
    row(eventId, "thescorebet", "point_spread", "away", 38.5, -120, at),
    row(eventId, "betmgm", "total_points", "over", 60.5, -110, at),
    row(eventId, "betmgm", "total_points", "under", 60.5, -110, at),
    row(eventId, "onexbet", "total_points", "over", 60.5, -110, at),
    row(eventId, "onexbet", "total_points", "under", 60.5, -110, at),
    row(eventId, "pinnacle", "total_points", "over", 60.5, -108, at),
    row(eventId, "pinnacle", "total_points", "under", 60.5, -108, at),
    { ...row(eventId, "betmgm", "total_points", "over", 59.5, -105, at), is_alternate_line: true },
    { ...row(eventId, "betmgm", "total_points", "under", 59.5, -115, at), is_alternate_line: true },
    { ...row(eventId, "betmgm", "point_spread", "home", -38.5, 125, at), home_team: "San Jose State Spartans", away_team: "USC Trojans" },
    { ...row(eventId, "betmgm", "point_spread", "away", 38.5, 125, at), home_team: "San Jose State Spartans", away_team: "USC Trojans" },
    row(eventId, "sportzino", "moneyline", "away", null, 2000, at),
  ];
  return rows;
}

function row(eventId: string, sportsbook: string, marketType: string, side: string, line: number | null, price: number, at: string): Record<string, unknown> {
  return {
    event_id: eventId,
    external_event_id: `${sportsbook}-sjs-usc`,
    event_start_time: "2026-08-29T19:00:00.000Z",
    home_team: "(14) USC Trojans",
    away_team: "San Jose State Spartans",
    sportsbook,
    market_type: marketType,
    selection_type: side,
    line,
    odds_american: price,
    is_main_line: true,
    is_alternate_line: false,
    is_player_prop: false,
    is_live: false,
    is_active: true,
    is_stale_pregame_price: false,
    timestamp: at,
  };
}
