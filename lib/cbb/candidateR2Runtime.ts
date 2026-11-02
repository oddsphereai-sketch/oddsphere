import artifact from "./artifacts/candidate-r2.json";
import { CBB_SCORE_RESEARCH_RELEASE } from "./scoreResearch";
import { forecastCbbScoreArtifactBatch, type CbbScoreArtifact, type CbbScoreFixture } from "./scoreArtifactRuntime";
import type { CbbTrainingGame } from "./types";

/** Frozen r2 research/reproduction path. The live writer uses currentScoreRuntime. */
export function forecastCbbCandidateR2(game:CbbScoreFixture,asOf:string,history:CbbTrainingGame[]=[]){
  const {state,forecast,features}=forecastCbbScoreArtifactBatch(artifact as CbbScoreArtifact,CBB_SCORE_RESEARCH_RELEASE,[game],asOf,history)[0];
  return {state,forecast,features};
}
export function forecastCbbCandidateR2Batch(games:CbbScoreFixture[],asOf:string,history:CbbTrainingGame[]=[]){
  return forecastCbbScoreArtifactBatch(artifact as CbbScoreArtifact,CBB_SCORE_RESEARCH_RELEASE,games,asOf,history)
    .map(({game,forecast,features})=>({game,forecast,features}));
}
