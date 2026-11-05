import source from "./artifacts/newcomer-strength-2026-r1.json";
import membership from "./artifacts/division-one-membership-2026-r1.json";
import type {CbbRatingState,CbbTeamRating} from "./types";

const memberIds=new Set(membership.members.map(m=>m.bdl));

/** Use program-specific published adjusted statistics only for a verified D1
 * newcomer missing from the incumbent fit. Fit the scale on all available exact
 * incumbent school pairs; existing ratings are never replaced or blended. */
export function cbbNewcomerRating(state:CbbRatingState,id:number){
  if(state.teams[id]||!memberIds.has(id)||state.season!==source.season||Date.parse(source.capturedAt)>Date.parse(state.asOf))
    throw Error("Invalid D1 newcomer source/identity/clock");
  const target=source.rows.find(r=>r.bdlId===id);if(!target)throw Error("D1 newcomer has no observed program statistics");
  const pairs=source.rows.filter(r=>!!state.teams[r.bdlId]);
  const fit=(field:"adjustedOffense"|"adjustedDefense"|"adjustedTempo",rating:"offense"|"defense"|"pace")=>{
    if(pairs.length<3)throw Error("D1 newcomer bridge is unidentified");
    const x=pairs.map(r=>r[field]),y=pairs.map(r=>state.teams[r.bdlId][rating]);
    const mx=x.reduce((n,v)=>n+v,0)/x.length,my=y.reduce((n,v)=>n+v,0)/y.length;
    const xx=x.reduce((n,v)=>n+(v-mx)**2,0);if(!(xx>0))throw Error("D1 newcomer bridge has no source variation");
    const slope=x.reduce((n,v,i)=>n+(v-mx)*(y[i]-my),0)/xx;
    const residuals=y.map((v,i)=>v-my-slope*(x[i]-mx));
    const variance=residuals.reduce((n,v)=>n+v*v,0)/(pairs.length-2);
    return {value:my+slope*(target[field]-mx),variance:variance*(1+1/pairs.length+(target[field]-mx)**2/xx),slope};
  };
  const off=fit("adjustedOffense","offense"),def=fit("adjustedDefense","defense"),pace=fit("adjustedTempo","pace");
  if(off.slope<0||def.slope<0||pace.slope<0)throw Error("D1 newcomer bridge reverses a source statistic");
  const rating:CbbTeamRating={offense:off.value,defense:def.value,pace:pace.value,games:0,factors:null,opponentFactors:null};
  return {rating,parameterVariance:[off.variance,def.variance,pace.variance] as [number,number,number],
    inputs:{release:source.release,schoolId:id,ncaaId:target.ncaaId,source:source.source,capturedAt:source.capturedAt,
      sourceHash:source.sourceHash,program:target.sourceName,adjustedOffense:target.adjustedOffense,
      adjustedDefense:target.adjustedDefense,adjustedTempo:target.adjustedTempo,bridgeInstitutions:pairs.length,
      uncertaintyBasis:"incumbent_source_translation_residual_not_entrant_calibration",
      sourceDomain:"early_season_published_program_efficiencies",qualifiedWager:false}};
}
