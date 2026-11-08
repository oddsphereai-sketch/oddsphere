/** Lossless public coverage and native source-context interning only. Forecasts and public evidence stay exact. */
const FORMAT = "props_ai_coverage_table_v1";
const REVIEW_FORMAT = "props_ai_coverage_table_v2";
const REVIEW_REF = "$propsAiReview";
const ROW_REF = "$propsAiRow";
const REVIEW_FIELDS = ["quoteConfirmedAt", "selectedSide", "confidence", "exception"];
const REF = "$propsAiCoverage";
const CONTEXT_REF = "$propsForecastContext";
const MAX_COVERAGES = 4096;
const MAX_REFERENCES = 100_000;
const MAX_CONTEXTS = 16_384;
const SOURCE_FIELDS = new Set(["forecastContext", "bookEvidence", "qualifiedReferenceEvidence", "projectionEvidence", "decisionSupport"]);
type ReviewTemplate={value:Record<string,unknown>;fields:string[];coverageIndex:number|null};
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function stringifyPropsAiCoverage(value: unknown,options:{internReviewMetadata?:boolean}={}): string {
  const table: unknown[] = [], contexts: unknown[] = [];
  const reviews:ReviewTemplate[]=[];
  const reviewIndexes=new Map<string,number>();
  const indexes = new Map<string, number>(), contextIndexes = new Map<string, number>();
  const identities = new WeakMap<object, number>(), contextIdentities = new WeakMap<object, number>();
  let references = 0;
  function coverageIndex(item:Record<string,unknown>){
    let index=identities.get(item);
    if(index===undefined){const exact=JSON.stringify(item);index=indexes.get(exact);
      if(index===undefined){if(table.length>=MAX_COVERAGES)throw new Error("AI coverage table bound exceeded");index=table.length;table.push(item);indexes.set(exact,index);}
      identities.set(item,index);
    }
    return index;
  }
  const json = JSON.stringify(value, (key, item: unknown) => {
    if(options.internReviewMetadata&&key==="aiReview"&&record(item)){
      if(++references>MAX_REFERENCES)throw new Error("AI coverage reference bound exceeded");
      const base={...item},fields=REVIEW_FIELDS.filter(field=>Object.hasOwn(item,field)&&item[field]!==undefined);
      const values=fields.map(field=>item[field]);for(const field of fields)base[field]=null;
      const index=record(item.coverage)?coverageIndex(item.coverage):null;
      if(index!==null)base.coverage=null;
      const entry={value:base,fields,coverageIndex:index},exact=JSON.stringify(entry);
      let id=reviewIndexes.get(exact);
      if(id===undefined){if(reviews.length>=MAX_CONTEXTS)throw new Error("AI review metadata table bound exceeded");id=reviews.length;reviews.push(entry);reviewIndexes.set(exact,id);}
      return {[REVIEW_REF]:id,values};
    }
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
    const index=coverageIndex(item.coverage);
    return { ...item, coverage: { [REF]: index } };
  });
  if (json === undefined) throw new Error("AI coverage payload is not JSON");
  const rowSchemas:string[][]=[],schemaIndexes=new Map<string,number>();
  function packRows(item:unknown):unknown{
    if(Array.isArray(item))return item.map(packRows);
    if(!record(item))return item;
    return Object.fromEntries(Object.entries(item).map(([key,child])=>{
      if((key==="decisions"||key==="memberDecisions")&&Array.isArray(child))return [key,child.map(row=>{
        if(!record(row))return packRows(row);
        if(++references>MAX_REFERENCES)throw new Error("AI coverage reference bound exceeded");
        const keys=Object.keys(row),signature=JSON.stringify(keys);let index=schemaIndexes.get(signature);
        if(index===undefined){if(rowSchemas.length>=256)throw new Error("AI row schema bound exceeded");index=rowSchemas.length;rowSchemas.push(keys);schemaIndexes.set(signature,index);}
        return {[ROW_REF]:[index,...keys.map(k=>packRows(row[k]))]};
      })];
      return [key,packRows(child)];
    }));
  }
  const payload=options.internReviewMetadata?packRows(JSON.parse(json)):JSON.parse(json);
  return table.length || contexts.length || reviews.length || rowSchemas.length ? JSON.stringify({ format:options.internReviewMetadata?REVIEW_FORMAT:FORMAT, coverages: table, contexts,...(options.internReviewMetadata?{reviews,rowSchemas}:{}), payload }) : json;
}

export function parsePropsAiCoverage(json: string): unknown {
  const value: unknown = JSON.parse(json);
  // Every legacy inline payload retains precedence and its exact original fields.
  if (!record(value) || ![FORMAT,REVIEW_FORMAT].includes(value.format as string)) return value;
  if (!Array.isArray(value.coverages) || value.coverages.length > MAX_COVERAGES
    || !value.coverages.every(record) || !Object.hasOwn(value, "payload")) {
    throw new Error("Invalid AI coverage table");
  }
  const table = value.coverages, contexts = value.contexts ?? [];
  if (!Array.isArray(contexts) || contexts.length > MAX_CONTEXTS || !contexts.every(item => record(item) || Array.isArray(item))) throw new Error("Invalid forecast context table");
  const contextTable: unknown[] = contexts;
  const reviews=value.format===REVIEW_FORMAT?value.reviews:[];
  if(!Array.isArray(reviews)||reviews.length>MAX_CONTEXTS||!reviews.every(entry=>record(entry)&&record(entry.value)&&Array.isArray(entry.fields)
    &&entry.fields.every(field=>typeof field==="string"&&REVIEW_FIELDS.includes(field)&&Object.hasOwn(entry.value as object,field))
    &&new Set(entry.fields).size===entry.fields.length
    &&(entry.coverageIndex===null||typeof entry.coverageIndex==="number"&&Number.isInteger(entry.coverageIndex)&&entry.coverageIndex>=0&&entry.coverageIndex<table.length)))throw new Error("Invalid AI review metadata table");
  const rowSchemas=value.format===REVIEW_FORMAT?value.rowSchemas:[];
  if(!Array.isArray(rowSchemas)||rowSchemas.length>256||!rowSchemas.every(keys=>Array.isArray(keys)&&keys.every(k=>typeof k==="string")&&new Set(keys).size===keys.length))throw new Error("Invalid AI row schemas");
  const reviewTable=reviews as ReviewTemplate[],schemaTable=rowSchemas as string[][],metadataFormat=value.format===REVIEW_FORMAT;
  let references = 0;
  function restore(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(restore);
    if (!record(item)) return item;
    for (const [key, child] of Object.entries(item)) {
      if(metadataFormat&&(key==="decisions"||key==="memberDecisions")&&Array.isArray(child)){
        item[key]=child.map(row=>{
          if(!record(row)||Object.keys(row).length!==1||!Array.isArray(row[ROW_REF]))return restore(row);
          const [index,...values]=row[ROW_REF];
          if(++references>MAX_REFERENCES||typeof index!=="number"||!Number.isInteger(index)||index<0||index>=schemaTable.length||values.length!==schemaTable[index].length)throw new Error("Invalid AI row reference");
          return restore(Object.fromEntries(schemaTable[index].map((field:string,i:number)=>[field,values[i]])));
        });
      }else if(metadataFormat&&key==="aiReview"&&record(child)&&Object.keys(child).length===2&&Object.hasOwn(child,REVIEW_REF)&&Array.isArray(child.values)){
        const index=child[REVIEW_REF],values=child.values;
        if(++references>MAX_REFERENCES||typeof index!=="number"||!Number.isInteger(index)||index<0||index>=reviewTable.length)throw new Error("Invalid AI review metadata reference");
        const entry=reviewTable[index],base={...entry.value};
        if(values.length!==entry.fields.length)throw new Error("Invalid AI review metadata width");
        if(entry.coverageIndex!==null)base.coverage=table[entry.coverageIndex];
        entry.fields.forEach((field:string,i:number)=>{base[field]=values[i];});item[key]=base;
      } else if (SOURCE_FIELDS.has(key) && record(child) && Object.keys(child).length === 1 && Object.hasOwn(child, CONTEXT_REF)) {
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
