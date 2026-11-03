/** Offline archived-opening diagnostic only. Importing this file never fits real data. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { cbbExactMarketCenter, CBB_EXACT_CENTER_RESEARCH_RELEASE } from "../../lib/cbb/marketReaderResearch";
import { cbbImpliedProbability, reviewCbbQuote } from "../../lib/cbb/marketEvidence";
import { normalCdf, cbbThresholdProbabilities, settleCbbMarket } from "../../lib/cbb/model";
import { evaluateCbbMarketReaderRows } from "../../lib/cbb/marketReaderEvaluation";
import { fitCbbMarketLevelStack, predictCbbMarketLevelStack, CBB_LEVEL_STACK_RESEARCH_RELEASE,
  type CbbLevelStackExpert, type CbbLevelStackTrainingRow } from "../../lib/cbb/marketLevelStackResearch";
import type { CbbForecast, CbbMarket, CbbQuote, CbbTrainingGame, CbbUncertainty } from "../../lib/cbb/types";

export const CBB_LEVEL_STACK_DECLARATION_COMMIT="a0bfc973dd34a47b69bbd16867b338bc331d64f2";
export const CBB_LEVEL_STACK_DECLARATION_PATH="docs/model-audits/2026-11-02-cbb-level-stack-predeclaration.md";
export const CBB_LEVEL_STACK_ARCHIVE_SHA256="47adb0ee1eb2a9010891ecacd29e269b77e9b4e5a0a7d76b990d1bfd201f5c64";
const SOURCE_SCOPE="retrospective_bdl_retail_archived_opening_1h_fixture_corroborated";
const EXPECTED_INDEPENDENT_RELEASE="cbb_shadow_2026_11_02_stthomas_verified_venue_inputs";
const MARKETS:CbbMarket[]=["moneyline","spread","total"];
const BOOKS=new Set(["draftkings","fanduel","betmgm","caesars","betrivers"]);
const family=(book:string)=>["pinnacle","ps3838"].includes(book.toLowerCase())?"pinnacle":book.toLowerCase();
const epoch=(clock:string)=>Date.parse(clock);
const sign=(value:number)=>Math.abs(value)<=1e-7?0:value>0?1:-1;
const sha=(bytes:string|Buffer)=>createHash("sha256").update(bytes).digest("hex");
type Axis="margin"|"total";
type Reference={quote:CbbQuote;orientation:string;availability:string};
export type CbbLevelStackArchiveRow={game:CbbTrainingGame;forecast:CbbForecast;targets:CbbQuote[];evidence:Reference[];orientationEventId:string};
type AxisCase={experts:CbbLevelStackExpert[];values:Record<string,number>;pattern:string};
export type CbbLevelStackCase={row:CbbLevelStackArchiveRow;margin:AxisCase;total:AxisCase;outcomeAvailableAt:string;
  targetFamilies:string[];sourceProblems:string[];retainedSourceQuotes:CbbQuote[];sourceAgreement:Array<{book:string;spreadCenter:number;moneylineCenter:number;winnerAgreement:"agrees"|"opposes"|"neutral"}>};
const pattern=(experts:CbbLevelStackExpert[])=>JSON.stringify(experts.map(e=>e.id).sort());
const tuple=(quote:CbbQuote)=>JSON.stringify([quote.line,quote.firstPrice,quote.secondPrice]);
function validPair(q:CbbQuote){
  if(![q.firstPrice,q.secondPrice].every(p=>Number.isFinite(p)&&Number.isInteger(p)&&Math.abs(p)>=100)||
    q.market!=="moneyline"&&(q.line===null||!Number.isFinite(q.line)||!Number.isInteger(q.line*2))||q.market==="total"&&q.line!<=0)return false;
  const hold=cbbImpliedProbability(q.firstPrice)+cbbImpliedProbability(q.secondPrice);return hold>=.98&&hold<=1.3;
}
/** No cached features or cached context are read. One physical book owns one
 * margin expert: exact Spread center first; ML-only has a different pattern. */
export function buildCbbLevelStackCase(row:CbbLevelStackArchiveRow):CbbLevelStackCase{
  const {game,forecast}=row,at=epoch(forecast.asOf);
  if(!Number.isFinite(at)||at>=epoch(game.date)||forecast.gameId!==game.id||forecast.homeId!==game.homeId||forecast.awayId!==game.awayId||
    forecast.inputStatus!=="complete"||!row.orientationEventId||!Number.isInteger(game.homeScore)||!Number.isInteger(game.awayScore)||game.homeScore===game.awayScore||
    Math.abs(forecast.homeScore-forecast.awayScore-forecast.margin)>1e-8||Math.abs(forecast.homeScore+forecast.awayScore-forecast.total)>1e-8)
    throw new Error(`Invalid archived CBB forecast/fixture ${game.id}`);
  if(row.targets.length!==3||MARKETS.some(m=>row.targets.filter(q=>q.market===m).length!==1)||row.targets.some(q=>q.gameId!==game.id||q.phase!=="opening"||
    !validPair(q)||!Number.isFinite(epoch(q.providerObservedAt))||epoch(q.providerObservedAt)>at))throw new Error(`Invalid exact archived target ${game.id}`);
  const targetFamilies=[...new Set(row.targets.map(q=>family(q.sportsbook)))].sort(),excluded=new Set(targetFamilies),sourceProblems:string[]=[];
  const groups=new Map<string,CbbQuote[]>();
  for(const source of row.evidence){
    const q=source.quote,book=family(q.sportsbook),observed=epoch(q.providerObservedAt);
    let reason:string|null=null;
    if(q.gameId!==game.id)reason="wrong_game";
    else if(excluded.has(book))reason="target_family_excluded";
    else if(!BOOKS.has(book))reason="outside_declared_retail_opening_source_scope";
    else if(source.availability!=="provider_archived_opening"||q.phase!=="opening")reason="not_archived_opening";
    else if(!["fixture_corroborated","named_selections_verified"].includes(source.orientation))reason="unverified_fixture_orientation";
    else if(!MARKETS.includes(q.market)||!validPair(q))reason="invalid_complete_source_pair";
    else if(!Number.isFinite(observed)||observed>at||at-observed>3600_000)reason="future_or_older_than_1h";
    if(reason){sourceProblems.push(`${book}:${q.market}:${reason}`);continue;}
    const key=`${book}:${q.market}`;groups.set(key,[...(groups.get(key)??[]),q]);
  }
  const centers=new Map<string,Map<CbbMarket,number>>(),retainedSourceQuotes:CbbQuote[]=[];
  for(const [key,quotes] of groups){
    const latest=Math.max(...quotes.map(q=>epoch(q.providerObservedAt))),same=quotes.filter(q=>epoch(q.providerObservedAt)===latest);
    if(new Set(same.map(tuple)).size!==1){sourceProblems.push(`${key}:ambiguous_latest_source_pair`);continue;}
    const q=same[0],book=family(q.sportsbook),fair=cbbImpliedProbability(q.firstPrice)/(cbbImpliedProbability(q.firstPrice)+cbbImpliedProbability(q.secondPrice));
    const center=cbbExactMarketCenter(forecast,q,fair),byMarket=centers.get(book)??new Map<CbbMarket,number>();
    byMarket.set(q.market,center);centers.set(book,byMarket);retainedSourceQuotes.push(structuredClone(q));
  }
  const marginExperts:CbbLevelStackExpert[]=[{id:"independent",kind:"independent"}],totalExperts:CbbLevelStackExpert[]=[{id:"independent",kind:"independent"}];
  const marginValues:Record<string,number>={independent:forecast.margin},totalValues:Record<string,number>={independent:forecast.total};
  const sourceAgreement:CbbLevelStackCase["sourceAgreement"]=[];
  for(const [book,byMarket] of [...centers].sort(([a],[b])=>a.localeCompare(b))){
    const spread=byMarket.get("spread"),ml=byMarket.get("moneyline"),total=byMarket.get("total");
    const owner=spread!==undefined?"spread":ml!==undefined?"moneyline":null;
    if(owner){const id=`${book}:${owner}`;marginExperts.push({id,kind:"market",book,market:owner});marginValues[id]=byMarket.get(owner)!;}
    if(total!==undefined){const id=`${book}:total`;totalExperts.push({id,kind:"market",book,market:"total"});totalValues[id]=total;}
    if(spread!==undefined&&ml!==undefined)sourceAgreement.push({book,spreadCenter:spread,moneylineCenter:ml,
      winnerAgreement:sign(spread)===0||sign(ml)===0?"neutral":sign(spread)===sign(ml)?"agrees":"opposes"});
  }
  return {row,margin:{experts:marginExperts,values:marginValues,pattern:pattern(marginExperts)},
    total:{experts:totalExperts,values:totalValues,pattern:pattern(totalExperts)},outcomeAvailableAt:new Date(epoch(game.date)+6*3600_000).toISOString(),
    targetFamilies,sourceProblems,retainedSourceQuotes,sourceAgreement};
}
type FitResult=ReturnType<typeof fitCbbMarketLevelStack>;
type FittedModel=Extract<FitResult,{status:"fitted"}>["model"];
type PatternFit={axis:Axis;pattern:string;games:number;experts:CbbLevelStackExpert[];fit:FitResult};
type MeanRead={margin:number;total:number;marginApplied:boolean;totalApplied:boolean;appliedPattern:boolean;meanChanged:boolean;fallbackReasons:string[]};
function fitPatterns(cases:CbbLevelStackCase[],axis:Axis,trainingCutoff:string):PatternFit[]{
  const groups=new Map<string,CbbLevelStackCase[]>();for(const row of cases)if(row[axis].experts.length>1)groups.set(row[axis].pattern,[...(groups.get(row[axis].pattern)??[]),row]);
  return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([key,group])=>{
    const rows:CbbLevelStackTrainingRow[]=group.map(c=>({gameId:c.row.game.id,decisionAt:c.row.forecast.asOf,outcomeAvailableAt:c.outcomeAvailableAt,
      outcome:axis==="margin"?c.row.game.homeScore-c.row.game.awayScore:c.row.game.homeScore+c.row.game.awayScore,values:c[axis].values}));
    const experts=group[0][axis].experts;
    return {axis,pattern:key,games:group.length,experts,fit:fitCbbMarketLevelStack({axis,experts,rows,trainingCutoff,sourceScope:`${SOURCE_SCOPE};independent=${EXPECTED_INDEPENDENT_RELEASE};inversion=${CBB_EXACT_CENTER_RESEARCH_RELEASE}`})};
  });
}
function meanRead(c:CbbLevelStackCase,models:Map<string,FittedModel>):MeanRead{
  const values={margin:c.row.forecast.margin,total:c.row.forecast.total},applied={margin:false,total:false},fallbackReasons:string[]=[];
  for(const axis of ["margin","total"] as const){
    const model=models.get(`${axis}:${c[axis].pattern}`);
    if(!model){fallbackReasons.push(`${axis}:${c[axis].experts.length===1?"no_fresh_market_expert":"unsupported_or_unidentified_exact_source_pattern"}`);continue;}
    const prediction=predictCbbMarketLevelStack(model,c[axis].values);
    if(prediction.status==="predicted"){values[axis]=prediction.value;applied[axis]=true;}else fallbackReasons.push(`${axis}:${prediction.status}`);
  }
  if(!Number.isFinite(values.margin)||!Number.isFinite(values.total)||values.total<=Math.abs(values.margin))return {margin:c.row.forecast.margin,total:c.row.forecast.total,
    marginApplied:false,totalApplied:false,appliedPattern:false,meanChanged:false,fallbackReasons:[...fallbackReasons,"incoherent_final_score_exact_baseline_fallback"]};
  return {...values,marginApplied:applied.margin,totalApplied:applied.total,appliedPattern:applied.margin||applied.total,
    meanChanged:Math.abs(values.margin-c.row.forecast.margin)>1e-9||Math.abs(values.total-c.row.forecast.total)>1e-9,fallbackReasons};
}
export function calibrateCbbLevelStackResidualLaw(rows:Array<{marginResidual:number;totalResidual:number}>){
  if(rows.length<2)return {status:"unidentified" as const,reason:"fewer_than_two_paired_calibration_residuals"};
  if(rows.some(r=>![r.marginResidual,r.totalResidual].every(Number.isFinite)))throw new Error("Nonfinite CBB calibration residual");
  const n=rows.length,marginSecondMoment=rows.reduce((s,r)=>s+r.marginResidual**2,0)/n,totalSecondMoment=rows.reduce((s,r)=>s+r.totalResidual**2,0)/n,
    crossMoment=rows.reduce((s,r)=>s+r.marginResidual*r.totalResidual,0)/n,determinant=marginSecondMoment*totalSecondMoment-crossMoment**2;
  if(![marginSecondMoment,totalSecondMoment,crossMoment,determinant].every(Number.isFinite))return {status:"unidentified" as const,reason:"nonfinite_derived_residual_second_moment",n};
  if(!(marginSecondMoment>0&&totalSecondMoment>0&&determinant>0))return {status:"unidentified" as const,reason:"nonpositive_or_singular_residual_second_moment",n,marginSecondMoment,totalSecondMoment,crossMoment,determinant};
  const marginSd=Math.sqrt(marginSecondMoment),totalSd=Math.sqrt(totalSecondMoment),marginTotalCorrelation=crossMoment/(marginSd*totalSd);
  if(![marginSd,totalSd,marginTotalCorrelation].every(Number.isFinite)||!(Math.abs(marginTotalCorrelation)<1))return {status:"unidentified" as const,reason:"invalid_residual_correlation",n,marginSecondMoment,totalSecondMoment,crossMoment,determinant};
  return {status:"calibrated" as const,n,marginSd,totalSd,marginTotalCorrelation,marginSecondMoment,totalSecondMoment,crossMoment,determinant,
    meanMarginResidual:rows.reduce((s,r)=>s+r.marginResidual,0)/n,meanTotalResidual:rows.reduce((s,r)=>s+r.totalResidual,0)/n};
}
type CalibratedLaw=Extract<ReturnType<typeof calibrateCbbLevelStackResidualLaw>,{status:"calibrated"}>;
function withLaw(base:CbbForecast,means:MeanRead,law?:CalibratedLaw,independentMeans=false):CbbForecast{
  if(!means.appliedPattern)return base;
  const margin=independentMeans?base.margin:means.margin,total=independentMeans?base.total:means.total;
  const uncertainty:CbbUncertainty=law?{...base.uncertainty,marginSd:law.marginSd,totalSd:law.totalSd,marginTotalCorrelation:law.marginTotalCorrelation,
    marginCorrection:0,totalCorrection:0,fitThroughSeason:2025,games:law.n}:{...base.uncertainty};
  const zero=normalCdf((.5-margin)/uncertainty.marginSd)-normalCdf((-.5-margin)/uncertainty.marginSd);
  const homeWinProbability=(1-normalCdf((.5-margin)/uncertainty.marginSd))/(1-zero);
  if(!Number.isFinite(homeWinProbability)||homeWinProbability<0||homeWinProbability>1)throw new Error("Invalid CBB final no-tie law");
  return {...base,release:CBB_LEVEL_STACK_RESEARCH_RELEASE,margin,total,homeScore:(total+margin)/2,awayScore:(total-margin)/2,homeWinProbability,uncertainty};
}
export function describeCbbLevelStackDecision(c:CbbLevelStackCase,forecast:CbbForecast,period:string){
  const snapshot=(f:CbbForecast)=>{const homeMinusAwayError=f.homeScore-f.awayScore-f.margin,homePlusAwayError=f.homeScore+f.awayScore-f.total,
    winnerSpreadZeroError=cbbThresholdProbabilities(f,"spread",0).first-f.homeWinProbability;
    return {release:f.release,home:f.homeScore,away:f.awayScore,margin:f.margin,total:f.total,homeWinProbability:f.homeWinProbability,uncertainty:f.uncertainty,
      coherence:{homeMinusAwayError,homePlusAwayError,winnerSpreadZeroError,valid:[homeMinusAwayError,homePlusAwayError,winnerSpreadZeroError].every(e=>Math.abs(e)<=1e-8)}};};
  const marketDecision=(f:CbbForecast,q:CbbQuote)=>{const p=cbbThresholdProbabilities(f,q.market,q.line),review=reviewCbbQuote(f,q);
    const selection=review.selection as "first"|"second";
    return {selection,price:selection==="first"?q.firstPrice:q.secondPrice,firstProbability:p.first,secondProbability:p.second,pushProbability:p.push,
      selectedProbability:review.probability,expectedValue:review.expectedValue,outcome:settleCbbMarket(q.market,selection,q.line,c.row.game.homeScore,c.row.game.awayScore)};};
  return {gameId:c.row.game.id,date:c.row.game.date,decisionAt:c.row.forecast.asOf,outcomeAvailableAt:c.outcomeAvailableAt,period,
    marginPattern:c.margin.pattern,totalPattern:c.total.pattern,actual:{home:c.row.game.homeScore,away:c.row.game.awayScore},
    baseline:snapshot(c.row.forecast),candidate:snapshot(forecast),markets:c.row.targets.map(target=>({market:target.market,target,
      baseline:marketDecision(c.row.forecast,target),candidate:marketDecision(forecast,target)}))};
}
function summary(cases:CbbLevelStackCase[],forecasts:CbbForecast[]){
  const rows=cases.map((c,i)=>({game:c.row.game,forecast:forecasts[i],features:[],targets:c.row.targets}));
  const evaluated=evaluateCbbMarketReaderRows(rows);
  const n=Math.max(1,rows.length),score={...evaluated.score,
    marginRmse:Math.sqrt(rows.reduce((s,r)=>s+(r.game.homeScore-r.game.awayScore-r.forecast.margin)**2,0)/n),
    totalRmse:Math.sqrt(rows.reduce((s,r)=>s+(r.game.homeScore+r.game.awayScore-r.forecast.total)**2,0)/n),
    teamScoreRmse:Math.sqrt(rows.reduce((s,r)=>s+((r.game.homeScore-r.forecast.homeScore)**2+(r.game.awayScore-r.forecast.awayScore)**2)/2,0)/n)};
  const result={...evaluated,score};
  const priceEV=Object.fromEntries(MARKETS.map(market=>{const reviews=rows.map(r=>reviewCbbQuote(r.forecast,r.targets.find(q=>q.market===market)!));
    return [market,{games:reviews.length,meanModelExpectedValue:reviews.reduce((s,r)=>s+r.expectedValue,0)/Math.max(1,reviews.length),
      positiveModelEV:reviews.filter(r=>r.expectedValue>0).length,nonpositiveModelEV:reviews.filter(r=>r.expectedValue<=0).length}];}));
  return {...result,priceEV};
}
function compare(cases:CbbLevelStackCase[],forecasts:CbbForecast[]){
  const baseline=cases.map(c=>c.row.forecast),old=summary(cases,baseline),next=summary(cases,forecasts);
  const paired=Object.fromEntries(MARKETS.map(market=>{let correctedLosses=0,harmedWins=0,sideChanges=0,pushTransitions=0;
    for(let i=0;i<cases.length;i++){
      const q=cases[i].row.targets.find(t=>t.market===market)!,before=reviewCbbQuote(baseline[i],q),after=reviewCbbQuote(forecasts[i],q);
      sideChanges+=Number(before.selection!==after.selection);
      const g=cases[i].row.game,first=market==="total"?g.homeScore+g.awayScore-q.line!:g.homeScore-g.awayScore+(market==="spread"?q.line!:0);
      const outcome=(selection:"first"|"second")=>first===0?"push":(first>0)===(selection==="first")?"win":"loss";
      const a=outcome(before.selection as "first"|"second"),b=outcome(after.selection as "first"|"second");correctedLosses+=Number(a==="loss"&&b==="win");harmedWins+=Number(a==="win"&&b==="loss");pushTransitions+=Number(a!==b&&(a==="push"||b==="push"));
    }
    return [market,{correctedLosses,harmedWins,sideChanges,pushTransitions}];}));
  return {baseline:old,candidate:next,paired};
}
const latestOutcome=(cases:CbbLevelStackCase[])=>new Date(Math.max(...cases.map(c=>epoch(c.outcomeAvailableAt)))).toISOString();
/** Called with real rows only after the separate predeclaration commit is frozen. */
export function evaluateCbbMarketLevelStackArchive(rows:CbbLevelStackArchiveRow[]){
  if(rows.length!==1070||new Set(rows.map(r=>r.game.id)).size!==1070||rows.some(r=>r.forecast.release!==EXPECTED_INDEPENDENT_RELEASE))throw new Error("CBB frozen1070 independent cohort changed");
  const cases=rows.map(buildCbbLevelStackCase),fit=cases.filter(c=>c.row.game.date<"2026-02-15"),selection=cases.filter(c=>c.row.game.date>="2026-02-15"&&c.row.game.date<"2026-03-01"),
    later=cases.filter(c=>c.row.game.date>="2026-03-01");
  if(fit.length!==433||selection.length!==408||later.length!==229)throw new Error("CBB frozen calendar partition changed");
  const fitCutoff=latestOutcome(fit),calibration=selection.filter(c=>epoch(c.row.forecast.asOf)>=epoch(fitCutoff));
  if(!calibration.length)throw new Error("CBB calibration cohort empty after availability guard");
  const calibrationCutoff=latestOutcome(calibration),evaluation=later.filter(c=>epoch(c.row.forecast.asOf)>=epoch(calibrationCutoff));
  const patternFits=[...fitPatterns(fit,"margin",fitCutoff),...fitPatterns(fit,"total",fitCutoff)];
  const models=new Map<string,FittedModel>();for(const item of patternFits)if(item.fit.status==="fitted")models.set(`${item.axis}:${item.pattern}`,item.fit.model);
  const calibrationMeans=calibration.map(c=>meanRead(c,models)),applicable=calibration.filter((_,i)=>calibrationMeans[i].appliedPattern);
  const candidateResiduals=calibration.flatMap((c,i)=>calibrationMeans[i].appliedPattern?[{marginResidual:c.row.game.homeScore-c.row.game.awayScore-calibrationMeans[i].margin,
    totalResidual:c.row.game.homeScore+c.row.game.awayScore-calibrationMeans[i].total}]:[]);
  const independentResiduals=applicable.map(c=>({marginResidual:c.row.game.homeScore-c.row.game.awayScore-c.row.forecast.margin,totalResidual:c.row.game.homeScore+c.row.game.awayScore-c.row.forecast.total}));
  const candidateLaw=calibrateCbbLevelStackResidualLaw(candidateResiduals),independentLaw=calibrateCbbLevelStackResidualLaw(independentResiduals);
  const laterMeans=evaluation.map(c=>meanRead(c,models));
  const final=evaluation.map((c,i)=>candidateLaw.status==="calibrated"?withLaw(c.row.forecast,laterMeans[i],candidateLaw):c.row.forecast);
  const attribution=evaluation.map((c,i)=>independentLaw.status==="calibrated"?withLaw(c.row.forecast,laterMeans[i],independentLaw,true):c.row.forecast);
  const fitPredictions=fit.map(c=>withLaw(c.row.forecast,meanRead(c,models))),calibrationPredictions=calibration.map((c,i)=>withLaw(c.row.forecast,calibrationMeans[i]));
  const coverage=(items:CbbLevelStackCase[],means:MeanRead[])=>({games:items.length,marginApplicable:means.filter(r=>r.marginApplied).length,totalApplicable:means.filter(r=>r.totalApplied).length,
    anyHeadApplicable:means.filter(r=>r.appliedPattern).length,bothPatternsFallback:means.filter(r=>!r.appliedPattern).length,meanChanged:means.filter(r=>r.meanChanged).length,
    reasons:Object.fromEntries([...new Set(means.flatMap(r=>r.fallbackReasons))].map(reason=>[reason,means.filter(r=>r.fallbackReasons.includes(reason)).length]))});
  const probabilityChanged=(c:CbbLevelStackCase,next:CbbForecast)=>MARKETS.some(m=>{
    const q=c.row.targets.find(q=>q.market===m)!,a=cbbThresholdProbabilities(c.row.forecast,m,q.line),b=cbbThresholdProbabilities(next,m,q.line);
    return Math.abs(a.first-b.first)>1e-9||Math.abs(a.second-b.second)>1e-9||Math.abs(a.push-b.push)>1e-9;
  });
  const perGame=evaluation.map((c,i)=>({...describeCbbLevelStackDecision(c,final[i],"later_after_frozen_calibration"),meanRead:laterMeans[i],finalLawApplied:laterMeans[i].appliedPattern&&candidateLaw.status==="calibrated",probabilityChanged:probabilityChanged(c,final[i]),actualMeanChanged:Math.abs(final[i].margin-c.row.forecast.margin)>1e-9||Math.abs(final[i].total-c.row.forecast.total)>1e-9}));
  return {release:CBB_LEVEL_STACK_RESEARCH_RELEASE,scope:SOURCE_SCOPE,independentRelease:EXPECTED_INDEPENDENT_RELEASE,priceCenterInversionRelease:CBB_EXACT_CENTER_RESEARCH_RELEASE,
    productionWrites:0,providerRequests:0,databaseQueries:0,
    qualification:"Already-opened one-season archived-retail-opening retrospective diagnostic; no untouched/live-current professional or November calibration claim.",
    estimator:"One exact source-pattern convex least-squares stack per axis; no intercept, hypersearch, source substitution or missing-book renormalization.",
    outcomeClock:"Game scheduled start+6h is the original historical runtime holdback, not a newly asserted provider result receipt.",
    counts:{all:cases.length,fit:fit.length,calendarSelection:selection.length,calibration:calibration.length,selectionBeforeFitAvailable:selection.length-calibration.length,
      calendarLater:later.length,evaluation:evaluation.length,laterBeforeCalibrationAvailable:later.length-evaluation.length},fitCutoff,calibrationCutoff,
    patterns:patternFits,calibration:{candidateLaw,independentAttributionLaw:independentLaw,matchingApplicableGames:applicable.length,gameIds:applicable.map(c=>c.row.game.id)},
    coverage:{fit:coverage(fit,fit.map(c=>meanRead(c,models))),calibration:coverage(calibration,calibrationMeans),evaluation:coverage(evaluation,laterMeans)},
    trainingInSampleDiagnostic:compare(fit,fitPredictions),calibrationBeforeResidualLaw:compare(calibration,calibrationPredictions),
    selectionBeforeFitAvailableExactBaseline:compare(selection.filter(c=>epoch(c.row.forecast.asOf)<epoch(fitCutoff)),selection.filter(c=>epoch(c.row.forecast.asOf)<epoch(fitCutoff)).map(c=>c.row.forecast)),
    laterBeforeCalibrationAvailableExactBaseline:compare(later.filter(c=>epoch(c.row.forecast.asOf)<epoch(calibrationCutoff)),later.filter(c=>epoch(c.row.forecast.asOf)<epoch(calibrationCutoff)).map(c=>c.row.forecast)),
    finalEvaluationCoverage:{games:evaluation.length,appliedPattern:laterMeans.filter(m=>m.appliedPattern).length,
      finalLawApplied:perGame.filter(r=>r.finalLawApplied).length,actualMeanChanged:perGame.filter(r=>r.actualMeanChanged).length,probabilityChanged:perGame.filter(r=>r.probabilityChanged).length,
      exactWholeForecastFallback:perGame.filter(r=>!r.finalLawApplied).length},
    evaluation:compare(evaluation,final),independentConditionalCalibrationAttribution:compare(evaluation,attribution),
    gradeImpact:{status:"out_of_scope",reason:"Archived opening receipts are not current executable production grade inputs; no grade/stake qualification inferred."},
    sourceLedger:cases.map(c=>({gameId:c.row.game.id,decisionAt:c.row.forecast.asOf,targetFamilies:c.targetFamilies,sourceProblems:c.sourceProblems,
      sourceAgreement:c.sourceAgreement,retainedSourceQuotes:c.retainedSourceQuotes,margin:c.margin,total:c.total})),perGame,
    rowReports:{trainingInSample:fit.map((c,i)=>describeCbbLevelStackDecision(c,fitPredictions[i],"training_in_sample_diagnostic")),
      calibrationBeforeResidualLaw:calibration.map((c,i)=>describeCbbLevelStackDecision(c,calibrationPredictions[i],"calibration_before_residual_law")),
      selectionBeforeFitAvailable:selection.filter(c=>epoch(c.row.forecast.asOf)<epoch(fitCutoff)).map(c=>describeCbbLevelStackDecision(c,c.row.forecast,"selection_before_fit_available_exact_baseline")),
      laterBeforeCalibrationAvailable:later.filter(c=>epoch(c.row.forecast.asOf)<epoch(calibrationCutoff)).map(c=>describeCbbLevelStackDecision(c,c.row.forecast,"later_before_calibration_available_exact_baseline")),
      evaluation:perGame}};
}
export function assertCbbLevelStackDeclaration(commit:string|undefined,path:string|undefined){
  if(commit!==CBB_LEVEL_STACK_DECLARATION_COMMIT||path!==CBB_LEVEL_STACK_DECLARATION_PATH)throw new Error("CBB real fit requires the exact frozen declaration commit/path; no fit occurred");
}
function main(){
  const arg=(name:string)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
  const declarationCommit=arg("declaration-commit"),declarationPath=arg("declaration-path"),out=arg("out");
  assertCbbLevelStackDeclaration(declarationCommit,declarationPath);
  if(!out)throw new Error("Real-cohort fit requires --out=<offlineJSON>; no fit occurred");
  const declaration=execFileSync("git",["show",`${declarationCommit}:${declarationPath}`],{encoding:"utf8",maxBuffer:2_000_000});
  if(!declaration.trim())throw new Error("Frozen declaration empty");
  const data=arg("data")??"/private/tmp/oddsphere-cbb-stthomas-recovery-20261102/historical-2025-candidate-rows.json",bytes=readFileSync(data);
  if(sha(bytes)!==CBB_LEVEL_STACK_ARCHIVE_SHA256)throw new Error("Frozen CBB archive SHA mismatch; no fit occurred");
  const report=evaluateCbbMarketLevelStackArchive(JSON.parse(bytes.toString("utf8")) as CbbLevelStackArchiveRow[]);
  const provenance={dataFile:resolve(data),dataBytes:bytes.length,dataSha256:sha(bytes),declarationCommit,declarationPath,declarationSha256:sha(declaration),
    operatorSha256:sha(readFileSync(process.argv[1])),methodSha256:sha(readFileSync(resolve("lib/cbb/marketLevelStackResearch.ts")))};
  writeFileSync(out,JSON.stringify({...report,provenance},null,2));
  console.log(JSON.stringify({out:resolve(out),provenance,counts:report.counts,coverage:report.coverage,calibration:report.calibration,
    evaluation:report.evaluation,independentConditionalCalibrationAttribution:report.independentConditionalCalibrationAttribution},null,2));
}
if(["evaluate-cbb-market-level-stack.ts","evaluate-cbb-market-level-stack.js"].includes(basename(process.argv[1]??"")))main();
