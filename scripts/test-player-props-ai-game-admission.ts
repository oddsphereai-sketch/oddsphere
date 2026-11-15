/** Pure gate proof. Actual deadline/reviewer integration has separate controls. */
import assert from 'node:assert/strict';
import {propsAiGameAdmission} from '../lib/playerPropsAi/gameAdmission';
globalThis.fetch=async()=>{throw Error('Whole-game admission proof forbids network');};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
async function main(){
 const gate=propsAiGameAdmission(16),first=await gate(8);
 let fullGranted=false,laterGranted=false;
 const pendingFull=gate(16).then(release=>{fullGranted=true;return release;});
 const pendingLater=gate(1).then(release=>{laterGranted=true;return release;});
 await flush();assert(!fullGranted&&!laterGranted,'A queued whole game cannot be bypassed');
 first();const releaseFull=await pendingFull;await flush();assert(fullGranted&&!laterGranted);
 first();await flush();assert(!laterGranted,'Repeated release cannot create capacity');
 releaseFull();const releaseLater=await pendingLater;assert(laterGranted);
 releaseFull();releaseLater();releaseLater();
 const nine=await gate(9);let eightGranted=false;
 const pendingEight=gate(8).then(release=>{eightGranted=true;return release;});
 await flush();assert(!eightGranted,'Nine-part game reserves nine actual units, not eight');
 nine();const releaseEight=await pendingEight;releaseEight();

 // Preserve useful parallelism: five3-part games fit while a sixth waits.
 const small=propsAiGameAdmission(),held=[];
 for(let i=0;i<5;i++)held.push(await small(3));
 let sixth=false;const pending=small(3).then(release=>{sixth=true;return release;});
 await flush();assert(!sixth);held[0]();const sixthRelease=await pending;assert(sixth);
 for(const release of held)release();sixthRelease();

 // A small later arrival must not consume the only free unit in front of a
 // queued eight-unit game. Queue order stays stable under mixed part counts.
 const fifo=propsAiGameAdmission(),eight=await fifo(8),seven=await fifo(7),order:string[]=[];
 const big=fifo(8).then(release=>{order.push('big');return release;});
 const little=fifo(1).then(release=>{order.push('little');return release;});
 await flush();assert.deepEqual(order,[]);seven();const bigRelease=await big;await flush();assert.deepEqual(order,['big']);
 eight();const littleRelease=await little;assert.deepEqual(order,['big','little']);bigRelease();littleRelease();

 // Event-loop-only stress proves accounting/draining, not wall-clock capacity.
 const stress=propsAiGameAdmission();let active=0,peak=0,completed=0;
 await Promise.all(Array.from({length:40},(_,i)=>(async()=>{
  const parts=1+i%16,weight=Math.min(parts,16),release=await stress(parts);active+=weight;peak=Math.max(peak,active);assert(active<=16);
  try{await new Promise<void>(resolve=>setImmediate(resolve));completed++;}finally{active-=weight;release();}
 })()));
 assert.equal(completed,40);assert.equal(active,0);assert(peak<=16);
 for(const value of [0,17,1.5,NaN])assert.throws(()=>propsAiGameAdmission(value),/capacity/);
 for(const value of [0,17,1.5,NaN])await assert.rejects(gate(value),/part count/);
 await assert.rejects(propsAiGameAdmission(4)(5),/weight exceeds capacity/);
 console.log('Whole-game admission gate passed: FIFO weighted16 accounting, min(parts,16), five3-part parallel games, no bypass and idempotent release. No funding/HTTP/DB/time simulation; actual reviewer terminal/deadline proof is separate.');
}
void main();
