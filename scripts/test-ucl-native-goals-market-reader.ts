import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bivariatePoissonScoreDistribution} from '../lib/services/soccer/dixonColes';
import {deriveSoccerMarketProbabilities} from '../lib/services/soccer/soccerMarketProbabilities';
import {deriveUclCoherentMarketOutcome} from '../lib/services/ucl/uclCoherentMarketOutcome';
import {deriveUclNativeGoalProjection,projectUclGoalMarkets,uclBttsConstraint,uclNativeTotalConstraint,uclTotalStakeFractions} from '../lib/services/ucl/uclGoalMarketProjection';
import {eplCurrentBookVectors} from '../lib/services/epl/eplForwardEvidenceCapture';
import {__TEST__,soccerFixtureEventIdentities} from '../lib/providers/real_api/CurrentSoccerMarketProvider';
import type {EplForwardBookVector} from '../lib/services/epl/eplForwardEvidenceCapture';
import type {RawOwlsOddsResponse} from '../lib/providers/owls/owlsSharpBookOdds';

export function testUclNativeGoalsMarketReader(){
 const at='2026-11-03T14:56:04.708Z',quote='2026-11-03T14:55:00Z',kickoff='2026-11-03T20:00:00Z';
 const american=(p:number)=>p>=.5?-100*p/(1-p):100*(1-p)/p;
 const vector=(book:string,market:'total'|'btts',line:number|null,q:number):EplForwardBookVector=>({
  identity:`owls:evt:${book}:${market}:${line}`,sportsbook:book,canonicalBook:book,sourceClass:book==='pinnacle'?'named_originator':'named_retail',
  provider:'owls',providerEndpoint:'/api/v1/soccer/odds',providerEventId:'evt',market,line,capturedAt:at,fetchedAtMin:quote,fetchedAtMax:quote,vectorSkewMs:0,overround:1,probabilityTotal:1,
  outcomes:[market==='total'?'over':'yes',market==='total'?'under':'no'].map((side,i)=>{const p=i===0?q:1-q;return{side,american:american(p),decimal:1/p,rawImpliedProbability:p,noVigProbability:p,fetchedAt:quote,fetchedAtSource:'provider'};})});
 const input={totalVectors:[] as EplForwardBookVector[],bttsVectors:[] as EplForwardBookVector[],evaluatedTotalCanonicalBook:'draftkings',evaluatedBttsCanonicalBook:'novig',providerEventId:'evt',decisionAt:Date.parse(at),kickoff:Date.parse(kickoff)};
 assert.deepEqual(uclTotalStakeFractions(3,3),{win:0,loss:0});
 assert.deepEqual(uclTotalStakeFractions(3,3.25),{win:0,loss:.5});
 assert.deepEqual(uclTotalStakeFractions(3,2.75),{win:.5,loss:0});
 assert.deepEqual(uclTotalStakeFractions(4,3.25),{win:1,loss:0});
 const base=bivariatePoissonScoreDistribution(1.5,1.5,-.1);
 for(const line of [2.5,3,3.25,3.5]){
  const constraint=uclNativeTotalConstraint(`total:${line}`,line,.55),result=projectUclGoalMarkets(base,[constraint]);
  assert.ok(result.converged);assert.ok(result.residual<1e-7);
  let win=0,loss=0;result.joint.forEach((row,h)=>row.forEach((p,a)=>{const s=uclTotalStakeFractions(h+a,line);win+=p*s.win;loss+=p*s.loss;}));
  assert.ok(Math.abs(win/(win+loss)-.55)<1e-7,'target share uses exact push/quarter settlement');
  if(line===3)assert.ok(Math.abs(win-.55)>.01,'whole-line fair probability is conditional on settled stake');
 }
 assert.deepEqual(projectUclGoalMarkets(base,[]).joint,base,'absent evidence preserves exact law');
 const prior=deriveSoccerMarketProbabilities({joint:base,totalLine:2.5});
 const own=deriveUclNativeGoalProjection(base,{...input,totalVectors:[vector('draftkings','total',3.5,.5)],bttsVectors:[vector('novig','btts',null,.1)]});
 assert.equal(own.receipt.totalApplied,false);assert.equal(own.receipt.bttsApplied,false);assert.deepEqual(own.joint,base);
 const changed=deriveUclNativeGoalProjection(base,{...input,totalVectors:[vector('pinnacle','total',3.5,.55)],bttsVectors:[vector('novig','btts',null,.1)]});
 assert.ok(changed.receipt.totalApplied);assert.equal(changed.receipt.bttsApplied,false);
 assert.ok(changed.receipt.after.home+changed.receipt.after.away>3.5,'total mean can move');
 assert.notEqual(deriveSoccerMarketProbabilities({joint:changed.joint,totalLine:2.5}).btts.yes,prior.btts.yes,'native total can alter BTTS without own-book self-corroboration');
 const strong=deriveUclCoherentMarketOutcome({independentLambdaHome:2,independentLambdaAway:2,totalVectors:[vector('pinnacle','total',2.5,.25)],bttsVectors:[],evaluatedTotalCanonicalBook:'draftkings',evaluatedBttsCanonicalBook:'novig',evaluatedMatchResultCanonicalBook:null,providerEventId:'evt',decisionAt:at,kickoff});
 assert.ok(strong.markets.total.under>.74,'strong independent Over can be corrected without a confidence ceiling');
 assert.ok(strong.expectedGoals.home+strong.expectedGoals.away<4,'final means follow same changed score law');
 const sparse=deriveUclNativeGoalProjection(base,{...input,bttsVectors:[vector('pinnacle','btts',null,.3)]});
 assert.ok(sparse.receipt.bttsApplied);assert.ok(Math.abs(deriveSoccerMarketProbabilities({joint:sparse.joint,totalLine:2.5}).btts.yes-.3)<1e-7,'single genuine alternative suffices');
 const earlier=vector('pinnacle','total',3.25,.55);earlier.outcomes.forEach(o=>{o.fetchedAt='2026-11-03T14:10:00Z';});
 assert.equal(deriveUclNativeGoalProjection(base,{...input,totalVectors:[earlier]}).receipt.totalApplied,false,'near-kickoff thirty-minute source window');
 assert.equal(deriveUclNativeGoalProjection(base,{...input,totalVectors:[earlier],kickoff:Date.parse('2026-11-04T20:00:00Z')}).receipt.totalApplied,true,'future fixtures retain the shared sixty-minute source window');
 const incompatible=deriveUclNativeGoalProjection(base,{...input,totalVectors:[vector('pinnacle','total',.5,.01)],bttsVectors:[vector('fanduel','btts',null,.9)]});
 assert.ok(incompatible.receipt.totalApplied);assert.equal(incompatible.receipt.bttsApplied,false);assert.ok(incompatible.receipt.inactive.some(r=>r.reason==='btts_constraint_incompatible_or_projection_unavailable'));
 const totalOnly=deriveUclNativeGoalProjection(base,{...input,totalVectors:[vector('pinnacle','total',.5,.01)]});
 assert.deepEqual(incompatible.joint,totalOnly.joint,'incompatible BTTS never erases valid total');
 for(const mutate of [(v:EplForwardBookVector)=>{v.outcomes[0]!.fetchedAt='2026-11-03T15:00:00Z';},(v:EplForwardBookVector)=>{v.outcomes.forEach(o=>o.fetchedAt='2026-11-03T12:00:00Z');},(v:EplForwardBookVector)=>{v.providerEventId='wrong';}]){
  const bad=vector('pinnacle','total',3.5,.55);mutate(bad);
  const result=deriveUclNativeGoalProjection(base,{...input,totalVectors:[bad],bttsVectors:[vector('fanduel','btts',null,.3)]});assert.equal(result.receipt.totalApplied,false);assert.equal(result.receipt.bttsApplied,true);
 }
 const duplicate=vector('pinnacle','total',3.5,.6);
 const ambiguous=deriveUclNativeGoalProjection(base,{...input,totalVectors:[vector('pinnacle','total',3.5,.55),duplicate,vector('fanduel','total',3.5,.52)]});
 assert.equal(ambiguous.receipt.total?.book,'fanduel');assert.ok(ambiguous.receipt.inactive.some(r=>r.reason==='conflicting_same_book_contract_capture'));
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/ucl-current-native-inputs-20261103.json',import.meta.url),'utf8')) as {capturedAt:string;games:Array<{id:number;home:string;away:string;kickoff:string}>;response:RawOwlsOddsResponse};
 let applied=0;
 for(const game of fixture.games){
  const source=__TEST__.normalizeOwlsFixture(fixture.response,'ucl',game,Date.parse(fixture.capturedAt));
  const market={eventId:source.eventId,odds:source.rows,splits:[],splitsState:'unavailable' as const};
  const totals=eplCurrentBookVectors(market,'total',fixture.capturedAt,{nativeTotalLines:true});
  assert.ok(totals.some(v=>v.canonicalBook==='pinnacle'));
  assert.ok(eplCurrentBookVectors(market,'total',fixture.capturedAt).every(v=>v.line===2.5),'EPL default unchanged');
  const outcome=deriveUclCoherentMarketOutcome({independentLambdaHome:1.4,independentLambdaAway:1.3,totalVectors:totals,bttsVectors:eplCurrentBookVectors(market,'btts',fixture.capturedAt,{nativeTotalLines:true}),evaluatedTotalCanonicalBook:'draftkings',evaluatedBttsCanonicalBook:'novig',evaluatedMatchResultCanonicalBook:null,providerEventId:source.eventId,fixtureEventIdentities:soccerFixtureEventIdentities(source.rows),decisionAt:fixture.capturedAt,kickoff:game.kickoff});
  const receipt=outcome.audit.goalsReader.nativeGoalMarketRead;assert.ok(receipt.totalApplied);assert.ok(receipt.converged);assert.equal(receipt.total?.book,'pinnacle');assert.ok(receipt.residual<1e-7);applied++;
  assert.ok(Math.abs(outcome.joint.flat().reduce((sum,p)=>sum+p,0)-1)<1e-10);
  assert.ok(outcome.joint.flat().every(p=>Number.isFinite(p)&&p>=0));
  assert.ok(outcome.expectedGoals.home+outcome.expectedGoals.away>2.7,'actual native total changes score mean');
 }
 assert.equal(applied,18);
 const first=fixture.games[0]!,normalized=__TEST__.normalizeOwlsFixture(fixture.response,'ucl',first,Date.parse(fixture.capturedAt));
 const pin=normalized.rows.filter(r=>r.sportsbook==='pinnacle'&&r.market==='total');
 const broken={eventId:normalized.eventId,odds:[pin[0]!,{...pin[1]!,fetched_at:'2026-11-03T14:55:33Z'}],splits:[],splitsState:'unavailable' as const};
 assert.equal(eplCurrentBookVectors(broken,'total',fixture.capturedAt,{nativeTotalLines:true}).length,0,'opposite sides from different original captures cannot be stitched');
 const conflict={...broken,odds:[...pin,{...pin[0]!,odds_american:-150}]};
 assert.equal(eplCurrentBookVectors(conflict,'total',fixture.capturedAt,{nativeTotalLines:true}).length,0,'same-source conflicting paired side is rejected');
 console.log('PASS UCL native goals: exact whole/quarter settlement, movable joint scores/ML/BTTS, sparse target-free BTTS, own-quote exclusion, independent-axis conflict/freshness/identity, original paired cohorts and actual18-source numerical consumption; EPL defaults unchanged.');
}
testUclNativeGoalsMarketReader();
