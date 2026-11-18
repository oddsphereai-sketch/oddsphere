/** Offline numerical supplement. Same Normal expectation, no risk-policy change.
 * For z >= 12 use the positive Laplace continued fraction for the Mills ratio:
 * R(z)=1/(z+1/(z+2/(z+...))), so 1-zR(z)=d/(z+d), d=1/(z+2/(...)).
 * Avoid subtracting almost equal log-tail terms. No probability/variance floor.
 * The production default and every locked reader retain the original function.
 */
import {cbbWorkingNormalExpectedDownside as legacy} from "./contextualScoreLawResearch";
export const DOWNSIDE_METHOD="normal_downside_offline_2026_11_18_r1_positive_tail_fraction";
export function stableDownside(mean:number,sd:number):number {
  if (!Number.isFinite(mean) || !Number.isFinite(sd) || sd<0) throw Error("Invalid working downside");
  if (sd===0) return Math.max(-mean,0);
  if (mean<0) return stableDownside(-mean,sd)-mean;
  const z=mean/sd;
  if (z<12) return legacy(mean,sd);
  if (!Number.isFinite(z)) return 0;
  let d=0;
  for (let k=128;k>=1;k--) d=k/(z+d);
  return Math.exp(Math.log(sd)-.5*z*z-.5*Math.log(2*Math.PI)+Math.log(d)-Math.log(z+d));
}
