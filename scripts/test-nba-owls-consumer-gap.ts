import assert from "node:assert/strict";
import { __NBA_LINES_TEST__ as test } from "../lib/services/nba/refreshNbaLinesService";

const availableAt = "2026-11-04T15:20:00Z";
const games = [{ id: 1, external_id: 401, home_team_id: 2, away_team_id: 3, game_date: "2026-11-06T02:00:00Z" }];
const teams = new Map([[2, { id: 2, abbreviation: "PHX", display_name: "Phoenix Suns" }],
  [3, { id: 3, abbreviation: "ORL", display_name: "Orlando Magic" }]]);
const pair = (sportsbook: string, market = "moneyline", stamp = "2026-11-04T15:00:00Z") => ["home", "away"].map((side, i) => ({
  event_id: "native-exact-event", sportsbook, market_type: market, side,
  home_team: "Phoenix Suns", away_team: "Orlando Magic", event_start_time: games[0]!.game_date,
  provider_timestamp: stamp, odds_american: i === 0 ? -150 : 130,
  line: market === "spread" ? i === 0 ? -3.5 : 3.5 : null, is_main_line: true,
}));
const primary = pair("draftkings");
const native = [...pair("draftkings").map(row => ({ ...row, odds_american: -110 })), ...pair("fanduel"), ...pair("circa")];
const filled = test.fillOwlsConsumerGaps(primary, native, games, teams, availableAt, availableAt);
assert.deepEqual(filled.rows.filter(row => row.sportsbook === "draftkings"), primary, "a complete BDL/TOA pair retains exact priority");
assert.deepEqual(filled.addedRows.map(row => row.sportsbook), ["fanduel", "fanduel"]);
assert.equal(filled.rows.some(row => row.sportsbook === "circa"), false, "professional evidence cannot become a consumer execution offer");
assert.equal(test.scopedConsumerPairs(pair("ballybet"), games, teams, availableAt).scopeKeys.size, 0,
  "a context-only retail book cannot claim executable coverage");
assert.equal(test.scopedConsumerPairs(primary.slice(0, 1), games, teams, availableAt).scopeKeys.size, 0,
  "a singleton cannot block another provider's paired fallback");
assert.equal(test.scopedConsumerPairs([primary[0]!, { ...primary[1]!, provider_timestamp: "2026-11-04T15:01:00Z" }], games, teams, availableAt).scopeKeys.size, 0,
  "opposite sides from different source clocks cannot manufacture one contract");
assert.equal(test.scopedConsumerPairs([primary[0]!, { ...primary[1]!, event_id: "different-event" }], games, teams, availableAt).scopeKeys.size, 0,
  "opposite sides from different provider events cannot pair");
assert.equal(test.scopedConsumerPairs(pair("draftkings", "moneyline", "2026-11-04T15:21:00Z"), games, teams, availableAt).scopeKeys.size, 0,
  "a future native timestamp cannot claim coverage");
assert.equal(test.scopedConsumerPairs(primary.map(row => ({ ...row, event_start_time: "2026-11-08T02:00:00Z" })), games, teams, availableAt).scopeKeys.size, 0,
  "a later same-team fixture remains outside the scoped event");
assert.equal(test.scopedConsumerPairs(pair("draftkings", "spread").map((row, i) => i ? { ...row, line: 4.5 } : row), games, teams, availableAt).scopeKeys.size, 0);
assert.equal(test.scopedConsumerPairs(primary.map(row => ({ ...row, odds_american: 0 })), games, teams, availableAt).scopeKeys.size, 0);
const fragment = [{ ...primary[0]!, odds_american: -170 }];
const repaired = test.fillOwlsConsumerGaps(fragment, primary, games, teams, availableAt, availableAt);
assert.deepEqual(repaired.rows, primary, "replace an incomplete fragment with the intact native pair, never mix sides");
assert.equal(test.fillOwlsConsumerGaps(pair("hardrockbet"), pair("hardrock"), games, teams, availableAt, availableAt).addedRows.length, 0,
  "Hard Rock aliases cannot duplicate a complete physical offer");
const response = { success: true, data: [{ id: "native-exact-event", sport: "nba", home_team: "Phoenix Suns", away_team: "Orlando Magic",
  commence_time: games[0]!.game_date, bookmakers: [{ key: "draftkings", last_update: "2026-11-04T15:10:00Z", markets: [
    { key: "h2h", last_update: "2026-11-04T15:00:00Z", outcomes: [{ name: "Phoenix Suns", price: -150 }, { name: "Orlando Magic", price: 130 }] },
    { key: "totals", outcomes: [{ name: "Over", point: 220.5, price: -110 }] },
  ] }] }] };
const nativeResponseRows = test.owlsConsumerRows(response);
assert.equal(nativeResponseRows.length, 2, "incomplete native markets remain unavailable");
assert.ok(nativeResponseRows.every(row => row.provider_timestamp === "2026-11-04T15:00:00.000Z"),
  "preserve the market's own native clock instead of a newer book-level update");
assert.deepEqual(test.fillOwlsConsumerGaps([], [], games, teams, availableAt, availableAt).rows, [], "unoffered future prices remain absent");
console.log("NBA native consumer gaps: complete exact pairs, provider priority, real native clocks, scope/family isolation and unoffered preservation passed");
