import assert from "node:assert/strict";
import fixture from "../lib/services/nba/fixtures/nbaPlayerPropsProductPreview.json";
import {
  advanceNbaPlayerPropsCandidateLifecycle,
  NBA_PLAYER_PROPS_WRITER_LEASE_GROUP,
  planNbaPlayerPropsRefresh,
} from "../lib/services/nba/nbaPlayerPropsLifecycle";
import type { NbaPlayerPropsMemberSnapshot } from "../lib/services/nba/nbaPlayerPropsProductContract";

const historical = fixture as NbaPlayerPropsMemberSnapshot;
const firstStart = Date.parse(historical.games[0]!.scheduledStart);
const forward = { ...historical, mode: "private_forward_candidate" as const };
const plan = planNbaPlayerPropsRefresh({
  now: new Date(firstStart - 170 * 60_000).toISOString(),
  slateDate: historical.slateDate,
  games: historical.games,
});
assert.equal(plan.publicEnabled, false);
assert.equal(plan.writerLeaseGroup, NBA_PLAYER_PROPS_WRITER_LEASE_GROUP);
assert(plan.dueGameIds.includes(historical.games[0]!.gameId));

const locked = advanceNbaPlayerPropsCandidateLifecycle({
  now: new Date(firstStart - 45 * 60_000).toISOString(),
  previous: null,
  candidate: forward,
});
assert(locked.frozenAtLock > 0);
const lockedRow = locked.snapshot.decisions.find((row) => row.gameId === historical.games[0]!.gameId)!;
assert(lockedRow.lockedAt);

const mutatedCandidate = {
  ...forward,
  decisions: forward.decisions.map((row) => row.decisionKey === lockedRow.decisionKey
    ? { ...row, projection: row.projection + 9, side: row.side === "over" ? "under" as const : "over" as const }
    : row),
};
const rerun = advanceNbaPlayerPropsCandidateLifecycle({
  now: new Date(firstStart - 30 * 60_000).toISOString(),
  previous: locked.snapshot,
  candidate: mutatedCandidate,
});
assert.deepEqual(rerun.snapshot.decisions.find((row) => row.decisionKey === lockedRow.decisionKey), lockedRow);
assert(rerun.retainedLocked > 0);

process.stdout.write("NBA player-props disabled lifecycle and lock immutability passed.\n");
