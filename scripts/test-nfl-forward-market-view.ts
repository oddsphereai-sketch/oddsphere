/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic immutable lazy source boundaries. */
import assert from 'node:assert/strict';
import {nflForwardMarketView} from '../lib/services/football/nflForwardMarketView';
import {digest} from '../lib/playerPropsAi/evidence';
globalThis.fetch=async()=>{throw Error('NETWORK BLOCKED');};
let reads=0,other=0;
const row=(id:string,game:string,value:any)=>({id,providerGameId:game,payload:Object.defineProperties({}, {
 market:{enumerable:true,get(){reads++;return structuredClone(value);}},
 contextualEvidenceCapture:{enumerable:true,get(){other++;return {exact:id};}},
 fixed:{enumerable:true,value:'original'},
})}) as any;
const a=row('a','one',{current:[1,2],opening:null}),b=row('b','one',{current:[3]}),c=row('c','two',{current:[4]});
const original=[a,b,c],view=nflForwardMarketView(original);
assert.notEqual(view,original);assert.notEqual(view[0],a);assert.equal(reads,0);assert.equal(other,0);
const v=view[0].payload.market;assert.deepEqual(v,a.payload.market);const count=reads;
assert.equal(view[0].payload.market,v);assert.equal(reads,count);
assert.deepEqual(view[0].payload.contextualEvidenceCapture,{exact:'a'});assert.equal(other,1);
assert.equal((view[0].payload as any).fixed,'original');assert.deepEqual(Object.keys(view[0].payload),Object.keys(a.payload));
assert.deepEqual(view[1].payload.market,{current:[3]});assert.deepEqual(view[2].payload.market,{current:[4]});
const afterGame=reads;assert.deepEqual(view[0].payload.market,v);assert.equal(reads,afterGame+1);
assert.equal(digest(JSON.parse(JSON.stringify(view))),digest(JSON.parse(JSON.stringify(original))));
// A view is request-local; object identity prevents duplicate row IDs or games
// from borrowing another original payload's market.
const duplicate=row('a','one',{different:true}),dups=nflForwardMarketView([a,duplicate]);
assert.deepEqual(dups[0].payload.market,{current:[1,2],opening:null});assert.deepEqual(dups[1].payload.market,{different:true});
const another=nflForwardMarketView([a]);const beforeNew=reads;void another[0].payload.market;assert.equal(reads,beforeNew+1);
const oversized=nflForwardMarketView([a],1),beforeOversized=reads;void oversized[0].payload.market;void oversized[0].payload.market;assert.equal(reads,beforeOversized+2);
const oneBytes=Buffer.byteLength(JSON.stringify(a.payload.market)),lru=nflForwardMarketView([a,b],oneBytes),beforeLru=reads;
void lru[0].payload.market;void lru[1].payload.market;void lru[0].payload.market;assert.equal(reads,beforeLru+3);
const hot:any={id:'hot',providerGameId:'one',payload:{market:{yes:1}}};assert.equal(nflForwardMarketView([hot])[0],hot);
const fail:any={id:'bad',providerGameId:'one',payload:Object.defineProperty({},'market',{get(){throw Error('original checksum/decode failure');},enumerable:true})};
assert.throws(()=>nflForwardMarketView([fail])[0].payload.market,/original checksum/);
for(const invalid of [-1,NaN,Infinity,1.5])assert.throws(()=>nflForwardMarketView([],invalid));
assert.equal(nflForwardMarketView([],0).length,0);
console.log('PASS NFL market view: lazy exact values/other fields, no cross-game/request/identity reuse, bounded oversize/LRU, original failure propagation');
