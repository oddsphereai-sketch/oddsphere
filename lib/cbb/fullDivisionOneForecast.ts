import artifact from "./artifacts/candidate-r4.json";
import crossPrior from "./artifacts/cross-division-prior-r1.json";
import {computeSlateDate} from "../dates/slateDate";
import {forecastCbbScoreArtifactFromState,type CbbScoreArtifact} from "./scoreArtifactRuntime";
import {CBB_FULL_D1_SCORE_ARTIFACT,CBB_FULL_D1_SCORE_RELEASE,CBB_D1_NEWCOMERS,fitCbbFullDivisionOneState} from "./fullDivisionOneScoreRuntime";
import {cbbScoreFeatures,correctCbbScoreForecast} from "./scoreResearch";
import {forecastCbbGame} from "./model";
import {cbbDivisionOneFixture} from "./divisionOneMembership";
import {cbbCrossDivisionContext,cbbOfficialD1FixtureContext} from "./crossDivisionIdentity";
import {forecastCbbCrossDivision,CBB_FULL_D1_COVERAGE_START,type CbbCrossDivisionPrior,type CrossDivisionGame} from "./crossDivisionPrior";
import type {CbbGame,CbbTrainingGame} from "./types";
import type {EspnCbbEvent} from "./dataset";
import {matchCbbProviderVenue} from "./providerVenueIdentity";

export const CBB_FULL_D1_FORECAST_RELEASE="cbb_full_d1_forecast_2026_11_05_r1_official_opponent_coverage" as const;
export function forecastCbbFullDivisionOneBatch(games:CbbGame[],asOf:string,history:CbbTrainingGame[],
  events:Map<string,{events:EspnCbbEvent[];fetchedAt:string}>,crossHistory:CrossDivisionGame[]=[]){
  const state=fitCbbFullDivisionOneState(asOf,history);
  return games.map(game=>{
    const day=computeSlateDate("cbb",game.date),official=events.get(day),division=cbbDivisionOneFixture(game);
    if(day<CBB_FULL_D1_COVERAGE_START)throw Error("Expanded CBB coverage cannot reinterpret November 4");
    if(official&&Date.parse(official.fetchedAt)>Date.parse(asOf))throw Error("CBB official fixture evidence was not yet observed");
    if(!division.eligible)throw Error("Foreign division fixture entered the D1 forecast batch");
    const cross=official&&division.crossDivision?cbbCrossDivisionContext(game,official.events,official.fetchedAt):null;
    const venue=cross??(official?(matchCbbProviderVenue(game,official.events,official.fetchedAt)??
      cbbOfficialD1FixtureContext(game,official.events,official.fetchedAt)):null);
    const fixture={id:game.id,date:game.date,season:game.season,homeId:game.home_team.id,awayId:game.visitor_team.id,
      neutral:venue?.timeConfirmed?venue.neutral:null};
    // Exact existing implementation and release for the incumbent D1/D1 domain.
    const newcomer=CBB_D1_NEWCOMERS.find(r=>r.id===fixture.homeId||r.id===fixture.awayId);
    if(!division.crossDivision&&!newcomer&&state.teams[fixture.homeId]&&state.teams[fixture.awayId]){
      const row=forecastCbbScoreArtifactFromState(CBB_FULL_D1_SCORE_ARTIFACT,CBB_FULL_D1_SCORE_RELEASE,fixture,state,history);return {...row,coverage:null};
    }
    if(division.crossDivision){
      if(!cross)throw Error(`Cross-division official school/venue identity unresolved: ${game.id}`);
      const result=forecastCbbCrossDivision({prior:crossPrior as unknown as CbbCrossDivisionPrior,state,game:fixture,
        divisionOneId:cross.divisionOneId,opponentId:cross.opponentId,history:crossHistory});
      return {game:fixture,state,features:[],forecast:result.forecast,coverage:{release:CBB_FULL_D1_FORECAST_RELEASE,
        kind:"cross_division" as const,identity:cross,inputs:result.inputs}};
    }
    if(!newcomer)throw Error("D1 newcomer fixture has ambiguous missing strength");
    const augmented=state;
    const probe=forecastCbbGame(augmented,fixture,artifact.uncertainty),role=newcomer.id===fixture.homeId?1:-1;
    const jm=[role*probe.possessions/100,-role*probe.possessions/100,probe.margin/(2*probe.possessions)],
      jt=[probe.possessions/100,probe.possessions/100,probe.total/(2*probe.possessions)];
    // This is source-translation residual uncertainty, not a calibrated entrant
    // posterior. Do not shrink it using the incumbent ridge as a variance model.
    const parameterVariance=newcomer.parameterVariance;
    const cov=(a:number[],b:number[])=>a.reduce((n,v,i)=>n+v*b[i]*parameterVariance[i],0);
    const vm=artifact.uncertainty.marginSd**2+cov(jm,jm),vt=artifact.uncertainty.totalSd**2+cov(jt,jt);
    const uncertainty={...artifact.uncertainty,marginSd:Math.sqrt(vm),totalSd:Math.sqrt(vt),
      marginTotalCorrelation:(artifact.uncertainty.marginTotalCorrelation*artifact.uncertainty.marginSd*artifact.uncertainty.totalSd+cov(jm,jt))/Math.sqrt(vm*vt)};
    const base=forecastCbbGame(augmented,fixture,uncertainty),features=cbbScoreFeatures(base,augmented,fixture,history);
    const forecast={...correctCbbScoreForecast(base,features,artifact.correction as CbbScoreArtifact["correction"],game.season),release:CBB_FULL_D1_SCORE_RELEASE};
    return {game:fixture,state:augmented,features,forecast,coverage:{release:CBB_FULL_D1_FORECAST_RELEASE,kind:"d1_newcomer" as const,
      identity:null,inputs:{...newcomer.inputs,parameterVariance}}};
  });
}
