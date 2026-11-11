/** Lossless named records for repeated source structures; never a source filter. */
import type {Json} from "./evidenceContract";
import {invariant,stable} from "./evidence";
type Packed={format:"props_source_records_v1"|"props_source_records_v2";schema:string;recordSchemas:string[][];strings:string[];arrays?:Json[];document:Json};
export function packReaderSource(value:Json):Packed{
  const counts=new Map<string,number>(),arrayCounts=new Map<string,number>();
  const count=(v:Json)=>{if(typeof v==="string")counts.set(v,(counts.get(v)??0)+1);else if(v&&typeof v==="object"){if(Array.isArray(v)){const key=JSON.stringify(v);if(key.length>=24)arrayCounts.set(key,(arrayCounts.get(key)??0)+1);}Object.values(v).forEach(count);}};count(value);
  const strings=[...counts].filter(([s,n])=>n>=3&&s.length>=32).map(([s])=>s),stringIds=new Map(strings.map((s,i)=>[s,i]));
  const recordSchemas:string[][]=[],schemas=new Map<string,number>(),arrays:Json[]=[],arrayIds=new Map<string,number>();
  const encode=(v:Json):Json=>{
    if(typeof v==="string"&&stringIds.has(v))return {$s:stringIds.get(v)!};
    if(Array.isArray(v)){
      const key=JSON.stringify(v);
      if((arrayCounts.get(key)??0)>=3){
        if(!arrayIds.has(key)){const id=arrays.length;arrayIds.set(key,id);arrays.push(null);arrays[id]=v.map(encode);}
        return {$a:arrayIds.get(key)!};
      }
      return v.map(encode);
    }
    if(v&&typeof v==="object"){
      const keys=Object.keys(v),reserved=keys.some(k=>k==="$r"||k==="$s"||k==="$a");
      if(reserved||keys.length>=3&&keys.join("").length>=40){
        const key=JSON.stringify(keys);if(!schemas.has(key)){schemas.set(key,recordSchemas.length);recordSchemas.push(keys);}
        return {$r:[schemas.get(key)!,...keys.map(k=>encode(v[k]))]};
      }
      return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]));
    }
    return v;
  };
  // Keep the game/player navigation named. Only its evidence payloads are packed.
  const root=value as Record<string,Json>;
  const document:Json={...root,sharedContext:encode(root.sharedContext),historicalGames:encode(root.historicalGames),
    players:(root.players as Record<string,Json>[]).map(p=>({...p,evidence:(p.evidence as Json[][]).map(e=>[...e.slice(0,4),encode(e[4])]),readerAreas:encode(p.readerAreas)})),quoteTraces:encode(root.quoteTraces)};
  return {format:"props_source_records_v2",schema:"$r:[recordSchemas index,field values in listed order]; $s:strings index; $a:arrays index. Resolve these lossless records/arrays before interpreting evidence. Existing $ref:context_N still resolves in sharedContext. Indices are labels, not stat values. Same source references are not extra independent signals.",recordSchemas,strings,arrays,document};
}
export function unpackReaderSource(packed:Packed|PackedReaderSourceV3):Json{
  if(packed.format==="props_source_tables_v3")return unpackReaderSourceV3(packed);
  invariant(["props_source_records_v1","props_source_records_v2"].includes(packed.format),"Unknown source record format");
  const arrayStack=new Set<number>();
  const decode=(v:Json):Json=>{
    if(Array.isArray(v))return v.map(decode);
    if(v&&typeof v==="object"){
      if(Object.keys(v).length===1&&typeof v.$a==="number"){
        const id=v.$a;invariant(Number.isSafeInteger(id)&&id>=0&&id<(packed.arrays?.length??0)&&!arrayStack.has(id),"Invalid/cyclic source array reference");
        arrayStack.add(id);const result=decode(packed.arrays![id]);arrayStack.delete(id);return result;
      }
      if(Object.keys(v).length===1&&typeof v.$s==="number"){
        invariant(Number.isSafeInteger(v.$s)&&v.$s>=0&&v.$s<packed.strings.length,"Invalid source string reference");return packed.strings[v.$s];
      }
      if(Object.keys(v).length===1&&Array.isArray(v.$r)){
        const [index,...values]=v.$r;invariant(typeof index==="number"&&Number.isSafeInteger(index)&&index>=0&&index<packed.recordSchemas.length,"Invalid source record reference");
        const keys=packed.recordSchemas[index];invariant(keys.length===values.length,"Source record width mismatch");
        return Object.fromEntries(keys.map((k,i)=>[k,decode(values[i])]));
      }
      return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)]));
    }
    return v;
  };
  return decode(packed.document);
}
export function verifiedReaderSource(value:Json){const packed=packReaderSource(value);invariant(stable(unpackReaderSource(packed))===stable(value),"Source codec lost evidence");return packed;}

/** v3 is additive: stored v1/v2 source packets retain their pinned decoder. */
type SourceColumn={sameAs:number}|Json[]|{constant:Json}|{dictionary:Json[];indices:number[]}|{default:Json;at:[number,Json][]}|{runs:[number,Json][]};
type SourceTable={fields:string[];tuple:boolean;start:number;rows:number;columns:SourceColumn[]};
export type PackedReaderSourceV3={format:"props_source_tables_v3";schema:string;decodedNodes:number;decodedBytes:number;strings:string[];tables:SourceTable[];document:Json};
const SOURCE_LIMITS={nodes:2_000_000,bytes:32_000_000,depth:128,tables:4096,rows:100_000,width:256};
const jsonBytes=(v:unknown)=>Buffer.byteLength(JSON.stringify(v));
// Distinguish -0 from 0 as well as every JSON type when deduplicating values.
const valueKey=(v:Json):string=>JSON.stringify(v,(_k,x)=>typeof x==="number"&&Object.is(x,-0)?"\u0000number:-0":typeof x==="string"&&x.startsWith("\u0000")?"\u0000string:"+x:x);
const literalKeys=new Set(["$literal","$o","$tuples"]);
const sourceObject=(v:Json):v is Record<string,Json>=>v!==null&&typeof v==="object"&&!Array.isArray(v);

/** Named tables preserve all records, tuple positions, clocks, precision and types. */
export function packReaderSourceV3(value:Json):PackedReaderSourceV3{
  const groups=new Map<string,Json[]>(),stringCounts=new Map<string,number>(),ancestors=new Set<object>();let decodedNodes=0;
  const scan=(v:Json,depth:number)=>{
    invariant(++decodedNodes<=SOURCE_LIMITS.nodes&&depth<=SOURCE_LIMITS.depth,"Source exceeds codec expansion limit");
    if(typeof v==="number")invariant(Number.isFinite(v),"Non-JSON source number");
    if(typeof v==="string")stringCounts.set(v,(stringCounts.get(v)??0)+1);
    else if(v!==null&&typeof v==="object"){
      invariant(!ancestors.has(v),"Cyclic source value");ancestors.add(v);
      if(!Array.isArray(v)||v.length===5){
        const fields=Object.keys(v),key=JSON.stringify([Array.isArray(v),fields]);
        if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(v);
      }
      Object.values(v).forEach(x=>scan(x,depth+1));ancestors.delete(v);
    }
  };scan(value,0);
  const decodedBytes=jsonBytes(value);invariant(decodedBytes<=SOURCE_LIMITS.bytes,"Source exceeds codec byte limit");
  const strings=[...stringCounts].filter(([s,n])=>n>=3&&s.length>=12).map(([s])=>s),stringIds=new Map(strings.map((s,i)=>[s,i]));
  const tables:SourceTable[]=[],rawTables:Json[][]=[],recordIds=new Map<object,[number,number]>();let nextIndex=strings.length;
  for(const [schema,records]of groups){
    const [tuple,fields]=JSON.parse(schema) as [boolean,string[]];
    // Keep actor navigation named and do not create tables for tiny records.
    if(records.length<3||fields.length<2||fields.length>SOURCE_LIMITS.width||fields.includes("canonicalStatistics"))continue;
    const unique:Json[]=[],lookup=new Map<string,number>(),id=tables.length;
    for(const record of records){const key=valueKey(record);if(!lookup.has(key)){lookup.set(key,unique.length);unique.push(record);}recordIds.set(record as object,[id,lookup.get(key)!]);}
    invariant(unique.length<=SOURCE_LIMITS.rows&&tables.length<SOURCE_LIMITS.tables,"Source exceeds codec table limit");
    tables.push({fields,tuple,start:nextIndex,rows:unique.length,columns:[]});rawTables.push(unique);nextIndex+=unique.length;
  }
  const encode=(v:Json,named=false):Json=>{
    if(typeof v==="string"){
      if(!named&&stringIds.has(v))return `#${stringIds.get(v)}`;
      return v.startsWith("#")?{$literal:v}:v;
    }
    if(v===null||typeof v!=="object")return v;
    if(!named&&recordIds.has(v)){const[t,r]=recordIds.get(v)!;return `#${tables[t].start+r}`;}
    if(Array.isArray(v)){
      const plain=v.map(x=>encode(x,named));
      if(!named&&v.length>=3&&v.every(x=>Array.isArray(x)&&x.length===(v[0] as Json[]).length)){
        const width=(v[0] as Json[]).length;
        if(width<=SOURCE_LIMITS.width){const candidate={$tuples:{rows:v.length,width,columns:columns(Array.from({length:width},(_,i)=>String(i)),v)}} as unknown as Json;if(jsonBytes(candidate)<jsonBytes(plain))return candidate;}
      }
      return plain;
    }
    const entries=Object.entries(v).map(([k,x])=>[k,encode(x,named)]);
    return Object.keys(v).some(k=>literalKeys.has(k))?{$o:entries as Json}:Object.fromEntries(entries);
  };
  const columns=(fields:string[],rows:Json[]):SourceColumn[]=>fields.map((k,columnIndex)=>{
    const values=rows.map(row=>(row as Record<string,Json>)[k]),unique=new Map<string,Json>();for(const v of values)unique.set(valueKey(v),v);
    for(let prior=0;prior<columnIndex;prior++)if(rows.every((row,i)=>valueKey((row as Record<string,Json>)[fields[prior]])===valueKey(values[i])))return {sameAs:prior};
    if(unique.size===1)return {constant:encode(values[0])};
    const keys=[...unique.keys()],dictionary=[...unique.values()].map(v=>encode(v)),keyIds=new Map(keys.map((k,i)=>[k,i])),indices=values.map(v=>keyIds.get(valueKey(v))!);
    const plain=values.map(v=>encode(v)),dict={dictionary,indices};
    const counts=new Map<string,number>();for(const v of values){const key=valueKey(v);counts.set(key,(counts.get(key)??0)+1);}
    const common=[...counts].sort((a,b)=>b[1]-a[1])[0][0],sparse={default:encode(unique.get(common)!),at:values.flatMap((v,i)=>valueKey(v)===common?[]:[[i,encode(v)] as [number,Json]])};
    const runs:[number,Json][]=[];let previous:string|undefined;for(const v of values){const key=valueKey(v);if(key===previous)runs[runs.length-1][0]++;else runs.push([1,encode(v)]);previous=key;}
    return ([plain,dict,sparse,{runs}] as SourceColumn[]).sort((a,b)=>jsonBytes(a)-jsonBytes(b))[0];
  });
  tables.forEach((table,i)=>{table.columns=columns(table.fields,rawTables[i]);});
  const root=sourceObject(value)?value:null;
  // The semantic legend and game/player/market navigation remain directly named.
  const packedFields=new Set(["sharedContext","historicalGames","sharedGameContext","quoteTraces","verifiedReaderClaims"]);
  const document=root&&Array.isArray(root.players)?{
    ...Object.fromEntries(Object.entries(root).map(([k,v])=>[k,encode(v,!packedFields.has(k))])),
    players:root.players.map(player=>{invariant(sourceObject(player),"Invalid source player");return Object.fromEntries(Object.entries(player).map(([k,v])=>[k,encode(v,k!=="evidence"&&k!=="readerAreas")]));}),
  }:encode(value);
  return {format:"props_source_tables_v3",schema:'LOSSLESS NAMED TABLES. "#N" is an index label, never a statistic: N < strings.length selects strings[N]; otherwise select the table whose start <= N < start+rows and read row N-start. fields names each column; tuple:true restores original array positions; interpret by its original use and document schema, never by width or reference index. A column is values by row, {constant:value} for every row, {dictionary,indices} by row, {default,at:[[row,value],...]} with exact overrides, or {runs:[[count,value],...]} in original order; {sameAs:earlierColumnIndex} repeats that exact column. $tuples is a local tuple table with rows,width,columns. $literal escapes a literal # string; $o escapes literal reserved fields as [field,value] pairs. Existing $ref:context_N still resolves in document.sharedContext. Resolve completely before interpreting. All supplied facts, clocks, units and raw history are retained; reused source references are not independent signals.',decodedNodes,decodedBytes,strings,tables,document};
}

export function unpackReaderSourceV3(packed:PackedReaderSourceV3):Json{
  invariant(packed.format==="props_source_tables_v3","Unknown source table format");
  const integer=(v:unknown,min:number,max:number)=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=min&&v<=max;
  invariant(integer(packed.decodedNodes,1,SOURCE_LIMITS.nodes)&&integer(packed.decodedBytes,1,SOURCE_LIMITS.bytes),"Invalid source expansion declaration");
  invariant(Array.isArray(packed.strings)&&packed.strings.every(s=>typeof s==="string")&&Array.isArray(packed.tables)&&packed.tables.length<=SOURCE_LIMITS.tables,"Invalid source tables");
  const tableColumns:Json[][][]=[];let next=packed.strings.length,columnCells=0;
  invariant(packed.strings.length<=packed.decodedNodes&&packed.strings.reduce((n,s)=>n+Buffer.byteLength(s),0)<=packed.decodedBytes,"Oversized source string pool");
  const validateColumns=(cols:SourceColumn[],rows:number,width:number)=>{
    const valuesByColumn:Json[][]=[];
    invariant(integer(rows,0,SOURCE_LIMITS.rows)&&integer(width,0,SOURCE_LIMITS.width)&&Array.isArray(cols)&&cols.length===width,"Source table width/count mismatch");
    columnCells+=rows*width;invariant(columnCells<=packed.decodedNodes,"Source exceeds declared table allocation");
    for(const [columnIndex,c]of cols.entries()){
      let values:Json[];
      if(Array.isArray(c)){invariant(c.length===rows,"Source column width mismatch");values=c;}
      else{
        invariant(c!==null&&typeof c==="object","Invalid source column");const keys=Object.keys(c).sort().join(",");
        if(keys==="sameAs"){const previous=(c as {sameAs:number}).sameAs;invariant(integer(previous,0,columnIndex-1),"Invalid source column alias");values=valuesByColumn[previous];}
        else if(keys==="constant")values=Array(rows).fill((c as {constant:Json}).constant);
        else if(keys==="dictionary,indices"){
          const d=c as {dictionary:Json[];indices:number[]};invariant(Array.isArray(d.dictionary)&&d.dictionary.length>0&&Array.isArray(d.indices)&&d.indices.length===rows&&d.indices.every(i=>integer(i,0,d.dictionary.length-1)),"Invalid source dictionary index");values=d.indices.map(i=>d.dictionary[i]);
        }else if(keys==="at,default"){
          const s=c as {default:Json;at:[number,Json][]};invariant(Array.isArray(s.at)&&s.at.length<=rows,"Invalid source sparse column");values=Array(rows).fill(s.default);let previous=-1;
          for(const pair of s.at){invariant(Array.isArray(pair)&&pair.length===2&&integer(pair[0],previous+1,rows-1),"Invalid source sparse row");previous=pair[0];values[pair[0]]=pair[1];}
        }else if(keys==="runs"){
          const r=c as {runs:[number,Json][]};invariant(Array.isArray(r.runs)&&r.runs.length<=rows,"Invalid source runs");values=[];
          for(const pair of r.runs){invariant(Array.isArray(pair)&&pair.length===2&&integer(pair[0],1,rows-values.length),"Invalid source run length");for(let n=0;n<pair[0];n++)values.push(pair[1]);}invariant(values.length===rows,"Source run width mismatch");
        }else throw Error("Invalid source column encoding");
      }
      valuesByColumn.push(values);
    }
    return valuesByColumn;
  };
  for(const t of packed.tables){
    invariant(t!==null&&typeof t==="object"&&Object.keys(t).sort().join(",")==="columns,fields,rows,start,tuple"&&typeof t.tuple==="boolean"&&Array.isArray(t.fields)&&t.fields.every(k=>typeof k==="string")&&new Set(t.fields).size===t.fields.length&&t.start===next,"Invalid source table schema/range");
    if(t.tuple)invariant(t.fields.every((k,i)=>k===String(i)),"Invalid source tuple positions");
    tableColumns.push(validateColumns(t.columns,t.rows,t.fields.length));next+=t.rows;
  }
  let nodes=0,textBytes=0;const activeRecords=new Set<number>(),activeObjects=new Set<object>();
  const decode=(v:Json,depth:number):Json=>{
    invariant(depth<=SOURCE_LIMITS.depth,"Source exceeds codec depth limit");
    if(typeof v==="string"&&v.startsWith("#")){
      invariant(/^#(?:0|[1-9]\d*)$/.test(v),"Invalid source index label");const index=Number(v.slice(1));invariant(integer(index,0,next-1),"Invalid source index reference");
      if(index<packed.strings.length)return scalar(packed.strings[index]);
      invariant(!activeRecords.has(index),"Cyclic source record reference");activeRecords.add(index);
      const tableIndex=packed.tables.findIndex(t=>index>=t.start&&index<t.start+t.rows),table=packed.tables[tableIndex],row=index-table.start;
      if(!table.tuple)table.fields.forEach(accountKey);
      count();const values=tableColumns[tableIndex].map(column=>decode(column[row],depth+1));activeRecords.delete(index);
      return table.tuple?values:Object.fromEntries(table.fields.map((k,i)=>[k,values[i]]));
    }
    if(v===null||typeof v!=="object")return scalar(v);
    invariant(!activeObjects.has(v),"Cyclic source encoded value");activeObjects.add(v);
    let result:Json;
    if(Array.isArray(v)){count();result=v.map(x=>decode(x,depth+1));}
    else if(Object.keys(v).some(k=>literalKeys.has(k))){
      invariant(Object.keys(v).length===1,"Ambiguous source escape");
      if("$literal"in v){invariant(typeof v.$literal==="string"&&v.$literal.startsWith("#"),"Invalid source literal");result=scalar(v.$literal);}
      else if("$o"in v){
        invariant(Array.isArray(v.$o),"Invalid source object escape");const keys=new Set<string>();count();result=Object.fromEntries(v.$o.map(pair=>{invariant(Array.isArray(pair)&&pair.length===2&&typeof pair[0]==="string"&&!keys.has(pair[0]),"Invalid source escaped fields");keys.add(pair[0]);accountKey(pair[0]);return[pair[0],decode(pair[1],depth+1)];}));
      }else{
        const t=v.$tuples;invariant(sourceObject(t)&&Object.keys(t).sort().join(",")==="columns,rows,width","Invalid local source tuple table");
        const local=t as unknown as {rows:number;width:number;columns:SourceColumn[]};const localColumns=validateColumns(local.columns,local.rows,local.width);count();
        result=Array.from({length:local.rows},(_,r)=>{count();return localColumns.map(column=>decode(column[r],depth+2));});
      }
    }else{count();result=Object.fromEntries(Object.entries(v).map(([k,x])=>{accountKey(k);return[k,decode(x,depth+1)];}));}
    activeObjects.delete(v);return result;
  };
  const accountKey=(key:string)=>{textBytes+=Buffer.byteLength(key);invariant(textBytes<=packed.decodedBytes,"Source exceeds declared key expansion");};
  const count=()=>invariant(++nodes<=packed.decodedNodes,"Source exceeds declared node expansion");
  const scalar=(v:Json):Json=>{count();if(typeof v==="number")invariant(Number.isFinite(v),"Non-JSON decoded number");if(typeof v==="string"){textBytes+=Buffer.byteLength(v);invariant(textBytes<=packed.decodedBytes,"Source exceeds declared text expansion");}return v;};
  const result=decode(packed.document,0);invariant(nodes===packed.decodedNodes&&jsonBytes(result)===packed.decodedBytes,"Source decoded declaration mismatch");return result;
}
export function verifiedReaderSourceV3(value:Json){const packed=packReaderSourceV3(value);invariant(stable(unpackReaderSourceV3(packed))===stable(value),"Source table codec lost evidence");return packed;}
