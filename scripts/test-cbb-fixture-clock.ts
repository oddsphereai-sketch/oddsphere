import assert from "node:assert/strict";
import fs from "node:fs";
import {gunzipSync} from "node:zlib";
import {advanceCbbProvisionalSnapshot,CbbFixtureClockError} from "../lib/cbb/provisionalLifecycle";
import {cbbContextAtFixtureClock} from "../lib/services/cbb/cbbMarketBehaviorInputs";
import {writeCbbMemberGame,cbbMemberGameForReader,type CbbStoredMemberGame} from "../lib/services/cbb/cbbMemberGameStore";
import {cbbFixtureChronology} from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import {mergeCbbReaderEvidence} from "../lib/services/cbb/cbbReaderMarketEvidence";
import {cbbDailyEdgeResponse} from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import type {CbbGame} from "../lib/cbb/types";
const initial=JSON.parse(gunzipSync(fs.readFileSync(new URL("./fixtures/cbb-uiw-r20-member-20261105.json.gz",import.meta.url))).toString()) as CbbStoredMemberGame;
const source=JSON.parse(gunzipSync(fs.readFileSync(new URL("./fixtures/cbb-cross-division-20261105/forward-source.json.gz",import.meta.url))).toString());
const game={...(source.games as CbbGame[]).find(g=>g.id===initial.snapshot.gameId)!,date:"2026-11-06T00:00:00.000Z"};
let stored=structuredClone(initial),writes=0;
const db={from:()=>({select:()=>{const q={eq:()=>q,maybeSingle:async()=>({data:{payload:stored},error:null})};return q;},
 upsert:async(row:{payload:CbbStoredMemberGame})=>{stored=structuredClone(row.payload);writes++;return {error:null};}})} as unknown as NonNullable<Parameters<typeof writeCbbMemberGame>[1]>;
async function main(){
 const original=JSON.stringify(initial),snapshot=initial.snapshot,now="2026-11-05T16:50:00.000Z";
 assert.equal(cbbContextAtFixtureClock(snapshot,game.date),null);
 assert.equal(cbbContextAtFixtureClock(snapshot,"2026-11-05T18:00:00-05:00"),snapshot,"same instant is not a new epoch");
 assert.throws(()=>advanceCbbProvisionalSnapshot({existing:snapshot,candidate:null,startsAt:game.date,now}),CbbFixtureClockError);
 const candidate=structuredClone(snapshot.board);candidate.asOf=now;
 const renewed=await writeCbbMemberGame({game,candidate,homeLogo:null,awayLogo:null,now},db);
 assert.equal(renewed.record.snapshot.startsAt,game.date);assert.equal(renewed.record.snapshot.fixtureClockRevisions?.length,1);
 assert.equal(renewed.record.snapshot.fixtureClockRevisions?.[0].previousStartsAt,snapshot.startsAt);
 assert.equal(renewed.record.memberGame.gameTime,"7:00 PM");assert.equal(renewed.record.memberGame.gameStartMinutes,19*60);
 assert.equal(renewed.record.memberGame.scheduledLockAt,"2026-11-05T23:00:00.000Z");
 stored=structuredClone(initial);const beforeWrites=writes;
 await assert.rejects(writeCbbMemberGame({game:{...game,home_team:{...game.home_team,id:999}},candidate,homeLogo:null,awayLogo:null,now},db),/school identity/);
 assert.equal(writes,beforeWrites);
 // The valid decision predates the corrected cutoff; freeze it without a new forecast.
 stored=structuredClone(initial);
 const frozen=await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:"2026-11-05T23:00:00.000Z"},db);
 assert.deepEqual(frozen.record.snapshot.board,snapshot.board);
 for(const [key,value]of Object.entries(cbbFixtureChronology(game.date)))assert.equal((frozen.record.memberGame as unknown as Record<string,unknown>)[key],value);
 assert.deepEqual(frozen.record.memberGame.projected,initial.memberGame.projected);
 for(const key of ["moneyline","total","first_inning"] as const){
  const {lockedLineAmerican:oldPrice,lockedLineAt:oldAt,...oldMarket}=initial.memberGame.markets[key];void oldPrice;void oldAt;
  const {lockedLineAmerican:newPrice,lockedLineAt:newAt,...newMarket}=frozen.record.memberGame.markets[key];void newPrice;void newAt;
  assert.deepEqual(newMarket,oldMarket,"freezing the corrected clock keeps original decision and evidence exact");
 }
 // A thirty-minute change used to merge newly supplied historical chart rows
 // into the old saved decision before freezing. This eligible synthetic row
 // proves the merge would change the payload if the freeze bypass regresses.
 const halfHourGame={...game,date:"2026-11-05T23:30:00.000Z"},halfHourLock="2026-11-05T22:30:00.000Z";
 const history={release:"owls_book_display_history_2026_10_29_r1",sport:"cbb",fetchedAt:now,eventsAt:now,events:[],rows:[{
  event:game.id,start:snapshot.startsAt,away:initial.memberGame.awayTeam,home:initial.memberGame.homeTeam,kind:"spread",side:"home",book:"betmgm",
  providerEventId:"synthetic-clock-regression",checkedAt:now,opening:null,quotes:[[Date.parse("2026-11-05T15:00:00Z"),-120,-7.5]],observedQuotes:true,
 }]} as NonNullable<Parameters<typeof writeCbbMemberGame>[0]["bookHistory"]>;
 const wouldChange=mergeCbbReaderEvidence(cbbDailyEdgeResponse("2026-11-05",[initial.memberGame],now),history,[],Date.parse(halfHourLock));
 assert.notDeepEqual(wouldChange.games[0].markets.first_inning.lineTrail,initial.memberGame.markets.first_inning.lineTrail);
 stored=structuredClone(initial);
 const halfHour=await writeCbbMemberGame({game:halfHourGame,candidate:null,homeLogo:null,awayLogo:null,now:halfHourLock,bookHistory:history},db);
 assert.deepEqual(halfHour.record.memberGame.markets.first_inning.lineTrail,initial.memberGame.markets.first_inning.lineTrail);
 assert.deepEqual(halfHour.record.snapshot.board,snapshot.board);
 stored=structuredClone(frozen.record);
 const frozenBytes=JSON.stringify(stored);
 assert.equal((await writeCbbMemberGame({game:{...game,date:"2026-11-06T01:00:00.000Z"},candidate,homeLogo:null,awayLogo:null,now:"2026-11-06T02:00:00Z"},db)).written,false);
 assert.deepEqual(cbbMemberGameForReader(stored,{...game,date:"2026-11-06T01:00:00.000Z"}),frozen.record.memberGame);
 assert.equal(JSON.stringify(stored),frozenBytes);
 stored=structuredClone(initial);stored.snapshot.capturedAt="2026-11-05T23:01:00.000Z";
 await assert.rejects(writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:"2026-11-05T23:10:00.000Z"},db),CbbFixtureClockError);
 stored=structuredClone(initial);
 await assert.rejects(writeCbbMemberGame({game:{...game,date:"2026-11-05T16:00:00.000Z"},candidate:null,homeLogo:null,awayLogo:null,now},db),CbbFixtureClockError);
 assert.equal(JSON.stringify(initial),original);
 console.log("PASS actual UIW R20 clock correction: same-instant identity, fresh prelock revision, school guard, exact four-field chronology, prior-decision freeze, late-cutoff refusal and immutable locked precedence.");
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
