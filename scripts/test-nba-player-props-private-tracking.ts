import assert from "node:assert/strict";
import { summarizePrivatePlayerPropTracking } from "../lib/services/playerPropsPrivateDiagnostics";
import {
  buildNbaPlayerPropsPrivateTrackingRow,
  decodeNbaPlayerPropsPrivateTrackingHistory,
  encodeNbaPlayerPropsPrivateTrackingHistory,
  mergeNbaPlayerPropsPrivateTrackingRows,
  NBA_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE,
  NBA_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA,
  settleNbaPlayerPropsPrivateTrackingRow,
  type NbaPlayerPropsPrivateTrackingHistory,
} from "../lib/services/nba/nbaPlayerPropsPrivateTracking";
import { buildNbaPlayerPropsSettlementRevision } from "../lib/services/nba/nbaPlayerPropsSettlementStore";
import type { NbaPlayerPropsCurrentState } from "../lib/services/nba/nbaPlayerPropsCurrentState";

const lockedAt = "2026-10-20T22:00:00.000Z";
const base = {
  gameId: "nba-bdl:1",
  playerId: "nba-bdl-player:7",
  playerName: "Player Seven",
  team: "NYK",
  opponent: "BOS",
  scheduledStart: "2026-10-20T23:00:00.000Z",
  market: "rebounds" as const,
  line: 7.5,
  side: "over" as const,
  sportsbook: "FanDuel",
  americanPrice: -105,
  canonicalMainLine: true,
  independentProjection: 7.1,
  finalProjection: 8.3,
  independentProbability: 0.47,
  marketProbability: 0.56,
  finalProbability: 0.59,
  grade: "Lean",
  marketMovement: "qualified_flip",
  observedAt: "2026-10-20T21:55:00.000Z",
  lockedAt,
  modelRelease: "nba-props-model-r1",
  calibrationRelease: "nba-props-calibration-r1",
  decisionRelease: "nba-props-decision-r1",
};

const row = buildNbaPlayerPropsPrivateTrackingRow(base);
assert.match(row.rowKey, /^nba-props-decision-r1\|nba-bdl:1\|nba-bdl-player:7\|rebounds\|7.5\|over\|fanduel$/);
const duplicate = mergeNbaPlayerPropsPrivateTrackingRows({ previous: [row], current: [row] });
assert.deepEqual({ added: duplicate.added, preserved: duplicate.preserved, conflicts: duplicate.conflicts }, {
  added: 0, preserved: 1, conflicts: 0,
});
const conflict = mergeNbaPlayerPropsPrivateTrackingRows({
  previous: [row],
  current: [{ ...row, finalProjection: 9.9 }],
});
assert.equal(conflict.conflicts, 1);
assert.equal(conflict.rows[0]?.finalProjection, 8.3, "the first locked payload remains immutable");

const history: NbaPlayerPropsPrivateTrackingHistory = {
  kind: "nba_player_props_private_tracking_history_v1",
  schema: NBA_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA,
  captureRelease: NBA_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE,
  season: 2026,
  slateDate: "2026-10-20",
  createdAt: lockedAt,
  updatedAt: lockedAt,
  rows: [row],
};
const envelope = encodeNbaPlayerPropsPrivateTrackingHistory(history);
assert.deepEqual(decodeNbaPlayerPropsPrivateTrackingHistory(envelope), history);
assert.equal(decodeNbaPlayerPropsPrivateTrackingHistory({ ...envelope, checksum: "bad" }), null);

const settled = settleNbaPlayerPropsPrivateTrackingRow({ row, actual: 10 });
const report = summarizePrivatePlayerPropTracking([settled]);
assert.equal(report.mainLine.wins, 1);
assert.equal(report.mainLine.marketReader.corrections, 1);
assert.equal(report.byMarket.rebounds?.mainLine.projection.mae, 1.6999999999999993);
assert.equal(report.byMarket.rebounds?.mainLine.independentProjection.mae, 2.9000000000000004);
assert.deepEqual(report.byMarket.rebounds?.cushions["+1"], {
  records: 1, wins: 1, losses: 0, pushes: 0, hitRate: 1,
});

const officialBox = {
  rowId: 17,
  gameId: 1,
  playerId: 7,
  teamId: 10,
  minutes: 32,
  points: 18,
  oreb: 2,
  dreb: 5,
  ast: 4,
  fg3m: 2,
  blk: 0,
  stl: 1,
  turnover: 2,
  fga: 12,
  fgm: 6,
  fg3a: 5,
  fta: 4,
  ftm: 4,
  pf: 2,
  plusMinus: 3,
} satisfies NbaPlayerPropsCurrentState["boxes"][number];

const pushRevision = buildNbaPlayerPropsSettlementRevision({
  row: { ...row, rowKey: row.rowKey.replace("|7.5|", "|7|"), line: 7 },
  box: officialBox,
  prior: null,
  observedAt: "2026-10-21T04:00:00.000Z",
});
assert.equal(pushRevision.status, "added");
assert.equal(pushRevision.revision.actual, 7);
assert.equal(pushRevision.revision.result, "push");
assert.equal(pushRevision.revision.unitReturn, 0);

const dnpRevision = buildNbaPlayerPropsSettlementRevision({
  row,
  box: { ...officialBox, minutes: 0 },
  prior: null,
  observedAt: "2026-10-21T04:00:00.000Z",
});
assert.equal(dnpRevision.revision.actual, null);
assert.equal(dnpRevision.revision.result, "void");
assert.equal(dnpRevision.revision.unitReturn, 0);

const missingBoxRevision = buildNbaPlayerPropsSettlementRevision({
  row,
  box: null,
  prior: null,
  observedAt: "2026-10-21T04:00:00.000Z",
});
assert.equal(missingBoxRevision.revision.result, "void");

const correctedRevision = buildNbaPlayerPropsSettlementRevision({
  row,
  box: { ...officialBox, oreb: 3, dreb: 6 },
  prior: dnpRevision.revision,
  observedAt: "2026-10-21T10:00:00.000Z",
});
assert.equal(correctedRevision.status, "corrected");
assert.equal(correctedRevision.revision.revision, 2);
assert.equal(correctedRevision.revision.actual, 9);
assert.equal(correctedRevision.revision.result, "win");

const preservedRevision = buildNbaPlayerPropsSettlementRevision({
  row,
  box: { ...officialBox, oreb: 3, dreb: 6 },
  prior: correctedRevision.revision,
  observedAt: "2026-10-21T11:00:00.000Z",
});
assert.equal(preservedRevision.status, "preserved");
assert.deepEqual(preservedRevision.revision, correctedRevision.revision);

console.log("NBA player props private tracking tests passed.");
