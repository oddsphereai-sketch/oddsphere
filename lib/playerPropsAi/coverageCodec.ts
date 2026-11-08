/** Lossless public coverage and native source-context interning only. Forecasts and public evidence stay exact. */
const FORMAT = "props_ai_coverage_table_v1";
const REF = "$propsAiCoverage";
const CONTEXT_REF = "$propsForecastContext";
const MAX_COVERAGES = 4096;
const MAX_REFERENCES = 100_000;
const MAX_CONTEXTS = 16_384;
const SOURCE_FIELDS = new Set(["forecastContext", "bookEvidence", "qualifiedReferenceEvidence", "projectionEvidence", "decisionSupport"]);
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function stringifyPropsAiCoverage(value: unknown): string {
  const table: unknown[] = [], contexts: unknown[] = [];
  const indexes = new Map<string, number>(), contextIndexes = new Map<string, number>();
  const identities = new WeakMap<object, number>(), contextIdentities = new WeakMap<object, number>();
  let references = 0;
  const json = JSON.stringify(value, (key, item: unknown) => {
    if (SOURCE_FIELDS.has(key) && (record(item) || Array.isArray(item))) {
      if (++references > MAX_REFERENCES) throw new Error("AI coverage reference bound exceeded");
      let index = contextIdentities.get(item);
      if (index === undefined) {
        const exact = JSON.stringify(item);
        index = contextIndexes.get(exact);
        if (index === undefined) {
          if (contexts.length >= MAX_CONTEXTS) throw new Error("Forecast context table bound exceeded");
          index = contexts.length;contexts.push(item);contextIndexes.set(exact,index);
        }
        contextIdentities.set(item,index);
      }
      return {[CONTEXT_REF]:index};
    }
    if (key !== "aiReview" || !record(item) || !record(item.coverage)) return item;
    if (++references > MAX_REFERENCES) throw new Error("AI coverage reference bound exceeded");
    let index = identities.get(item.coverage);
    if (index === undefined) {
      const exact = JSON.stringify(item.coverage);
      index = indexes.get(exact);
      if (index === undefined) {
        if (table.length >= MAX_COVERAGES) throw new Error("AI coverage table bound exceeded");
        index = table.length;
        table.push(item.coverage);
        indexes.set(exact, index);
      }
      identities.set(item.coverage, index);
    }
    return { ...item, coverage: { [REF]: index } };
  });
  if (json === undefined) throw new Error("AI coverage payload is not JSON");
  return table.length || contexts.length ? JSON.stringify({ format: FORMAT, coverages: table, contexts, payload: JSON.parse(json) }) : json;
}

export function parsePropsAiCoverage(json: string): unknown {
  const value: unknown = JSON.parse(json);
  // Every legacy inline payload retains precedence and its exact original fields.
  if (!record(value) || value.format !== FORMAT) return value;
  if (!Array.isArray(value.coverages) || value.coverages.length > MAX_COVERAGES
    || !value.coverages.every(record) || !Object.hasOwn(value, "payload")) {
    throw new Error("Invalid AI coverage table");
  }
  const table = value.coverages, contexts = value.contexts ?? [];
  if (!Array.isArray(contexts) || contexts.length > MAX_CONTEXTS || !contexts.every(item => record(item) || Array.isArray(item))) throw new Error("Invalid forecast context table");
  const contextTable: unknown[] = contexts;
  let references = 0;
  function restore(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(restore);
    if (!record(item)) return item;
    for (const [key, child] of Object.entries(item)) {
      if (SOURCE_FIELDS.has(key) && record(child) && Object.keys(child).length === 1 && Object.hasOwn(child, CONTEXT_REF)) {
        const index=child[CONTEXT_REF];
        if (++references > MAX_REFERENCES || typeof index !== "number" || !Number.isInteger(index)
          || index < 0 || index >= contextTable.length) throw new Error("Invalid forecast context reference");
        item[key]=contextTable[index];
      } else if (key === "aiReview" && record(child) && record(child.coverage)
        && Object.keys(child.coverage).length === 1 && Object.hasOwn(child.coverage, REF)) {
        const index = child.coverage[REF];
        if (++references > MAX_REFERENCES || typeof index !== "number" || !Number.isInteger(index)
          || index < 0 || index >= table.length) throw new Error("Invalid AI coverage reference");
        item[key] = { ...child, coverage: table[index] };
      } else item[key] = restore(child);
    }
    return item;
  }
  return restore(value.payload);
}
