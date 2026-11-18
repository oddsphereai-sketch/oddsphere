/** Shared frozen-model prediction only; no fit, writer, storage or provider call. */
import {createHash} from "node:crypto";
import type {Coordinates,Axis} from "./groupedOutcomeCoordinates";

export const RELEASE = "cbb_joint_residual_research_2026_11_18_r2_grouped_native_innovations";
export type TrainingRow = Coordinates & {target: number};
type Matrix = number[][];
const dot = (a: readonly number[],b: readonly number[]) => a.reduce((s,v,j) => s+v*b[j],0);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function validate(row: Coordinates) {
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
