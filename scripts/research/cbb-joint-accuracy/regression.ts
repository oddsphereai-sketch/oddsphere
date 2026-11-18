/** Pure offline learner. No production writer imports this module. */
import {createHash} from "node:crypto";
import type {Coordinates,Axis} from "./coordinates";

export const RELEASE = "cbb_joint_residual_research_2026_11_18_r2_grouped_native_innovations";
export type TrainingRow = Coordinates & {target: number};
type Matrix = number[][];
const dot = (a: readonly number[],b: readonly number[]) => a.reduce((s,v,j) => s+v*b[j],0);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function cholesky(a: Matrix): Matrix {
  const l = a.map(r => r.map(() => 0));
  for (let i=0;i<a.length;i++) for (let j=0;j<=i;j++) {
    let v = a[i][j];
    for (let k=0;k<j;k++) v -= l[i][k]*l[j][k];
    if (i === j) {
      if (!(v>0 && Number.isFinite(v))) throw Error("Unresolved posterior covariance");
      l[i][j] = Math.sqrt(v);
    } else l[i][j] = v/l[j][j];
  }
  return l;
}
function solve(l: Matrix,b: number[]): number[] {
  const y = b.map(() => 0), x = b.map(() => 0);
  for (let i=0;i<b.length;i++) {let v=b[i]; for (let j=0;j<i;j++) v-=l[i][j]*y[j]; y[i]=v/l[i][i];}
  for (let i=b.length-1;i>=0;i--) {let v=y[i]; for (let j=i+1;j<b.length;j++) v-=l[j][i]*x[j]; x[i]=v/l[i][i];}
  return x;
}
function validate(row: Coordinates) {
  if (!Number.isSafeInteger(row.gameId) || row.gameId<=0 || !Number.isFinite(row.origin) ||
      !["margin","total"].includes(row.axis) || new Set(row.names).size !== row.names.length ||
      [row.groups,row.values,row.known].some(xs => xs.length !== row.names.length) ||
      !row.values.every(Number.isFinite) || row.known.some((k,j) => typeof k !== "boolean" || !k && row.values[j] !== 0))
    throw Error("Invalid regression identity or observed/missing coordinate");
}
export type ResidualModel = {
  release: typeof RELEASE; axis: Axis; status: string; iterations: number;
  names: string[]; groups: string[]; scales: number[]; active: number[];
  coefficients: number[]; covariance: Matrix; noiseVariance: number;
  fittedPrecisions: Record<string,number>; trainingIds: number[]; trainingSha256: string;
  initialObjective: number; objective: number; maxGradientPerGame: number;
};

/** One deterministic grouped marginal-likelihood fit; no parameter grid. */
export function fit(rows: readonly TrainingRow[]): ResidualModel {
  if (rows.length<100 || new Set(rows.map(r => r.gameId)).size !== rows.length) throw Error("Insufficient/duplicate training games");
  rows.forEach(validate);
  const original = hash(rows), schema = hash({axis:rows[0].axis,names:rows[0].names,groups:rows[0].groups});
  if (rows.some(r => !Number.isFinite(r.target) || hash({axis:r.axis,names:r.names,groups:r.groups}) !== schema))
    throw Error("Training target or feature schema mismatch");
  const {names,groups,axis} = rows[0], n=rows.length;
  const scales=names.map((_,j) => Math.sqrt(rows.reduce((s,r) => s+r.values[j]**2,0)/n));
  const active=scales.flatMap((s,j) => s>0 ? [j] : []), p=active.length;
  if (!p) throw Error("No identified training coordinates");
  const groupNames=[...new Set(active.map(j => groups[j]))], groupIndex=active.map(j => groupNames.indexOf(groups[j]));
  const x=rows.map(r => active.map(j => r.values[j]/scales[j])), y=rows.map(r => r.target-r.origin);
  const gram=Array.from({length:p},() => Array(p).fill(0)), rhs=Array(p).fill(0);
  for (let i=0;i<n;i++) for (let j=0;j<p;j++) {
    rhs[j]+=x[i][j]*y[i]; for (let k=0;k<=j;k++) gram[j][k]+=x[i][j]*x[i][k];
  }
  for (let j=0;j<p;j++) for (let k=0;k<j;k++) gram[k][j]=gram[j][k];
  const evaluate=(theta: number[]) => {
    const alphas=theta.slice(0,-1).map(Math.exp), beta=Math.exp(theta.at(-1)!);
    if (![...alphas,beta].every(v => v>0 && Number.isFinite(v))) throw Error("Nonfinite evidence precision");
    const alpha=groupIndex.map(g => alphas[g]);
    const l=cholesky(gram.map((r,j) => r.map((v,k) => beta*v+(j===k ? alpha[j] : 0))));
    const coefficients=solve(l,rhs.map(v => beta*v));
    const columns=Array.from({length:p},(_,j) => solve(l,Array.from({length:p},(_,k) => k===j ? 1 : 0)));
    const covariance=Array.from({length:p},(_,j) => columns.map(c => c[j]));
    const rss=y.reduce((s,v,i) => s+(v-dot(x[i],coefficients))**2,0);
    const gamma=alpha.map((a,j) => 1-a*covariance[j][j]);
    const objective=.5*(n*Math.log(2*Math.PI)-n*Math.log(beta)-alpha.reduce((s,a) => s+Math.log(a),0)+
      2*l.reduce((s,r,j) => s+Math.log(r[j]),0)+beta*rss+coefficients.reduce((s,v,j) => s+alpha[j]*v*v,0));
    const gradient=groupNames.map((_,g) => .5*coefficients.reduce((s,v,j) => s+(groupIndex[j]===g ? alpha[j]*v*v-gamma[j] : 0),0));
    gradient.push(.5*(beta*rss-n+gamma.reduce((s,v) => s+v,0)));
    if (![objective,...gradient].every(Number.isFinite)) throw Error("Unresolved marginal likelihood");
    return {objective,gradient,coefficients,covariance,beta,alphas};
  };
  let theta=[...groupNames.map(() => 0),Math.log(n/y.reduce((s,v) => s+v*v,0))];
  let state=evaluate(theta), iterations=0, status="iteration_limit";
  const initialObjective=state.objective, dimension=theta.length;
  const identity=() => Array.from({length:dimension},(_,i) => Array.from({length:dimension},(_,j) => i===j ? 1/n : 0));
  let inverse=identity();
  for (;iterations<300;iterations++) {
    if (Math.max(...state.gradient.map(Math.abs))/n<=1e-5) {status="converged"; break;}
    let direction=inverse.map(r => -dot(r,state.gradient));
    if (!(dot(direction,state.gradient)<0)) {inverse=identity(); direction=state.gradient.map(v => -v/n);}
    let accepted: {theta:number[];state:ReturnType<typeof evaluate>} | null=null;
    for (let attempt=0,step=1;attempt<24;attempt++,step*=.5) {
      const next=theta.map((v,j) => v+step*direction[j]);
      try {
        const candidate=evaluate(next);
        if (candidate.objective<=state.objective+1e-4*step*dot(state.gradient,direction)) {accepted={theta:next,state:candidate}; break;}
      } catch { /* Numerically unresolved proposed precisions cannot be accepted. */ }
    }
    if (!accepted) {status="line_search_failed"; break;}
    const s=accepted.theta.map((v,j) => v-theta[j]), g=accepted.state.gradient.map((v,j) => v-state.gradient[j]), gs=dot(g,s);
    if (gs>0) {
      const hg=inverse.map(r => dot(r,g)), ghg=dot(g,hg);
      inverse=inverse.map((r,i) => r.map((v,j) => v+(1+ghg/gs)*s[i]*s[j]/gs-(hg[i]*s[j]+s[i]*hg[j])/gs));
      if (!inverse.flat().every(Number.isFinite)) inverse=identity();
    } else inverse=identity();
    theta=accepted.theta; state=accepted.state;
  }
  if (hash(rows)!==original) throw Error("Training input mutation");
  return {release:RELEASE,axis,status,iterations,names:[...names],groups:[...groups],scales,active,
    coefficients:state.coefficients,covariance:state.covariance,noiseVariance:1/state.beta,
    fittedPrecisions:Object.fromEntries(groupNames.map((g,j) => [g,state.alphas[j]])),
    trainingIds:rows.map(r => r.gameId),trainingSha256:original,initialObjective,objective:state.objective,
    maxGradientPerGame:Math.max(...state.gradient.map(Math.abs))/n};
}

export function predict(model: ResidualModel,row: Coordinates) {
  validate(row);
  if (model.release!==RELEASE || model.status!=="converged" || model.axis!==row.axis || model.trainingIds.includes(row.gameId) ||
      hash({names:model.names,groups:model.groups})!==hash({names:row.names,groups:row.groups}))
    throw Error("Regression release, own-game exclusion or feature binding mismatch");
  const x=model.active.map(j => row.values[j]/model.scales[j]);
  const residual=dot(x,model.coefficients);
  const locationVariance=x.reduce((s,v,j) => s+v*dot(model.covariance[j],x),0);
  if (!(locationVariance>=0 && Number.isFinite(locationVariance) && model.noiseVariance>0)) throw Error("Invalid predictive variance");
  return {mean:row.origin+residual,sd:Math.sqrt(model.noiseVariance+locationVariance),locationVariance,residual};
}
