/** Outcome-blind frozen receipt replay: no fit, provider, database or writer.
 * --capture=/absolute/member-capture.json --out=/absolute/report.json */
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {readCbbContextualOutcomeEvidence} from "../../lib/services/cbb/cbbContextualOutcomeRuntime";
import {buildCbbInterpretedDecision} from "../../lib/cbb/contextualInterpretedDecision";
import {CBB_MARKET_RESISTANCE_GRADE_RELEASE} from "../../lib/cbb/contextualMarketResistanceGrade";
const flag=(k:string)=>process.argv.find(x=>x.startsWith(`--${k}=`))?.slice(k.length+3);
const path=flag("capture"),out=flag("out");if(!path||!out)throw Error("Supply --capture and --out");
const original=readFileSync(path,"utf8"),capture=JSON.parse(original),rows=[];
const before=JSON.stringify(capture),started=performance.now(),models=new Set<string>(),releases=new Set<string>();
const sampleCounts=new Set<number>();
for(const r of capture.rows){const read=readCbbContextualOutcomeEvidence(r.payload.snapshot.board);for(const row of read?.decision.marketDecisions??[])if(row.recommendationRisk)sampleCounts.add(row.recommendationRisk.context.calibrationGames);}
assert.equal(sampleCounts.size,1,"Captured calibration-game counts differ");const calibrationGames=[...sampleCounts][0];
let games=0,maxRehydrationDelta=0;
const sameNumber=(a:number|null,b:number|null)=>{if(a===b)return;assert(a!==null&&b!==null);const delta=Math.abs(a-b);maxRehydrationDelta=Math.max(maxRehydrationDelta,delta);assert(delta<=128*Number.EPSILON*(Math.abs(a)+Math.abs(b)+1),"rehydrated law differs beyond roundtrip arithmetic");};
for(const record of capture.rows){
 const board=record.payload.snapshot.board,read=readCbbContextualOutcomeEvidence(board);if(!read)continue;
 models.add(board.modelRelease);releases.add(board.gradeRelease);games++;
 const d=read.decision,f=d.workingForecast,cal=d.calibration.parameters;
 const context=d.marketDecisions.find(r=>r.recommendationRisk)?.recommendationRisk?.context??{calibrationGames,
  marginLocationSd:Math.sqrt(f.margin.varianceComponents.sourceLocation+f.margin.varianceComponents.functionPosterior)*Math.exp(cal.logMarginScale),
  totalLocationSd:Math.sqrt(f.total.varianceComponents.trendPosterior+f.total.varianceComponents.functionPosterior)*Math.exp(cal.logTotalScale)};
 const next=buildCbbInterpretedDecision({input:read.input,interpretation:d.interpretation,latent:d.numericalTrace.finalLatentDistribution,
  targets:d.marketDecisions.flatMap(r=>r.target?[r.target]:[]),recommendationRisk:context});
 for(const key of ["home","away","margin","total","homeWinProbability"] as const)sameNumber(next.finalScore[key],d.finalScore[key]);
 for(const row of next.marketDecisions){
  const old=d.marketDecisions.find(r=>r.market===row.market)!;
  for(const key of ["target","selection","price"] as const)assert.deepEqual(row[key],old[key],`${d.gameId}/${row.market}: ${key} changed`);
  for(const key of ["probability","loseProbability","pushProbability","expectedValue"] as const)sameNumber(row[key],old[key]);
  if(row.marketResistanceAssessment)assert.equal(row.marketResistanceAssessment.baseGrade,old.grade,"The incumbent qualification was changed before the resistance rule");
  rows.push({gameId:d.gameId,matchup:`${record.payload.memberGame.awayTeam}@${record.payload.memberGame.homeTeam}`,
   market:row.market,locked:record.payload.snapshot.lockedAt!==null,previous:old.grade,next:row.grade,
   probability:row.probability,price:row.price,expectedValue:row.expectedValue,reason:row.reason,
   assessment:row.marketResistanceAssessment??null});
 }
}
assert.equal(models.size,1,"Do not blend numerical model releases");assert.equal(releases.size,1,"Do not blend incumbent grading releases");
assert.equal(JSON.stringify(capture),before,"The stored capture was mutated");
const count=(values:string[])=>values.reduce<Record<string,number>>((a,x)=>(a[x]=(a[x]??0)+1,a),{});
const actionable=(grade:string)=>grade==="Lean"||grade==="Best Angle";
const report={at:new Date().toISOString(),captureAt:capture.at,captureSha256:createHash("sha256").update(original).digest("hex"),
 release:CBB_MARKET_RESISTANCE_GRADE_RELEASE,models:[...models],incumbentGradeReleases:[...releases],games,markets:rows.length,
 before:count(rows.map(r=>r.previous)),after:count(rows.map(r=>r.next)),
 promotions:rows.filter(r=>!actionable(r.previous)&&actionable(r.next)).length,demotions:rows.filter(r=>actionable(r.previous)&&!actionable(r.next)).length,
 changed:rows.filter(r=>r.previous!==r.next),unchangedNumericalModel:true,quotesAndSelectionsExact:true,maxRehydrationDelta,unchangedCapturedPayloads:true,
 productionWrites:0,providerCalls:0,modelFits:0,elapsedMs:Math.round(performance.now()-started),
 limits:"Previously inspected capture, not blind accuracy evidence. Counterfactual grades never replace stored locks. Current R7 Margin inference limitations remain separate."};
writeFileSync(out,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
