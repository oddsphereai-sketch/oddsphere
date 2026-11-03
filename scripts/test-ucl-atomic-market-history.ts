import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {DailyEdgeResponse} from '../app/lab/lib/labTypes';
import type {EplStoredPriceObservation} from '../lib/services/epl/buildEplDailyEdgePreview';
import {compactEplLineHistory,persistEplLineHistory,readEplStoredPriceHistory} from '../lib/services/epl/eplLineHistoryStore';
import {persistUclLineHistory,readUclStoredPriceHistory} from '../lib/services/ucl/uclLineHistoryStore';
import {UCL_EXTERNAL_ID_OFFSET} from '../lib/services/ucl/uclCompetitionContext';
import {applyUclStoredQuoteFallback} from '../lib/services/ucl/uclStoredQuoteFallback';
import {__TEST__} from '../lib/providers/real_api/CurrentSoccerMarketProvider';

const providerId=4243833,gameId=910;
function database(){
 const stored:Record<string,unknown>[]=[];
 const client={from(table:string){let op='select',data:Record<string,unknown>|Record<string,unknown>[]|null=null,from=0,to=999999;
  const predicates:Array<(r:Record<string,unknown>)=>boolean>=[];
  const q={select(_fields:string){return q;},eq(key:string,value:unknown){predicates.push(r=>r[key]===value);return q;},is(key:string,value:unknown){return q.eq(key,value);},
   in(key:string,values:unknown[]){predicates.push(r=>values.includes(r[key]));return q;},order(_key:string,_options:unknown){return q;},range(a:number,b:number){from=a;to=b;return q;},
   update(value:Record<string,unknown>){op='update';data=value;return q;},insert(value:Record<string,unknown>[]){op='insert';data=value;return q;},
   then(resolve:(v:unknown)=>void,reject?:(e:unknown)=>void){try{if(op==='insert'){stored.push(...structuredClone(data as Record<string,unknown>[]));return Promise.resolve({data:null,error:null}).then(resolve,reject);}
    const rows=(table==='games'?[{id:gameId,external_id:UCL_EXTERNAL_ID_OFFSET+providerId,sport:'soccer'}]:stored).filter(r=>predicates.every(p=>p(r)));
    if(op==='update')rows.forEach(r=>Object.assign(r,data));return Promise.resolve({data:op==='select'?structuredClone(rows.slice(from,to+1)):null,error:null}).then(resolve,reject);
   }catch(error){return Promise.reject(error).then(resolve,reject);}}
  };return q;
 }} as unknown as SupabaseClient;
 return{stored,client};
}
const response={games:[{external_id:providerId,markets:{moneyline:{},total:{},first_inning:{}},soccerDoubleChanceMarket:{}}]} as unknown as DailyEdgeResponse;
const sides={match_result:['home','draw','away'],double_chance:['home_or_draw','away_or_draw','home_or_away'],total:['over','under'],btts:['yes','no']} as const;
function capture(time:string,step:number):EplStoredPriceObservation[]{return(Object.keys(sides) as Array<keyof typeof sides>).flatMap(market=>
 (market==='total'?[2.5,3.5]:[null]).flatMap(line=>sides[market].map((side,index)=>({providerId,market,side,line,sportsbook:'pinnacle',recordedAt:time,isOpener:false,
  american:index===0? -200+step*10 : index===1?150:300}))));}
function fallback(history:EplStoredPriceObservation[],now='2026-11-03T17:27:00Z'){
 return applyUclStoredQuoteFallback({providerId,history,kickoff:'2026-11-03T20:00:00Z',now:new Date(now),fixture:{eventId:null,odds:[],splits:[],splitsState:'unavailable'}});
}
export async function testUclAtomicMarketHistory(){
 for(const reverse of[false,true]){
  const {client,stored}=database();const clocks=['2026-11-03T17:10:00Z','2026-11-03T17:15:00Z','2026-11-03T17:20:00Z','2026-11-03T17:25:00Z'];
  for(let i=0;i<clocks.length;i++){
   // A→B→C changes only the first side; D is a fully unchanged real capture.
   const rows=capture(clocks[i]!,Math.min(i,2));if(reverse)rows.reverse();
   const result=await persistUclLineHistory({response,allBookPrices:rows,apply:true,client});assert.equal(result.written,12,'all source sides survive at each actual capture clock');
  }
  const history=await readUclStoredPriceHistory([providerId],{client});assert.equal(history.length,48);
  assert.equal(compactEplLineHistory(history,{atomicMarketCaptures:true}).length,48,'read compaction never drops an unchanged opposite side');
  for(const clock of clocks)assert.equal(history.filter(r=>r.recordedAt===clock).length,12);
  assert.equal((await persistUclLineHistory({response,allBookPrices:capture(clocks[3]!,2).reverse(),apply:true,client})).written,0,'same original capture is idempotent');
  const recovered=fallback(history);
  for(const market of Object.keys(sides) as Array<keyof typeof sides>){const rows=recovered.odds.filter(r=>r.market===market);
   assert.equal(rows.length,sides[market].length);assert.ok(rows.every(r=>r.fetched_at===clocks[3]));
   assert.equal(rows.find(r=>r.selection===sides[market][0])?.odds_american,-180);
   const shared=__TEST__.freshStoredRows({history,providerId,market,kickoff:'2026-11-03T20:00:00Z',nowMs:Date.parse('2026-11-03T17:27:00Z'),intactFamilies:true});
   assert.equal(shared.length,sides[market].length);assert.ok(shared.every(r=>Date.parse(r.fetched_at)===Date.parse(clocks[3]!)));
  }
  assert.ok(recovered.odds.filter(r=>r.market==='total').every(r=>r.line===2.5),'native3.5 history never becomes an offered2.5 quote');
  const partial={...capture('2026-11-03T17:26:00Z',3).find(r=>r.market==='btts'&&r.side==='yes')!};
  assert.equal((await persistUclLineHistory({response,allBookPrices:[partial],apply:true,client})).written,1);
  const withPartial=await readUclStoredPriceHistory([providerId],{client});
  assert.ok(fallback(withPartial).odds.filter(r=>r.market==='btts').every(r=>r.fetched_at===clocks[3]),'a later partial capture cannot borrow its opposite');
  await persistUclLineHistory({response,allBookPrices:[{...partial,recordedAt:'2026-11-03T17:57:00Z'}],apply:true,client});
  assert.equal(fallback(await readUclStoredPriceHistory([providerId],{client}),'2026-11-03T17:58:00Z').odds.length,0,'a fresh partial cannot borrow an opposite from a stale complete capture or restamp it');
  const legacyDefault=await readEplStoredPriceHistory([providerId],UCL_EXTERNAL_ID_OFFSET,'legacy-EPL',{client});assert.ok(legacyDefault.length<history.length,'EPL default still uses legacy per-side compaction');
  assert.ok(stored.filter(r=>r.recorded_at===clocks[3]).every(r=>r.is_opener===false),'actual current capture flags preserved on flat sides');
 }
 // Genuine partial legacy records stay partial. A later complete actual source
 // can establish availability without relabeling the original historical side.
 const {client,stored}=database();
 const yes={...capture('2026-11-03T17:10:00Z',0).find(r=>r.market==='btts'&&r.side==='yes')!,isOpener:true};
 await persistUclLineHistory({response,allBookPrices:[yes],apply:true,client});
 const original=JSON.stringify(stored[0]);
 const no=capture('2026-11-03T17:15:00Z',1).find(r=>r.market==='btts'&&r.side==='no')!;
 await persistUclLineHistory({response,allBookPrices:[no],apply:true,client});
 assert.equal(fallback(await readUclStoredPriceHistory([providerId],{client})).odds.length,0,'legacy unmatched sides never become a synthetic pair');
 const complete=capture('2026-11-03T17:20:00Z',2).filter(r=>r.market==='btts');
 await persistUclLineHistory({response,allBookPrices:complete,apply:true,client});
 const recovered=fallback(await readUclStoredPriceHistory([providerId],{client}));
 assert.equal(recovered.odds.length,2);assert.ok(recovered.odds.every(r=>r.fetched_at==='2026-11-03T17:20:00Z'));
 assert.equal(JSON.stringify(stored[0]),original,'earlier partial history remains exact');
 // The member display is a presentation copy, not a new source capture.
 const provenance=database(),sourceAt='2026-11-03T17:20:00Z',displayAt='2026-11-03T17:25:00Z';
 const actual=capture(sourceAt,2).filter(r=>r.market==='btts');
 const displayed=structuredClone(response);displayed.games[0]!.markets.first_inning={soccerPriceBoard:{rows:actual.map(r=>({side:r.side,price_american:r.american,odds_trail:[{american:r.american,line:null,sportsbook:r.sportsbook,observedAt:displayAt,source:'current_line'}]}))}} as never;
 await persistUclLineHistory({response:displayed,allBookPrices:actual,apply:true,client:provenance.client});
 assert.equal(provenance.stored.length,2);assert.ok(provenance.stored.every(r=>r.recorded_at===sourceAt),'authoritative source prevents a duplicate display-capture clock');
 // Explicit default writer control: the third flat opposite side is still
 // compacted for EPL; this UCL repair does not change another sport policy.
 const control=database();for(let i=0;i<3;i++)await persistEplLineHistory({response,externalIdOffset:UCL_EXTERNAL_ID_OFFSET,client:control.client,apply:true,allBookPrices:capture(`2026-11-03T17:${10+i}:00Z`,i).filter(r=>r.market==='btts')});
 assert.equal(control.stored.length,5);
 console.log('PASS UCL atomic source history: three one-sided changes plus flat fourth capture, allfourmarketfamilies/twototalcontracts, bothroworders, actualpersist/read/latestfreshfallback, no borrowed partial/opener/clocks, idempotence and EPLdefault unchanged.');
}
