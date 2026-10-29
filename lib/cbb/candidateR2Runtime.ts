import artifact from "./artifacts/candidate-r2.json";
import { forecastCbbGame } from "./model";
import { CBB_SCORE_RESEARCH_RELEASE, cbbScoreFeatures, correctCbbScoreForecast, fitCbbScoreResearchState,
  type CbbScoreCorrection } from "./scoreResearch";
import type { CbbTrainingGame } from "./types";

/** Private candidate runtime only. No member route, provider factory or writer imports this module. */
export function forecastCbbCandidateR2(game: {
  id: number; date: string; season: number; homeId: number; awayId: number; neutral: boolean | null;
}, asOf: string, availableCurrentSeasonGames: CbbTrainingGame[] = []) {
  if (artifact.release !== CBB_SCORE_RESEARCH_RELEASE || artifact.selectedHead !== "matchup" || artifact.correction.mode !== "matchup") {
    throw new Error("CBB r2 artifact/runtime mismatch");
  }
  if (game.season !== artifact.prior.season + 1) throw new Error("CBB r2 requires the matching prior-season artifact");
  if (availableCurrentSeasonGames.some(row => row.season !== game.season || Date.parse(row.date) + 6 * 60 * 60 * 1000 > Date.parse(asOf))) {
    throw new Error("future CBB current-season input");
  }
  const state = fitCbbScoreResearchState(availableCurrentSeasonGames, {
    season: game.season, asOf, config: artifact.config, prior: artifact.prior,
  });
  const base = { ...forecastCbbGame(state, game, artifact.uncertainty), release: CBB_SCORE_RESEARCH_RELEASE };
  const features = cbbScoreFeatures(base, state, game, availableCurrentSeasonGames);
  return { state, forecast: correctCbbScoreForecast(base, features, artifact.correction as CbbScoreCorrection, game.season), features };
}

/** Same r2 mathematics with one point-in-time fit for an entire CBB slate. */
export function forecastCbbCandidateR2Batch(games: Array<{
  id:number;date:string;season:number;homeId:number;awayId:number;neutral:boolean|null;
}>,asOf:string,availableCurrentSeasonGames:CbbTrainingGame[]=[]){
  if(artifact.release!==CBB_SCORE_RESEARCH_RELEASE||artifact.selectedHead!=="matchup"||artifact.correction.mode!=="matchup")throw new Error("CBB r2 artifact/runtime mismatch");
  if(games.some(game=>game.season!==artifact.prior.season+1))throw new Error("CBB r2 requires matching prior-season artifact");
  if(availableCurrentSeasonGames.some(row=>row.season!==artifact.prior.season+1||Date.parse(row.date)+6*60*60_000>Date.parse(asOf)))throw new Error("future CBB current-season input");
  const state=fitCbbScoreResearchState(availableCurrentSeasonGames,{season:artifact.prior.season+1,asOf,config:artifact.config,prior:artifact.prior});
  return games.map(game=>{
    const base={...forecastCbbGame(state,game,artifact.uncertainty),release:CBB_SCORE_RESEARCH_RELEASE};
    const features=cbbScoreFeatures(base,state,game,availableCurrentSeasonGames);
    return {game,forecast:correctCbbScoreForecast(base,features,artifact.correction as CbbScoreCorrection,game.season),features};
  });
}
