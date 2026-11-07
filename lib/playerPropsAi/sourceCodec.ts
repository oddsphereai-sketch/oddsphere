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
export function unpackReaderSource(packed:Packed):Json{
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
