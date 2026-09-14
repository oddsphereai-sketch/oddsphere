import assert from "node:assert/strict";
import {
  boardDateLabel,
  dateKeyInTimeZone,
} from "../app/lab/lib/dailyEdgeBoardDates";

const lateUtcKickoff = "2026-10-13T22:30:00.000Z";

assert.equal(dateKeyInTimeZone(lateUtcKickoff, "America/New_York"), "2026-10-13");
assert.equal(dateKeyInTimeZone(lateUtcKickoff, "Europe/Madrid"), "2026-10-14");
assert.equal(boardDateLabel(lateUtcKickoff, "America/New_York"), "Tuesday, Oct 13");
assert.equal(boardDateLabel(lateUtcKickoff, "Europe/Madrid"), "Wednesday, Oct 14");
assert.equal(dateKeyInTimeZone("not-a-date", "Europe/Madrid"), "Unscheduled");
assert.equal(dateKeyInTimeZone(lateUtcKickoff, "Not/AZone"), "Unscheduled");
assert.equal(boardDateLabel(null, "Europe/Madrid"), "Date TBD");
assert.equal(boardDateLabel(lateUtcKickoff, "Not/AZone"), "Date TBD");

console.log("Daily Edge board-date tests passed");
