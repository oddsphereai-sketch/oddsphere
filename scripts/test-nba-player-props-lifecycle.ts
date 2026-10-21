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

const missed = advanceNbaPlayerPropsCandidateLifecycle({
  now: new Date(firstStart - 45 * 60_000).toISOString(),
  previous: null,
  candidate: forward,
});
assert.equal(missed.frozenAtLock, 0, "a post-cutoff run cannot invent or backdate a missing lock");
assert(!missed.snapshot.decisions.some((row) => row.gameId === historical.games[0]!.gameId));

const prelock = advanceNbaPlayerPropsCandidateLifecycle({
  now: new Date(firstStart - 90 * 60_000).toISOString(),
  previous: null,
  candidate: forward,
});
const prelockRow = prelock.snapshot.decisions.find((row) => row.gameId === historical.games[0]!.gameId)!;
assert(prelockRow && !prelockRow.lockedAt);

const mutatedCandidate = {
  ...forward,
  decisions: forward.decisions.map((row) => row.decisionKey === prelockRow.decisionKey
    ? { ...row, decisionKey: `${row.decisionKey}|changed-line`, line: row.line + 1, projection: row.projection + 9, side: row.side === "over" ? "under" as const : "over" as const }
    : row),
};
const rerun = advanceNbaPlayerPropsCandidateLifecycle({
  now: new Date(firstStart - 30 * 60_000).toISOString(),
  previous: prelock.snapshot,
  candidate: mutatedCandidate,
});
const lockedRow = rerun.snapshot.decisions.find((row) => row.gameId === historical.games[0]!.gameId)!;
assert.equal(lockedRow.decisionKey, prelockRow.decisionKey, "lock must preserve the last genuinely observed pre-cutoff quote");
assert.equal(lockedRow.projection, prelockRow.projection);
assert(lockedRow.lockedAt);

process.stdout.write("NBA player-props disabled lifecycle and lock immutability passed.\n");
