import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildNflTrackingProposals,
  NFL_TRACKING_LIFECYCLE_RELEASE,
  settleNflTrackingProposal,
} from "../lib/services/football/nflTrackingLifecycle";
import { NFL_REGULAR_LOCAL_CALIBRATION_RELEASE, NFL_REGULAR_LOCAL_MODEL_RELEASE } from "../lib/services/football/nflRegularLocalSlate";
import { NFL_REGULAR_DECISION_RELEASE } from "../lib/services/football/nflRegularDecision";

const root = process.env.NFL_RESEARCH_CURRENT_CACHE_ROOT
  ? path.resolve(process.env.NFL_RESEARCH_CURRENT_CACHE_ROOT)
  : path.resolve("football-research/cache/nfl-model/current");
function snapshot(pointerName: string) {
  const pointer = JSON.parse(readFileSync(path.join(root, pointerName), "utf8")) as { filename: string };
  return JSON.parse(readFileSync(path.join(root, pointer.filename), "utf8"));
}

const regular = snapshot("nfl_daily_edge.regular.json");
const lockedAt = "2026-09-09T12:00:00.000Z";
const regularRows = buildNflTrackingProposals({
  snapshot: regular.snapshot,
  seasonPhase: "regular",
  week: 1,
  lockedAt,
  modelApproved: true,
  officialRegistryLaunched: true,
  projectionRelease: NFL_REGULAR_LOCAL_MODEL_RELEASE,
  calibrationRelease: NFL_REGULAR_LOCAL_CALIBRATION_RELEASE,
  decisionRelease: NFL_REGULAR_DECISION_RELEASE,
});
assert.equal(regularRows.length, 48);
assert.equal(new Set(regularRows.map((row) => `${row.gameId}:${row.market}`)).size, 48);
assert.equal(regularRows.every((row) => row.trackingEligible), true);
assert.equal(regularRows.every((row) => row.appendToExistingLifetime), true);
assert.deepEqual([...new Set(regularRows.map((row) => row.market))].sort(), ["moneyline", "spread", "total"]);
assert.equal(regularRows.every((row) => row.lifecycleRelease === NFL_TRACKING_LIFECYCLE_RELEASE), true);

const perGameLocks = Object.fromEntries(regular.snapshot.games.map((game: { id: string; scheduledLockAt: string }) => [
  game.id,
  game.scheduledLockAt,
]));
const perGameRows = buildNflTrackingProposals({
  snapshot: regular.snapshot,
  seasonPhase: "regular",
  week: 1,
  lockedAt: perGameLocks,
  modelApproved: true,
  officialRegistryLaunched: true,
  projectionRelease: NFL_REGULAR_LOCAL_MODEL_RELEASE,
  calibrationRelease: NFL_REGULAR_LOCAL_CALIBRATION_RELEASE,
  decisionRelease: NFL_REGULAR_DECISION_RELEASE,
});
assert.equal(perGameRows.length, regular.snapshot.games.length * 3);
assert.equal(perGameRows.every((row) => row.lockedAt === perGameLocks[row.gameId]), true);
const byeWeekShape = buildNflTrackingProposals({
  snapshot: { ...regular.snapshot, games: regular.snapshot.games.slice(0, 13) },
  seasonPhase: "regular",
  week: 9,
  lockedAt,
  modelApproved: false,
  officialRegistryLaunched: false,
  projectionRelease: NFL_REGULAR_LOCAL_MODEL_RELEASE,
  calibrationRelease: NFL_REGULAR_LOCAL_CALIBRATION_RELEASE,
  decisionRelease: NFL_REGULAR_DECISION_RELEASE,
});
assert.equal(byeWeekShape.length, 39, "bye-week cards must retain exactly three markets per scheduled game");
assert.throws(() => buildNflTrackingProposals({
  snapshot: regular.snapshot,
  seasonPhase: "regular",
  week: 1,
  lockedAt: {},
  modelApproved: true,
  officialRegistryLaunched: true,
  projectionRelease: NFL_REGULAR_LOCAL_MODEL_RELEASE,
  calibrationRelease: NFL_REGULAR_LOCAL_CALIBRATION_RELEASE,
  decisionRelease: NFL_REGULAR_DECISION_RELEASE,
}), /missing an actual ISO lock timestamp/);

const shadowRows = buildNflTrackingProposals({
  snapshot: regular.snapshot,
  seasonPhase: "regular",
  week: 1,
  lockedAt,
  modelApproved: false,
  officialRegistryLaunched: false,
  projectionRelease: NFL_REGULAR_LOCAL_MODEL_RELEASE,
  calibrationRelease: NFL_REGULAR_LOCAL_CALIBRATION_RELEASE,
  decisionRelease: NFL_REGULAR_DECISION_RELEASE,
});
assert.equal(shadowRows.every((row) => !row.trackingEligible && row.trackingReason === "model_not_approved"), true);

const preseasonRows = buildNflTrackingProposals({
  // Season phase is an explicit tracking input. Reuse the checksum-verified
  // regular card so this policy test does not depend on a retired preseason
  // pointer while still proving every market is excluded from lifetime totals.
  snapshot: regular.snapshot,
  seasonPhase: "preseason",
  week: 2,
  lockedAt: "2026-08-20T12:00:00.000Z",
  modelApproved: true,
  officialRegistryLaunched: true,
  projectionRelease: "preseason-rehearsal",
  calibrationRelease: "preseason-rehearsal",
  decisionRelease: "preseason-rehearsal",
});
assert.equal(preseasonRows.length, 48);
assert.equal(preseasonRows.every((row) => !row.trackingEligible), true);
assert.equal(preseasonRows.every((row) => row.trackingReason === "preseason_excluded"), true);

const moneyline = { ...regularRows.find((row) => row.market === "moneyline")!, pick: "SEA", homeTeam: "SEA", awayTeam: "NE" };
assert.equal(settleNflTrackingProposal(moneyline, { homeScore: 24, awayScore: 20, status: "final" }).outcome, "win");
assert.equal(settleNflTrackingProposal(moneyline, { homeScore: 17, awayScore: 20, status: "final" }).outcome, "loss");

const total = { ...regularRows.find((row) => row.market === "total")!, pick: "Over", line: 44 };
assert.equal(settleNflTrackingProposal(total, { homeScore: 24, awayScore: 21, status: "final" }).outcome, "win");
assert.equal(settleNflTrackingProposal(total, { homeScore: 23, awayScore: 21, status: "final" }).outcome, "push");

const spread = { ...regularRows.find((row) => row.market === "spread")!, pick: "SEA -3", line: -3, homeTeam: "SEA", awayTeam: "NE" };
assert.equal(settleNflTrackingProposal(spread, { homeScore: 24, awayScore: 20, status: "final" }).outcome, "win");
assert.equal(settleNflTrackingProposal(spread, { homeScore: 23, awayScore: 20, status: "final" }).outcome, "push");
assert.equal(settleNflTrackingProposal(spread, { homeScore: 20, awayScore: 20, status: "canceled" }).outcome, "void");

console.log("Football tracking lifecycle: weekly per-game locks, preseason exclusion, lifetime append, and settlement passed");
