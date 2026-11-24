/** Lossless wire-only key interning. Quote values, order and multiplicity stay exact. */
export const NBA_PROPS_MARKET_ROW_TABLE = "nba_props_market_row_table_v1" as const;
export const NBA_PROPS_MARKET_ROW_TABLE_THRESHOLD = 100_000;
const MAX_LAYOUTS = 64;
const MAX_COLUMNS = 64;
const MAX_KEY_BYTES = 128;

type Plan = { properties: unknown[][]; layouts: string[][]; rowLayouts: Uint8Array };
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const omitted = (value: unknown) => value === undefined || typeof value === "function" || typeof value === "symbol";

function keysFor(value: unknown): string[] | null {
  if (!object(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const keys = Object.keys(value);
  if (keys.length > MAX_COLUMNS) return null;
  const kept: string[] = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor) || Buffer.byteLength(key) > MAX_KEY_BYTES) return null;
    if (key === "toJSON" && typeof descriptor.value === "function") return null;
    if (!omitted(descriptor.value)) kept.push(key);
  }
  return kept;
}

/** Unsupported object shapes retain the original bounded JSON path. */
export function planNbaPropsMarketRowTable(history: unknown, maxRows: number): Plan | null {
  if (!object(history) || !Array.isArray(history.observations)
    || history.observations.length < NBA_PROPS_MARKET_ROW_TABLE_THRESHOLD
    || history.observations.length > maxRows) return null;
  const rootKeys = keysFor(history);
  if (!rootKeys?.includes("observations")) return null;
  const properties = rootKeys.map(key => key === "observations" ? [key] : [key, history[key]]);
  const layouts: string[][] = [], identities = new Map<string, number>();
  const rowLayouts = new Uint8Array(history.observations.length);
  for (let index = 0; index < history.observations.length; index += 1) {
    const keys = keysFor(history.observations[index]);
    if (!keys) return null;
    const identity = JSON.stringify(keys);
    let layout = identities.get(identity);
    if (layout === undefined) {
      if (layouts.length === MAX_LAYOUTS) return null;
      layout = layouts.length; layouts.push(keys); identities.set(identity, layout);
    }
    rowLayouts[index] = layout;
  }
  return {properties, layouts, rowLayouts};
}

export function* stringifyNbaPropsMarketRowTable(
  history: {observations: readonly unknown[]}, plan: Plan,
): Generator<string> {
  yield `{"format":${JSON.stringify(NBA_PROPS_MARKET_ROW_TABLE)},"properties":`;
  yield JSON.stringify(plan.properties);
  yield ',"layouts":'; yield JSON.stringify(plan.layouts); yield ',"rows":[';
  for (let index = 0; index < history.observations.length; index += 1) {
    if (index) yield ",";
    const layout = plan.rowLayouts[index]!, keys = plan.layouts[layout]!;
    const row = history.observations[index] as Record<string, unknown>;
    const values = JSON.stringify(keys.map(key => row[key]));
    yield keys.length ? `[${layout},${values.slice(1)}` : `[${layout}]`;
  }
  yield "]}";
}

/** Expand in place so tuple arrays are released as original row objects appear. */
export function parseNbaPropsMarketRowTable(value: unknown, maxRows: number): unknown {
  if (!object(value) || value.format !== NBA_PROPS_MARKET_ROW_TABLE
    || Object.keys(value).sort().join(",") !== "format,layouts,properties,rows"
    || !Array.isArray(value.layouts) || !value.layouts.length || value.layouts.length > MAX_LAYOUTS
    || !Array.isArray(value.properties) || value.properties.length > MAX_COLUMNS
    || !Array.isArray(value.rows) || value.rows.length > maxRows) throw new Error("Invalid NBA market row table.");
  const validKeys = (keys: unknown): keys is string[] => Array.isArray(keys) && keys.length <= MAX_COLUMNS
    && keys.every(key => typeof key === "string" && Buffer.byteLength(key) <= MAX_KEY_BYTES)
    && new Set(keys).size === keys.length;
  if (!value.layouts.every(validKeys)) throw new Error("Invalid NBA market row layout.");
  const properties = value.properties as unknown[][], rootKeys: string[] = [];
  let observationSlots = 0;
  for (const property of properties) {
    if (!Array.isArray(property) || ![1, 2].includes(property.length)
      || typeof property[0] !== "string" || Buffer.byteLength(property[0]) > MAX_KEY_BYTES) throw new Error("Invalid NBA market property.");
    rootKeys.push(property[0]);
    if (property[0] === "observations") { if (property.length !== 1) throw new Error("Invalid NBA market observations."); observationSlots++; }
    else if (property.length !== 2) throw new Error("Invalid NBA market property value.");
  }
  if (observationSlots !== 1 || new Set(rootKeys).size !== rootKeys.length) throw new Error("Ambiguous NBA market properties.");
  const layouts = value.layouts as string[][], rows = value.rows;
  for (let index = 0; index < rows.length; index += 1) {
    const tuple: unknown = rows[index];
    if (!Array.isArray(tuple) || !Number.isInteger(tuple[0]) || tuple[0] < 0
      || tuple[0] >= layouts.length || tuple.length !== layouts[tuple[0]]!.length + 1) throw new Error("Invalid NBA market row values.");
    const keys = layouts[tuple[0]]!;
    rows[index] = Object.fromEntries(keys.map((key, column) => [key, tuple[column + 1]]));
  }
  return Object.fromEntries(properties.map(property => property[0] === "observations" ? [property[0], rows] : property));
}
