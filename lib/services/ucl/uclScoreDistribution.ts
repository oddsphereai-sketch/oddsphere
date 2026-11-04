/** UCL-only adaptive Poisson support. A larger independent rate must not be
 * silently clipped to 3.8 goals or lose its upper tail on a fixed 0..8 grid. */
export function uclScoreDistribution(home:number,away:number,tau:number):number[][] {
  if(![home,away,tau].every(Number.isFinite)||home<=0||away<=0)throw Error("Invalid UCL goal rates");
  const factors=[1-home*away*tau,1+home*tau,1+away*tau,1-tau];
  if(factors.some(v=>v<0))throw Error("UCL low-score correction outside valid rate domain");
  const marginal=(rate:number)=>{const p=[Math.exp(-rate)];let sum=p[0]!;
    for(let k=1;k<128&&(k<9||1-sum>1e-12);k++){p.push(p[k-1]!*rate/k);sum+=p[k]!;}
    if(1-sum>1e-12)throw Error("UCL score support did not cover goal tail");return p;};
  const h=marginal(home),a=marginal(away),size=Math.max(h.length,a.length);
  const joint=Array.from({length:size},(_,i)=>Array.from({length:size},(_,j)=>(h[i]??0)*(a[j]??0)));
  joint[0]![0]!*=factors[0]!;joint[0]![1]!*=factors[1]!;joint[1]![0]!*=factors[2]!;joint[1]![1]!*=factors[3]!;
  const sum=joint.flat().reduce((s,p)=>s+p,0);return joint.map(r=>r.map(p=>p/sum));
}
