import assert from 'node:assert/strict';
import {normalizeCbbRetailPriceJournal} from '../lib/cbb/retailPriceJournal';
import {normalizeOwlsSharpBookOdds,type RawOwlsOddsResponse,type RawOwlsOddsEvent} from '../lib/providers/owls/owlsSharpBookOdds';
import {buildOwlsSharpPriceObservations} from '../lib/services/marketIntelligenceV2/shadowSync';
import {pairCbbCanonicalMarketEvidence} from '../lib/services/cbb/cbbCanonicalMarketEvidence';
import {cbbCanonicalBehaviorInputs} from '../lib/services/cbb/cbbCanonicalBehaviorInputs';
const now=new Date('2026-11-03T14:00:00Z');
const pair=[{name:'Duquesne',price:-118,point:-9.5},{name:'Purdue FW',price:-104,point:9.5}];
const book=(key:string)=>({key,last_update:'2026-11-03T13:59:00Z',markets:[{key:'spreads',outcomes:pair}]});
const response:RawOwlsOddsResponse={success:true,data:[{eventId:'ncaab:Purdue FW@Duquesne-20261104',sport:'ncaab',commence_time:'2026-11-04T00:00:00Z',away_team:'Purdue FW',home_team:'Duquesne',bookmakers:[book('pinnacle'),book('fanduel'),book('kalshi')]}]};
const result=normalizeCbbRetailPriceJournal(response,now);
assert.equal(result.prices.length,4);
assert.deepEqual(result.prices.filter(r=>r.sportsbook==='pinnacle'),normalizeOwlsSharpBookOdds(response,'ncaab').prices,'professional capture remains byte-identical');
const game={id:1,externalId:10882593,slateDate:'2026-11-03',gameDate:'2026-11-04T00:00:00Z',homeTeamId:2,awayTeamId:3,homeAbbr:'DUQ',awayAbbr:'PFW',homeName:'Duquesne Dukes',awayName:'Purdue Fort Wayne Mastodons',homeLocation:'Duquesne',awayLocation:'Purdue Fort Wayne'};
const built=buildOwlsSharpPriceObservations({sport:'cbb',games:[game],rows:result.prices,fetchedAt:now,ingestionRunId:'normal-cycle'});
assert.equal(built.observations.length,4);
assert.equal(built.observations.filter(r=>r.sharp_book===false).length,2);
assert.ok(built.observations.every(r=>r.provider_timestamp==='2026-11-03T13:59:00.000Z'&&r.ingestion_run_id==='normal-cycle'&&r.provider_event_id==='ncaab:Purdue FW@Duquesne-20261104'));
assert.equal(buildOwlsSharpPriceObservations({sport:'nba',games:[],rows:result.prices.filter(r=>r.sportsbook==='fanduel'),fetchedAt:now}).observations.length,0);
function changed(change:(r:RawOwlsOddsResponse)=>void){const r=structuredClone(response);change(r);return normalizeCbbRetailPriceJournal(r,now).prices.filter(r=>r.sportsbook==='fanduel');}
assert.equal(changed(r=>{(r.data as RawOwlsOddsEvent[])[0].bookmakers![1].last_update='2026-11-03T14:01:00Z';}).length,0);
assert.equal(changed(r=>{(r.data as RawOwlsOddsEvent[])[0].commence_time='2026-11-03T13:00:00Z';}).length,0);
assert.equal(changed(r=>{(r.data as RawOwlsOddsEvent[])[0].bookmakers![1].markets![0].outcomes!.pop();}).length,0);
assert.equal(changed(r=>{(r.data as RawOwlsOddsEvent[])[0].bookmakers![1].markets![0].outcomes![0].price=-90;}).length,0);
assert.equal(changed(r=>{(r.data as RawOwlsOddsEvent[])[0].bookmakers![1].markets![0].outcomes![1].point=10;}).length,0);
assert.equal(changed(r=>{const books=(r.data as RawOwlsOddsEvent[])[0].bookmakers!;books.push({...structuredClone(books[1]),last_update:'2026-11-03T13:58:00Z'});}).length,0);
assert.equal(changed(r=>{const books=(r.data as RawOwlsOddsEvent[])[0].bookmakers!;books.push(structuredClone(books[1]));}).length,2,'duplicate exact source frame coalesces');
assert.equal(changed(r=>{Object.assign((r.data as RawOwlsOddsEvent[])[0].bookmakers![1].markets![0],{last_update:'2026-11-03T13:57:00Z'});})[0].observedAt,'2026-11-03T13:57:00.000Z');
assert.deepEqual(normalizeCbbRetailPriceJournal(response,now),result,'re-reading does not invent later clocks');
const nativeResponse=structuredClone(response);(nativeResponse.data as RawOwlsOddsEvent[])[0].bookmakers![1].key='draftkings';
const completed=new Date('2026-11-03T14:00:00.599Z');
const produced=buildOwlsSharpPriceObservations({sport:'cbb',games:[game],rows:normalizeCbbRetailPriceJournal(nativeResponse,completed).prices,
 fetchedAt:now,retailFetchedAt:completed,ingestionRunId:'cbb:2026-11-03:2026-11-03T14:00:00.000Z'});
const team=(id:number,college:string)=>({id,college,name:college,full_name:college,abbreviation:college,conference_id:null});
const paired=pairCbbCanonicalMarketEvidence({game:{id:10882593,date:game.gameDate,season:2026,status:'pre',period:0,home_score:0,away_score:0,
 home_team:team(2,'Duquesne'),visitor_team:team(3,'Purdue Fort Wayne')},decisionAt:'2026-11-03T14:01:00Z',
 priceRows:produced.observations.map((r,i)=>({...r,id:1000+i,inserted_at:'2026-11-03T14:00:01Z'}))});
const consumed=cbbCanonicalBehaviorInputs(paired);
assert.equal(consumed.contextQuotes.length,1,'real journal→observation builder→native pair→pressure context preserves the retail response');
assert.equal(consumed.contextQuotes[0].fetchedAt,completed.toISOString());
assert.equal(consumed.historyQuotes[0].fetchedAt,now.toISOString(),'the professional run-start contract remains unchanged');
assert.equal(consumed.quarantinedSources.length,0);
console.log('PASS CBB retail journal: same-response two-sided retail capture, original per-market clocks, native lineage, professional parity, no exchange/sharp relabeling, ambiguity/future/live rejection.');
