/** Actual parser/bindings and the same serialized handoff used by the MLB
 * writer. Publication is an explicit awaited local fixture, never real I/O. */
import assert from 'node:assert/strict';
import {digest} from '../lib/playerPropsAi/evidence';
import {testMlbPrelockHandoff} from '../lib/playerPropsAi/mlbPrelockHandoff';
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
 const success=digest(handoff.rows());fail=true;
 await assert.rejects(handoff.observe({...packet,cutoff:tick},null,false),/synthetic_durable_write_failed/);
 assert.equal(digest(handoff.rows()),success,'Failed publication cannot be labeled durable or replace its predecessor');
 fail=false;await handoff.observe({...packet,cutoff:tick},null,false);
 assert.equal(handoff.rows()[0].aiReview,undefined,'Lookup failure restores the actual independent construction');
 assert.equal(digest(handoff.rows()[1]),oldBytes,'Stored locked values win before new metadata or pricing checks');
 const count=writes.length;
 await assert.rejects(handoff.observe({...packet,start:new Date(Date.parse(start)+60000).toISOString(),cutoff:tick},review,true),/fixture clock changed/);
 assert.equal(writes.length,count);
 assert.equal(digest(oldLock),oldBytes);
 // A missing review cannot reopen a current own-player lineup block through
 // native fallback. An explicit later posted return restores the same native
 // decision, with every conditional forecast and price field unchanged.
 const nativeLean={...native,playGrade:'LEAN' as const,units:1};
 const nativeFallback=testMlbPrelockHandoff([nativeLean,oldLock],async()=>{},()=>tick);
 const absent=structuredClone(packet);absent.cutoff=tick;
 absent.players[0].evidence.push({id:'actual-own-lineup',kind:'availability',source:'synthetic exact actor lineup',availableAt:tick,value:{canonicalGameId:packet.gameId,scheduledStart:packet.start,status:'not_in_lineup',battingOrder:null,asOfTimestamp:tick}});
 await nativeFallback.observe(absent,null,false);
 const blocked=nativeFallback.rows()[0];assert.equal(blocked.playGrade,'NO_PLAY');assert.equal(blocked.units,0);assert(blocked.reasonCodes.includes('SOURCE_PARTICIPATION_UNAVAILABLE_NATIVE_FALLBACK'));
 const numeric=(row:PlayerPropPreviewRow)=>[row.projection,row.finalProbability,row.modelProbability,row.overProbability,row.underProbability,row.line,row.side,row.odds,row.book,row.aiReview];
 assert.deepEqual(numeric(blocked),numeric(nativeLean),'Lineup qualification cannot rewrite the native conditional law or execution');
 assert.equal(digest(nativeFallback.rows()[1]),oldBytes);
 tick=new Date(Date.parse(tick)+1000).toISOString();const returned=structuredClone(absent);returned.cutoff=tick;
 returned.players[0].evidence.push({id:'actual-own-posted-return',kind:'availability',source:'synthetic exact actor lineup',availableAt:tick,value:{canonicalGameId:packet.gameId,scheduledStart:packet.start,status:'posted',battingOrder:3,asOfTimestamp:tick}});
 await nativeFallback.observe(returned,null,true);assert.equal(nativeFallback.rows()[0].playGrade,'LEAN');assert.equal(nativeFallback.rows()[0].units,1);assert.deepEqual(numeric(nativeFallback.rows()[0]),numeric(nativeLean));
 assert.equal(digest(nativeFallback.rows()[1]),oldBytes);
 console.log('MLB native participation impact: two retained rows; actionable1→0 for explicit absence,0→1 after posted return; exact conditional numbers/prices and stored lock.');
 console.log('MLB handoff boundary passed: awaited serialized actual-ready publication, duplicate observation collapse, exact milestone execution, withdrawal/return recovery, write-failure honesty, lookup fallback, clock refusal and immutable locks. No HTTP/DB/paid calls.');
 }finally{if(original===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Object.assign(process.env,{NODE_ENV:original});}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
