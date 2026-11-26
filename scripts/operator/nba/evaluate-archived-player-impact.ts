import fs from "node:fs";
import { gunzipSync,gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { qualifyNbaArchivedRotation,type NbaArchivedRotationSnapshot } from "../../../lib/research/nba/nbaArchivedRotationLedger";
import { fitNbaArchivedBaseline,fitNbaArchivedImpact,applyNbaArchivedImpact,type ArchivedBaselineRow } from "../../../lib/research/nba/nbaArchivedImpactFit";
import { scoreNbaPortableModel } from "../../../lib/automodel/nba/nbaPortableScoreModel";
const read=(p:string)=>JSON.parse(gunzipSync(fs.readFileSync(p)).toString());
async function main(){
 const [ledgerPath,featurePath,proofPath,templatePath,destination]=process.argv.slice(2);
 if(!ledgerPath||!featurePath||!proofPath||!templatePath||!destination||fs.existsSync(destination))throw Error("usage: evaluate-archived-player-impact LEDGER FEATURES PROOF SHIPPED_RECIPE NEW_OUTPUT.json.gz");
 const ledger=read(ledgerPath) as {rows:NbaArchivedRotationSnapshot[]}, proof=JSON.parse(fs.readFileSync(proofPath,"utf8"));
 if(proof.ledgerFileSha256!==createHash("sha256").update(fs.readFileSync(ledgerPath)).digest("hex"))throw Error("frozen_ledger_file_mismatch");
 const qualification=qualifyNbaArchivedRotation(ledger.rows,proof);
 if(!qualification.mayFit)throw Error("archival_data_gate_closed:"+qualification.issues.join(","));
 const sources=read(featurePath) as {features:Record<string,number|string|null>[];finals:{gameId:number;sourceAvailableAt:string}[]};
 const features=JSON.parse(fs.readFileSync(templatePath,"utf8")).design.features as string[];
 if(features.length!==75||features.some(n=>/^target_|evaluation_|reference_|market_|odds_/i.test(n)))throw Error("changed_or_outcome_baseline_recipe");
 const finals=new Map(sources.finals.map(r=>[r.gameId,r.sourceAvailableAt]));
 const rows:ArchivedBaselineRow[]=sources.features.map(r=>({gameId:String(r.game_id).padStart(10,"0"),season:Number(r.season),cutoff:String(r.feature_cutoff),finalAvailableAt:finals.get(Number(r.game_id))!,actualMargin:Number(r.target_home_margin),actualTotal:Number(r.target_total),features:Object.fromEntries(features.map(f=>[f,typeof r[f]==="number"?r[f]:null]))}));
 const first=(season:number)=>rows.filter(r=>r.season===season).map(r=>r.cutoff).sort()[0]!;
 const a1=fitNbaArchivedBaseline(rows.filter(r=>r.season===2021&&Date.parse(r.finalAvailableAt)<Date.parse(first(2022))),features,"nba_original_t60_features_2026_11_23_r1_publication_clocks",first(2022));
 const a2=fitNbaArchivedBaseline(rows.filter(r=>r.season<=2022&&Date.parse(r.finalAvailableAt)<Date.parse(first(2023))),features,"nba_original_t60_features_2026_11_23_r1_publication_clocks",first(2023));
 const byId=new Map(rows.map(r=>[r.gameId,r]));
 const training=ledger.rows.filter(s=>s.status==="complete"&&s.target.season===2022&&byId.has(s.target.gameId)&&Date.parse(byId.get(s.target.gameId)!.finalAvailableAt)<Date.parse(first(2023))).map(s=>{const r=byId.get(s.target.gameId)!;if(r.cutoff!==new Date(s.target.cutoff).toISOString())throw Error("native_baseline_cutoff_mismatch");return{snapshotHash:s.hash,baseline:a1,features:r.features,actualMargin:r.actualMargin,actualTotal:r.actualTotal,finalAvailableAt:r.finalAvailableAt};});
 const head=fitNbaArchivedImpact({snapshots:ledger.rows,proof,training});
 const evaluations=ledger.rows.filter(s=>s.status==="complete"&&s.target.season>=2023&&byId.has(s.target.gameId)).map(s=>{const r=byId.get(s.target.gameId)!;if(r.cutoff!==new Date(s.target.cutoff).toISOString())throw Error("native_selection_cutoff_mismatch");const baseline=scoreNbaPortableModel(a2.artifact,r.features),candidate=applyNbaArchivedImpact(head,s,a2,r.features);return{gameId:r.gameId,season:r.season,cutoff:r.cutoff,snapshotHash:s.hash,actualMargin:r.actualMargin,actualTotal:r.actualTotal,baselineMargin:baseline.marginHome,baselineTotal:baseline.total,candidateMargin:candidate.margin,candidateTotal:candidate.total,marginCorrection:candidate.marginCorrection,totalCorrection:candidate.totalCorrection,teamLossA:(Math.abs((r.actualTotal+r.actualMargin-baseline.total-baseline.marginHome)/2)+Math.abs((r.actualTotal-r.actualMargin-baseline.total+baseline.marginHome)/2))/2,teamLossC:(Math.abs((r.actualTotal+r.actualMargin-candidate.total-candidate.margin)/2)+Math.abs((r.actualTotal-r.actualMargin-candidate.total+candidate.margin)/2))/2};});
 type E=typeof evaluations[number];const mean=(a:number[])=>a.reduce((s,n)=>s+n,0)/a.length;
 const metrics=(a:E[])=>({games:a.length,teamMAE_A:mean(a.map(r=>r.teamLossA)),teamMAE_C:mean(a.map(r=>r.teamLossC)),teamMAE_gain:mean(a.map(r=>r.teamLossA-r.teamLossC)),marginMAE_A:mean(a.map(r=>Math.abs(r.baselineMargin-r.actualMargin))),marginMAE_C:mean(a.map(r=>Math.abs(r.candidateMargin-r.actualMargin))),totalMAE_A:mean(a.map(r=>Math.abs(r.baselineTotal-r.actualTotal))),totalMAE_C:mean(a.map(r=>Math.abs(r.candidateTotal-r.actualTotal))),totalBias_A:mean(a.map(r=>r.baselineTotal-r.actualTotal)),totalBias_C:mean(a.map(r=>r.candidateTotal-r.actualTotal)),winnerCorrect_A:a.filter(r=>(r.baselineMargin>0)===(r.actualMargin>0)).length,winnerCorrect_C:a.filter(r=>(r.candidateMargin>0)===(r.actualMargin>0)).length});
 const selection=evaluations.filter(r=>[2023,2024].includes(r.season)), blocks=new Map<string,E[]>();
 for(const r of selection){const d=new Date(r.cutoff);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));const k=d.toISOString().slice(0,10),b=blocks.get(k)??[];b.push(r);blocks.set(k,b);}
 const weeks=[...blocks].map(([week,a])=>({week,...metrics(a)})), bootstrap:number[]=[];let seed=20261123;const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<1000;i++){let sum=0,n=0;for(let j=0;j<weeks.length;j++){const w=weeks[Math.floor(rng()*weeks.length)]!;sum+=w.teamMAE_gain*w.games;n+=w.games;}bootstrap.push(sum/n);}bootstrap.sort((a,b)=>a-b);
 const report={createdAt:new Date().toISOString(),qualification,baselineA1:a1,baselineA2:a2,head,selection:metrics(selection),bySeason:Object.fromEntries([...new Set(evaluations.map(r=>r.season))].map(s=>[s,metrics(evaluations.filter(r=>r.season===s))])),weeks,weekBlockBootstrap:{draws:1000,seed:20261123,teamMAEGain95CI:[bootstrap[24],bootstrap[974]]},evaluations,productionPromotionEligible:false,remainingGates:["current_incumbent_B_comparison","source_bound_market_direction_probability","exact_price_full_grader_and_board_balance","fresh_forward_evidence"],productionWrites:0,providerRequests:0};
 fs.writeFileSync(destination,gzipSync(JSON.stringify(report)),{flag:"wx",mode:0o600});fs.writeFileSync(destination+".summary.json",JSON.stringify({...report,baselineA1:undefined,baselineA2:undefined,head:{hash:head.hash,trainingRows:head.trainingRows,margin:head.margin,total:head.total},weeks:undefined,evaluations:undefined},null,2),{flag:"wx",mode:0o600});console.log(JSON.stringify({...report,baselineA1:undefined,baselineA2:undefined,weeks:undefined,evaluations:undefined}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
