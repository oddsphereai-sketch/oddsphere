import artifact from "./artifacts/candidate-r4.json";
import { forecastCbbScoreArtifactBatch, type CbbScoreArtifact, type CbbScoreFixture } from "./scoreArtifactRuntime";
import type { CbbTrainingGame } from "./types";

export const CBB_PREVIOUS_SCORE_RELEASE="cbb_candidate_2026_11_02_r3_verified_stthomas_venue_prior" as const;
export const CBB_CURRENT_SCORE_RELEASE="cbb_candidate_2026_11_03_r4_verified_new_orleans_venue_prior" as const;

/** Sole live score artifact. Only genuine historical venue inputs changed. */
export function forecastCbbCurrentBatch(games:CbbScoreFixture[],asOf:string,history:CbbTrainingGame[]=[]){
  if(!Number.isFinite(Date.parse(asOf))||Date.parse(asOf)<Date.parse(artifact.prior.asOf))throw new Error("CBB prior was not yet available");
  return forecastCbbScoreArtifactBatch(artifact as CbbScoreArtifact,CBB_CURRENT_SCORE_RELEASE,games,asOf,history)
    .map(({game,forecast,features})=>({game,forecast,features}));
}
