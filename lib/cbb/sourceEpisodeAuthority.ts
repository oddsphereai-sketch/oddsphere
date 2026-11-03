/** The NBA/NFL physical-episode pattern, with CBB receipt-window ordering.
 * This selects observed evidence; it does not estimate bookmaker reliability. */
export type CbbSourceEpisode = {
  id:string; effect:number; observedDirection:-1|0|1;
  beforeSourceAt:number; afterSourceAt:number;
  beforeEarliest:number;beforeAvailableBy:number; afterAvailableBy:number;
  currentSourceAt:number; currentAvailableBy:number;
  currentDirection:-1|0|1; resolved:boolean;
  qualifiedReaction?:boolean;
  qualifiedContrarianHold?:boolean;
  qualifiedNetResistance?:boolean;
  repricedSourceAt?:number|null;
};
export type CbbSourceAuthority = {
  status:"selected"|"equivalent"|"retained"|"unresolved";
  reason:"single_physical_source"|"equivalent_source_effects"|"observed_leader_with_followers"|
    "later_episode_supersedes_old_observations"|"qualified_source_response"|"qualified_contrarian_hold"|
    "latest_observed_repricing"|"qualified_current_resistance"|"current_source_opposition"|"overlapping_source_windows";
  selectedId:string|null; authorIds:string[]; followerIds:string[]; opposingIds:string[];
};
const same=(a:number,b:number)=>Math.abs(a-b)<=1e-7;

export function selectCbbSourceEpisode(rows:readonly CbbSourceEpisode[]):CbbSourceAuthority{
  if(!rows.length||new Set(rows.map(row=>row.id)).size!==rows.length||rows.some(row=>
    !row.id||![row.effect,row.beforeSourceAt,row.afterSourceAt,row.beforeEarliest,row.beforeAvailableBy,row.afterAvailableBy,
      row.currentSourceAt,row.currentAvailableBy].every(Number.isFinite)||
    row.beforeSourceAt>=row.afterSourceAt||row.afterSourceAt>row.currentSourceAt||
    row.beforeEarliest>row.beforeAvailableBy||row.beforeAvailableBy>row.afterAvailableBy||row.afterAvailableBy>row.currentAvailableBy||
    row.repricedSourceAt!=null&&(!Number.isFinite(row.repricedSourceAt)||row.repricedSourceAt>row.currentSourceAt)))
    throw new Error("CBB source authorship requires distinct ordered economic episodes");
  const result=(chosen:CbbSourceEpisode,reason:CbbSourceAuthority["reason"],followers:string[]=[],opponents:string[]=[]):CbbSourceAuthority=>
    ({status:"selected",reason,selectedId:chosen.id,authorIds:[chosen.id],followerIds:followers,opposingIds:opponents});
  if(rows.length===1)return result(rows[0],"single_physical_source");
  if(rows.every(row=>same(row.effect,rows[0].effect))){
    // Sorting equivalent identities cannot change the numerical consequence.
    const ids=rows.map(row=>row.id).sort();
    return {status:"equivalent",reason:"equivalent_source_effects",selectedId:ids[0],authorIds:ids,followerIds:[],opposingIds:[]};
  }
  const opposed=new Set(rows.map(row=>row.observedDirection).filter(Boolean)).size>1;
  if(opposed){
    // An old source cannot be called superseded if it was observed again
    // after the later episode began. A last-move timestamp alone is insufficient.
    const later=rows.filter(row=>row.resolved&&row.currentDirection===row.observedDirection&&rows.every(other=>other===row||
      other.currentSourceAt<row.beforeSourceAt&&other.currentAvailableBy<=row.beforeEarliest));
    if(later.length===1)return result(later[0],"later_episode_supersedes_old_observations",[],rows.filter(row=>row!==later[0]).map(row=>row.id));
    return {status:"unresolved",reason:"current_source_opposition",selectedId:null,authorIds:[],followerIds:[],opposingIds:rows.map(row=>row.id).sort()};
  }
  // A's changed state preceded a later still-unchanged state at B. Different
  // polling times alone do not prove that A led B. Use both native and arrival
  // ordering, without manufacturing precision inside a concurrent collection.
  const leaders=rows.filter(row=>row.resolved&&row.currentDirection===row.observedDirection&&rows.every(other=>other===row||
    row.afterSourceAt<=other.beforeSourceAt&&row.afterAvailableBy<=other.beforeEarliest));
  if(leaders.length===1)return result(leaders[0],"observed_leader_with_followers",rows.filter(row=>row!==leaders[0]).map(row=>row.id));
  const reacting=rows.filter(row=>row.qualifiedReaction&&row.resolved&&row.currentDirection===row.observedDirection);
  if(reacting.length===1)return result(reacting[0],"qualified_source_response");
  // A genuine later hold against money opposing this source's priced stance
  // distinguishes conviction without adding invented hold points or requiring
  // that the book was the first mover. This is not ordinary flat/missing data.
  const holding=rows.filter(row=>row.qualifiedContrarianHold);
  if(holding.length===1)return result(holding[0],"qualified_contrarian_hold");
  // When aligned books reprice by different amounts, use the newest observed
  // resolved ECONOMIC update. This is an explicit recency interpretation, not
  // a claim of leadership. Refreshed unchanged quotes and insertion order do
  // not supply repricedSourceAt. Exact simultaneous ambiguity stays explicit.
  const repriced=rows.filter(row=>row.resolved&&row.currentDirection===row.observedDirection&&row.repricedSourceAt!=null);
  const latest=Math.max(...repriced.map(row=>row.repricedSourceAt!));
  const newest=repriced.filter(row=>row.repricedSourceAt===latest);
  if(newest.length===1)return result(newest[0],"latest_observed_repricing");
  // Old aligned net moves need not be transported when today's own-source
  // money is met by a verified hold. With no resolved new repricing to select,
  // retain the forecast explicitly because of current resistance, not because
  // leadership was unavailable. There is no invented opposite point bonus.
  const resisting=rows.filter(row=>row.qualifiedNetResistance);
  if(resisting.length===1)return {status:"retained",reason:"qualified_current_resistance",selectedId:resisting[0].id,
    authorIds:[],followerIds:[],opposingIds:[resisting[0].id]};
  return {status:"unresolved",reason:"overlapping_source_windows",selectedId:null,authorIds:[],followerIds:[],opposingIds:[]};
}
