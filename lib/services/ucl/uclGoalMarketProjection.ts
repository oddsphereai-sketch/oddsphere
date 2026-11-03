import type {ScoreDistribution} from "@/lib/services/soccer/dixonColes";

export type UclGoalConstraint={identity:string;feature:(home:number,away:number)=>number;target:number};

/** Fraction of stake that wins/loses on an Over contract. A quarter line
 * splits equally between the adjacent whole/half lines; pushes earn/lose0. */
export function uclTotalStakeFractions(goals:number,line:number):{win:number;loss:number}{
 if(!Number.isInteger(goals)||goals<0||!Number.isFinite(line)||line<0||!Number.isInteger(line*4))throw Error("Invalid regulation goals contract");
 const legs=Number.isInteger(line*2)?[line]:[line-.25,line+.25];
 return{win:legs.reduce((sum,leg)=>sum+(goals>leg?1:0),0)/legs.length,
  loss:legs.reduce((sum,leg)=>sum+(goals<leg?1:0),0)/legs.length};
}

export function uclNativeTotalConstraint(identity:string,line:number,fairOver:number):UclGoalConstraint{
 if(!Number.isFinite(fairOver)||fairOver<=0||fairOver>=1)throw Error("Invalid paired total probability");
 // q is a fair stake-settlement share, not unconditional P(N>line).
 return{identity,target:0,feature:(home,away)=>{const s=uclTotalStakeFractions(home+away,line);return(1-fairOver)*s.win-fairOver*s.loss;}};
}

export function uclBttsConstraint(identity:string,fairYes:number):UclGoalConstraint{
 if(!Number.isFinite(fairYes)||fairYes<=0||fairYes>=1)throw Error("Invalid paired BTTS probability");
 return{identity,target:fairYes,feature:(home,away)=>home>0&&away>0?1:0};
}

/** Minimum-information projection. Each exact paired market supplies a linear
 * settlement constraint on ONE joint law. No independent mean or binary-goals
 * probability is frozen; every resulting market and expected score can move.
 * Numerical tolerances/iteration bounds control convergence, never play grades. */
export function projectUclGoalMarkets(base:ScoreDistribution,constraints:readonly UclGoalConstraint[]):{
 joint:ScoreDistribution;converged:boolean;residual:number;iterations:number;
}{
 if(!constraints.length)return{joint:base.map(row=>[...row]),converged:true,residual:0,iterations:0};
 const cells=base.flatMap((row,home)=>row.map((p,away)=>({home,away,p})));
 if(!cells.length||cells.some(c=>!Number.isFinite(c.p)||c.p<0)||!(cells.reduce((s,c)=>s+c.p,0)>0))throw Error("Invalid prior score law");
 const mass=cells.reduce((sum,c)=>sum+c.p,0);let probabilities=cells.map(c=>c.p/mass);
 const features=constraints.map(c=>cells.map(cell=>c.feature(cell.home,cell.away)));
 if(features.some(row=>row.some(v=>!Number.isFinite(v))))throw Error("Invalid goal-market feature");
 const residual=()=>Math.max(0,...constraints.map((c,i)=>Math.abs(probabilities.reduce((sum,p,k)=>sum+p*features[i]![k]!,0)-c.target)));
 let error=residual(),iterations=0;
 for(;iterations<256&&error>1e-9;iterations++){
  for(let i=0;i<constraints.length;i++){
   const c=constraints[i]!,feature=features[i]!;
   const meanAt=(theta:number)=>{
    let z=0,sum=0;const shift=Math.max(...feature.map((f,k)=>probabilities[k]!>0?theta*f:-Infinity));
    for(let k=0;k<probabilities.length;k++){const w=probabilities[k]!*Math.exp(theta*feature[k]!-shift);z+=w;sum+=w*feature[k]!;}
    return{mean:sum/z,shift};
   };
   let low=-1,high=1;
   while(low>-256&&meanAt(low).mean>c.target)low*=2;
   while(high<256&&meanAt(high).mean<c.target)high*=2;
   if(meanAt(low).mean>c.target+1e-9||meanAt(high).mean<c.target-1e-9)return{joint:base.map(row=>[...row]),converged:false,residual:error,iterations};
   for(let step=0;step<64;step++){const theta=(low+high)/2;if(meanAt(theta).mean<c.target)low=theta;else high=theta;}
   const theta=(low+high)/2,shift=meanAt(theta).shift;
   const updated=probabilities.map((p,k)=>p*Math.exp(theta*feature[k]!-shift));const z=updated.reduce((s,p)=>s+p,0);
   if(!Number.isFinite(z)||z<=0)return{joint:base.map(row=>[...row]),converged:false,residual:error,iterations};
   probabilities=updated.map(p=>p/z);
  }
  error=residual();
 }
 const joint=base.map(row=>row.map(()=>0));cells.forEach((cell,i)=>{joint[cell.home]![cell.away]=probabilities[i]!;});
 return{joint: error<=1e-7?joint:base.map(row=>[...row]),converged:error<=1e-7,residual:error,iterations};
}
