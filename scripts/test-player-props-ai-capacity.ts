import {isMissedPropsEarlyWindow} from "../lib/playerPropsAi/schedule";
/** Pure offline proofs: no database, providers, model calls or paid requests. */
import assert from "node:assert/strict";
import {encodeNbaPlayerPropsPrivatePayload,decodeNbaPlayerPropsPrivatePayload} from "../lib/services/nba/nbaPlayerPropsPrivateStore";
import { parsePropsAiCoverage, stringifyPropsAiCoverage } from "../lib/playerPropsAi/coverageCodec";
import { propsAiCompletionWindowMs, propsAiGenerationPool } from "../lib/playerPropsAi/completionWindow";
import { runPropsReview } from "../lib/playerPropsAi/reviewer";
import type { GamePacket } from "../lib/playerPropsAi/evidenceContract";
import type { PropsAiJob } from "../lib/playerPropsAi/budget";

async function main() {
 const coverage={recent_form:{status:"available",facts:Array.from({length:100},(_,i)=>({id:`fact-${i}`,hash:`hash-${i}`,label:"Retained exact supplied evidence. ".repeat(15),availableAt:"2026-11-08T14:00:00Z",sourceIds:["source"]})),effect:"supports",observation:"Exact source conclusion."}};
 const rows=Array.from({length:800},(_,i)=>({id:i,state:i%2?"locked":"unlocked",projection:17.2841,probability:.578318,side:"over",grade:"Lean",price:-113,aiReview:{release:"retained-r15",reviewId:"same-player-review",coverage:structuredClone(coverage)}}));
 const original=JSON.stringify(rows),wire=stringifyPropsAiCoverage(rows);
 assert.ok(Buffer.byteLength(original)>32_000_000,"fixture exceeds the production canonical ceiling without interning");
 assert.ok(Buffer.byteLength(wire)<500_000,"all evidence remains stored once within the existing bound");
 assert.equal(JSON.stringify(parsePropsAiCoverage(wire)),original,"all locked/unlocked evidence, numeric fields and ordering round-trip exactly");
 assert.equal(JSON.stringify(rows),original,"encoding never changes the original rows");
 const nba=encodeNbaPlayerPropsPrivatePayload({decisions:rows},"candidate_snapshot");
 assert.deepEqual(decodeNbaPlayerPropsPrivatePayload(nba,"candidate_snapshot"),{decisions:rows},"NBA candidate storage retains every exact locked/unlocked source value");
 assert.equal(stringifyPropsAiCoverage({legacy:{projection:12.345,locked:true}}),JSON.stringify({legacy:{projection:12.345,locked:true}}));
 assert.deepEqual(parsePropsAiCoverage('{"legacy":true}'),{legacy:true});
 assert.throws(()=>parsePropsAiCoverage('{"format":"props_ai_coverage_table_v1","coverages":[],"payload":{"aiReview":{"coverage":{"$propsAiCoverage":0}}}}'),/Invalid AI coverage reference/);
 const inline={aiReview:{coverage:{...coverage,$propsAiCoverage:99}}};
 assert.deepEqual(parsePropsAiCoverage(JSON.stringify({format:"props_ai_coverage_table_v1",coverages:[],payload:inline})),inline,"inline stored evidence takes precedence over a reference-like extra field");
 assert.equal(propsAiCompletionWindowMs(5),120_000);assert.equal(propsAiCompletionWindowMs(16),210_000);
 const slot=propsAiGenerationPool(16);let active=0,peak=0,completed=0;
 await Promise.all(Array.from({length:16},()=>Promise.all(Array.from({length:5},()=>slot(async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;completed++;})))));
 assert.equal(peak,16);assert.equal(completed,80);assert.equal(active,0);
 const now="2026-11-08T14:00:00Z",start="2026-11-08T18:00:00Z",lock="2026-11-08T17:00:00Z";
 const packet={sport:"nfl",gameId:"synthetic",start,lock,cutoff:now,stage:"early",players:[],quotes:[]} as unknown as GamePacket;
 const job={job_key:"synthetic",game_id:"synthetic",sport:"nfl",scheduled_start:start,lock_at:lock,game_day:"2026-11-08",stage:"early",state:"pending"} as PropsAiJob;
 let claims=0;const store={claim:async()=>{claims++;return {claimed:false,reason:"synthetic_stop"};}} as never;
 const args={packet,job,store,key:"synthetic",writerRunId:"synthetic-owner",preferStronger:false,clock:()=>now,prepare:async()=>[{packet,inputTokens:1}]};
 const late=await runPropsReview({...args,deadline:Date.now()+40_000});
 assert.equal(late.status,"skipped");assert.equal("reason" in late&&late.reason,"insufficient_completion_window");assert.equal(claims,0,"no money claimed or requests sent for the actual late-batch regression");
 await runPropsReview({...args,deadline:Date.now()+180_000});assert.equal(claims,1,"a funded full completion window remains eligible");
 assert.equal(isMissedPropsEarlyWindow('early',lock,'2026-11-08T16:34:59.999Z'),false);
 assert.equal(isMissedPropsEarlyWindow('early',lock,'2026-11-08T16:35:00Z'),true);
 assert.equal(isMissedPropsEarlyWindow('final',lock,'2026-11-08T16:35:00Z'),false);
 let prepared=0;
 const closed=await runPropsReview({...args,clock:()=>"2026-11-08T16:36:00Z",prepare:async()=>{prepared++;throw Error('closed early slot must not prepare or count tokens');}});
 assert.equal(closed.status,'skipped');assert.equal('reason' in closed&&closed.reason,'early_window_closed_final_only');assert.equal(prepared,0);assert.equal(claims,1);
 let movingClock=now;
 const crossed=await runPropsReview({...args,deadline:Date.now()+180_000,clock:()=>movingClock,prepare:async()=>{movingClock='2026-11-08T16:35:00Z';return [{packet,inputTokens:1}];}});
 assert.equal(crossed.status,'skipped');assert.equal('reason' in crossed&&crossed.reason,'early_window_closed_final_only');assert.equal(claims,1,'window is checked again before any money is claimed');
 console.log("AI capacity proof passed: >32 MB exact evidence round-trip, immutable locks/inline precedence, bounded 16-game/80-part dispatch, and late work deferred before any claim. No network calls.");
}
void main();
