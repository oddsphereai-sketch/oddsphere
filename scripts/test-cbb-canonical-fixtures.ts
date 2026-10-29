import assert from "node:assert/strict";
import { CbbBallDontLieClient } from "../lib/cbb/ballDontLie";
import { assertCbbFixtureRefreshSafe, cbbCanonicalGamePayload,
  cbbCanonicalStatus, cbbCanonicalTeamPayload } from "../lib/cbb/canonicalFixture";
import { cbbFixtureSeedDates, selectCbbSlateGames } from "../lib/services/cbb/seedCbbGamesService";
import type { CbbGame, CbbTeam } from "../lib/cbb/types";

const home: CbbTeam = { id: 92, conference_id: 7, name: "Wildcats",
  full_name: "Villanova Wildcats", college: "Villanova", abbreviation: "VILL" };
const away: CbbTeam = { id: 11, conference_id: 1, name: "Fighting Irish",
  full_name: "Notre Dame Fighting Irish", college: "Notre Dame", abbreviation: "ND" };
const game: CbbGame = { id: 10882407, date: "2026-11-01T14:30:00.000Z", season: 2026,
  status: "pre", status_state: "scheduled", period: 0, home_team: home,
  visitor_team: away, home_score: 0, away_score: 0 };
const late: CbbGame = { ...game, id: 10882408, date: "2026-11-02T04:59:00.000Z" };
const nextDay: CbbGame = { ...game, id: 10882409, date: "2026-11-02T05:01:00.000Z" };

assert.deepEqual(selectCbbSlateGames([nextDay, late, game], "2026-11-01", 2026).map(row => row.id),
  [game.id, late.id]);
assert.deepEqual(cbbFixtureSeedDates("2026-10-29"),
  ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
assert.throws(() => cbbFixtureSeedDates("2026-11-1"), /Invalid/);
assert.throws(() => selectCbbSlateGames([game, game], "2026-11-01", 2026), /Duplicate/);
assert.throws(() => selectCbbSlateGames([{ ...game, status_state: "unknown" }], "2026-11-01", 2026), /unknown/);
assert.throws(() => selectCbbSlateGames([{ ...game, season: 2025 }], "2026-11-01", 2026), /foreign season/);
assert.equal(cbbCanonicalStatus({ status: "pre" }), "STATUS_SCHEDULED");
assert.equal(cbbCanonicalStatus({ status: "post", status_state: "final" }), "STATUS_FINAL");
assert.throws(() => cbbCanonicalStatus({ status: "pre", status_state: "canceled-but-rescheduled" }), /Unsupported/);
assert.equal(cbbCanonicalTeamPayload(home).slug, "cbb-92");
assert.equal(cbbCanonicalGamePayload(late, 200, 300).slate_date, "2026-11-01");
assert.equal(cbbCanonicalGamePayload(game, 200, 300).home_score, null);
assert.throws(() => cbbCanonicalGamePayload({ ...game, status_state: "final", home_score: -1 }, 200, 300), /valid score/);
assert.equal(cbbCanonicalGamePayload({ ...game, status_state: "in_progress", home_score: 18 }, 200, 300).home_score, 18);
const payload = cbbCanonicalGamePayload(game, 200, 300);
const previous = { id: 1, status: "STATUS_SCHEDULED", game_date: game.date,
  home_team_id: 200, away_team_id: 300 };
assert.doesNotThrow(() => assertCbbFixtureRefreshSafe(previous, payload, true));
assert.throws(() => assertCbbFixtureRefreshSafe(previous, { ...payload, game_date: nextDay.date }, true), /locked identity/);
assert.throws(() => assertCbbFixtureRefreshSafe({ ...previous, status: "STATUS_FINAL" }, payload, false), /regress from final/);

async function testDateBoundedProvider(): Promise<void> {
  const urls: URL[] = [];
  const client = new CbbBallDontLieClient("test-key", { delayMs: 0, fetch: async input => {
    urls.push(new URL(String(input)));
    return new Response(JSON.stringify({ data: [game], meta: { next_cursor: null } }), { status: 200 });
  } });
  assert.deepEqual(await client.gamesForDates(["2026-10-31", "2026-11-01", "2026-11-02"], 2026), [game]);
  assert.deepEqual(urls[0].searchParams.getAll("dates[]"), ["2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.deepEqual(urls[0].searchParams.getAll("seasons[]"), ["2026"]);
  assert.throws(() => client.gamesForDates(["2026-11-01", "2026-11-01"], 2026), /distinct/);
  console.log("CBB canonical fixture tests passed");
}
testDateBoundedProvider().catch(error => { console.error(error); process.exitCode = 1; });
