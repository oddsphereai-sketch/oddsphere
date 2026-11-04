import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
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
import { buildNbaPlayerPropsSettlementRevision, planNbaPropsSettlementCatchup, settleNbaPlayerPropsTrackedSlates, NBA_PLAYER_PROPS_SETTLEMENT_RELEASE,hasNbaPropsUnsettledTrackedSlates } from "../lib/services/nba/nbaPlayerPropsSettlementStore";
import { refreshNbaPlayerPropsPrivateCandidate } from "../lib/services/nba/nbaPlayerPropsPrivateWriter";
import { encodeNbaPlayerPropsPrivatePayload,decodeNbaPlayerPropsPrivatePayload } from "../lib/services/nba/nbaPlayerPropsPrivateStore";
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
  marketEvidence: {
    mode: "target_excluded_arbitration" as const,
    targetExcludedBooks: 4,
    targetExcludedReferenceBooks: 2,
    movement: {
      sportsbook: "FanDuel",
      openingLine: 7.5,
      priorLine: 7.5,
      currentLine: 7.5,
      openingPrice: -110,
      priorPrice: -108,
      currentPrice: -105,
    },
  },
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
  kind: "nba_player_props_private_tracking_history_v2",
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

const { marketEvidence: _futureEvidence, ...legacyRow } = row;
const legacyHistory = {
  ...history,
  kind: "nba_player_props_private_tracking_history_v1",
  schema: "nba_player_props_private_tracking_history_v1",
  captureRelease: "nba_player_props_private_tracking_2026_10_21_r2_private_forward",
  rows: [{ ...legacyRow, captureRelease: "nba_player_props_private_tracking_2026_10_21_r2_private_forward" }],
};
const legacyJson = JSON.stringify(legacyHistory);
const legacyCompressed = gzipSync(Buffer.from(legacyJson), { level: 9 });
const decodedLegacy = decodeNbaPlayerPropsPrivateTrackingHistory({
  kind: "nba_player_props_private_tracking_envelope_v1",
  schema: "nba_player_props_private_tracking_history_v1",
  captureRelease: "nba_player_props_private_tracking_2026_10_21_r2_private_forward",
  encoding: "gzip-base64",
  checksum: createHash("sha256").update(legacyJson).digest("hex"),
  season: legacyHistory.season,
  slateDate: legacyHistory.slateDate,
  uncompressedBytes: Buffer.byteLength(legacyJson),
  compressedBytes: legacyCompressed.byteLength,
  payload: legacyCompressed.toString("base64"),
});
assert(decodedLegacy, "legacy tracking envelopes must remain readable");
assert.deepEqual(decodedLegacy.rows[0], legacyHistory.rows[0], "legacy locked rows must remain byte-equivalent");
assert.equal(decodedLegacy.rows[0]?.marketEvidence, undefined);

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

async function testOldSlateCatchup(){
  const catalog=[1,2,3,4,5].map(day=>({date:`2026-10-${String(day).padStart(2,"0")}`,sourceVersion:`hash-${day}`}));
  assert.deepEqual(planNbaPropsSettlementCatchup({requested:[],catalog,receipts:{}}),["2026-10-01","2026-10-02","2026-10-03"]);
  assert.deepEqual(planNbaPropsSettlementCatchup({requested:["2026-10-02"],catalog,receipts:{"2026-10-01":{sourceVersion:"hash-1",rows:1}}}),["2026-10-03","2026-10-04","2026-10-05"]);
  assert.deepEqual(planNbaPropsSettlementCatchup({requested:[],catalog:catalog.slice(0,1),receipts:{"2026-10-01":{sourceVersion:"old-hash",rows:1}}}),["2026-10-01"],"a changed tracking checksum reopens a previously completed slate");
  assert.throws(()=>planNbaPropsSettlementCatchup({requested:[],catalog:[...catalog,catalog[0]],receipts:{}}),/Invalid/);
  assert.throws(()=>planNbaPropsSettlementCatchup({requested:[],catalog:Array.from({length:401},()=>catalog[0]),receipts:{}}),/bound/);
  const oldHistory={kind:"nba_player_props_private_tracking_history_v2" as const,schema:NBA_PLAYER_PROPS_PRIVATE_TRACKING_SCHEMA,captureRelease:NBA_PLAYER_PROPS_PRIVATE_TRACKING_RELEASE,season:2026,slateDate:"2026-10-20",createdAt:lockedAt,updatedAt:lockedAt,rows:[row]};
  const trackingPayload=encodeNbaPlayerPropsPrivateTrackingHistory(oldHistory);
  const trackingBytes=JSON.stringify(trackingPayload);
  const priorRevision={...preservedRevision.revision,rowKey:"previous-locked-row"};
  let payload:unknown=encodeNbaPlayerPropsPrivatePayload({release:"nba_player_props_private_settlement_2026_10_21_r1_official_box_revisions",publicEnabled:false,season:2026,createdAt:lockedAt,updatedAt:lockedAt,revisions:[priorRevision]},"tracking_history");
  let writes=0;
  const db={from:(table:string)=>{assert.equal(table,"lab_response_snapshots");return{select:()=>{let key="";const q={eq:(_field:string,value:string)=>{key=value;return q;},like:()=>q,order:()=>q,limit:async()=>({error:null,data:[{slate_date:"2026-10-20",source_checksum:trackingPayload.checksum,generated_at:lockedAt}]}),maybeSingle:async()=>({error:null,data:key.includes("settlement")?{payload}:key.endsWith("2026-10-20")?{payload:trackingPayload}:null})};return q;},upsert:async(value:{payload:unknown})=>{writes++;payload=value.payload;return{error:null};}};}} as unknown as Parameters<typeof settleNbaPlayerPropsTrackedSlates>[0]["client"];
  const state={games:[{gameId:1}],boxes:[officialBox]} as unknown as NbaPlayerPropsCurrentState;
  assert.equal(await hasNbaPropsUnsettledTrackedSlates(db,2026),true,"legacy incomplete dates remain discoverable on rest days");
  await assert.rejects(refreshNbaPlayerPropsPrivateCandidate({client:db,season:2026,slateDate:"2026-11-04",schedule:[],ballDontLieApiKey:"fixture",fullRefresh:true,now:"2026-11-04T10:00:00Z",fetchImpl:async(url)=>{assert.ok(String(url).includes("/games"),"a pending rest day fetches official stats, never market quotes");throw Error("pending_rest_day_stat_refresh");}}),/pending_rest_day_stat_refresh/);
  assert.equal(writes,0,"an official-stat failure on a rest day cannot publish a guessed outcome");
  const pending=await settleNbaPlayerPropsTrackedSlates({client:db,season:2026,slateDates:["2026-11-04"],state:{...state,games:[]},observedAt:"2026-11-04T10:00:00Z"});
  assert.equal(pending.written,false);assert.equal(writes,0,"a missing final game cannot produce a completion receipt or guessed outcome");
  const first=await settleNbaPlayerPropsTrackedSlates({client:db,season:2026,slateDates:["2026-11-04"],state,observedAt:"2026-11-04T11:00:00Z"});
  assert.deepEqual(first.catchupDates,["2026-10-20"]);assert.equal(first.added,1);
  const after=decodeNbaPlayerPropsPrivatePayload<{release:string;revisions:unknown[];slateReceipts:Record<string,{rows:number}>}>(payload,"tracking_history")!;
  assert.equal(after.release,NBA_PLAYER_PROPS_SETTLEMENT_RELEASE);assert.deepEqual(after.revisions[0],priorRevision,"all prior outcome revisions remain exact");
  assert.equal(after.slateReceipts["2026-10-20"].rows,1);
  const second=await settleNbaPlayerPropsTrackedSlates({client:db,season:2026,slateDates:["2026-11-04"],state,observedAt:"2026-11-04T12:00:00Z"});
  assert.deepEqual(second.catchupDates,[]);assert.equal(second.written,false);assert.equal(writes,1);
  assert.equal(await hasNbaPropsUnsettledTrackedSlates(db,2026),false);
  const offday=await refreshNbaPlayerPropsPrivateCandidate({client:db,season:2026,slateDate:"2026-11-04",schedule:[],ballDontLieApiKey:"fixture",fullRefresh:true,now:"2026-11-04T12:00:00Z",fetchImpl:async()=>{throw Error("completed rest day must not call providers");}});
  assert.equal(offday.status,"no_games");assert.equal(offday.providerRequests,0);assert.equal(writes,1);
  assert.equal(JSON.stringify(trackingPayload),trackingBytes,"settlement cannot change original locked tracking payload");
  console.log("NBA props settlement: bounded old-slate catch-up, checksum reopening, legacy precedence and idempotence passed.");
}
void testOldSlateCatchup();
