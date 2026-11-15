/** Actual parser/bindings and the same serialized handoff used by the MLB
 * writer. Publication is an explicit awaited local fixture, never real I/O. */
import assert from 'node:assert/strict';
import {digest} from '../lib/playerPropsAi/evidence';
import {testMlbPrelockHandoff,MlbPropsReviewAuthorityUnavailableError} from '../lib/playerPropsAi/mlbPrelockHandoff';
import {gzipSync} from 'node:zlib';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {readerCanonicalContextHash} from '../lib/playerPropsAi/readerContext';
import {readerAvailabilityContextHash} from '../lib/playerPropsAi/readerClaimFreshness';
import {packet,review,native,at,now,start,lock} from './test-player-props-ai-mlb-event-settlement';
import type {PlayerPropPreviewRow} from '../app/mlb/props/components/PlayerPropsDashboard';

globalThis.fetch=async()=>{throw Error('MLB handoff proof forbids HTTP');};
async function main(){
 const original=process.env.NODE_ENV;Object.assign(process.env,{NODE_ENV:'test'});
 try{
 let tick=at,active=0,maxActive=0,fail=false;
 const oldLock={...native,id:'immutable-old-lock',market:'batter_walks',projection:5,finalProbability:.123,playGrade:'LEAN',units:.25,lockStatus:{status:'locked',lockedAt:'2020-01-01T00:00:00Z'}} as PlayerPropPreviewRow;
 const oldBytes=digest(oldLock),writes:{rows:PlayerPropPreviewRow[];at:string}[]=[];
 const handoff=testMlbPrelockHandoff([native,oldLock],async rows=>{
  active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;
  if(fail)throw Error('synthetic_durable_write_failed');
  writes.push({rows,at:tick});
 },()=>tick);
 await handoff.observe(packet,null,true);assert.equal(writes.length,1);assert.equal(writes[0].rows[0].aiReview,undefined);
 tick=now;await Promise.all([handoff.observe(packet,review,true),handoff.observe(packet,review,true)]);
 assert.equal(maxActive,1);assert.equal(writes.length,2,'Identical completed/observed callbacks share one durable publication');
 const paid=writes[1].rows[0];assert(paid.aiReview);assert.equal(paid.finalProbability,.75);assert.equal(paid.playGrade,'BEST_ANGLE');assert.equal(paid.units,1);
 assert.equal(paid.aiReview.executionEvidence!.selectedQuote.offerContract,'milestone');
 const beforeAfterLock=digest(handoff.rows());tick=new Date(Date.parse(lock)+1).toISOString();
 await handoff.observe({...packet,cutoff:tick},review,true);
 assert.equal(writes.length,2,'No after-lock callback can backdate or reconstruct an earlier row');assert.equal(digest(handoff.rows()),beforeAfterLock);
 tick=new Date(Date.parse(now)+60000).toISOString();
 await handoff.observe({...packet,cutoff:tick,executionQuotes:[]},review,true);
 assert.equal(writes.length,3);assert.equal(handoff.rows()[0].playGrade,'NO_PLAY');assert.equal(handoff.rows()[0].units,0);assert.equal(handoff.rows()[0].aiReview,undefined,'Withdrawn current offers cannot lock an older AI action');
 tick=new Date(Date.parse(now)+120000).toISOString();
 await handoff.observe({...packet,cutoff:tick},review,true);
 assert.equal(handoff.rows()[0].playGrade,'BEST_ANGLE');assert.equal(handoff.rows()[0].units,1,'Returning exact executable event restores existing promotion qualification');
 const count=writes.length;
 await assert.rejects(handoff.observe({...packet,start:new Date(Date.parse(start)+60000).toISOString(),cutoff:tick},review,true),/fixture clock changed/);
 assert.equal(writes.length,count);
 await assert.rejects(handoff.observe({...packet,cutoff:tick},null,false),MlbPropsReviewAuthorityUnavailableError);
 assert.equal(writes.length,count,'Unknown review lookup cannot publish native withdrawal');
 assert.throws(()=>handoff.rows(),MlbPropsReviewAuthorityUnavailableError);
 await handoff.observe({...packet,cutoff:tick},review,true);
 assert(handoff.rows()[0].aiReview,'Known same-game callback recovers a read hold');
 fail=true;
 await assert.rejects(handoff.observe({...packet,cutoff:tick},null,true),/publication acknowledgement unavailable/);
 assert.throws(()=>handoff.rows(),/publication acknowledgement unavailable/,'An uncertain write fences the final generic board');
 fail=false;
 await assert.rejects(handoff.observe({...packet,cutoff:tick},null,false),/publication acknowledgement unavailable/,'A later callback cannot clear uncertain authority');
 assert.equal(writes.length,count,'No later same-invocation publication can reuse stale rows');
 assert.equal(digest(writes.at(-1)!.rows[1]),oldBytes,'Stored locked values remain unchanged');
 const lookupFallback=testMlbPrelockHandoff([native,oldLock],async()=>{},()=>tick);
 await assert.rejects(lookupFallback.observe({...packet,cutoff:tick},null,false),MlbPropsReviewAuthorityUnavailableError);
 assert.throws(()=>lookupFallback.rows(),MlbPropsReviewAuthorityUnavailableError,'No acknowledged authority cannot become native fallback');
 await lookupFallback.observe({...packet,cutoff:tick},null,true);
 assert.equal(lookupFallback.rows()[0].aiReview,undefined,'A verified empty inventory restores native construction');
 assert.equal(digest(lookupFallback.rows()[1]),oldBytes);
 assert.equal(digest(oldLock),oldBytes);
 // A missing review cannot reopen a current own-player lineup block through
 // native fallback. An explicit later posted return restores the same native
 // decision, with every conditional forecast and price field unchanged.
 const nativeLean={...native,playGrade:'LEAN' as const,units:1};
 const nativeFallback=testMlbPrelockHandoff([nativeLean,oldLock],async()=>{},()=>tick);
 const absent=structuredClone(packet);absent.cutoff=tick;
 absent.players[0].evidence.push({id:'actual-own-lineup',kind:'availability',source:'synthetic exact actor lineup',availableAt:tick,value:{canonicalGameId:packet.gameId,scheduledStart:packet.start,status:'not_in_lineup',battingOrder:null,asOfTimestamp:tick}});
 await nativeFallback.observe(absent,null,true);
 const blocked=nativeFallback.rows()[0];assert.equal(blocked.playGrade,'NO_PLAY');assert.equal(blocked.units,0);assert(blocked.reasonCodes.includes('SOURCE_PARTICIPATION_UNAVAILABLE_NATIVE_FALLBACK'));
 const numeric=(row:PlayerPropPreviewRow)=>[row.projection,row.finalProbability,row.modelProbability,row.overProbability,row.underProbability,row.line,row.side,row.odds,row.book,row.aiReview];
 assert.deepEqual(numeric(blocked),numeric(nativeLean),'Lineup qualification cannot rewrite the native conditional law or execution');
 assert.equal(digest(nativeFallback.rows()[1]),oldBytes);
 tick=new Date(Date.parse(tick)+1000).toISOString();const returned=structuredClone(absent);returned.cutoff=tick;
 returned.players[0].evidence.push({id:'actual-own-posted-return',kind:'availability',source:'synthetic exact actor lineup',availableAt:tick,value:{canonicalGameId:packet.gameId,scheduledStart:packet.start,status:'posted',battingOrder:3,asOfTimestamp:tick}});
 await nativeFallback.observe(returned,null,true);assert.equal(nativeFallback.rows()[0].playGrade,'LEAN');assert.equal(nativeFallback.rows()[0].units,1);assert.deepEqual(numeric(nativeFallback.rows()[0]),numeric(nativeLean));
 assert.equal(digest(nativeFallback.rows()[1]),oldBytes);
 // Two-game/restart controls: another game's old AI is never copied into a
 // fresh whole-board source without its own known current callback.
 const packetB=structuredClone(packet);packetB.gameId='balldontlie-game-2';packetB.sourceGameId=packetB.gameId;
 const reviewB=structuredClone(review);reviewB.gameId=reviewB.sourceGameId=packetB.gameId;reviewB.criticalContextHashes=criticalContextHashes(packetB);reviewB.inputHash=digest(packetB);
 const rawB=JSON.stringify(packetB);reviewB.inputEvidence={encoding:'gzip-base64',digest:digest(packetB),bytes:Buffer.byteLength(rawB),data:gzipSync(rawB).toString('base64')};
 for(const p of reviewB.players){p.sourceReadProofs!.originalCriticalContextHash=reviewB.criticalContextHashes[p.playerId];p.sourceReadProofs!.canonicalContextHash=readerCanonicalContextHash(packetB,p.playerId);p.sourceReadProofs!.availabilityContextHash=readerAvailabilityContextHash(packetB,p.playerId)!;}
 const nativeB={...structuredClone(native),id:'native-B',providerIds:{...native.providerIds!,gameId:packetB.gameId}} as PlayerPropPreviewRow;
 const priorB=testMlbPrelockHandoff([nativeB],async()=>{},()=>tick);await priorB.observe({...packetB,cutoff:tick},reviewB,true);const acknowledgedB=priorB.rows()[0],bBytes=digest(acknowledgedB);
 const partial:{rows:PlayerPropPreviewRow[];held:readonly string[]}[]=[];
 const two=testMlbPrelockHandoff([native,nativeB],async(rows,_game,state)=>{partial.push({rows,held:state.heldGameIds});},()=>tick,{slateDate:'2030-06-01',games:[{gameId:packet.gameId,start},{gameId:packetB.gameId,start}],previousSnapshot:{slateDate:'2030-06-01',snapshotId:'actual-previous-ack',asOfTimestamp:at,data:{props:[native,acknowledgedB]}}});
 await two.observe({...packet,cutoff:tick},review,true);assert.equal(partial.length,1);assert(partial[0].rows.some(row=>row.aiReview));assert(!partial[0].rows.some(row=>row.providerIds?.gameId===packetB.gameId),'Unobserved prior unlocked B cannot become fresh source under A header');assert.throws(()=>two.rows(),MlbPropsReviewAuthorityUnavailableError);assert.equal(digest(acknowledgedB),bBytes);
 await assert.rejects(two.observe({...packetB,cutoff:tick},null,false),MlbPropsReviewAuthorityUnavailableError);assert.equal(partial.length,1);
 await two.observe({...packetB,cutoff:tick},reviewB,true);assert(two.rows().find(row=>row.providerIds?.gameId===packetB.gameId)?.aiReview);assert.equal(two.rows().length,2);
 await assert.rejects(two.observe({...packet,cutoff:tick},null,false),MlbPropsReviewAuthorityUnavailableError);assert.throws(()=>two.rows(),MlbPropsReviewAuthorityUnavailableError);
 await two.observe({...packetB,cutoff:tick},null,true);assert(!partial.at(-1)!.rows.some(row=>row.providerIds?.gameId===packet.gameId),'Known B cannot refresh held A');
 await two.observe({...packet,cutoff:tick},review,true);assert.equal(two.rows().length,2);assert(two.rows().find(row=>row.providerIds?.gameId===packet.gameId)?.aiReview);
 const frozenB={...acknowledgedB,lockStatus:{status:'locked' as const,lockedAt:at}},frozenBytes=digest(frozenB),lockedWrites:PlayerPropPreviewRow[][]=[];
 const lockedOther=testMlbPrelockHandoff([native,nativeB],async rows=>{lockedWrites.push(rows);},()=>tick,{slateDate:'2030-06-01',games:[{gameId:packet.gameId,start},{gameId:packetB.gameId,start}],previousSnapshot:{slateDate:'2030-06-01',snapshotId:'locked-previous',asOfTimestamp:at,data:{props:[native,frozenB,frozenB]}}});
 await lockedOther.observe({...packet,cutoff:tick},review,true);assert.equal(lockedWrites[0].filter(row=>digest(row)===frozenBytes).length,2,'Original locked duplicates survive partial writes');assert.equal(lockedOther.rows().filter(row=>digest(row)===frozenBytes).length,2);
 const freshWrites:PlayerPropPreviewRow[][]=[];const fresh=testMlbPrelockHandoff([native,nativeB],async rows=>{freshWrites.push(rows);},()=>tick);assert.throws(()=>fresh.rows(),MlbPropsReviewAuthorityUnavailableError);await fresh.observe({...packet,cutoff:tick},review,true);assert.equal(freshWrites[0].length,1,'No prior ACK B remains unpublished while A completes');assert.throws(()=>fresh.rows(),MlbPropsReviewAuthorityUnavailableError);await fresh.observe({...packetB,cutoff:tick},null,true);assert.equal(fresh.rows().length,2,'Verified empty B permits its current native positive');fresh.holdSources([packetB.gameId]);assert.throws(()=>fresh.rows(),MlbPropsReviewAuthorityUnavailableError);await fresh.observe({...packetB,cutoff:tick},reviewB,true);assert(fresh.rows().find(row=>row.providerIds?.gameId===packetB.gameId)?.aiReview);
 assert.throws(()=>testMlbPrelockHandoff([native],async()=>{},()=>tick,{slateDate:'2030-06-01',games:[{gameId:packet.gameId,start}],previousSnapshot:{slateDate:'2030-05-31',snapshotId:'foreign',asOfTimestamp:at,data:{props:[native]}}}),MlbPropsReviewAuthorityUnavailableError);
 console.log('MLB unknown-authority controls passed: no native withdrawal, same-game read recovery, sticky uncertain writes, two-game partial source omission, known positive return, same-day ACK restart and exact duplicate locked rows.');
 console.log('MLB native participation impact: two retained rows; actionable1→0 for explicit absence,0→1 after posted return; exact conditional numbers/prices and stored lock.');
 console.log('MLB handoff boundary passed: awaited serialized actual-ready publication, duplicate observation collapse, exact milestone execution, withdrawal/return recovery, write-failure honesty, lookup fallback, clock refusal and immutable locks. No HTTP/DB/paid calls.');
 }finally{if(original===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Object.assign(process.env,{NODE_ENV:original});}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
