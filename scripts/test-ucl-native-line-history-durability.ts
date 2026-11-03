import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {DailyEdgeResponse} from '../app/lab/lib/labTypes';
import type {EplStoredPriceObservation} from '../lib/services/epl/buildEplDailyEdgePreview';
import {readEplStoredPriceHistory} from '../lib/services/epl/eplLineHistoryStore';
import {persistUclLineHistory,readUclStoredPriceHistory} from '../lib/services/ucl/uclLineHistoryStore';
import {UCL_EXTERNAL_ID_OFFSET} from '../lib/services/ucl/uclCompetitionContext';

export async function testUclNativeLineHistoryDurability(){
 const providerId=4243833;
 const response={games:[{external_id:providerId,markets:{moneyline:{},total:{},first_inning:{}}}]} as unknown as DailyEdgeResponse;
 const pair=(line:number,time:string):EplStoredPriceObservation[]=>['over','under'].map(side=>({providerId,market:'total',side,line,american:side==='over'?(line===2.5?-150:120):(line===2.5?130:-140),sportsbook:'pinnacle',recordedAt:time,isOpener:false}));
 for(const reverse of [false,true]){
  const stored:Record<string,unknown>[]=[];const updateFilters:Array<Array<[string,unknown]>>=[];
  const client={from(table:string){
   let op='select',values:Record<string,unknown>|Record<string,unknown>[]|null=null,lower=0,upper=999999;
   const filters:Array<[string,(value:unknown)=>boolean]>=[],eqs:Array<[string,unknown]>=[];
   const q={select(_fields:string){return q;},eq(key:string,value:unknown){filters.push([key,current=>current===value]);eqs.push([key,value]);return q;},
    is(key:string,value:unknown){return q.eq(key,value);},in(key:string,list:unknown[]){filters.push([key,value=>list.includes(value)]);return q;},
    order(_key:string,_options:unknown){return q;},range(from:number,to:number){lower=from;upper=to;return q;},
    update(value:Record<string,unknown>){op='update';values=value;return q;},insert(value:Record<string,unknown>[]){op='insert';values=value;return q;},
    then(resolve:(value:unknown)=>void,reject?:(error:unknown)=>void){try{
     if(op==='insert'){stored.push(...structuredClone(values as Record<string,unknown>[]));return Promise.resolve({data:null,error:null}).then(resolve,reject);}
     const all=table==='games'?[{id:900,external_id:UCL_EXTERNAL_ID_OFFSET+providerId,sport:'soccer'}]:stored;
     const rows=all.filter(row=>filters.every(([key,predicate])=>predicate(row[key])));
     if(op==='update'){updateFilters.push(eqs);for(const row of rows)Object.assign(row,values);}
     return Promise.resolve({data:op==='select'?structuredClone(rows.slice(lower,upper+1)):null,error:null}).then(resolve,reject);
    }catch(error){return Promise.reject(error).then(resolve,reject);}}
   };return q;
  }} as unknown as SupabaseClient;
  const first=[...pair(2.5,'2026-11-03T10:00:00Z'),...pair(3.5,'2026-11-03T10:00:00Z')];if(reverse)first.reverse();
  assert.equal((await persistUclLineHistory({response,allBookPrices:first,apply:true,client})).written,4);
  const read=await readUclStoredPriceHistory([providerId],{client});
  assert.equal(read.length,4,'read after actual persistence retains both contracts at the same clock');
  assert.deepEqual(new Set(read.map(row=>`${row.line}:${row.side}:${row.recordedAt}:${row.american}`)),new Set(first.map(row=>`${row.line}:${row.side}:${row.recordedAt}:${row.american}`)));
  assert.equal((await persistUclLineHistory({response,allBookPrices:[...first].reverse(),apply:true,client})).written,0,'second pass must not reinsert a contract discarded by compaction');
  const oldDefault=await readEplStoredPriceHistory([providerId],UCL_EXTERNAL_ID_OFFSET,'EPL-default',{client});
  assert.equal(oldDefault.length,2,'EPL default compaction remains unchanged');
  const second=[...pair(2.5,'2026-11-03T10:01:00Z'),...pair(3.5,'2026-11-03T10:01:00Z')];if(!reverse)second.reverse();
  assert.equal((await persistUclLineHistory({response,allBookPrices:second,apply:true,client})).written,4,'each contract receives its own flat-quote verification capture');
  assert.equal((await readUclStoredPriceHistory([providerId],{client})).length,8);
  assert.equal((await persistUclLineHistory({response,allBookPrices:[...pair(2.5,'2026-11-03T10:02:00Z'),...pair(3.5,'2026-11-03T10:02:00Z')],apply:true,client})).written,0,'unchanged terminal polling remains bounded per contract');
  await persistUclLineHistory({response,allBookPrices:pair(2.5,'2026-11-03T09:00:00Z'),apply:true,client});
  assert.ok(updateFilters.every(filters=>filters.some(([key])=>key==='line_value')),'UCL opener repair is scoped to the exact total contract');
  assert.ok(stored.filter(row=>row.line_value===3.5&&row.recorded_at==='2026-11-03T10:00:00Z').every(row=>row.is_opener===true),'earlier2.5 discovery never removes3.5 opening authority');
 }
 console.log('PASS UCL native journal: persisted/read same-clock2.5+3.5 in both row orders, exact values/clocks, repeat-write idempotence, per-contract flat verification/opener scope; EPL default unchanged.');
}
