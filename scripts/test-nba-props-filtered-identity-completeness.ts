/** Finite explicit-ID response completeness. No HTTP, model, DB or paid calls. */
import assert from 'node:assert/strict';
import {validatedNbaFilteredPlayerResponse,validatedNbaPlayerRecords} from '../lib/services/nba/nbaPlayerPropsCurrentIdentityContract';
import {assertNoDeclaredContinuation} from '../lib/providers/playerPropsResponseCompleteness';
import {digest} from '../lib/playerPropsAi/evidence';
globalThis.fetch=async()=>{throw Error('Filtered identity test forbids real network');};
const player=(id:number)=>({id,first_name:'Synthetic',last_name:'Actor'+id,team:{id:id%2?1:2}});
let controls=0;
for(const n of [1,2,99,100])for(const reversed of [false,true])for(const cursor of [undefined,null,17]){
 const ids=Array.from({length:n},(_,i)=>String(i+1)),data=ids.map(Number).map(player);if(reversed)data.reverse();
 const body={data,meta:{per_page:100,...(cursor===undefined?{}:{next_cursor:cursor})}},original=digest(body);
 assert.deepEqual(validatedNbaFilteredPlayerResponse(body,ids),data);assert.equal(digest(body),original);controls+=2;
 if(cursor){assert.throws(()=>assertNoDeclaredContinuation(body,'Original generic boundary'));assert.equal(validatedNbaPlayerRecords(body,ids).length,n);controls+=2;}
}
const good={data:[player(1),player(2)],meta:{per_page:100,next_cursor:2}};
for(const change of [
 (b:typeof good)=>{b.data.pop();},(b:typeof good)=>{b.data.push(player(3));},
 (b:typeof good)=>{b.data[1]=player(1);},(b:typeof good)=>{b.data[1]=player(3);},
 (b:typeof good)=>{b.data[0].team.id=NaN;},
]){const bad=structuredClone(good);change(bad);assert.throws(()=>validatedNbaFilteredPlayerResponse(bad,['1','2']));controls++;}
for(const next_cursor of [0,-1,1.2,'2',false,{},[],NaN,Infinity]){
 assert.throws(()=>validatedNbaFilteredPlayerResponse({...good,meta:{per_page:100,next_cursor}},['1','2']));controls++;
}
for(const per_page of [0,1,101,-1,2.5,'100',null,false,{},[]]){
 assert.throws(()=>validatedNbaFilteredPlayerResponse({...good,meta:{per_page,next_cursor:2}},['1','2']));controls++;
}
for(const extra of [{has_more:true},{hasMore:true},{pagination:{}},{nextCursor:2}]){
 assert.throws(()=>validatedNbaFilteredPlayerResponse({...good,meta:{...good.meta,...extra}},['1','2']));controls++;
}
for(const extra of [{success:false},{next_cursor:2},{nextCursor:2},{pagination:{}},{has_more:true}]){
 assert.throws(()=>validatedNbaFilteredPlayerResponse({...good,...extra},['1','2']));controls++;
}
for(const meta of [false,'bad',[],17]){assert.throws(()=>validatedNbaFilteredPlayerResponse({...good,meta},['1','2']));controls++;}
for(const requested of [[],['1','1'],['0','2'],['01','2'],Array.from({length:101},(_,i)=>String(i+1))]){
 assert.throws(()=>validatedNbaFilteredPlayerResponse(good,requested));controls++;
}
// A cursor alone never donates missing current team authority: the original
// metadata shape and later exact-game source guard retain their own ownership.
const missingTeam={data:[{id:1,first_name:'Synthetic',last_name:'Actor1'}],meta:{per_page:100,next_cursor:1}};
assert.deepEqual(validatedNbaFilteredPlayerResponse(missingTeam,['1']),missingTeam.data);controls++;
console.log(JSON.stringify({controls,closedRequestedIdSet:true,noPagingOrRetries:true,originalResponseUnchanged:true,networkRequests:0}));
