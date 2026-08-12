import assert from "node:assert/strict";
import { resolvePitcherStarterWorkload } from "../lib/mlb/props/realScoring";

const mixedRole = resolvePitcherStarterWorkload({
  starts: 2,
  gamesPitched: 16,
  innings: 34,
  battersFaced: null,
  recentStarts: 2,
  recentOuts: 28,
  recentBattersFaced: 42,
});
assert.equal(mixedRole.source, "recent_starts");
assert.equal(mixedRole.outsPerStart, 14);
assert.equal(mixedRole.battersFacedPerStart, 21);
assert.ok(mixedRole.battersFacedPerStart < 32);

const establishedStarter = resolvePitcherStarterWorkload({
  starts: 20,
  gamesPitched: 21,
  innings: 120,
  battersFaced: 500,
  recentStarts: 10,
  recentOuts: 165,
  recentBattersFaced: 230,
});
assert.equal(establishedStarter.source, "season_starter");
assert.equal(establishedStarter.outsPerStart, 18);
assert.equal(establishedStarter.battersFacedPerStart, 25);

const relieverFallback = resolvePitcherStarterWorkload({
  starts: 1,
  gamesPitched: 20,
  innings: 30,
  battersFaced: null,
  recentStarts: null,
  recentOuts: null,
  recentBattersFaced: null,
});
assert.equal(relieverFallback.source, "appearance_fallback");
assert.ok(relieverFallback.battersFacedPerStart < 22);

console.log("PASS pitcher workload guard separates starter workload from mixed-role season totals");
