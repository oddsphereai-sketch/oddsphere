import assert from 'node:assert/strict';
import {bivariatePoissonScoreDistribution} from '../lib/services/soccer/dixonColes';
import {deriveSoccerMarketProbabilities} from '../lib/services/soccer/soccerMarketProbabilities';
import {deriveUclRelativeMarketRead,inferUclNativeTotalMean,uclPoissonNativeTotalShare,type UclRelativeMarketInput} from '../lib/services/ucl/uclRelativeMarketRead';
import type {EplForwardBookVector} from '../lib/services/epl/eplForwardEvidenceCapture';
import type {EplStoredPriceObservation} from '../lib/services/epl/buildEplDailyEdgePreview';
import {eplCurrentBookVectors} from '../lib/services/epl/eplForwardEvidenceCapture';
import {applyUclStoredQuoteFallback} from '../lib/services/ucl/uclStoredQuoteFallback';

export function testUclRelativeMarketReader(){
 const currentAt='2026-11-03T13:55:00Z',baselineAt='2026-11-03T10:00:00Z',decisionAt='2026-11-03T14:00:00Z';
 const american=(p:number)=>p>=.5?-100*p/(1-p):100*(1-p)/p;
 const sides=(market:'match_result'|'total'|'btts')=>market==='match_result'?['home','draw','away']:market==='total'?['over','under']:['yes','no'];
 const vector=(market:'match_result'|'total'|'btts',p:number[],line:number|null=null,book='pinnacle',at=currentAt,vig=1):EplForwardBookVector=>({identity:`owls:${market}:${book}:${line}:${at}`,provider:'owls',providerEndpoint:'/odds',providerEventId:'evt',sportsbook:book,canonicalBook:book,sourceClass:book==='pinnacle'?'named_originator':'named_retail',market,line,capturedAt:decisionAt,fetchedAtMin:at,fetchedAtMax:at,vectorSkewMs:0,overround:vig,probabilityTotal:1,outcomes:sides(market).map((side,i)=>({side,american:american(p[i]!*vig),decimal:1/(p[i]!*vig),rawImpliedProbability:p[i]!*vig,noVigProbability:p[i]!,fetchedAt:at,fetchedAtSource:'provider'}))});
 const history=(v:EplForwardBookVector,at=baselineAt):EplStoredPriceObservation[]=>v.outcomes.map(o=>({providerId:1,market:v.market as 'match_result'|'total'|'btts',side:o.side,line:v.line,american:o.american,sportsbook:v.canonicalBook,recordedAt:at,isOpener:false}));
 const common:UclRelativeMarketInput={matchId:1,totalVectors:[],providerEventId:'evt',decisionAt,kickoff:'2026-11-03T20:00:00Z',evaluatedMatchResultCanonicalBook:'pinnacle',evaluatedTotalCanonicalBook:'pinnacle',evaluatedBttsCanonicalBook:'pinnacle'};
 const base=bivariatePoissonScoreDistribution(1.8,1,-.1),prior=deriveSoccerMarketProbabilities({joint:base,totalLine:2.5});
 const mr=vector('match_result',[.3,.2,.5]),mrBase=vector('match_result',[.6,.2,.2]);
 const noHistory=deriveUclRelativeMarketRead(base,{...common,matchResultVectors:[mr],totalVectors:[vector('total',[.9,.1],3.5)],bttsVectors:[vector('btts',[.1,.9])]});
 assert.strictEqual(noHistory.joint,base);assert.equal(noHistory.receipt.markets.total.status,'context_only');assert.equal(noHistory.receipt.markets.total.selected?.factor,null);
 const winner=deriveUclRelativeMarketRead(base,{...common,matchResultVectors:[mr],storedPriceHistory:history(mrBase)});
 const raw={home:prior.match_result.home*.5,draw:prior.match_result.draw,away:prior.match_result.away*2.5},z=raw.home+raw.draw+raw.away;
 assert.ok(Math.abs(winner.receipt.finalProbabilities.match_result.away-raw.away/z)<1e-7);assert.ok(winner.receipt.finalProbabilities.match_result.away>winner.receipt.finalProbabilities.match_result.home,'relative physical-book evidence can flip winner');
 assert.equal(winner.receipt.markets.match_result.selected?.independentOfExecutionBook,false,'own execution path is allowed but never labeled independent corroboration');
 for(const market of ['match_result','total','btts'] as const){const p=market==='match_result'?[.6,.2,.2]:[.65,.35],line=market==='total'?2.5:null;
  const flat=vector(market,p,line),vig=vector(market,p,line,'pinnacle',currentAt,1.05);
  for(const endpoint of [flat,vig]){const result=deriveUclRelativeMarketRead(base,{...common,matchResultVectors:market==='match_result'?[endpoint]:[],totalVectors:market==='total'?[endpoint]:[],bttsVectors:market==='btts'?[endpoint]:[],storedPriceHistory:history(flat)});assert.strictEqual(result.joint,base,'flat and pure vig paths preserve exact original law');}
 }
 const muBase=3,muCurrent=2.5,qBase=uclPoissonNativeTotalShare(muBase,3)!,qCurrent=uclPoissonNativeTotalShare(muCurrent,3.25)!;
 assert.ok(Math.abs(inferUclNativeTotalMean(3,qBase)!-muBase)<1e-7);assert.ok(Math.abs(inferUclNativeTotalMean(3.25,qCurrent)!-muCurrent)<1e-7);
 const total=vector('total',[qCurrent,1-qCurrent],3.25),totalBase=vector('total',[qBase,1-qBase],3);
 const relativeTotal=deriveUclRelativeMarketRead(base,{...common,totalVectors:[total],storedPriceHistory:history(totalBase)});
 assert.ok(Math.abs((relativeTotal.receipt.markets.total.selected?.factor as number)-muCurrent/muBase)<1e-7);assert.ok(relativeTotal.receipt.finalMeans.home+relativeTotal.receipt.finalMeans.away<2.8);
 assert.ok(Math.abs(relativeTotal.receipt.markets.total.sourceOpinionPool!.current.probabilities.over!-uclPoissonNativeTotalShare(muCurrent,2.5)!)<1e-9,
  'pooled Total opinions always use inferred official2.5 units even with only one native-contract family');
 assert.notEqual(relativeTotal.receipt.finalProbabilities.btts.yes,prior.btts.yes,'total evidence affects BTTS through one law');
 const flatBtts=vector('btts',[.6,.4]);
 const held=deriveUclRelativeMarketRead(base,{...common,totalVectors:[vector('total',[1-qCurrent,qCurrent],3.25)],bttsVectors:[flatBtts],storedPriceHistory:[...history(totalBase),...history(flatBtts)]});
 assert.ok(Math.abs(held.receipt.finalProbabilities.btts.yes-prior.btts.yes)>1e-5,'flat BTTS cannot freeze scoring consequences of genuine Total evidence');
 assert.equal(held.receipt.markets.btts.status,'unchanged');assert.ok(held.receipt.includedConstraintMarkets.includes('btts'),'flat source context is common to both profiles, not a frozen forecast marginal');assert.ok(!held.receipt.appliedMarkets.includes('btts'));
 assert.ok(held.receipt.crossMarketAffectedMarkets?.includes('btts'));
 for(const epsilon of [-1e-6,1e-6]){
  const nearlyFlat=vector('btts',[.6+epsilon,.4-epsilon]);
  const near=deriveUclRelativeMarketRead(base,{...common,totalVectors:[vector('total',[1-qCurrent,qCurrent],3.25)],bttsVectors:[nearlyFlat],storedPriceHistory:[...history(totalBase),...history(flatBtts)]});
  assert.ok(Math.abs(near.receipt.finalProbabilities.btts.yes-held.receipt.finalProbabilities.btts.yes)<.0001,
   'tiny changes across flat cannot switch between frozen and freely changing score laws');
 }
 const btts=vector('btts',[.5,.5]),bttsBase=vector('btts',[.6,.4]);
 for(const market of ['match_result','total','btts'] as const){
  const before=market==='match_result'?mrBase:market==='total'?vector('total',[.65,.35],2.5):bttsBase;
  const after=market==='match_result'?mr:market==='total'?vector('total',[.55,.45],2.5):btts;
  const storedHistory=[...history(before),...history(after,currentAt)];
  const fallback=applyUclStoredQuoteFallback({fixture:{eventId:null,odds:[],splits:[],splitsState:'unavailable'},providerId:1,
   history:storedHistory,kickoff:common.kickoff,now:new Date(decisionAt)});
  const vectors=eplCurrentBookVectors(fallback,market,decisionAt,{nativeTotalLines:true});
  assert.equal(vectors.length,1);
  const args={...common,fixtureEventIdentities:[],matchResultVectors:market==='match_result'?vectors:[],
   totalVectors:market==='total'?vectors:[],bttsVectors:market==='btts'?vectors:[],storedPriceHistory:storedHistory};
  const accepted=deriveUclRelativeMarketRead(base,args),axis=accepted.receipt.markets[market];
  assert.equal(axis.status,'applied',`${market}: actual fallback builder paired capture participates in relative reading`);
  assert.equal(axis.selected?.identityBasis,'exact_stored_fixture_capture');assert.equal(axis.selected?.providerEventId,null);
  assert.equal(axis.selected?.current.clockBasis,'stored_capture');assert.equal(axis.selected?.current.observedAt,currentAt.replace('Z','.000Z'));
  assert.notStrictEqual(accepted.joint,base);
  assert.equal(deriveUclRelativeMarketRead(base,{...args,storedPriceHistory:[...storedHistory,...storedHistory]}).receipt.markets[market].status,'applied','identical duplicate rows stay idempotent');
  const invalid=[
   storedHistory.map(r=>r.recordedAt===currentAt?{...r,providerId:2}:r),
   storedHistory.map(r=>r.recordedAt===currentAt?{...r,sportsbook:'draftkings'}:r),
   storedHistory.map(r=>r.recordedAt===currentAt?{...r,line:3.5}:r),
   storedHistory.map(r=>r.recordedAt===currentAt?{...r,american:r.american+1}:r),
   storedHistory.map(r=>r.recordedAt===currentAt?{...r,recordedAt:'2026-11-03T13:54:00Z'}:r),
   storedHistory.map(r=>r.recordedAt===currentAt?{...r,isOpener:true}:r),
   storedHistory.filter((r,i)=>i!==storedHistory.length-1),
   [...storedHistory,{...storedHistory.at(-1)!,american:999}],
   [...storedHistory,...history(after,'2026-11-03T13:57:00Z')],
  ];
  for(const rows of invalid)assert.equal(deriveUclRelativeMarketRead(base,{...args,storedPriceHistory:rows}).receipt.markets[market].status,'unavailable',`${market}: foreign/partial/conflicting/opener/mismatched/superseded capture cannot gain authority`);
  const partialLater=deriveUclRelativeMarketRead(base,{...args,storedPriceHistory:[...storedHistory,...history(after,'2026-11-03T13:57:00Z').slice(0,1)]});
  assert.equal(partialLater.receipt.markets[market].status,'applied');assert.equal(partialLater.receipt.markets[market].latestLegFullyObserved,false);
  const wrongEndpoint=structuredClone(vectors);wrongEndpoint[0]!.providerEndpoint='/untrusted';
  assert.equal(deriveUclRelativeMarketRead(base,{...args,matchResultVectors:market==='match_result'?wrongEndpoint:[],totalVectors:market==='total'?wrongEndpoint:[],bttsVectors:market==='btts'?wrongEndpoint:[]}).receipt.markets[market].status,'unavailable');
  const future=structuredClone(vectors);future[0]!.outcomes.forEach(o=>{o.fetchedAt='2026-11-03T14:01:00Z';});
  const futureArgs={...args,storedPriceHistory:[...history(before),...history(after,'2026-11-03T14:01:00Z')],matchResultVectors:market==='match_result'?future:[],totalVectors:market==='total'?future:[],bttsVectors:market==='btts'?future:[]};
  assert.equal(deriveUclRelativeMarketRead(base,futureArgs).receipt.markets[market].status,'unavailable','even exact stored future captures are not current evidence');
 }
 const actualPrices=vector('btts',[.5,.5]);actualPrices.outcomes[0]!.american=-186;actualPrices.outcomes[1]!.american=158;
 const actualHistory=[...history(bttsBase),...history(actualPrices,currentAt)];
 const actualFallback=applyUclStoredQuoteFallback({fixture:{eventId:null,odds:[],splits:[],splitsState:'unavailable'},providerId:1,history:actualHistory,kickoff:common.kickoff,now:new Date(decisionAt)});
 const actualRead=deriveUclRelativeMarketRead(base,{...common,fixtureEventIdentities:[],bttsVectors:eplCurrentBookVectors(actualFallback,'btts',decisionAt),storedPriceHistory:actualHistory});
 assert.equal(actualRead.receipt.markets.btts.status,'applied','reported−186/+158 stored pair is read rather than lost for missing nativeID');
 assert.equal(actualRead.receipt.markets.btts.direction,'yes');
 const combined=deriveUclRelativeMarketRead(base,{...common,matchResultVectors:[mr],totalVectors:[total],bttsVectors:[btts],storedPriceHistory:[...history(mrBase),...history(totalBase),...history(bttsBase)]});
 assert.deepEqual(new Set(combined.receipt.appliedMarkets),new Set(['match_result','total','btts']));
 assert.equal(combined.receipt.method,'joint_multibook_source_profile_density_ratio');
 const oddsTarget=(prior.btts.yes*(2/3))/(1-prior.btts.yes+prior.btts.yes*(2/3));
 const bttsOnly=deriveUclRelativeMarketRead(base,{...common,bttsVectors:[btts],storedPriceHistory:history(bttsBase)});
 assert.ok(Math.abs(bttsOnly.receipt.finalProbabilities.btts.yes-oddsTarget)<1e-7,'single-axis limit remains original odds times observed odds innovation');
 const reversed=deriveUclRelativeMarketRead(base,{...common,matchResultVectors:[mr],totalVectors:[total],bttsVectors:[btts],storedPriceHistory:[...history(bttsBase),...history(totalBase),...history(mrBase)].reverse()});
 assert.deepEqual(reversed.joint,combined.joint,'joint market interpretation is not an arbitrary serial market order');
 assert.ok(combined.receipt.residual<1e-7);assert.ok(Math.abs(combined.joint.flat().reduce((s,p)=>s+p,0)-1)<1e-10);
 const returned=deriveUclRelativeMarketRead(base,{...common,bttsVectors:[bttsBase],storedPriceHistory:[...history(bttsBase),...history(vector('btts',[.8,.2]),'2026-11-03T12:00:00Z')]});
 assert.strictEqual(returned.joint,base);assert.equal(returned.receipt.markets.btts.roundTrip,true,'net buyback is not a synthetic new edge');
 const retrace=deriveUclRelativeMarketRead(base,{...common,bttsVectors:[vector('btts',[.7,.3])],storedPriceHistory:[...history(bttsBase),...history(vector('btts',[.8,.2]),'2026-11-03T12:00:00Z')]});
 assert.equal(retrace.receipt.markets.btts.direction,'yes');assert.equal(retrace.receipt.markets.btts.latestInformativeDirection,'no');assert.equal(retrace.receipt.markets.btts.retraced,true);
 const hold=deriveUclRelativeMarketRead(base,{...common,bttsVectors:[vector('btts',[.7,.3])],storedPriceHistory:[...history(bttsBase),...history(vector('btts',[.7,.3]),'2026-11-03T12:00:00Z')]});
 assert.equal(hold.receipt.markets.btts.latestLegDirection,'flat');assert.equal(hold.receipt.markets.btts.latestInformativeDirection,'yes');
 const day=deriveUclRelativeMarketRead(base,{...common,bttsVectors:[btts],storedPriceHistory:[...history(vector('btts',[.2,.8]),'2026-11-03T04:30:00Z'),...history(bttsBase,'2026-11-03T05:15:00Z'),...history(vector('btts',[.7,.3]),'2026-11-03T08:00:00Z')]});
 assert.equal(day.receipt.markets.btts.selected?.baseline?.observedAt,'2026-11-03T04:30:00Z');assert.equal(day.receipt.markets.btts.selected?.baseline?.clockBasis,'stored_capture');
 const priorDay=deriveUclRelativeMarketRead(base,{...common,bttsVectors:[btts],storedPriceHistory:[...history(vector('btts',[.2,.8]),'2026-11-02T22:00:00Z'),...history(bttsBase,'2026-11-03T04:30:00Z')]});
 assert.equal(priorDay.receipt.markets.btts.selected?.baseline?.observedAt,'2026-11-02T22:00:00Z');
 const midnight=deriveUclRelativeMarketRead(base,{...common,decisionAt:'2026-11-03T05:05:00Z',bttsVectors:[vector('btts',[.5,.5],null,'pinnacle','2026-11-03T04:58:00Z')],storedPriceHistory:[...history(vector('btts',[.2,.8]),'2026-11-02T05:10:00Z'),...history(bttsBase,'2026-11-03T04:30:00Z')]});
 assert.equal(midnight.receipt.markets.btts.selected?.baseline?.observedAt,'2026-11-02T05:10:00Z','midnight cannot discard earlier paired observations');
 const partial=history(bttsBase).slice(0,1).concat(history(bttsBase,'2026-11-03T11:00:00Z').slice(1));
 assert.strictEqual(deriveUclRelativeMarketRead(base,{...common,bttsVectors:[btts],storedPriceHistory:partial}).joint,base,'different captures never synthesize a paired baseline');
 const afterCurrent=history(bttsBase,'2026-11-03T13:58:00Z');assert.strictEqual(deriveUclRelativeMarketRead(base,{...common,bttsVectors:[btts],storedPriceHistory:afterCurrent}).joint,base,'baseline precedes current provider quote, not retrieval clock');
 const wrongGame=history(bttsBase).map(row=>({...row,providerId:2}));assert.strictEqual(deriveUclRelativeMarketRead(base,{...common,bttsVectors:[btts],storedPriceHistory:wrongGame}).joint,base);
 const duplicate=deriveUclRelativeMarketRead(base,{...common,bttsVectors:[btts,btts],storedPriceHistory:[...history(bttsBase),...history(bttsBase)]});assert.equal(duplicate.receipt.markets.btts.candidates.length,1);
 const invalid=structuredClone(btts);invalid.outcomes.forEach(o=>o.fetchedAt='2026-11-03T15:00:00Z');
 const isolated=deriveUclRelativeMarketRead(base,{...common,totalVectors:[total],bttsVectors:[invalid],storedPriceHistory:history(totalBase)});assert.equal(isolated.receipt.markets.total.status,'applied');assert.equal(isolated.receipt.markets.btts.status,'unavailable');
 const flatPin=vector('btts',[.6,.4]),movingRetail=vector('btts',[.8,.2],null,'draftkings');
 const dkBase=vector('btts',[.5,.5],null,'draftkings');
 const professionalHeld=deriveUclRelativeMarketRead(base,{...common,bttsVectors:[movingRetail,flatPin],storedPriceHistory:[...history(flatPin),...history(dkBase)]});
 assert.ok(professionalHeld.receipt.finalProbabilities.btts.yes>prior.btts.yes,'valid retail evidence participates alongside a flat professional opinion');assert.equal(professionalHeld.receipt.markets.btts.selected?.book,'pinnacle');
 assert.equal(professionalHeld.receipt.markets.btts.sourceOpinionPool?.families.length,2,'both economic opinions are included, rather than replacing the professional quote');
 const retailOnly=deriveUclRelativeMarketRead(base,{...common,bttsVectors:[movingRetail],storedPriceHistory:history(dkBase)});
 assert.ok(professionalHeld.receipt.finalProbabilities.btts.yes<retailOnly.receipt.finalProbabilities.btts.yes,'flat source context moderates the opinion pool instead of disappearing');
 const cloneRetail=vector('btts',[.8,.2],null,'fanduel'),cloneBase=vector('btts',[.5,.5],null,'fanduel');
 const copied=deriveUclRelativeMarketRead(base,{...common,bttsVectors:[movingRetail,flatPin,cloneRetail],storedPriceHistory:[...history(flatPin),...history(dkBase),...history(cloneBase)]});
 assert.deepEqual(copied.joint,professionalHeld.joint,'copied economic trajectories cannot multiply confidence');
 assert.equal(copied.receipt.markets.btts.sourceOpinionPool?.families.length,2);
 assert.ok(copied.receipt.markets.btts.sourceOpinionPool?.families.some(f=>f.books.length===2),'all physical identities remain visible inside a copied-path family');
 const missingHistory=deriveUclRelativeMarketRead(base,{...common,bttsVectors:[movingRetail,vector('btts',[.2,.8],null,'caesars')],storedPriceHistory:history(dkBase)});
 assert.deepEqual(missingHistory.joint,retailOnly.joint,'a missing baseline is not a zero vote that dilutes available evidence');
 const plus=vector('btts',[.7,.3]),minus=vector('btts',[.3,.7],null,'draftkings');
 const opposing=deriveUclRelativeMarketRead(base,{...common,bttsVectors:[plus,minus],storedPriceHistory:[...history(vector('btts',[.5,.5])),...history(dkBase)]});
 assert.strictEqual(opposing.joint,base,'equal opposite observed opinions cancel without picking whichever book ranks first');
 assert.equal(opposing.receipt.markets.btts.opposingCandidates,true,'cancellation retains the actual disagreement receipt');
 const overnight=deriveUclRelativeMarketRead(base,{...common,bttsVectors:[vector('btts',[.6,.4])],storedPriceHistory:[...history(vector('btts',[.7,.3]),'2026-11-02T22:00:00Z'),...history(vector('btts',[.5,.5]),'2026-11-03T06:00:00Z')]});
 assert.equal(overnight.receipt.markets.btts.direction,'no','an intraday Yes recovery must not erase the longer observed weakening toward No');
 assert.equal(overnight.receipt.markets.btts.latestInformativeDirection,'yes','net and latest interpretations are both retained without double-counting either');
 assert.equal(overnight.receipt.markets.btts.selected?.baselineRule,'first_observed_complete_pregame');
 const noProfessionalBaseline=deriveUclRelativeMarketRead(base,{...common,bttsVectors:[flatPin,movingRetail],storedPriceHistory:history(dkBase)});
 assert.equal(noProfessionalBaseline.receipt.markets.btts.selected?.book,'draftkings');assert.equal(noProfessionalBaseline.receipt.markets.btts.status,'applied','actual retail path can inform when professional history is unavailable');
 const incomplete=deriveUclRelativeMarketRead(base,{...common,bttsVectors:[vector('btts',[.7,.3])],storedPriceHistory:[...history(bttsBase),...history(vector('btts',[.8,.2]),'2026-11-03T12:00:00Z').slice(0,1)]});
 assert.equal(incomplete.receipt.markets.btts.latestLegFullyObserved,false);assert.equal(incomplete.receipt.markets.btts.selected?.incompleteCaptureCount,1);
 const conflicting=deriveUclRelativeMarketRead(base,{...common,bttsVectors:[btts,vector('btts',[.7,.3])],storedPriceHistory:history(bttsBase)});
 assert.strictEqual(conflicting.joint,base);assert.ok(conflicting.receipt.markets.btts.inactive.some(r=>r.reason==='conflicting_same_physical_book_contract_clock'));
 const conflictBase=Array.from({length:3},()=>[1/9,1/9,1/9]),qHigh=uclPoissonNativeTotalShare(3,.5)!,qLow=uclPoissonNativeTotalShare(.1,.5)!;
 const incompatible=deriveUclRelativeMarketRead(conflictBase,{...common,totalVectors:[vector('total',[qLow,1-qLow],.5)],bttsVectors:[vector('btts',[.5,.5])],storedPriceHistory:[...history(vector('total',[qHigh,1-qHigh],.5)),...history(vector('btts',[.5,.5]))]});
 assert.equal(incompatible.receipt.markets.total.status,'applied');assert.equal(incompatible.receipt.markets.btts.status,'conflict','incompatible held BTTS cannot erase feasible observed total innovation');assert.ok(incompatible.receipt.finalMeans.home+incompatible.receipt.finalMeans.away<.1);
 const outsideSupport=deriveUclRelativeMarketRead([[.25,.25],[.25,.25]],{...common,totalVectors:[vector('total',[qLow,1-qLow],.5)],storedPriceHistory:history(vector('total',[qHigh,1-qHigh],.5))});
 assert.equal(outsideSupport.receipt.markets.total.status,'conflict','an impossible baseline profile cannot silently create an invented density ratio');
 const gappedHeld=deriveUclRelativeMarketRead(base,{...common,bttsVectors:[vector('btts',[.7,.3])],storedPriceHistory:[...history(bttsBase),...history(vector('btts',[.65,.35]),'2026-11-03T12:10:00Z').slice(0,1),...history(vector('btts',[.7,.3]),'2026-11-03T12:20:00Z')]});
 assert.equal(gappedHeld.receipt.markets.btts.latestLegDirection,'flat');assert.equal(gappedHeld.receipt.markets.btts.latestLegFullyObserved,false,'a held capture cannot erase a gap inside the informative reaction leg');
 const homeStrong=bivariatePoissonScoreDistribution(3,.5,-.1),pinGain=vector('match_result',[.5,.3,.2]),dkGain=vector('match_result',[.5,.3,.2],null,'draftkings');
 const choiceOpposition=deriveUclRelativeMarketRead(homeStrong,{...common,matchResultVectors:[pinGain,dkGain],storedPriceHistory:[...history(vector('match_result',[.4,.5,.1])),...history(vector('match_result',[.6,.3,.1],null,'draftkings'))]});
 assert.equal(choiceOpposition.receipt.markets.match_result.direction,'away');assert.equal(choiceOpposition.receipt.markets.match_result.pickedSide,'home');assert.equal(choiceOpposition.receipt.markets.match_result.opposingCandidates,true,'other-source resistance binds final pick rather than largest relative-gain side');
 const tiny=deriveUclRelativeMarketRead(base,{...common,bttsVectors:[vector('btts',[.60001,.39999])],storedPriceHistory:history(bttsBase)});
 assert.ok(Math.abs(tiny.receipt.finalProbabilities.btts.yes-prior.btts.yes)<.0001,'small evidence has continuous rather than thresholded consequences');
 console.log('PASS UCL relative paths: exact independent no-history/flat/vig/roundtrip, physical paired MR flips, whole/quarter crossline mean ratio, original-marginal joint reconciliation, own-path provenance, latest-leg/retrace/hold, ET baseline rules, no partial/future/foreign pairing, duplicates and continuous effects.');
}
