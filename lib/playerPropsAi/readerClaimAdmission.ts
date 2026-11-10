/** Prospective factual-reader admission. Stored legacy text never enters this path. */
import type {GamePacket} from './evidenceContract';
import {digest,invariant} from './evidence';
import {compileReaderClaims,type ReaderClaim,type ReaderClaimCatalog} from './readerClaims';
import {READER_AREAS,type ReaderCoverage} from './readerCoverage';
import {unresolvedForecastMarkets,UNRESOLVED_INTERCEPTION_EVENT} from './sourceEvents';
import {readerAvailabilityContextHash} from './readerClaimFreshness';
import {readerCanonicalContextHash,PROPS_AI_READER_CONTEXT_RELEASE} from './readerContext';
import {criticalContextHashes} from './criticalContext';

export {PROPS_AI_READER_CLAIMS_RELEASE} from './releases';
import {PROPS_AI_READER_CLAIMS_RELEASE} from './releases';
export const READER_JUDGMENTS=['supports','cautions','mixed','uncertain','neutral'] as const;
type Judgment=typeof READER_JUDGMENTS[number];
type Selection={claimIds:string[];judgment:Judgment};
const effects=['upward','downward','mixed','neutral','uncertain','unavailable'] as const;
const object=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const exact=(value:unknown,keys:string[],reason:string)=>{const row=object(value);invariant(row&&Object.keys(row).sort().join('|')===keys.slice().sort().join('|'),reason);return row;};
const reasons=(catalog:ReaderClaimCatalog)=>catalog.claims.filter(c=>['source_missing','source_unavailable','own_availability_unknown'].includes(c.kind));
const uncertainOnly=(claims:ReaderClaim[])=>claims.every(c=>['source_missing','source_unavailable','own_availability_unknown'].includes(c.kind));
const judgmentText:Record<Judgment,string>={supports:'The estimated influence is supportive.',cautions:'The estimated influence is cautious.',mixed:'The estimated influence is mixed.',uncertain:'The estimated influence is uncertain.',neutral:'The estimated influence is neutral.'};
const schemaObject=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const selections=(claims:ReaderClaim[],maxItems=4)=>({type:'array',items:{type:'string',enum:claims.map(c=>c.id)},minItems:1,maxItems:Math.min(maxItems,claims.length)});

/** One source of schema enums and runtime admission; no separate judge or source lookup. */
export function readerClaimResponseSchema(packet:GamePacket,playerId:string,sourceCatalog?:ReaderClaimCatalog){
 const player=packet.players.find(p=>p.id===playerId);invariant(player,'Unknown reader actor');
 const catalog=sourceCatalog??compileReaderClaims(packet)[playerId],reasonIds=['forecast_declined',...reasons(catalog).map(c=>c.id),...(unresolvedForecastMarkets(player).length?['source_event_unresolved']:[])];
 return {
  assessment:schemaObject({claimIds:selections(catalog.claims,2),judgment:{type:'string',enum:uncertainOnly(catalog.claims)?['neutral','uncertain']:[...READER_JUDGMENTS]}}),
  coverage:schemaObject(Object.fromEntries(READER_AREAS.map(area=>{
   const source=catalog.areas[area],unknown=uncertainOnly(source.claims);
   return[area,schemaObject({claimIds:selections(source.claims),effect:{type:'string',enum:source.status==='missing'?['uncertain','unavailable']:unknown?['neutral','uncertain','unavailable']:[...effects]},judgment:{type:'string',enum:unknown?['neutral','uncertain']:[...READER_JUDGMENTS]}})];
  }))),
  gaps:{type:'array',items:{type:'string',enum:reasonIds},maxItems:6},
  exceptions:{type:'array',items:{anyOf:[{type:'string',enum:reasonIds},{type:'null'}]},minItems:player.markets.length,maxItems:player.markets.length},
 };
}
function selected(value:unknown,claims:ReaderClaim[],maximum:number):{selection:Selection;claims:ReaderClaim[]}{
 const row=object(value);invariant(row&&Array.isArray(row.claimIds)&&row.claimIds.length>=1&&row.claimIds.length<=maximum&&new Set(row.claimIds).size===row.claimIds.length,'Missing/duplicate reader claim selection');
 invariant(READER_JUDGMENTS.includes(row.judgment as Judgment),'Invalid bounded reader judgment');
 const chosen=row.claimIds.map(id=>{invariant(typeof id==='string','Invalid source claim ID');const claim=claims.find(c=>c.id===id);invariant(claim,'Foreign actor/area or unsupported source claim');return claim;});
 return {selection:{claimIds:chosen.map(c=>c.id),judgment:row.judgment as Judgment},claims:chosen};
}
/** Freeze rendered text at admission. It is never reconstructed by member readers. */
export function renderReaderClaimSelections(packet:GamePacket,playerId:string,value:unknown,sourceCatalog?:ReaderClaimCatalog){
 const row=exact(value,['assessment','coverage','gaps','exceptions','priorRead','evidenceIds','law','confidence'],'Future reader fields mismatch; unrestricted factual prose is not accepted');
 const player=packet.players.find(p=>p.id===playerId);invariant(player,'Unknown reader actor');
 const catalog=sourceCatalog??compileReaderClaims(packet)[playerId],rawCoverage=exact(row.coverage,[...READER_AREAS],'Reader omitted or added a required source area');
 const selectedIds=new Set<string>(),proof:Record<string,unknown>={};
 const coverage=Object.fromEntries(READER_AREAS.map(area=>{
  const raw=exact(rawCoverage[area],['claimIds','effect','judgment'],'Future area fields mismatch; factual observation must select verified claims');
  const areaCatalog=catalog.areas[area],choice=selected(raw,areaCatalog.claims,4);
  invariant(areaCatalog.requiredClaimIds.every(id=>choice.selection.claimIds.includes(id)),`Reader omitted mandatory ${area} source reading`);
  invariant(effects.includes(raw.effect as typeof effects[number]),'Invalid estimated reader effect');
  invariant(areaCatalog.status!=='missing'||['uncertain','unavailable'].includes(raw.effect as string),'Missing source cannot create a directional signal');
  // Report silence is not an adverse or favorable own-player health fact.
  invariant(!uncertainOnly(choice.claims)||['neutral','uncertain','unavailable'].includes(raw.effect as string),'Unknown source cannot establish a directional effect');
  invariant(!uncertainOnly(choice.claims)||['neutral','uncertain'].includes(choice.selection.judgment),'Unknown source cannot establish supportive or adverse influence');
  const factIds=[...new Set(choice.claims.flatMap(c=>c.factIds))];choice.claims.forEach(c=>selectedIds.add(c.id));
  const observation=[...choice.claims.map(c=>c.text),judgmentText[choice.selection.judgment]].join(' ');
  invariant(observation.length<=1400,'Verified reader rendering exceeds bounded area text');
  proof[area]={...choice.selection,effect:raw.effect};
  return[area,{status:areaCatalog.status,factIds,effect:raw.effect,observation}];
 })) as ReaderCoverage;
 const assessmentRow=exact(row.assessment,['claimIds','judgment'],'Future assessment must select verified claims; unrestricted prose is not accepted');
 const assessmentChoice=selected(assessmentRow,catalog.claims,2);
 invariant(assessmentChoice.selection.claimIds.every(id=>selectedIds.has(id)),'Assessment cites a fact the area review did not select');
 invariant(!uncertainOnly(assessmentChoice.claims)||['neutral','uncertain'].includes(assessmentChoice.selection.judgment),'Unknown source cannot establish an assessment influence');
 const assessment=[...assessmentChoice.claims.map(c=>c.shortText??c.text),judgmentText[assessmentChoice.selection.judgment]].join(' ');
 invariant(assessment.length<=600,'Verified assessment rendering exceeds bounded text');
 const reason=(token:unknown,market?:string):string=>{
  invariant(typeof token==='string','Invalid source reason selection');
  if(token==='forecast_declined')return 'A supported estimate was not established for this scope from the available inputs.';
  if(token==='source_event_unresolved'){invariant((market?unresolvedForecastMarkets(player).includes(market):unresolvedForecastMarkets(player).length>0),'Fabricated unresolved source-event reason');return UNRESOLVED_INTERCEPTION_EVENT;}
  const claim=reasons(catalog).find(c=>c.id===token);invariant(claim,'Unsupported gap/exception source claim');selectedIds.add(claim.id);return claim.text;
 };
 invariant(Array.isArray(row.gaps)&&row.gaps.length<=6,'Invalid source gap selections');
 invariant(Array.isArray(row.exceptions)&&row.exceptions.length===player.markets.length,'Missing aligned exception selections');
 const gaps=row.gaps.map(token=>reason(token));
 const exceptions=row.exceptions.map((token,i)=>token===null?null:reason(token,player.markets[i]));
 // Bind the FULL compiled claim, including its exact source relationships,
 // without storing its already archived windows/quotes or rendered text twice.
 // The original input plus this pinned release can reproduce the catalog.
 const claims=catalog.claims.filter(c=>selectedIds.has(c.id)).map(c=>({id:c.id,claimHash:digest(c),area:c.area,kind:c.kind,
  factIds:[...c.factIds],factHashes:[...c.factHashes],sourceIds:[...c.sourceIds],availableAt:c.availableAt}));
 return {...row,assessment,coverage,gaps,exceptions,sourceReadProofs:{release:PROPS_AI_READER_CLAIMS_RELEASE,contextRelease:PROPS_AI_READER_CONTEXT_RELEASE,originalCriticalContextHash:criticalContextHashes({...packet,players:[player]})[playerId],canonicalContextHash:readerCanonicalContextHash(packet,playerId),availabilityContextHash:readerAvailabilityContextHash(packet,playerId),catalogHash:digest(catalog),claims,assessment:assessmentChoice.selection,areas:proof,gaps:[...row.gaps],exceptions:[...row.exceptions]}};
}

/** Reader-only checks share the same required selections and factual renderer. */
export function renderReaderOnlyClaimSelections(packet:GamePacket,playerId:string,value:unknown){
 const row=exact(value,['coverage'],'Reader-only fields mismatch');
 const catalog=compileReaderClaims(packet)[playerId],coverage=object(row.coverage);invariant(coverage,'Missing reader-only coverage');
 const ids=READER_AREAS.flatMap(area=>{const selection=object(coverage[area]);return Array.isArray(selection?.claimIds)?selection.claimIds as string[]:[];});
 const id=ids.find(id=>catalog.claims.some(c=>c.id===id));invariant(id,'Missing reader-only claims');
 return renderReaderClaimSelections(packet,playerId,{coverage,assessment:{claimIds:[id],judgment:'uncertain'},priorRead:{},evidenceIds:[],gaps:[],exceptions:packet.players.find(p=>p.id===playerId)!.markets.map(()=>null),law:null,confidence:[]});
}
