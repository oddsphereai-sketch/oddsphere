/** Replays only the already-frozen head; never fits or writes production. */
import fs from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { scoreNbaLearnedShrinkage, type NbaLearnedShrinkageHead } from "../../../lib/research/nba/nbaLearnedShrinkage";
import { nbaPlayerStateHash } from "../../../lib/research/nba/nbaPlayerStateLedger";
import {nbaClimateDay} from "../../../lib/research/nba/nbaPriorFinalsCalibration";
import {scoreNbaPortableModel,type NbaPortableFeatureRow} from "../../../lib/automodel/nba/nbaPortableScoreModel";
type Row={gameId:string;season:number;startAt:string;cutoff:string;sourceSha256:string;features:NbaPortableFeatureRow;actualMargin:number;actualTotal:number};
const [input, frozenPath, output] = process.argv.slice(2);
if (!input || !frozenPath || !output || fs.existsSync(output)) throw Error("usage: evaluate-learned-shrinkage INPUTS FROZEN_HEAD NEW_REPORT.json.gz");
const bytes=fs.readFileSync(input),source=JSON.parse(gunzipSync(bytes).toString()),frozen=JSON.parse(fs.readFileSync(frozenPath,"utf8"));
const head=frozen.head as NbaLearnedShrinkageHead;
if(frozen.inputSha256!==createHash("sha256").update(bytes).digest("hex")) throw Error("changed_frozen_input");
const {hash,...core}=head;if(hash!==nbaPlayerStateHash(core))throw Error("changed_frozen_head");
const originals=source.rows as Row[],before=nbaPlayerStateHash(originals);
if(originals.length>10000||new Set(originals.map(r=>r.gameId)).size!==originals.length)throw Error("invalid_source_budget_or_duplicates");
const targets=originals.filter(r=>[2023,2024,2025].includes(r.season)).sort((a,b)=>Date.parse(a.cutoff)-Date.parse(b.cutoff)||a.gameId.localeCompare(b.gameId));
const evaluations=targets.map(r=>{
 const baseline=scoreNbaPortableModel(source.baseline.artifact,r.features);
 const result=scoreNbaLearnedShrinkage(head,r.features,{season:r.season,cutoff:r.cutoff,sourceRecipe:source.sourceRecipe});
 const {actualMargin,actualTotal}=r,homeScore=(actualTotal+actualMargin)/2,awayScore=(actualTotal-actualMargin)/2;
 const teamLoss=(m:number,t:number)=>(Math.abs((t+m)/2-homeScore)+Math.abs((t-m)/2-awayScore))/2;
 return {gameId:r.gameId,season:r.season,startAt:r.startAt,cutoff:r.cutoff,sourceSha256:r.sourceSha256,headHash:result.headHash,
   actualMargin,actualTotal,baselineMargin:baseline.marginHome,baselineTotal:baseline.total,candidateMargin:result.marginHome,candidateTotal:result.total,
   marginCorrection:result.marginHome-baseline.marginHome,totalCorrection:result.total-baseline.total,teamLossA:teamLoss(baseline.marginHome,baseline.total),teamLossC:teamLoss(result.marginHome,result.total)};
});
type Evaluation=typeof evaluations[number];
const mean=(a:number[])=>a.reduce((sum,n)=>sum+n,0)/a.length;
function metrics(a:Evaluation[]){return {games:a.length,teamMAE_A:mean(a.map(r=>r.teamLossA)),teamMAE_C:mean(a.map(r=>r.teamLossC)),teamMAE_gain:mean(a.map(r=>r.teamLossA-r.teamLossC)),marginMAE_A:mean(a.map(r=>Math.abs(r.baselineMargin-r.actualMargin))),marginMAE_C:mean(a.map(r=>Math.abs(r.candidateMargin-r.actualMargin))),totalMAE_A:mean(a.map(r=>Math.abs(r.baselineTotal-r.actualTotal))),totalMAE_C:mean(a.map(r=>Math.abs(r.candidateTotal-r.actualTotal))),marginBias_A:mean(a.map(r=>r.baselineMargin-r.actualMargin)),marginBias_C:mean(a.map(r=>r.candidateMargin-r.actualMargin)),totalBias_A:mean(a.map(r=>r.baselineTotal-r.actualTotal)),totalBias_C:mean(a.map(r=>r.candidateTotal-r.actualTotal)),winnerCorrect_A:a.filter(r=>(r.baselineMargin>0)===(r.actualMargin>0)).length,winnerCorrect_C:a.filter(r=>(r.candidateMargin>0)===(r.actualMargin>0)).length};}
const byWeek=new Map<string,Evaluation[]>();for(const r of evaluations){const monday=nbaClimateDay(r.startAt)-((nbaClimateDay(r.startAt)+3)%7),key=`${r.season}:${monday}`;byWeek.set(key,[...(byWeek.get(key)??[]),r]);}
const weeks=[...byWeek].map(([week,rows])=>({week,season:rows[0].season,...metrics(rows)}));
const development=metrics(evaluations.filter(r=>r.season!==2025)),replication=metrics(evaluations.filter(r=>r.season===2025));
const developmentWeeks=weeks.filter(w=>w.season!==2025),bootstrap:number[]=[];let seed=20261123;
const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(let i=0;i<1000;i++){let sum=0,n=0;for(let j=0;j<developmentWeeks.length;j++){const w=developmentWeeks[Math.floor(rng()*developmentWeeks.length)];sum+=w.teamMAE_gain*w.games;n+=w.games;}bootstrap.push(sum/n);}bootstrap.sort((a,b)=>a-b);
const ci=[bootstrap[24],bootstrap[974]];
const noMarginalRegression=(m:ReturnType<typeof metrics>)=>m.marginMAE_C<=m.marginMAE_A&&m.totalMAE_C<=m.totalMAE_A;
const developmentGatePassed=development.teamMAE_gain>=.10&&ci[0]>0&&noMarginalRegression(development);
const replicationGatePassed=replication.teamMAE_gain>0&&noMarginalRegression(replication);
if(nbaPlayerStateHash(originals)!==before)throw Error("source_mutation");
const report={createdAt:new Date().toISOString(),release:head.release,headHash:head.hash,frozenAt:frozen.frozenAt,inputSha256:frozen.inputSha256,
 labels:{development:"reopened_2023_2024",replication:"opened_2025",untouchedHoldout:false,comparator:"earlier_fit_native_A2_not_current_incumbent",pointForecastsOnly:true},
 development,replication,bySeason:Object.fromEntries([2023,2024,2025].map(s=>[s,metrics(evaluations.filter(r=>r.season===s))])),
 weekBlockBootstrap:{draws:1000,seed:20261123,calendar:"Eastern_Monday_slate_week",teamMAEGain95CI:ci},
 developmentGatePassed,replicationGatePassed,mayAdvanceToNextValidationStage:developmentGatePassed&&replicationGatePassed,productionPromotionEligible:false,
 sourceRefusalsWithinVerifiedCorpus:0,verifiedSourceRows:originals.length,
 weeks,evaluations,fittingPerformed:false,originalsHashBefore:before,originalsHashAfter:nbaPlayerStateHash(originals),productionWrites:0,providerRequests:0};
fs.writeFileSync(output,gzipSync(JSON.stringify(report)),{flag:"wx",mode:0o600});
const summary={...report,weeks:undefined,evaluations:undefined};fs.writeFileSync(output+".summary.json",JSON.stringify(summary,null,2),{flag:"wx",mode:0o600});console.log(JSON.stringify(summary));
