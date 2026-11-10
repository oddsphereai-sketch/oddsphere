import {qualifiedForecastMarkets} from "./sourceEvents";
/** A retained quote side is not the independent forecast's favored outcome. */
import type {Evidence,Json,Player} from "./evidenceContract";
const object=(v:Json):Record<string,Json>=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
const probability=(v:Json|undefined):number|null=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=1?v:null;
export type IndependentPriorEvent={sourceId:string;market:string|null;line:number|null;independentMean:number|null;
  referenceContractSide:string|null;probabilityOfReferenceSide:number|null;overProbability:number|null;underProbability:number|null;yesProbability:number|null;
  preferredOutcome:"yes"|"no"|"over"|"under"|"tie"|"unavailable";meaning:string;
  /** Prospective declared contracts only; these keys stay absent on legacy events. */
  offerContract?:"two_way"|"milestone";noProbability?:number|null};
export function independentPriorEvent(e:Evidence):IndependentPriorEvent{
  const v=object(e.value),line=typeof v.line==="number"&&Number.isFinite(v.line)?v.line:null;
  const selected=probability(v.independentSelectedSideProbability),side=v.selectedSide;
  let over=probability(v.independentOver),under=probability(v.independentUnder);
  const milestone=v.offerContract==="milestone";
  // Only a half-integer ordinary count/net-yard event proves no integer push.
  // Unknown integer/milestone contracts must not acquire an invented complement.
  if(!milestone&&line!==null&&Math.abs(line%1)===.5&&v.market!=="anytime_td"){
    if(side==="over"&&selected!==null){over??=selected;under??=1-selected;}
    if(side==="under"&&selected!==null){under??=selected;over??=1-selected;}
  }
  const yes=milestone?(selected??over):v.market==="anytime_td"&&side==="yes"?selected:null;
  const no=milestone?(under??(yes===null?null:1-yes)):yes===null?null:1-yes;
  const preferred=yes!==null&&no!==null&&yes+no<=1+1e-9?(yes>no?"yes":yes<no?"no":"tie"):!milestone&&over!==null&&under!==null&&over+under<=1+1e-9?(over>under?"over":under>over?"under":"tie"):"unavailable";
  return {sourceId:e.id,market:typeof v.market==="string"?v.market:null,line,
    independentMean:typeof v.independentProjection==="number"&&Number.isFinite(v.independentProjection)?v.independentProjection:null,
    referenceContractSide:typeof side==="string"?side:null,probabilityOfReferenceSide:selected,
    overProbability:milestone?null:over,underProbability:milestone?null:under,yesProbability:yes,preferredOutcome:preferred,
    ...(milestone?{offerContract:"milestone" as const,noProbability:no}:v.offerContract==="two_way"?{offerContract:"two_way" as const}:{}),
    meaning:"referenceContractSide names the retained contract, not the favored event; compare the actual independent probabilities. Missing push/contract information stays unknown."};
}
export function independentPriorEvents(player:Pick<Player,"evidence">&Partial<Pick<Player,"markets"|"sourceEventContracts">>){return player.evidence.filter(e=>e.kind==="independent_model").map(independentPriorEvent).filter(e=>!e.market||!player.markets||qualifiedForecastMarkets({markets:player.markets,sourceEventContracts:player.sourceEventContracts}).includes(e.market));}
