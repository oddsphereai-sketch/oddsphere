export type UclStrengthScoreTrainingRow = {
  id: number; kickoff: string; homeElo: number; awayElo: number;
  homeRatingDay: string; awayRatingDay: string;
  homeGoals: number; awayGoals: number; weight: number;
};

function solve(matrix: number[][], vector: number[]): number[] {
  const a = matrix.map((r, i) => [...r, vector[i]!]);
  for (let i = 0; i < 3; i++) {
    let pivot = i;
    for (let j = i + 1; j < 3; j++) if (Math.abs(a[j]![i]!) > Math.abs(a[pivot]![i]!)) pivot = j;
    [a[i], a[pivot]] = [a[pivot]!, a[i]!];
    const value = a[i]![i]!;
    if (!Number.isFinite(value) || Math.abs(value) < 1e-10) throw Error("Unidentified UCL strength scoring fit");
    for (let j = i; j <= 3; j++) a[i]![j] = a[i]![j]! / value;
    for (let k = 0; k < 3; k++) if (k !== i) {
      const factor = a[k]![i]!;
      for (let j = i; j <= 3; j++) a[k]![j] = a[k]![j]! - factor * a[i]![j]!;
    }
  }
  return a.map(r => r[3]!);
}

/** Three-parameter weighted Poisson rate fit: separate venue intercepts and
 * one rating-difference slope. These are strictly pre-match, original-source
 * rating observations, never today's ratings substituted into old matches.
 * This estimates a statistical prior relationship, not a bookmaker weight. */
export function fitUclStrengthScoreRate(rows: readonly UclStrengthScoreTrainingRow[]) {
  if (rows.length < 30) throw Error("Insufficient dated UCL strength-score pairs");
  for (const r of rows) if (![r.homeElo,r.awayElo,r.homeGoals,r.awayGoals,r.weight].every(Number.isFinite)
    || r.homeGoals < 0 || r.awayGoals < 0 || r.weight <= 0
    || !(Date.parse(r.homeRatingDay) < Date.parse(r.kickoff)) || !(Date.parse(r.awayRatingDay) < Date.parse(r.kickoff))) throw Error("Invalid or post-match UCL strength-score input");
  const observations = rows.flatMap(r => {
    const difference = (r.homeElo - r.awayElo) / 400;
    return [{ x:[1,0,difference], y:r.homeGoals, w:r.weight }, { x:[0,1,-difference], y:r.awayGoals, w:r.weight }];
  });
  const weight = rows.reduce((s,r) => s+r.weight,0);
  let beta = [Math.log(rows.reduce((s,r)=>s+r.weight*r.homeGoals,0)/weight),Math.log(rows.reduce((s,r)=>s+r.weight*r.awayGoals,0)/weight),0];
  const likelihood = (b:number[]) => observations.reduce((s,r)=>{const eta=r.x.reduce((v,x,i)=>v+x*b[i]!,0);return s+r.w*(r.y*eta-Math.exp(eta));},0);
  const information = (b:number[]) => {
    const h = Array.from({length:3},()=>[0,0,0]), gradient=[0,0,0];
    for (const r of observations) {
      const mu=Math.exp(r.x.reduce((s,x,i)=>s+x*b[i]!,0));
      for(let i=0;i<3;i++){gradient[i]=gradient[i]!+r.w*r.x[i]!*(r.y-mu);
        for(let j=0;j<3;j++)h[i]![j]=h[i]![j]!+r.w*mu*r.x[i]!*r.x[j]!;}
    }
    return {h,gradient};
  };
  let converged=false,iterations=0;
  for (;iterations<64;iterations++) {
    const {h,gradient}=information(beta),step=solve(h,gradient);
    if(Math.max(...step.map(Math.abs))<1e-9){converged=true;break;}
    let scale=1;const before=likelihood(beta);
    while(scale>1e-8&&likelihood(beta.map((b,i)=>b+scale*step[i]!))<before-1e-10)scale/=2;
    if(scale<=1e-8)throw Error("UCL strength score fit line search failed");
    beta=beta.map((b,i)=>b+scale*step[i]!);
  }
  if(!converged||beta.some(b=>!Number.isFinite(b))||beta[2]!<=0)throw Error("UCL strength score relationship did not identify a positive scoring slope");
  const variance=solve(information(beta).h,[0,0,1])[2]!;
  return {coefficientPer400:beta[2]!,coefficientStdError:Math.sqrt(variance),homeRate:Math.exp(beta[0]!),awayRate:Math.exp(beta[1]!),
    trainingRows:rows.length,iterations,converged,logLikelihood:likelihood(beta),
    minimumRatingDifference:Math.min(...rows.map(r=>r.homeElo-r.awayElo)),maximumRatingDifference:Math.max(...rows.map(r=>r.homeElo-r.awayElo))};
}
