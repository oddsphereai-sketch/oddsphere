import { forecastCbbGame } from "./model";
import type { CbbForecast, CbbFourFactors, CbbRatingState, CbbTeamRating, CbbTrainingGame } from "./types";

export const CBB_CROSS_DIVISION_PRIOR_RELEASE="cbb_cross_division_prior_2026_11_05_r1_observed_opponent_residuals" as const;
export const CBB_CROSS_DIVISION_SCORE_RELEASE="cbb_cross_division_score_2026_11_05_r1_posterior_score_law" as const;
export const CBB_FULL_D1_COVERAGE_START="2026-11-05" as const;
type Vector=[number,number,number];
type Matrix=[Vector,Vector,Vector];
export type CrossDivisionGame=CbbTrainingGame&{divisionOneId:number;opponentId:number};
type TeamPrior={mean:Vector;variance:Vector;precisionGames:number;games:number;factors:CbbFourFactors;opponentFactors:CbbFourFactors};
export type CbbCrossDivisionPrior={release:typeof CBB_CROSS_DIVISION_PRIOR_RELEASE;availableAt:string;fitThroughSeason:number;
  sourceHash:string;games:number;population:{mean:Vector;variance:Vector;persistence:Vector;noise:Matrix;factors:CbbFourFactors;opponentFactors:CbbFourFactors};
  teams:Record<number,TeamPrior>};
const zero=():Vector=>[0,0,0];
const keys=["efg","turnoverRate","offensiveReboundRate","freeThrowRate"] as const;
const factors=(rows:Array<{value:CbbFourFactors;weight:number}>):CbbFourFactors=>Object.fromEntries(keys.map(k=>
  [k,rows.reduce((n,r)=>n+r.weight*r.value[k],0)/rows.reduce((n,r)=>n+r.weight,0)])) as CbbFourFactors;

/** Estimate a PRESEASON prior from completed cross-division outcomes and the
 * matching season's final D1 ability. This is parameter fitting, never a replay
 * of what was knowable before those historical games. D1 states stay frozen. */
export function fitCbbCrossDivisionPrior(args:{games:CrossDivisionGame[];states:Record<number,CbbRatingState>;
  fitThroughSeason:number;availableAt:string;sourceHash:string}):CbbCrossDivisionPrior{
  const groups=new Map<string,Array<{value:Vector;weight:number;own:CbbFourFactors;other:CbbFourFactors}>>();
  for(const game of args.games){
    const state=args.states[game.season],d1=state?.teams[game.divisionOneId];
    if(!d1||state.season!==game.season||game.season>args.fitThroughSeason||game.neutral===null||
      ![game.homeId,game.awayId].includes(game.divisionOneId)||![game.homeId,game.awayId].includes(game.opponentId)||
      game.divisionOneId===game.opponentId||Date.parse(state.asOf)>Date.parse(args.availableAt)||
      Date.parse(game.date)+6*3600_000>Date.parse(args.availableAt))throw Error("Invalid cross-division prior source/season/clock");
    const lowerHome=game.homeId===game.opponentId,h=game.neutral?0:(lowerHome?1:-1)*state.homeEfficiency/2;
    const own=lowerHome?game.homeScore:game.awayScore,other=lowerHome?game.awayScore:game.homeScore;
    const value:Vector=[100*own/game.possessions-state.leagueEfficiency-d1.defense-h,
      100*other/game.possessions-state.leagueEfficiency-d1.offense+h,2*(game.tempo-state.leagueTempo)-d1.pace];
    if(!value.every(Number.isFinite))throw Error("Invalid cross-division residual");
    const weight=1,key=`${game.opponentId}:${game.season}`;
    const rows=groups.get(key)??[];
    rows.push({value,weight,own:lowerHome?game.homeFactors:game.awayFactors,other:lowerHome?game.awayFactors:game.homeFactors});
    groups.set(key,rows);
  }
  if(groups.size<2)throw Error("Cross-division population has insufficient institutions");
  const summaries=[...groups].map(([key,rows])=>{const [id,season]=key.split(":").map(Number),n=rows.reduce((n,r)=>n+r.weight,0);
    const mean=zero().map((_,i)=>rows.reduce((n,r)=>n+r.weight*r.value[i],0)/n) as Vector;
    return {id,season,rows,n,mean};});
  const seasons=[...new Set(summaries.map(g=>g.season))];
  const means=new Map(seasons.map(season=>{const rows=summaries.filter(g=>g.season===season);
    return [season,zero().map((_,i)=>rows.reduce((n,r)=>n+r.mean[i],0)/rows.length) as Vector];}));
  const mean=means.get(args.fitThroughSeason);if(!mean)throw Error("Cross-division prior has no latest-season source");
  const noise:Matrix=[zero(),zero(),zero()];let df=0;
  for(const g of summaries){df+=g.n-g.rows.reduce((n,r)=>n+r.weight*r.weight,0)/g.n;
    for(const row of g.rows)for(let i=0;i<3;i++)for(let j=0;j<3;j++)noise[i][j]+=row.weight*(row.value[i]-g.mean[i])*(row.value[j]-g.mean[j]);}
  if(!(df>0))throw Error("Cross-division residual variation is unidentified");
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)noise[i][j]/=df;
  const inverseN=summaries.reduce((n,r)=>n+1/r.n,0)/summaries.length;
  const variance=zero().map((_,i)=>Math.max(0,summaries.reduce((n,r)=>n+(r.mean[i]-means.get(r.season)![i])**2,0)/(summaries.length-seasons.length)-noise[i][i]*inverseN)) as Vector;
  const repeated=summaries.flatMap(g=>{const next=summaries.find(r=>r.id===g.id&&r.season===g.season+1);return next?[[g,next] as const]:[];});
  const persistence=zero().map((_,i)=>{
    if(repeated.length<2||variance[i]===0)return 0;
    const a=repeated.reduce((n,r)=>n+r[0].mean[i],0)/repeated.length,b=repeated.reduce((n,r)=>n+r[1].mean[i],0)/repeated.length;
    const covariance=repeated.reduce((n,r)=>n+(r[0].mean[i]-a)*(r[1].mean[i]-b),0)/(repeated.length-1);
    // Stationary AR(1) parameter bound, not a score/confidence cap.
    return Math.max(-1,Math.min(1,covariance/variance[i]));
  }) as Vector;
  const all=summaries.flatMap(g=>g.rows),own=factors(all.map(r=>({value:r.own,weight:r.weight}))),other=factors(all.map(r=>({value:r.other,weight:r.weight})));
  const latest=[...new Set(summaries.map(g=>g.id))].map(id=>summaries.filter(g=>g.id===id).sort((a,b)=>b.season-a.season)[0]);
  const teams=Object.fromEntries(latest.map(g=>{const years=args.fitThroughSeason+1-g.season;
    const posterior=variance.map((tau,i)=>tau===0?0:1/(1/tau+g.n/Math.max(1e-9,noise[i][i]))) as Vector;
    const v=variance.map((tau,i)=>tau*(1-persistence[i]**(2*years))+persistence[i]**(2*years)*posterior[i]) as Vector;
    const seasonMean=means.get(g.season)!;
    const m=mean.map((mu,i)=>mu+persistence[i]**years*(variance[i]===0?0:variance[i]/(variance[i]+noise[i][i]/g.n))*(g.mean[i]-seasonMean[i])) as Vector;
    return [g.id,{mean:m,variance:v,precisionGames:g.n,games:summaries.filter(r=>r.id===g.id).reduce((n,r)=>n+r.rows.length,0),
      factors:factors(g.rows.map(r=>({value:r.own,weight:r.weight}))),opponentFactors:factors(g.rows.map(r=>({value:r.other,weight:r.weight})))}];}));
  return {release:CBB_CROSS_DIVISION_PRIOR_RELEASE,availableAt:args.availableAt,sourceHash:args.sourceHash,
    fitThroughSeason:args.fitThroughSeason,games:args.games.length,population:{mean,variance,persistence,noise,factors:own,opponentFactors:other},teams};
}

/** The incumbent D1 fit is an input, never refitted with lower-division rows.
 * Sparse/new institutions use the observed lower-division population, not zero
 * D1-average strength. Parameter uncertainty remains in the joint score law. */
export function forecastCbbCrossDivision(args:{prior:CbbCrossDivisionPrior;state:CbbRatingState;
  game:{id:number;date:string;homeId:number;awayId:number;neutral:boolean|null};divisionOneId:number;opponentId:number;history?:CrossDivisionGame[]}):
  {forecast:CbbForecast;inputs:{release:string;opponentId:number;historyGames:number;basis:string;parameterVariance:Vector;sourceHash:string;
    venueDomain:string;uncertaintyQualification:string;qualifiedWager:false;currentHistory:CrossDivisionGame[];posteriorMean:Vector}}{
  const {prior,state,game}=args,d1=state.teams[args.divisionOneId];
  if(prior.release!==CBB_CROSS_DIVISION_PRIOR_RELEASE||prior.fitThroughSeason>=state.season||
    ![prior.availableAt,state.asOf,game.date].every(v=>Number.isFinite(Date.parse(v)))||
    Date.parse(prior.availableAt)>Date.parse(state.asOf)||!d1||game.neutral===null||
    ![game.homeId,game.awayId].includes(args.divisionOneId)||![game.homeId,game.awayId].includes(args.opponentId)||
    args.divisionOneId===args.opponentId)throw Error("Cross-division forecast identity/prior mismatch");
  for(const vector of [prior.population.mean,prior.population.variance,prior.population.persistence,...prior.population.noise]){
    if(vector.length!==3||!vector.every(Number.isFinite))throw Error("Cross-division prior vector is corrupt");
  }
  if(prior.population.variance.some(v=>v<0)||prior.population.noise.some((r,i)=>r[i]<=0))throw Error("Cross-division prior variance is invalid");
  const learned=prior.teams[args.opponentId],population=prior.population;
  let m=[...(learned?.mean??population.mean)] as Vector;
  let parameterVariance=[...(learned?.variance??population.variance)] as Vector;
  const current=(args.history??[]).filter(g=>g.opponentId===args.opponentId).sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id);
  if(new Set(current.map(g=>g.id)).size!==current.length)throw Error("Duplicate current cross-division input");
  for(const g of current){
    const opponent=state.teams[g.divisionOneId];
    if(g.season!==state.season||g.neutral===null||!opponent||g.divisionOneId===g.opponentId||
      ![g.homeId,g.awayId].includes(g.divisionOneId)||![g.homeId,g.awayId].includes(g.opponentId)||
      !Number.isFinite(Date.parse(g.date))||Date.parse(g.date)+6*3600_000>Date.parse(state.asOf))
      throw Error("Invalid current cross-division history identity/clock");
    const lowerHome=g.homeId===g.opponentId,h=g.neutral?0:(lowerHome?1:-1)*state.homeEfficiency/2;
    const own=lowerHome?g.homeScore:g.awayScore,other=lowerHome?g.awayScore:g.homeScore;
    const observed:Vector=[100*own/g.possessions-state.leagueEfficiency-opponent.defense-h,
      100*other/g.possessions-state.leagueEfficiency-opponent.offense+h,2*(g.tempo-state.leagueTempo)-opponent.pace];
    const weight=Math.exp(-(Date.parse(state.asOf)-Date.parse(g.date))/86400000/state.config.recencyDays);
    const nextVariance=parameterVariance.map((v,i)=>v===0?0:1/(1/v+weight/population.noise[i][i])) as Vector;
    m=m.map((mu,i)=>parameterVariance[i]===0?mu:nextVariance[i]*(mu/parameterVariance[i]+weight*observed[i]/population.noise[i][i])) as Vector;
    parameterVariance=nextVariance;
  }
  const rating:CbbTeamRating={offense:m[0],defense:m[1],pace:m[2],games:(learned?.games??0)+current.length,
    factors:learned?.factors??population.factors,opponentFactors:learned?.opponentFactors??population.opponentFactors};
  const augmented={...state,teams:{...state.teams,[args.opponentId]:rating}};
  const lowerHome=game.homeId===args.opponentId,home=augmented.teams[game.homeId],away=augmented.teams[game.awayId];
  const pace=state.leagueTempo+.5*(home.pace+away.pace),h=game.neutral===false?state.homeEfficiency/2:0;
  const homeEfficiency=state.leagueEfficiency+home.offense+away.defense+h;
  const awayEfficiency=state.leagueEfficiency+away.offense+home.defense-h;
  const marginJac:Vector=[(lowerHome?1:-1)*pace/100,(lowerHome?-1:1)*pace/100,(homeEfficiency-awayEfficiency)/200];
  const totalJac:Vector=[pace/100,pace/100,(homeEfficiency+awayEfficiency)/200];
  const cov=(a:Vector,b:Vector)=>a.reduce((sum,x,i)=>sum+b.reduce((n,y,j)=>n+x*y*(population.noise[i][j]+(i===j?parameterVariance[i]:0)),0),0);
  const vm=cov(marginJac,marginJac),vt=cov(totalJac,totalJac),mt=cov(marginJac,totalJac);
  if(!(vm>0&&vt>0&&mt*mt<vm*vt))throw Error("Cross-division score uncertainty is singular");
  const uncertainty={marginSd:Math.sqrt(vm),totalSd:Math.sqrt(vt),marginTotalCorrelation:mt/Math.sqrt(vm*vt),
    marginCorrection:0,totalCorrection:0,fitThroughSeason:prior.fitThroughSeason,games:prior.games};
  const forecast={...forecastCbbGame(augmented,game,uncertainty),release:CBB_CROSS_DIVISION_SCORE_RELEASE};
  return {forecast,inputs:{release:prior.release,opponentId:args.opponentId,historyGames:(learned?.games??0)+current.length,
    basis:current.length?"observed_current_opponent_posterior":learned?"observed_opponent_partial_pooling":"observed_cross_division_population_prior",parameterVariance,sourceHash:prior.sourceHash,
    venueDomain:game.neutral?"unobserved_neutral_cross_domain":lowerHome?"unobserved_lower_home_cross_domain":"observed_d1_home_cross_domain",
    uncertaintyQualification:learned?"historical_opponent_posterior_not_forward_calibration":"population_prior_without_school_history_or_selection_uncertainty",
    qualifiedWager:false,currentHistory:structuredClone(current),posteriorMean:m}};
}
