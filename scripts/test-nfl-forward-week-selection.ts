import assert from "node:assert/strict";
import {
  NFL_FORWARD_WEEK_SELECTION_RELEASE,
  resolveNflOperationalWeek,
  resolveNflForwardWeek,
} from "../lib/services/football/nflForwardWeekSelection";

assert.match(NFL_FORWARD_WEEK_SELECTION_RELEASE, /completed_slate_rollover/);
assert.equal(resolveNflForwardWeek({
  season: 2026,
  configuredWeek: 1,
  now: new Date("2026-09-15T03:59:59.999Z"),
}), 1, "Week 1 remains selected through Monday night Eastern");
assert.equal(resolveNflForwardWeek({
  season: 2026,
  configuredWeek: 1,
  now: new Date("2026-09-15T04:00:00.000Z"),
}), 2, "the board advances to Week 2 at Tuesday midnight Eastern");
assert.equal(resolveNflForwardWeek({
  season: 2026,
  configuredWeek: 1,
  now: new Date("2026-09-22T04:00:00.000Z"),
}), 3, "the weekly rollover continues without an environment edit");
assert.equal(resolveNflForwardWeek({
  season: 2026,
  configuredWeek: 4,
  now: new Date("2026-09-15T12:00:00.000Z"),
}), 4, "the configured week remains an operator-controlled floor");
assert.equal(resolveNflForwardWeek({
  season: 2027,
  configuredWeek: 3,
  now: new Date("2027-09-15T12:00:00.000Z"),
}), 3, "an undeclared future season fails closed to its configured week");
assert.equal(resolveNflForwardWeek({
  season: 2026,
  configuredWeek: 1,
  now: new Date("2027-02-15T12:00:00.000Z"),
}), 18, "the regular-season selector is capped at Week 18");
assert.throws(() => resolveNflForwardWeek({
  season: 2026,
  configuredWeek: 0,
}), /configured forward week/);

assert.equal(resolveNflOperationalWeek({
  season: 2026,
  configuredWeek: 1,
  now: new Date("2026-09-28T20:00:00.000Z"),
  scheduledStarts: ["2026-09-27T17:00:00.000Z", "2026-09-28T00:20:00.000Z"],
}), 4, "a completed Sunday-only Week 3 board advances after the established Monday 2 a.m. ET rollover");
assert.equal(resolveNflOperationalWeek({
  season: 2026,
  configuredWeek: 1,
  now: new Date("2026-09-28T20:00:00.000Z"),
  scheduledStarts: ["2026-09-27T17:00:00.000Z", "2026-09-29T00:15:00.000Z"],
}), 3, "a Monday-night game keeps Week 3 selected");
assert.equal(resolveNflOperationalWeek({
  season: 2026,
  configuredWeek: 1,
  now: new Date("2026-09-28T20:00:00.000Z"),
  scheduledStarts: [],
}), 3, "missing published schedule evidence fails closed to the calendar week");

console.log("NFL forward week selection: calendar floor, completed-slate rollover, Monday protection, and Week 18 cap passed.");
