import artifact from "./artifacts/candidate-r4.json";
import source from "./artifacts/newcomer-strength-2026-r1.json";
import {CBB_CURRENT_SCORE_RELEASE} from "./currentScoreRuntime";
import {cbbNewcomerRating} from "./newcomerStrength";
import {fitCbbScoreArtifactState,type CbbScoreArtifact} from "./scoreArtifactRuntime";
import type {CbbTrainingGame} from "./types";

import {CBB_FULL_D1_SCORE_RELEASE} from "./fullDivisionOneReleases";
export {CBB_FULL_D1_SCORE_RELEASE};
const bootstrap=fitCbbScoreArtifactState(artifact as CbbScoreArtifact,CBB_CURRENT_SCORE_RELEASE,source.capturedAt,[]);
export const CBB_D1_NEWCOMERS=source.rows.filter(row=>!artifact.prior.teams[String(row.bdlId) as keyof typeof artifact.prior.teams])
  .map(row=>({id:row.bdlId,...cbbNewcomerRating(bootstrap,row.bdlId)}));
const teams={...artifact.prior.teams};
for(const row of CBB_D1_NEWCOMERS){
  // The incumbent seasonal fit applies priorCarry exactly once. Translate the
  // observed CURRENT-ability prior to that input scale without double decay.
  Object.assign(teams,{[row.id]:{...row.rating,offense:row.rating.offense/artifact.config.priorCarry,
    defense:row.rating.defense/artifact.config.priorCarry,pace:row.rating.pace/artifact.config.priorCarry}});
}
export const CBB_FULL_D1_SCORE_ARTIFACT:CbbScoreArtifact={...artifact,release:CBB_FULL_D1_SCORE_RELEASE,
  prior:{...artifact.prior,teams}} as CbbScoreArtifact;
export function fitCbbFullDivisionOneState(asOf:string,history:CbbTrainingGame[]){
  if(Date.parse(asOf)<Date.parse(source.capturedAt))throw Error("Full D1 program inputs were not yet observed");
  return fitCbbScoreArtifactState(CBB_FULL_D1_SCORE_ARTIFACT,CBB_FULL_D1_SCORE_RELEASE,asOf,history);
}
