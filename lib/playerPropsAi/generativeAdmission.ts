/** Complete prospective diagnostics. Returned values are never repaired or clamped. */
import type {GamePacket} from "./evidenceContract";
import type {GameReview,PlayerReview} from "./law";
import {validateLaw} from "./law";
import {decodeGenerativeScenarioLaw} from "./generativeCoordinates";
import {draftFormattingFindings} from "./draftDiagnostics";
import {sourceForecastIssues,type ForecastSanityIssue} from "./forecastSanity";
import {compileReaderClaims} from './readerClaims';
import {renderReaderClaimSelections} from './readerClaimAdmission';
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
const sourceCodes:Record<string,string>={forecast_mean_outside_supplied_support:"mean",nonpositive_yardage_contradicts_source:"yards",combo_dependence_erases_source_variation:"dep",unsupported_zero_probability_tail:"pt",unsupported_priced_event_certainty:"qt"};
function ranges(numbers:number[]){const a=[...new Set(numbers)].sort((x,y)=>x-y),parts:string[]=[];for(let i=0;i<a.length;i++){const first=a[i];let last=first;while(i+1<a.length&&a[i+1]===last+1)last=a[++i];parts.push(first===last?String(first):`${first}-${last}`);}return parts.join(",");}
export function inspectGenerativeDraft(packet:GamePacket,draft:unknown){
 const catalogs=compileReaderClaims(packet);
 const rows=object(object(draft)?.players),players:GameReview["players"]={},coordinates:{playerId:string;playerIndex:number;code:string;detail:string}[]=[],source:{playerId:string;playerIndex:number;issues:ForecastSanityIssue[];unhandled:ForecastSanityIssue[]}[]=[];
 if(rows)for(const [id,unknownRow]of Object.entries(rows)){
  const player=packet.players.find(p=>p.id===id),row=object(unknownRow);if(!player||!row)continue;
  let law:PlayerReview["law"]=null,rendered:Record<string,unknown>|null=null;
  try{rendered=renderReaderClaimSelections(packet,id,row,catalogs[id]);}catch(error){coordinates.push({playerId:id,playerIndex:packet.players.indexOf(player),code:'source_claims',detail:(error as Error).message});}
  try{law=row.law===null?null:decodeGenerativeScenarioLaw(packet.sport,player,row.law);}catch(error){const detail=(error as Error).message,code=detail.includes("integer units:")?`units:${detail.split("units:")[1].trim()}`:detail.includes("stat units:")?`bound:${detail.split("units:")[1].trim()}`:detail.includes("weights")?"weights":detail.includes("coordinates")?"named_keys":"fields_or_identity";coordinates.push({playerId:id,playerIndex:packet.players.indexOf(player),code:code.slice(0,32),detail});}
  players[id]={...(rendered??row),law} as PlayerReview;
  if(law){const accepted=validateLaw(packet.sport,player,law),issues=sourceForecastIssues(packet,player,accepted),exceptions=Array.isArray(row.exceptions)?row.exceptions:[];source.push({playerId:id,playerIndex:packet.players.indexOf(player),issues,unhandled:issues.filter(issue=>issue.markets.some(m=>typeof exceptions[player.markets.indexOf(m)]!=="string"||!(exceptions[player.markets.indexOf(m)] as string).trim()))});}
 }
 const format=draftFormattingFindings(packet,{players},true),affected=packet.players.flatMap((player,i)=>{
  const text=format.filter(f=>f.playerIndex===i),coord=coordinates.filter(c=>c.playerIndex===i),issues=source.find(s=>s.playerIndex===i)?.unhandled??[];
  if(!text.length&&!coord.length&&!issues.length)return [];
  const readers=text.filter(f=>f.field.startsWith("reader")).map(f=>Number(f.field.slice(6))),fields=[...(text.some(f=>f.field==="assessment")?["A"]:[]),...(readers.length?[`R${ranges(readers)}`]:[])];
  const tags=[fields.length?`T:${fields.join("/")}`:"",coord.length?`C:${coord.map(c=>c.code).join("/")}`:"",issues.length?`S:${[...new Set(issues.map(issue=>sourceCodes[issue.code]??"source"))].join("/")} M:${ranges(issues.flatMap(issue=>issue.markets.map(m=>player.markets.indexOf(m))).filter(n=>n>=0))}`:""].filter(Boolean);return [`P${i} ${tags.join(" ")}`];
 });
 let summary=affected.length?`P=player;T=claim rendering(A/R indices);C=coordinates/claim selections;S=source(mean/yards/dep/pt/qt);M=market indices/ranges. ${affected.join("; ")}`:null;
 if(summary)for(const row of source){const example=row.unhandled.find(f=>f.example)?.example;if(example){const addition=`; P${row.playerIndex} ${example}`;if(summary.length+addition.length<=1024)summary+=addition;}}
 if(summary)for(const row of coordinates.filter(c=>c.code==='source_claims')){const detail=`; P${row.playerIndex} ${row.detail}`;if(summary.length+detail.length<=1024)summary+=detail;}
 return {canonical:{players},coordinates,source,format,summary:summary?.slice(0,1024)??null};
}
