/** Offline point-score research only. No live consumer or probability/grade rule. */
import type { NbaPortableModelArtifact, NbaPortableFeatureRow } from "../../automodel/nba/nbaPortableScoreModel";
import { nbaPlayerStateHash } from "./nbaPlayerStateLedger";
export const NBA_LEARNED_SHRINKAGE_RELEASE = "nba_learned_shrinkage_2026_11_24_r1_training_only" as const;
export type NbaLearnedShrinkageHead = {
  release: typeof NBA_LEARNED_SHRINKAGE_RELEASE; sourceRecipe: string;
  trainingHash: string; baselineHash: string; rawFitSha256: string;
  trainingEnd: string; trainingRows: number;
  design: NbaPortableModelArtifact["design"];
  margin: { weightVariance: number; noiseVariance: number; alpha: number; coefficients: number[] };
  total: { weightVariance: number; noiseVariance: number; alpha: number; coefficients: number[] };
  hash: string;
};
const sha = (s: string) => /^[a-f0-9]{64}$/.test(s);
export function scoreNbaLearnedShrinkage(head: NbaLearnedShrinkageHead, features: NbaPortableFeatureRow,
  target: { season: number; cutoff: string; sourceRecipe: string }) {
  const {hash,...core}=head,d=head.design;
  if(hash!==nbaPlayerStateHash(core)||head.release!==NBA_LEARNED_SHRINKAGE_RELEASE||
      ![head.trainingHash,head.baselineHash,head.rawFitSha256].every(sha)||!Number.isInteger(target.season)||target.season<=2022||
      !Number.isFinite(Date.parse(target.cutoff))||!Number.isFinite(Date.parse(head.trainingEnd))||Date.parse(head.trainingEnd)>=Date.parse(target.cutoff)||
      target.sourceRecipe!==head.sourceRecipe||!Number.isSafeInteger(head.trainingRows)||head.trainingRows<10||head.trainingRows>10000||
      d.features.length!==75||new Set(d.features).size!==75||d.splineKnots.length!==0||
      d.rawFeatureMedians.length!==75||!d.rawFeatureMedians.every(Number.isFinite)||
      d.designColumns<75||d.designColumns>150||d.designMeans.length!==d.designColumns||d.designStandardDeviations.length!==d.designColumns||
      !d.designMeans.every(Number.isFinite)||!d.designStandardDeviations.every(v=>Number.isFinite(v)&&v>0)||
      new Set(d.missingIndicatorColumns).size!==d.missingIndicatorColumns.length)throw Error("incompatible_learned_score");
  const indicators=d.missingIndicatorColumns.map(f=>{const index=d.features.indexOf(f);if(index<0)throw Error("unknown_learned_indicator");return index;});
  const missing:boolean[]=[];
  const values=d.features.map((f,i)=>{const raw=features[f],absent=raw==null||!Number.isFinite(raw);missing.push(absent);return absent?d.rawFeatureMedians[i]:raw!;});
  for(const i of indicators)values.push(missing[i]?1:0);
  if(values.length!==d.designColumns)throw Error("learned_design_dimension_mismatch");
  const x=values.map((v,i)=>(v-d.designMeans[i])/d.designStandardDeviations[i]);
  function predict(p:NbaLearnedShrinkageHead["margin"]){
    if(![p.weightVariance,p.noiseVariance,p.alpha].every(v=>Number.isFinite(v)&&v>0)||Math.abs(p.alpha-p.noiseVariance/p.weightVariance)>1e-10*Math.max(1,p.alpha)||p.coefficients.length!==x.length+1||!p.coefficients.every(Number.isFinite))throw Error("invalid_learned_coefficients");
    let score=p.coefficients[x.length];for(let i=0;i<x.length;i++)score+=x[i]*p.coefficients[i];return score;
  }
  const marginHome=predict(head.margin),total=predict(head.total),homeScore=(total+marginHome)/2,awayScore=(total-marginHome)/2;
  if(![marginHome,total,homeScore,awayScore].every(Number.isFinite)||homeScore<0||awayScore<0)throw Error("invalid_learned_score");
  return {release:head.release,headHash:head.hash,marginHome,total,homeScore,awayScore};
}
