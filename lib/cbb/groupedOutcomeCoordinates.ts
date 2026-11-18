/** Offline only. Original native source admission owns identity and clocks. */
import {buildCbbOutcomeInputs as nativeInputs} from "./contextualDirectOutcomeForecast";
import {cbbEconomicTotalOrigin,cbbOutcomeIsInnovation} from "./economicTotalForecast";
import type {CbbContextualFeatureInput} from "./contextualForecastFeatures";

export type Axis = "margin" | "total";
export type Coordinates = {
  gameId: number; axis: Axis; origin: number;
  names: string[]; groups: string[]; values: number[]; known: boolean[];
};
const median = (xs: number[]) => {
  const ordered = [...xs].sort((a,b) => a-b);
  return (ordered[Math.floor((ordered.length-1)/2)] + ordered[Math.floor(ordered.length/2)])/2;
};

export function coordinates(input: CbbContextualFeatureInput): Record<Axis,Coordinates> {
  const native = nativeInputs(input);
  return Object.fromEntries((["margin","total"] as const).map(axis => {
    const physical = native.measurementInputs[axis].measurements.filter(m => m.role !== "independent");
    if (new Set(physical.map(m => m.physicalSourceId)).size !== physical.length)
      throw Error("Repeated physical book in residual coordinates");
    const pro = physical.filter(m => m.role === "professional");
    const consumer = physical.filter(m => m.role === "consumer");
    const pool = pro.length ? pro : consumer;
    const origin = axis === "total" ? cbbEconomicTotalOrigin(native).value :
      pool.length ? median(pool.map(m => m.center)) : input.independent.margin;
    const row: Coordinates = {gameId:input.independent.gameId,axis,origin,names:[],groups:[],values:[],known:[]};
    const add = (name: string, group: string, value: number | null) => {
      if (value !== null && !Number.isFinite(value)) throw Error("Nonfinite residual coordinate");
      row.names.push(name); row.groups.push(group); row.values.push(value ?? 0); row.known.push(value !== null);
    };
    if (axis === "total") add("residual_constant","constant",1);
    add("independent.relative_point","level",input.independent[axis]-origin);
    const books = [...new Set(native[axis].blocks.level.names.flatMap(name => {
      const found = name.match(/^book\.([^.]+)\.(?:moneyline|spread|total)\.center$/);
      return found ? [found[1]] : [];
    }))].sort();
    for (const book of books) {
      const measurement = physical.find(m => m.book === book);
      add(`book.${book}.relative_center`,"level",measurement ? measurement.center-origin : null);
    }
    for (const block of ["path","pressure","cross_path","cross_pressure"] as const) {
      if (axis === "margin" && block.startsWith("cross_")) continue;
      const vector = native[axis].blocks[block];
      for (let j=0;j<vector.names.length;j++) {
        if (vector.parity[j] !== (axis === "margin" ? -1 : 1) || !cbbOutcomeIsInnovation(block,vector.names[j])) continue;
        add(`${block}:${vector.names[j]}`,block,vector.known[j] ? vector.values[j] : null);
      }
    }
    if (!Number.isFinite(origin) || new Set(row.names).size !== row.names.length)
      throw Error("Residual origin/schema invalid");
    return [axis,row];
  })) as Record<Axis,Coordinates>;
}
