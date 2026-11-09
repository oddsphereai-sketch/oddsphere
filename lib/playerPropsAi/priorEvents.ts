/** A retained quote side is not the independent forecast's favored outcome. */
import type {Evidence,Json,Player} from "./evidenceContract";
const object=(v:Json):Record<string,Json>=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
const probability=(v:Json|undefined):number|null=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=1?v:null;
export function independentPriorEvent(e:Evidence){
  const v=object(e.value),line=typeof v.line==="number"&&Number.isFinite(v.line)?v.line:null;
  const selected=probability(v.independentSelectedSideProbability),side=v.selectedSide;
  let over=probability(v.independentOver),under=probability(v.independentUnder);
  // Only a half-integer ordinary count/net-yard event proves no integer push.
  // Unknown integer/milestone contracts must not acquire an invented complement.
  if(line!==null&&Math.abs(line%1)===.5&&v.market!=="anytime_td"){
    if(side==="over"&&selected!==null){over??=selected;under??=1-selected;}
    if(side==="under"&&selected!==null){under??=selected;over??=1-selected;}
  }
  const yes=v.market==="anytime_td"&&side==="yes"?selected:null;
  const preferred=yes!==null?(yes>.5?"yes":yes<.5?"no":"tie"):over!==null&&under!==null&&over+under<=1+1e-9?(over>under?"over":under>over?"under":"tie"):"unavailable";
  return {sourceId:e.id,market:typeof v.market==="string"?v.market:null,line,
    independentMean:typeof v.independentProjection==="number"&&Number.isFinite(v.independentProjection)?v.independentProjection:null,
    referenceContractSide:typeof side==="string"?side:null,probabilityOfReferenceSide:selected,
    overProbability:over,underProbability:under,yesProbability:yes,preferredOutcome:preferred,
    meaning:"referenceContractSide names the retained contract, not the favored event; compare the actual independent probabilities. Missing push/contract information stays unknown."};
}
export function independentPriorEvents(player:Pick<Player,"evidence">){return player.evidence.filter(e=>e.kind==="independent_model").map(independentPriorEvent);}
