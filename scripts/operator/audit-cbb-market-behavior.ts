import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash}from'node:crypto';
import {readCbbMarketBehavior,gradeCbbMarketBehavior} from '../../lib/cbb/marketBehaviorCandidate';
import {gradeCbbProvisional} from '../../lib/cbb/provisionalGradePolicy';
import type {CbbForecast,CbbQuote,CbbGame} from '../../lib/cbb/types';
import type {CbbProvisionalSnapshot,CbbLegacyProvisionalBoard} from '../../lib/cbb/provisionalLifecycle';
type SourceRecord={snapshot:CbbProvisionalSnapshot&{board:CbbLegacyProvisionalBoard};awayName:string;homeName:string};
type Source={at:string;rows:SourceRecord[]};
import artifact from '../../lib/cbb/artifacts/candidate-r3.json';
import {reviewCbbQuote} from '../../lib/cbb/marketEvidence';
import {pairCbbCanonicalMarketEvidence,type CbbCanonicalPriceRow,type CbbCanonicalSplitRow} from '../../lib/services/cbb/cbbCanonicalMarketEvidence';
import {cbbCanonicalBehaviorInputs} from '../../lib/services/cbb/cbbCanonicalBehaviorInputs';
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const [currentFile,priorFile,fixtureFile,reportFile,nativeFile]=process.argv.slice(2);
if(!currentFile||!priorFile||!fixtureFile||!reportFile||!nativeFile)throw new Error('Usage: audit-cbb-market-behavior.ts CURRENT_JSON PRIOR_JSON FIXTURE_JSON REPORT_JSON CANONICAL_HISTORY_JSON (local files only; no network or database writes)');
async function main(){
 const source=read(currentFile) as Source,prior=read(priorFile) as Source,input=read(fixtureFile) as {games:CbbGame[]};
 const native=read(nativeFile) as {asOf:string;since:string;priceRows:CbbCanonicalPriceRow[];splitRows:CbbCanonicalSplitRow[];price:{complete:boolean};split:{complete:boolean};complete:boolean};
 assert.equal(native.complete,true,'a partial historical window cannot qualify this replay');
 assert.equal(native.price.complete,true);assert.equal(native.split.complete,true);
 const priceById=new Map<number,CbbCanonicalPriceRow[]>(),splitById=new Map<number,CbbCanonicalSplitRow[]>();
 for(const row of native.priceRows){const id=Number(row.canonical_event_id),rows=priceById.get(id)??[];rows.push(row);priceById.set(id,rows);}
 for(const row of native.splitRows){const id=Number(row.canonical_event_id),rows=splitById.get(id)??[];rows.push(row);splitById.set(id,rows);}
 const active=source.rows.filter((r)=>r.snapshot.lockedAt===null&&Date.parse(r.snapshot.startsAt)>Date.parse(r.snapshot.board.asOf)+3600_000);
 const counts=(rows:Array<{grade:string}>)=>rows.reduce<Record<string,number>>((a,r)=>(a[r.grade]=(a[r.grade]??0)+1,a),{});
 const bundles=active.map(r=>{const b=r.snapshot.board;assert.ok(!Object.hasOwn(b.marketContext,"contextualOutcomeEvidence"),"Legacy replay cannot reinterpret a released contextual outcome board");const s=b.score,fixture=input.games.find((g)=>g.id===r.snapshot.gameId);assert.ok(fixture);assert.ok(b.modelRelease);
  assert.equal(native.asOf,b.asOf,'native window cutoff must match this decision');
  assert.ok(Date.parse(native.since)<=Date.parse(b.asOf)-6*3600_000,'native window must cover the complete bootstrap');
  const base:CbbForecast={release:b.modelRelease,gameId:r.snapshot.gameId,asOf:b.asOf,homeId:fixture.home_team.id,awayId:fixture.visitor_team.id,homeScore:s.home,awayScore:s.away,margin:s.margin,total:s.total,homeWinProbability:s.homeWinProbability,uncertainty:artifact.uncertainty,possessions:0,inputStatus:'complete',issues:[]};
  const targets:CbbQuote[]=b.rows.map((row)=>{assert.ok(row.observedQuote&&row.targetBook&&row.quoteObservedAt);return ({gameId:base.gameId,market:row.market,line:row.line,firstPrice:row.observedQuote.firstPrice,secondPrice:row.observedQuote.secondPrice,sportsbook:row.targetBook,provider:row.quoteProvider??undefined,providerObservedAt:row.quoteObservedAt,fetchedAt:b.asOf,phase:'current'});});
  const quotes:CbbQuote[]=b.rows.flatMap((row)=>row.professionalReferenceQuotes??[]),key=`r3-diagnostic-fixture-${base.gameId}`;
  const evidence=pairCbbCanonicalMarketEvidence({game:fixture,decisionAt:b.asOf,priceRows:priceById.get(base.gameId),splitRows:splitById.get(base.gameId)});
  const history=cbbCanonicalBehaviorInputs(evidence);
  const result=readCbbMarketBehavior({independent:base,independentInputKey:key,startsAt:r.snapshot.startsAt,targets,currentQuotes:quotes,
    anchors:null,historyQuotes:history.historyQuotes,historyFlows:history.historyFlows,quarantinedSources:history.quarantinedSources,
    historyCompleteness:{price:native.price.complete,split:native.split.complete}});
  const markets=targets.map(target=>{const before=gradeCbbProvisional({forecast:base,target,references:quotes,asOf:b.asOf}),stored=b.rows.find((x)=>x.market===target.market),after=gradeCbbMarketBehavior({forecast:result.forecast,target,references:quotes,asOf:b.asOf},result.receipt);assert.ok(stored);assert.equal(before.grade,stored.grade);assert.equal(before.selection,stored.selection);assert.ok(Math.abs((before.expectedValue??0)-(stored.expectedValue??0))<1e-9);
   const actionable=(x:string)=>x==='Best Angle'||x==='Lean';
   return ({id:base.gameId,matchup:`${r.awayName} @ ${r.homeName}`,market:target.market,target,old:{grade:before.grade,selection:before.selection,ev:before.expectedValue,price:before.price,probability:reviewCbbQuote(base,target).probability},next:{grade:after.grade,selection:after.selection,ev:after.expectedValue,price:after.price,probability:after.selection===null?null:reviewCbbQuote(result.forecast,target).probability,pressure:after.marketPressure,economicCorroboration:after.economicCorroboration,economicPathConfirmation:after.economicPathConfirmation,actualActionConfirmation:after.actualActionConfirmation,pathResistance:after.pathResistance,gradeBasis:after.gradeBasis},promotion:!actionable(before.grade)&&actionable(after.grade),demotion:actionable(before.grade)&&!actionable(after.grade),sideChanged:before.selection!==after.selection});
  });
  const game={id:base.gameId,matchup:`${r.awayName} @ ${r.homeName}`,asOf:b.asOf,old:s,next:result.receipt.finalScore,winnerArbitration:result.receipt.winnerArbitration,margin:result.receipt.margin,total:result.receipt.total,episodes:result.receipt.episodes.map(e=>({book:e.book,market:e.market,delta:e.delta,anchor:e.anchor,current:e.current})),pathPosture:result.receipt.pathPosture,nativePricePairs:history.historyQuotes.length,nativeFlowPairs:history.historyFlows.length,nativeSplitContext:history.splitContext.length,quarantined:history.quarantinedSources,informationOverlap:result.receipt.informationOverlap};
  return {game,markets};
 });
 const all=bundles.flatMap(x=>x.markets),games=bundles.map(x=>x.game);
 const selected=games.map(g=>({g,key:createHash('sha256').update(`cbb-market-review-20261102:${g.id}`).digest('hex')})).sort((a,b)=>a.key.localeCompare(b.key)).slice(0,8).map(x=>x.g);
 const report={at:new Date().toISOString(),declaration:'Fixed private candidate; no outcomes, refits or production writes',sourceCapturedAt:source.at,priorCapturedAt:prior.at,games:games.length,markets:all.length,oldCounts:counts(all.map(r=>r.old)),newCounts:counts(all.map(r=>r.next)),promotions:all.filter(r=>r.promotion).length,demotions:all.filter(r=>r.demotion).length,netActionables:all.filter(r=>r.promotion).length-all.filter(r=>r.demotion).length,sideChanges:all.filter(r=>r.sideChanged).length,winnerArbitrations:0,staticOppositionContexts:games.filter(g=>g.winnerArbitration.status==='context_only').length,relativeMarginApplications:games.filter(g=>g.margin.reason==='observed_same_book_relative_economics').length,relativeTotalApplications:games.filter(g=>g.total.status==='applied').length,randomSeed:'cbb-market-review-20261102',randomSpotChecks:selected,cornell:games.find(g=>g.id===10882496),allGames:games,allMarkets:all,targetReceiptLimitation:'Target fetchedAt absent from stored board: decision asOf used only as diagnostic upperbound; original observed pair/prices retained. No live input receipt is invented.',outcomeQualification:'Unavailable; current games unplayed; opened21 historical rows lack movement pairs. Owner exception required for provisional publication under model-change-safety.',providerRequests:0,databaseWrites:0};
 Object.assign(report,{qualification:'Functional private diagnostic only; not exact live-grade or outcome qualification',
  targetRequestClock:'not_stored; new causal price/action confirmation withheld',
  anchorPolicy:'native six-hour window only; legacy independent-input parity not invented',
  nativeWindow:{asOf:native.asOf,since:native.since,complete:native.complete},
  tierChanges:all.filter(r=>r.old.grade!==r.next.grade).length,
  causalPriceConfirmations:all.filter(r=>r.next.economicPathConfirmation).length,
  nativeActionConfirmations:all.filter(r=>r.next.actualActionConfirmation).length,
  bestAttribution:all.filter(r=>r.next.grade==='Best Angle').reduce<Record<string,number>>((a,r)=>(a[r.next.gradeBasis]=(a[r.next.gradeBasis]??0)+1,a),{})});
 fs.writeFileSync(reportFile,JSON.stringify(report,null,2));console.log(JSON.stringify({games:report.games,markets:report.markets,old:report.oldCounts,next:report.newCounts,promotions:report.promotions,demotions:report.demotions,sideChanges:report.sideChanges,cornellMargin:report.cornell?.next.margin,reportFile,qualification:'functional private diagnostic; no historical target request clocks; not outcome qualification'},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
