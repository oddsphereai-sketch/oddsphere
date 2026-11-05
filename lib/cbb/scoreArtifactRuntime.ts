import { forecastCbbGame } from "./model";
import { cbbScoreFeatures, correctCbbScoreForecast, fitCbbScoreResearchState,
  type CbbScoreCorrection, type CbbScoreResearchConfig } from "./scoreResearch";
import type { CbbRatingState, CbbTrainingGame, CbbUncertainty } from "./types";

export type CbbScoreArtifact = {
  release: string; selectedHead: string; config: CbbScoreResearchConfig;
  prior: CbbRatingState; uncertainty: CbbUncertainty; correction: CbbScoreCorrection;
};
export type CbbScoreFixture = { id:number;date:string;season:number;homeId:number;awayId:number;neutral:boolean|null };

export function fitCbbScoreArtifactState(artifact:CbbScoreArtifact,expectedRelease:string,asOf:string,history:CbbTrainingGame[]=[]){
  if(artifact.release!==expectedRelease||artifact.selectedHead!=="matchup"||artifact.correction.mode!=="matchup")throw new Error("CBB score artifact/runtime mismatch");
  if(history.some(row=>row.season!==artifact.prior.season+1||Date.parse(row.date)+6*60*60_000>Date.parse(asOf)))throw new Error("future CBB current-season input");
  return {...fitCbbScoreResearchState(history,{season:artifact.prior.season+1,asOf,config:artifact.config,prior:artifact.prior}),release:expectedRelease};
}

export function forecastCbbScoreArtifactFromState(artifact:CbbScoreArtifact,expectedRelease:string,
  game:CbbScoreFixture,state:ReturnType<typeof fitCbbScoreArtifactState>,history:CbbTrainingGame[]){
  const base={...forecastCbbGame(state,game,artifact.uncertainty),release:expectedRelease};
  const features=cbbScoreFeatures(base,state,game,history);
  return {game,state,forecast:correctCbbScoreForecast(base,features,artifact.correction,game.season),features};
}

/** One mathematical implementation, with explicit immutable artifact authority. */
export function forecastCbbScoreArtifactBatch(artifact:CbbScoreArtifact, expectedRelease:string,
  games:CbbScoreFixture[],asOf:string,history:CbbTrainingGame[]=[]){
  if(artifact.release!==expectedRelease||artifact.selectedHead!=="matchup"||artifact.correction.mode!=="matchup")throw new Error("CBB score artifact/runtime mismatch");
  if(games.some(game=>game.season!==artifact.prior.season+1))throw new Error("CBB score requires matching prior-season artifact");
  if(history.some(row=>row.season!==artifact.prior.season+1||Date.parse(row.date)+6*60*60_000>Date.parse(asOf)))throw new Error("future CBB current-season input");
  const state=fitCbbScoreArtifactState(artifact,expectedRelease,asOf,history);
  return games.map(game=>forecastCbbScoreArtifactFromState(artifact,expectedRelease,game,state,history));
}
