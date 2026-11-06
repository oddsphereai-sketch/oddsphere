/** Outcome-blind historical-input failure reenactment; no DB/provider/write.
 * Exact past SQL failure is not directly recorded, so this is a causal mechanism test. */
import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {reconcileNbaMarketConsequence} from '../../lib/services/nba/nbaMarketConsequence';
import {resolveNbaConsequencePosture} from '../../lib/services/nba/nbaNamedBookPosture';
import {gradeNbaR29MarketForAudit,type GradeInput} from '../../lib/services/nba/nbaMarketReview';
const flag=(k:string)=>process.argv.find(x=>x.startsWith(`--${k}=`))?.slice(k.length+3);
const file=flag('boards'),recordFile=flag('records'),splitFile=flag('splits'),output=flag('out');if(!file||!recordFile||!splitFile||!output)throw Error('Supply --boards/--records/--splits/--out');
const bytes=readFileSync(file,'utf8'),b=JSON.parse(bytes).boards.nba;
const captured=JSON.parse(readFileSync(recordFile,'utf8'));
const tape=JSON.parse(readFileSync(splitFile,'utf8'));
assert.equal(tape.cutoff,b.as_of);
assert.equal(new Set(captured.map((r:any)=>r.model_version)).size,1,'Do not blend numerical model releases');
const out=[];
for(const g of b.games.filter((g:any)=>g.gameStartAt>'2026-11-06T05:00:00'&&g.gameStartAt<'2026-11-07T05:00:00')){
 const raw=captured.find((r:any)=>r.snapshot_json.nba_game_dto_at_capture.game_external_id===g.external_id).snapshot_json.nba_game_dto_at_capture;
 const prior=raw.grounding_audit.market_reader_knowledge_state,law={marginSigma:prior.independentInput.marginSigma,totalSigma:prior.independentInput.totalSigma,marginMixture:JSON.parse(prior.independentInput.mixture)??undefined};
 const total=g.projected.home+g.projected.away,margin=g.projected.home-g.projected.away;
 const splitRows=tape.rows.filter((r:any)=>r.canonical_event_id===String(g.external_id)).map((r:any)=>({provider:r.provider,sourceBook:r.source_book,sourceType:r.source_type,market:r.market_type,selectionKey:r.selection_key,betsPct:r.bets_pct,moneyPct:r.money_pct,marketLine:r.market_line,sourceObservedAt:r.source_observed_at,fetchedAt:r.fetched_at}));
 const c=reconcileNbaMarketConsequence({independentMargin:margin,independentTotal:total,law,spreadHome:null,totalLine:null,context:{eventId:String(g.external_id),inputFingerprint:prior.inputFingerprint,evaluatedAt:b.as_of,previousState:prior,priceRows:[],splitRows,pricesTrusted:false,splitsTrusted:true}});
 for(const [slot,market] of [['moneyline','moneyline'],['first_inning','spread'],['total','total']] as const){
  const m=g.markets[slot],pick=market==='total'?(m.pick.startsWith('OVER')?'over':'under'):(m.pick.startsWith(g.homeTeam+' ')?'home':'away');
  const price=m.priceAmerican,p=m.modelProb,ev=p*(price>0?price/100:100/-price)-(1-p);
  const edge=market==='moneyline'?(p-m.marketFairProb):market==='spread'?((pick==='home'?margin:-margin)+m.line)/10:((pick==='over'?total-m.line:m.line-total)/15);
  const posture=resolveNbaConsequencePosture({consequence:c,market,pickedSide:pick});
  const input:GradeInput={market,pick,confidence:m.modelTrustPct,modelProbabilityOnPick:p,band:ev>0?'support':'mild_conflict',edge,dataQualityTier:raw.data_quality_tier,injuriesKnown:g.nbaAvailability.home.known&&g.nbaAvailability.away.known,currentPriceAmerican:price,pairedOpposingPriceAmerican:m.opposingOddsTrail?.stops.at(-1)?.american,namedBookPosture:posture};
  const next=gradeNbaR29MarketForAudit(input),actual=m.verdict.key==='watchlist'?'watch':m.verdict.key;
  out.push({game:g.awayTeam+'@'+g.homeTeam,market,previous:actual,reproduced:next.grade,match:next.grade===actual,independentScoresRetained:c.homeScore===g.projected.home&&c.awayScore===g.projected.away,probability:p,price,sourcePosture:posture,rationale:next.rationale});
 }
}
const count=(a:string[])=>a.reduce((r:any,x)=>(r[x]=(r[x]??0)+1,r),{});const report={at:new Date().toISOString(),cutoff:b.as_of,captureSha256:createHash('sha256').update(bytes).digest('hex'),games:out.length/3,markets:out.length,historicalSplitRows:tape.rows.length,assumedFailure:'price_observation_lookup_failed',actual:count(out.map(x=>x.previous)),reproduced:count(out.map(x=>x.reproduced)),matched:out.filter(x=>x.match).length,independentScoresRetained:out.every(x=>x.independentScoresRetained),mismatches:out.filter(x=>!x.match),rows:out,productionWrites:0,providerCalls:0,limits:'Retrospective controlled failure reenactment using the historical split window; exact prior SQL error was not retained in the member snapshot and is not claimed directly observed.'};writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,rows:undefined},null,2));
