import assert from 'node:assert/strict';
import {propsAiWorkAdmission} from '../lib/playerPropsAi/workAdmission';

const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
async function main(){
 const work=propsAiWorkAdmission(16),gates=Array.from({length:16},deferred),events:string[]=[];
 let counts=0,reserved=0,peak=0;
 const running=gates.map((g,i)=>work.count(async()=>{counts++;peak=Math.max(peak,counts+reserved);events.push(`count${i}`);await g.promise;counts--;return i;}));
 await flush();assert.equal(counts,16);
 const first=work.game(8).then(release=>{reserved+=8;events.push('game8');let done=false;return()=>{if(done)return;done=true;reserved-=8;release();};});
 let secondReady=false;const second=work.game(1).then(release=>{reserved++;secondReady=true;events.push('game1');let done=false;return()=>{if(done)return;done=true;reserved--;release();};});
 let lateStarted=false;const late=work.count(async()=>{counts++;lateStarted=true;peak=Math.max(peak,counts+reserved);counts--;return 99;});
 for(let i=0;i<7;i++)gates[i].resolve();await flush();assert(!secondReady&&!lateStarted,'FIFO whole-game head cannot be bypassed by small work');
 gates[7].resolve();const releaseFirst=await first;await flush();assert(!secondReady&&!lateStarted);assert.equal(counts+reserved,16);
 gates[8].resolve();const releaseSecond=await second;await flush();assert(!lateStarted);assert.equal(counts+reserved,16);
 releaseFirst();await flush();assert(lateStarted,'Count resumes from freed capacity without waiting for unrelated game');await late;
 releaseFirst();releaseSecond();for(const g of gates)g.resolve();assert.deepEqual(await Promise.all(running),Array.from({length:16},(_,i)=>i));assert.equal(counts+reserved,0);assert(peak<=16);
 const all=await work.game(16);let starts=0;const blocked=work.count(async()=>{starts++;throw Error('synthetic');});await flush();assert.equal(starts,0);all();await assert.rejects(blocked,/synthetic/);const again=await work.game(16);again();again();
 for(const value of [0,17,1.5,NaN])await assert.rejects(work.game(value));for(const value of [0,17,1.5])assert.throws(()=>propsAiWorkAdmission(value));
 const small=propsAiWorkAdmission(2);await assert.rejects(small.game(3));
 assert(events.indexOf('game8')<events.indexOf('game1'));console.log('Work admission PASS: FIFO ready-game priority, exact shared16 count/reserved-generation capacity, count resumption, exceptions, idempotent release and invalid bounds; pure offline, no IO.');
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
