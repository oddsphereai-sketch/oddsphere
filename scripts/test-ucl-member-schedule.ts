import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildUclMemberSchedule, readUclMemberBoard } from "../lib/services/ucl/uclMemberSchedule";
import type { DailyEdgeResponse } from "../app/lab/lib/labTypes";

async function main() {
const now = new Date("2026-11-10T13:00:00Z");
const teams = [{ id: 1, display_name: "Arsenal" }, { id: 2, display_name: "Dortmund" }];
const fixture = (external_id: number, game_date: string) => ({ external_id, game_date, home_team_id: 1, away_team_id: 2 });
const rows = [fixture(34_000_001, "2026-11-24T20:00:00Z"), fixture(34_000_002, "2026-11-25T20:00:00Z"),
  fixture(34_000_003, "2026-12-08T20:00:00Z"), fixture(34_000_000, "2026-11-04T20:00:00Z"),
  fixture(12, "2026-11-11T20:00:00Z")];
const before = structuredClone(rows);
const schedule = buildUclMemberSchedule(rows, teams, now);
assert.deepEqual(schedule.games.map(g => g.externalId), [34_000_001, 34_000_002], "next round survives a two-week break, past and other competitions excluded");
assert.deepEqual(rows, before);
assert.deepEqual(Object.keys(schedule.games[0]!).sort(), ["awayTeam", "externalId", "gameStartAt", "homeTeam"], "schedule cannot invent a forecast, price, grade or stake");
assert.equal(buildUclMemberSchedule(rows, teams, new Date("2026-11-26T13:00Z")).games[0]!.externalId, 34_000_003);
assert.throws(() => buildUclMemberSchedule(rows, teams.slice(0, 1), now), /identity/);
assert.throws(() => buildUclMemberSchedule([...rows, rows[0]!], teams, now), /duplicated/);

const lock = { id: "soccer-ucl-1", gameStartAt: "2026-11-24T20:00Z", lockState: "locked", lockedAt: "2026-11-24T19:00Z",
  markets: { moneyline: { verdict: { key: "lean" }, modelProb: .73, priceAmerican: -122 } } };
const published = { games: [lock] } as unknown as DailyEdgeResponse;
const original = structuredClone(published);
assert.strictEqual(await readUclMemberBoard(published, now), published, "available forecast/lock remains authoritative; no DB/provider fallback");
assert.deepEqual(published, original);
for (const path of ["app/api/lab/daily-edge/route.ts", "app/lab/daily-edge/CandidateDailyEdgePage.tsx"]) {
  assert.match(readFileSync(path, "utf8"), /readUclMemberBoard/, `${path} uses the shared read-only fallback`);
}
const source = readFileSync("lib/services/ucl/uclMemberSchedule.ts", "utf8");
assert.doesNotMatch(source, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|buildUclSlate\(|fetch\(/);
console.log("PASS UCL upcoming round gap/rollover/identity, no fabricated betting outputs, existing lock precedence, shared read-only API/page path");

}
main().catch(error => { console.error(error); process.exitCode = 1; });
