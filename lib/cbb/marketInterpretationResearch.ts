/** Offline CBB interpretation experiment. This module is not called by the
 * member writer. It separates information that confirms the independent
 * score from information that actually moves its location. */
export type CbbRelativeMarketInterpretation = {
  kind:"unchanged"|"confirms_independent"|"corrects_independent"|"crosses_independent";
  scoreDelta:number;
  observedDelta:number;
};

export function interpretCbbRelativeMarketMove(independent:number,anchor:number,current:number):CbbRelativeMarketInterpretation{
  if(![independent,anchor,current].every(Number.isFinite))throw new Error("CBB market center must be finite");
  const observedDelta=current-anchor;
  if(Math.abs(observedDelta)<1e-9)return {kind:"unchanged",scoreDelta:0,observedDelta};
  const originalGap=anchor-independent,currentGap=current-independent;
  if(observedDelta*originalGap>=0)return {kind:"corrects_independent",scoreDelta:observedDelta,observedDelta};
  if(observedDelta*currentGap<=0)return {kind:"confirms_independent",scoreDelta:0,observedDelta};
  return {kind:"crosses_independent",scoreDelta:currentGap,observedDelta};
}
