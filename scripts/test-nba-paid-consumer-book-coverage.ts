import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __NBA_LINES_TEST__ as test, refreshNbaLineDates, refreshNbaLines, type RefreshNbaLinesResult,
  } from "../lib/services/nba/refreshNbaLinesService";
import { supabase } from "../lib/db/supabase";
import { parseNbaTheOddsApiCurrentBoard } from "../lib/services/nba/nbaTheOddsApiCurrentOdds";
import { NBA_MODEL_RELEASE, NBA_PREVIOUS_MODEL_RELEASE, NBA_MARKET_MARRIAGE_RELEASE,
  NBA_GRADE_POLICY_RELEASE } from "../lib/automodel/nba/nbaChampionRuntime";
import { buildNbaLockedMemberCapture, applyNbaLockedMemberSnapshotPrecedence } from "../lib/services/nba/nbaLockedMemberSnapshot";
import type { NbaDailyEdgeGameDto } from "../lib/services/nba/buildNbaDailyEdgeDto";

const receipt = "2026-11-04T16:42:00Z", evaluation = "2026-11-04T16:45:00Z";
const game = { id: 1, external_id: 401909922, home_team_id: 1, away_team_id: 2, game_date: "2026-11-05T00:00:00Z" };
const teams = new Map([[1, { id: 1, display_name: "Detroit Pistons", abbreviation: "DET" }],
  [2, { id: 2, display_name: "Philadelphia 76ers", abbreviation: "PHI" }]]);
const rawPair = (sportsbook: string, market = "moneyline") => (market === "total" ? ["over", "under"] : ["home", "away"]).map((side, i) => ({
  event_id: "bdl-exact-event", sportsbook, market_type: market, side,
  home_team: "Detroit Pistons", away_team: "Philadelphia 76ers", event_start_time: game.game_date,
  provider_timestamp: "2026-11-04T16:41:00Z", wire_received_at: receipt,
  odds_american: -110, line: market === "moneyline" ? null : market === "spread" ? i ? 2.5 : -2.5 : 219.5,
}));
const primary = ["moneyline", "spread", "total"].flatMap(market => rawPair("draftkings", market));
const board = { ...parseNbaTheOddsApiCurrentBoard([]), availableAt: receipt,
  quotes: rawPair("fanduel").map(row => ({ providerEventId: "toa-exact-event", scheduledStart: row.event_start_time,
    homeTeam: row.home_team, awayTeam: row.away_team, sportsbook: row.sportsbook, observedAt: row.provider_timestamp,
    market: "moneyline" as const, side: row.side as "home" | "away", line: null, americanPrice: -105 })) };
const fill = (value = board) => test.fillPaidConsumerGaps(primary, value, [game], teams, evaluation);
assert.equal(test.scopedConsumerPairs(primary, [game], teams, evaluation).scopeKeys.size, 3);
assert.equal(test.scopedConsumerPairs(rawPair("fanduel").map((row, i) => i ? { ...row, wire_received_at: "2026-11-04T16:43:00Z" } : row), [game], teams, evaluation).rows.length, 0,
  "two sides from separate actual provider receipts cannot manufacture a pair");
assert.equal(fill().addedRows.length, 2, "a new book's pair is consumed even when every game/market is already covered");
assert.deepEqual(fill().rows.slice(0, primary.length), primary);
assert.equal(fill({ ...board, quotes: board.quotes.map(q => ({ ...q, sportsbook: "draftkings", americanPrice: -101 })) }).addedRows.length, 0,
  "an intact BDL contract keeps exact priority, even at a less attractive price");
for (const [reason, altered] of [
  ["singleton", { ...board, quotes: board.quotes.slice(0, 1) }],
  ["different native clock", { ...board, quotes: board.quotes.map((q, i) => i ? { ...q, observedAt: "2026-11-04T16:41:30Z" } : q) }],
  ["different provider event", { ...board, quotes: board.quotes.map((q, i) => i ? { ...q, providerEventId: "another-event" } : q) }],
  ["native quote after actual response, though before evaluation", { ...board, quotes: board.quotes.map(q => ({ ...q, observedAt: "2026-11-04T16:43:00Z" })) }],
  ["response after evaluation", { ...board, availableAt: "2026-11-04T16:46:00Z" }],
  ["missing receipt", { ...board, availableAt: "" }],
  ["professional is not consumer", { ...board, quotes: board.quotes.map(q => ({ ...q, sportsbook: "circa" })) }],
  ["context book is not execution", { ...board, quotes: board.quotes.map(q => ({ ...q, sportsbook: "ballybet" })) }],
  ["wrong fixture date", { ...board, quotes: board.quotes.map(q => ({ ...q, scheduledStart: "2026-11-07T00:00:00Z" })) }],
  ["wrong fixture participants", { ...board, quotes: board.quotes.map(q => ({ ...q, homeTeam: "Boston Celtics" })) }],
] as const) assert.equal(fill(altered).addedRows.length, 0, reason);
assert.equal(test.fillPaidConsumerGaps(primary, board, [game], teams, "2026-11-05T00:00:00Z").addedRows.length, 0,
  "a prepared fixture that starts before finalization is not a current pregame offer");
const hardRock = primary.concat(rawPair("hardrockbet"));
assert.equal(test.fillPaidConsumerGaps(hardRock, { ...board, quotes: board.quotes.map(q => ({ ...q, sportsbook: "hardrock" })) }, [game], teams, evaluation).addedRows.length, 0);
const partial = [primary[0]!];
const replaced = test.fillPaidConsumerGaps(partial, { ...board, quotes: board.quotes.map(q => ({ ...q, sportsbook: "draftkings" })) }, [game], teams, evaluation);
assert.equal(replaced.rows.length, 2);
assert.ok(replaced.rows.every(q => q.odds_american === -105), "an incomplete BDL fragment cannot splice into TOA's pair");

const result = (mode: RefreshNbaLinesResult["mode"] = "dry-run"): RefreshNbaLinesResult => ({ mode,
  gamesInDb: 1, oddsRowsFetched: 0, matched: 0, unmatched: 0, parsed: 0, linesWritten: 0,
  linesRemoved: 0, lineHistoryWritten: 0, scopesReconciled: 0, incompleteBookGroupsDropped: 0,
  canonicalLines: [], warnings: [], errors: [] });
async function coordinator() {
  const order: string[] = []; let calls = 0;
  const run = await refreshNbaLineDates({ dates: ["today", "future"], optionsForDate: date => ({ slateDate: date, dryRun: true,
    getTheOddsApiCurrentBoard: async () => { calls++; order.push("fetch"); return board; } }),
    prepare: async opts => { order.push(`prepare:${opts.slateDate}`); return { needsConsumerFallback: opts.slateDate === "future",
      finalize: async shared => { order.push(`finalize:${opts.slateDate}`);
        assert.equal(shared!.board, board);
        if (opts.slateDate === "today") assert.equal(test.fillPaidConsumerGaps(primary, shared!.board, [game], teams, evaluation).addedRows.length, 2);
        return result(); } }; } });
  assert.deepEqual(order, ["prepare:today", "prepare:future", "fetch", "finalize:today", "finalize:future"]);
  assert.equal(calls, 1); assert.equal(run.results.length, 2); assert.deepEqual(run.failures, []);
  let forbidden = 0;
  await refreshNbaLineDates({ dates: ["today", "empty"], optionsForDate: date => ({ slateDate: date, dryRun: true,
    getTheOddsApiCurrentBoard: async () => { forbidden++; throw Error("must not fetch"); } }), prepare: async opts => ({
      needsConsumerFallback: false, finalize: async shared => { assert.equal(shared!.board, null); return result(opts.slateDate === "empty" ? "no-games" : "dry-run"); } }) });
  assert.equal(forbidden, 0, "no uncovered market anywhere means no new backup request");
  const failed = await refreshNbaLineDates({ dates: ["broken", "good"], optionsForDate: date => ({ slateDate: date, dryRun: true,
    getTheOddsApiCurrentBoard: async () => { throw Error("saved provider failure"); } }), prepare: async opts => {
      if (opts.slateDate === "broken") throw Error("original preparation error");
      return { needsConsumerFallback: true, finalize: async shared => {
        assert.equal(shared!.error, "saved provider failure"); return { ...result(), warnings: [shared!.error!] }; } }; } });
  assert.deepEqual(failed.failures, [{ date: "broken", error: "original preparation error" }]);
  assert.equal(failed.results[0]!.result.warnings[0], "saved provider failure");
  const route = readFileSync(new URL("../app/api/cron/nba-daily-refresh/route.ts", import.meta.url), "utf8");
  assert.match(route, /await refreshNbaLineDates\(/, "production route must execute the tested coordinator");
}

/** Exercise the real service prepare/finalize path with all I/O replaced in
 * memory. An accidental provider or DB writer call fails this test. */
async function realServiceCoordinator() {
  const originalFetch = globalThis.fetch, originalFrom = supabase.from;
  const now = Date.now(), nativeAt = new Date(now - 60_000).toISOString();
  const dates = [new Date(now).toISOString().slice(0, 10), new Date(now + 86400_000).toISOString().slice(0, 10)];
  const games = dates.map((date, i) => ({ ...game, id: i + 1, external_id: i + 101,
    game_date: new Date(now + (i + 1) * 86400_000).toISOString(), slate_date: date }));
  const events: string[] = []; let paidCalls = 0;
  (supabase as unknown as { from: (table: string) => unknown }).from = table => {
    assert.ok(["games", "teams"].includes(table), "dry-run cannot reach any DB writer/table");
    let date = ""; const query = { select: () => query, eq: (key: string, value: string) => {
      if (key === "slate_date") date = value; return query; }, then: (resolve: (value: unknown) => unknown) => {
        if (date === "broken") return resolve({ data: null, error: { message: "saved read failure" } });
        return resolve({ data: table === "teams" ? [...teams.values()] : games.filter(g => g.slate_date === date), error: null });
      } }; return query;
  };
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/nba/odds") { events.push("owls"); return Response.json({ success: true, data: [] }); }
    assert.equal(url.hostname, "api.balldontlie.io", "all external calls are mocked and bounded");
    const date = url.searchParams.get("dates[]"), fixture = games.find(g => g.slate_date === date)!;
    events.push(`${date}:${url.pathname}`);
    if (url.pathname === "/v1/games") return Response.json({ data: [{ id: fixture.id, datetime: fixture.game_date,
      home_team: { full_name: "Detroit Pistons" }, visitor_team: { full_name: "Philadelphia 76ers" } }] });
    assert.equal(url.pathname, "/v2/odds");
    return Response.json({ data: date === dates[0] ? [{ game_id: fixture.id, vendor: "draftkings", updated_at: nativeAt,
      moneyline_home_odds: -110, moneyline_away_odds: -110, spread_home_value: -2.5, spread_away_value: 2.5,
      spread_home_odds: -110, spread_away_odds: -110, total_value: 219.5, total_over_odds: -110, total_under_odds: -110 }] : [] });
  };
  try {
    const output = await refreshNbaLineDates({ dates, optionsForDate: slateDate => ({ slateDate, dryRun: true,
      owlsApiKey: "mock-only", ballDontLieApiKey: "mock-only", getTheOddsApiCurrentBoard: async () => {
        paidCalls++; events.push("paid"); return { ...board, availableAt: new Date().toISOString(), quotes: board.quotes.map(q => ({
          ...q, observedAt: nativeAt, scheduledStart: games[0]!.game_date })) }; } }) });
    assert.equal(paidCalls, 1); assert.deepEqual(output.failures, []);
    assert.equal(events.filter(x => x === "owls").length, 2);
    assert.equal(events.filter(x => x.endsWith(":/v1/games")).length, 2);
    assert.equal(events.filter(x => x.endsWith(":/v2/odds")).length, 2);
    assert.equal(events.at(-1), "paid", "every primary date prepares before the single paid fetch");
    assert.equal(output.results[0]!.result.consumerSourceCoverage?.theOddsApiPairsAdded, 1);
    assert.equal(output.results[0]!.result.canonicalLines.filter(row => row.sportsbook === "fanduel").length, 2);
    assert.equal(output.results[0]!.result.canonicalLines.filter(row => row.sportsbook === "draftkings").length, 6);
    assert.ok(output.results[1]!.result.errors.some(value => value.includes("3 market scope(s)")), "an unoffered future event remains unavailable");
    const previousCalls = events.length;
    const empty = await refreshNbaLines({ slateDate: "2099-01-01", dryRun: true });
    assert.equal(empty.mode, "no-games"); assert.equal(events.length, previousCalls);
    assert.deepEqual(empty.canonicalLines, []); assert.deepEqual(empty.errors, []);
    await assert.rejects(refreshNbaLines({ slateDate: "broken", dryRun: true }), /load NBA games failed: saved read failure/);
  } finally { globalThis.fetch = originalFetch; supabase.from = originalFrom; }
}

assert.equal(NBA_MODEL_RELEASE, "nba_professional_unified_2026_11_04_r36_paid_consumer_book_coverage");
assert.equal(NBA_PREVIOUS_MODEL_RELEASE, "nba_professional_unified_2026_11_04_r35_native_consumer_pairs");
assert.equal(NBA_MARKET_MARRIAGE_RELEASE, "nba_market_marriage_2026_11_04_r38_paid_consumer_book_coverage");
assert.equal(NBA_GRADE_POLICY_RELEASE, "nba_grade_policy_2026_11_04_r27_paid_consumer_book_coverage");
const legacy = { game_external_id: 901, matchup: "PHI @ DET", projection: { home_score: 110, away_score: 107 },
  provenance: { model_release: NBA_PREVIOUS_MODEL_RELEASE, marriage_release: "nba_market_marriage_2026_11_04_r37_native_consumer_pairs",
    grade_release: "nba_grade_policy_2026_11_04_r26_native_consumer_pairs" },
  intelligence: { ml: { pick_side: "home", model_prob_on_pick: .61, grade: "lean", current_price: { odds_american: -140 } } },
} as unknown as NbaDailyEdgeGameDto;
const capture = buildNbaLockedMemberCapture({ gameDto: legacy, memberGame: { external_id: 901, id: "nba-901", markets: {}, predictions: {} } as unknown as import("../app/lab/lib/labTypes").DailyEdgeGameDto });
const serialized = JSON.stringify(capture);
const restored = applyNbaLockedMemberSnapshotPrecedence({ games: [{ ...legacy, projection: { home_score: 120, away_score: 100 } } as NbaDailyEdgeGameDto],
  dbIdByExternalId: new Map([[901, 9]]), rows: ["moneyline", "spread", "total"].map(market => ({ game_id: 9, market,
    locked_at: "2026-11-04T15:00:00Z", snapshot_json: capture })) });
assert.deepEqual(restored.games[0], { ...legacy, locked_at: "2026-11-04T15:00:00Z" });
assert.equal(JSON.stringify(capture), serialized, "R35/R37/R26 locked fields remain byte-exact source payload");
void coordinator().then(realServiceCoordinator).then(() => console.log("NBA paid consumer coverage: late shared-response routing, exact-book priority, native availability and lock compatibility passed"))
  .catch(error => { console.error(error); process.exitCode = 1; });
