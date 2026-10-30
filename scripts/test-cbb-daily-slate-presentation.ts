import assert from "node:assert/strict";
import type { DailyEdgeGameDto, DailyEdgeResponse } from "../app/lab/lib/labTypes";
import {
  cbbAnalyzedGamesForDate,
  cbbScheduleForDate,
  cbbSlateDays,
  initialCbbSlateDate,
} from "../app/lab/lib/cbbDailySlate";

const locked = { id: "cbb-1", gameStartAt: "2026-11-01T14:30:00.000Z", lockState: "locked" } as DailyEdgeGameDto;
const future = { id: "cbb-2", gameStartAt: "2026-11-02T23:00:00.000Z" } as DailyEdgeGameDto;
const snapshot = {
  date: "2026-10-30",
  games: [locked, future],
  cbbRollingSchedule: {
    release: "fixture-test", anchorDate: "2026-10-30", throughDate: "2026-11-05",
    games: [
      { id: "schedule-1", slateDate: "2026-11-01" },
      { id: "schedule-2", slateDate: "2026-11-03" },
    ],
  },
} as DailyEdgeResponse;

assert.deepEqual(cbbSlateDays(snapshot), [
  { date: "2026-11-01", analyzed: 1, scheduled: 1 },
  { date: "2026-11-02", analyzed: 1, scheduled: 0 },
  { date: "2026-11-03", analyzed: 0, scheduled: 1 },
]);
assert.equal(initialCbbSlateDate(snapshot, null), "2026-11-01");
assert.equal(initialCbbSlateDate(snapshot, "cbb-2"), "2026-11-02");
assert.equal(initialCbbSlateDate({ ...snapshot, date: "2026-11-01" }, null), "2026-11-01");
assert.equal(initialCbbSlateDate({ ...snapshot, date: "2026-11-03" }, null), "2026-11-03");
assert.deepEqual(cbbAnalyzedGamesForDate(snapshot.games, "2026-11-01"), [locked]);
assert.deepEqual(cbbAnalyzedGamesForDate(snapshot.games, "2026-11-03"), []);
assert.deepEqual(cbbScheduleForDate(snapshot.cbbRollingSchedule, "2026-11-03")?.games.map((game) => game.id), ["schedule-2"]);
assert.equal(snapshot.games[0], locked);
assert.equal(snapshot.games[0]?.lockState, "locked");
assert.equal(snapshot.cbbRollingSchedule?.games.length, 2);

console.log("CBB daily-slate presentation tests passed");
