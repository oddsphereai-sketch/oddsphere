import assert from "node:assert/strict";
import { buildCbbLevelStackCase, calibrateCbbLevelStackResidualLaw, describeCbbLevelStackDecision, assertCbbLevelStackDeclaration, CBB_LEVEL_STACK_DECLARATION_COMMIT, CBB_LEVEL_STACK_DECLARATION_PATH, type CbbLevelStackArchiveRow } from "./operator/evaluate-cbb-market-level-stack";
import { normalCdf } from "../lib/cbb/model";
import type { CbbQuote } from "../lib/cbb/types";
const at="2026-02-20T15:00:00.000Z",start="2026-02-21T19:00:00.000Z",observed="2026-02-20T14:30:00.000Z";
const margin=4,total=150,sd=12,zero=normalCdf((.5-margin)/sd)-normalCdf((-.5-margin)/sd);
const quote=(market:"moneyline"|"spread"|"total",book="draftkings",clock=at):CbbQuote=>({gameId:777,market,sportsbook:book,line:market==="moneyline"?null:market==="spread"?-3.5:150.5,
 firstPrice:-110,secondPrice:-110,providerObservedAt:clock,fetchedAt:"2026-10-29T12:00:00.000Z",phase:"opening"});
const row:CbbLevelStackArchiveRow={game:{id:777,date:start,season:2025,homeId:1,awayId:2,homeScore:80,awayScore:75,homeRegulation:80,awayRegulation:75,
 overtime:false,possessions:70,tempo:70,neutral:false,homeFactors:{efg:.5,turnoverRate:.1,offensiveReboundRate:.2,freeThrowRate:.3},awayFactors:{efg:.5,turnoverRate:.1,offensiveReboundRate:.2,freeThrowRate:.3}},
 forecast:{release:"fixture",gameId:777,asOf:at,homeId:1,awayId:2,homeScore:77,awayScore:73,margin,total,possessions:70,
 homeWinProbability:(1-normalCdf((.5-margin)/sd))/(1-zero),inputStatus:"complete",issues:[],uncertainty:{marginSd:sd,totalSd:17,marginTotalCorrelation:0,
 marginCorrection:0,totalCorrection:0,fitThroughSeason:2024,games:1000}},targets:[quote("moneyline"),quote("spread"),quote("total")],
 evidence:["moneyline","spread","total"].map(m=>({quote:quote(m as "moneyline"|"spread"|"total","fanduel",observed),orientation:"fixture_corroborated",availability:"provider_archived_opening"})),orientationEventId:"verified-fixture-777"};
Object.defineProperty(row,"features",{get:()=>{throw new Error("cached features must never be read");}});
Object.defineProperty(row,"context",{get:()=>{throw new Error("cached context must never be read");}});
const result=buildCbbLevelStackCase(row);
assert.deepEqual(result.margin.experts.map(e=>e.id),["independent","fanduel:spread"],"same-book ML must not become a second margin vote");
assert.deepEqual(result.total.experts.map(e=>e.id),["independent","fanduel:total"]);
assert.equal(result.sourceAgreement.length,1);assert.equal(result.outcomeAvailableAt,"2026-02-22T01:00:00.000Z");
const mlOnly=buildCbbLevelStackCase({...row,evidence:row.evidence.filter(e=>e.quote.market!=="spread")});
assert.deepEqual(mlOnly.margin.experts.map(e=>e.id),["independent","fanduel:moneyline"]);
assert.notEqual(mlOnly.margin.pattern,result.margin.pattern,"ML-only has a separate exact pattern");
const union=buildCbbLevelStackCase({...row,targets:row.targets.map(q=>q.market==="total"?{...q,sportsbook:"fanduel"}:q)});
assert.equal(union.margin.experts.length,1);assert.equal(union.total.experts.length,1,"union target exclusion applies to every axis");
const stale=buildCbbLevelStackCase({...row,evidence:row.evidence.map(e=>({...e,quote:{...e.quote,providerObservedAt:"2026-02-20T13:59:59.999Z"}}))});
assert.equal(stale.margin.experts.length,1);assert.equal(stale.total.experts.length,1);
const boundary=buildCbbLevelStackCase({...row,evidence:row.evidence.map(e=>({...e,quote:{...e.quote,providerObservedAt:"2026-02-20T14:00:00.000Z"}}))});
assert.equal(boundary.margin.experts.length,2,"exact one-hour boundary is eligible");
const future=buildCbbLevelStackCase({...row,evidence:row.evidence.map(e=>({...e,quote:{...e.quote,providerObservedAt:"2026-02-20T15:00:00.001Z"}}))});
assert.equal(future.margin.experts.length,1);
const ambiguous=buildCbbLevelStackCase({...row,evidence:[...row.evidence,{...row.evidence[1],quote:{...row.evidence[1].quote,firstPrice:-130}}]});
assert.equal(ambiguous.margin.experts[1].id,"fanduel:moneyline","ambiguous Spread cannot override a separately genuine ML-only pattern");
assert.ok(ambiguous.sourceProblems.some(p=>p.includes("ambiguous_latest")));
const badIdentity=buildCbbLevelStackCase({...row,evidence:row.evidence.map(e=>({...e,quote:{...e.quote,gameId:9}}))});
assert.equal(badIdentity.margin.experts.length,1);
const law=calibrateCbbLevelStackResidualLaw([{marginResidual:1,totalResidual:2},{marginResidual:-1,totalResidual:1}]);
assert.equal(law.status,"calibrated");
if(law.status==="calibrated"){assert.equal(law.marginSd,1);assert.equal(law.totalSd,Math.sqrt(2.5));assert.equal(law.crossMoment,.5);}
assert.equal(calibrateCbbLevelStackResidualLaw([{marginResidual:1,totalResidual:2}]).status,"unidentified");
assert.equal(calibrateCbbLevelStackResidualLaw([{marginResidual:1,totalResidual:2},{marginResidual:2,totalResidual:4}]).status,"unidentified","singular law cannot receive guessed variance/correlation");
assert.throws(()=>buildCbbLevelStackCase({...row,targets:row.targets.slice(0,2)}),/exact archived target/);
assert.equal(calibrateCbbLevelStackResidualLaw([{marginResidual:1e200,totalResidual:0},{marginResidual:0,totalResidual:1e200}]).status,"unidentified","finite residuals cannot overflow into a calibrated infinite law");
const detail=describeCbbLevelStackDecision(result,row.forecast,"synthetic_fixture");
assert.equal(detail.markets.length,3);assert.equal(detail.candidate.coherence.valid,true);
assert.ok(detail.markets.every(m=>m.candidate.outcome===m.baseline.outcome&&Number.isFinite(m.candidate.expectedValue)));
assertCbbLevelStackDeclaration(CBB_LEVEL_STACK_DECLARATION_COMMIT,CBB_LEVEL_STACK_DECLARATION_PATH);
assert.throws(()=>assertCbbLevelStackDeclaration("a".repeat(40),CBB_LEVEL_STACK_DECLARATION_PATH),/exact frozen/);
assert.throws(()=>assertCbbLevelStackDeclaration(CBB_LEVEL_STACK_DECLARATION_COMMIT,"AGENTS.md"),/exact frozen/);
console.log("PASS CBB level-stack operator fixtures: raw own-book patterns, union exclusion, exact freshness, cache isolation, and measured valid residual covariance; real cohort not fitted.");
