/** Continuous independent-relative episode interpretation. Original evidence
 * and numeric consequence are distinct; confirmation can be useful without
 * applying the same directional information to the score twice. */
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
