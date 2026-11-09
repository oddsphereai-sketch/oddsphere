/** Prospective source-event qualification, separate from the immutable mathematical law. */
import type {GamePacket,Player,Quote} from "./evidenceContract";
export const PROPS_AI_SOURCE_EVENT_RELEASE="player_props_source_event_2026_11_09_r1_interception_contract" as const;
export const PROPS_AI_NFL_EVENT_SOURCE_RELEASE="player_props_ai_nfl_source_2026_11_09_r3_event_qualification" as const;
export const UNRESOLVED_INTERCEPTION_EVENT="Source interception event is unresolved; passing and defensive contracts cannot be interchanged.";
export type SourceEventQualification={release:typeof PROPS_AI_SOURCE_EVENT_RELEASE;providerMarket:string|null;observationId:string|null;status:"verified"|"unresolved";statistic:"interceptions"|null;reason:string;rosterPosition:string|null};
export type MarketEventQualification={release:typeof PROPS_AI_SOURCE_EVENT_RELEASE;status:"verified"|"unresolved";statistic:"interceptions"|null;contracts:(SourceEventQualification&{provider:string;book:string})[]};
const defense=new Set(["CB","S","FS","SS","DB","LB","ILB","OLB","MLB","DE","DT","DL","NT","EDGE"]);
export function qualifyNflSourceEvent(args:{market:string;provider:string;providerMarket:string|null;rosterPosition:string|null;observationId?:string|null}):SourceEventQualification|undefined{
 if(args.market!=="interceptions")return undefined;
 const raw=typeof args.providerMarket==="string"?args.providerMarket:null,position=typeof args.rosterPosition==="string"?args.rosterPosition:null,normalizedPosition=position?.trim().toUpperCase()??null;
 // A defensive roster role exposes a source-context conflict. It does not prove
 // defensive wager semantics or that a non-QB cannot ever throw a pass.
 const conflict=normalizedPosition!==null&&(normalizedPosition.split(" | ").some(p=>defense.has(p))||normalizedPosition.includes(" | "));
 const declared=args.provider==="balldontlie"&&raw==="interceptions";
 const verified=declared&&!conflict;
 return {release:PROPS_AI_SOURCE_EVENT_RELEASE,providerMarket:raw,observationId:args.observationId??null,status:verified?"verified":"unresolved",statistic:verified?"interceptions":null,rosterPosition:position,
  reason:conflict?"Captured defensive role does not establish this offered passing event; exact source contract requires clarification.":declared?"BALLDONTLIE documents this exact category as interceptions thrown.":"No verified provider-specific thrown-interception declaration for this raw label; never infer it from player position."};
}
export function sourceEventSemantic(q:Pick<Quote,"sourceEvent">){const e=q.sourceEvent;if(!e)return null;const {observationId:ignored,...semantic}=e;void ignored;return JSON.stringify(semantic);}
export function qualifyConflictingSourceObservations(rows:readonly Quote[]):Quote[]{
 const declarations=new Map<string,Set<string>>(),key=(q:Quote)=>JSON.stringify([q.provider,q.playerId,q.book,q.sourceEvent?.observationId]);
 for(const q of rows)if(q.sourceEvent?.observationId){const k=key(q),values=declarations.get(k)??new Set<string>();values.add(q.sourceEvent.providerMarket??"missing");declarations.set(k,values);}
 return rows.map(q=>q.sourceEvent?.observationId&&(declarations.get(key(q))?.size??0)>1?{...q,sourceEvent:{...q.sourceEvent,status:"unresolved",statistic:null,reason:"Conflicting raw market declarations share this exact provider observation; event remains unresolved."}}:q);
}
export function sourceEventUsable(q:Pick<Quote,"market"|"sourceEvent">){return !q.sourceEvent||q.sourceEvent.status==="verified"&&q.sourceEvent.statistic===q.market;}
export function sourceEventContext(contracts:Record<string,MarketEventQualification>){return Object.fromEntries(Object.entries(contracts).map(([market,value])=>[market,{release:value.release,status:value.status,statistic:value.statistic,declarations:[...new Set(value.contracts.map(c=>JSON.stringify({provider:c.provider,providerMarket:c.providerMarket,status:c.status,statistic:c.statistic,reason:c.reason,rosterPosition:c.rosterPosition})))].sort()}]));}
export function qualifiedForecastMarkets(p:Pick<Player,"markets"|"sourceEventContracts">){return p.markets.filter(m=>p.sourceEventContracts?.[m]?.status!=="unresolved");}
export function unresolvedForecastMarkets(p:Pick<Player,"markets"|"sourceEventContracts">){return p.markets.filter(m=>p.sourceEventContracts?.[m]?.status==="unresolved");}
export function sourceEventSummary(quotes:readonly Quote[]):MarketEventQualification{
 const contracts=[...new Map(quotes.filter(q=>q.market==="interceptions"&&q.opening===false&&q.sourceEvent).map(q=>{const value={...q.sourceEvent!,observationId:null,provider:q.provider,book:q.book};return[JSON.stringify(value),value];})).values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 const verified=contracts.some(c=>c.status==="verified");return {release:PROPS_AI_SOURCE_EVENT_RELEASE,status:verified?"verified":"unresolved",statistic:verified?"interceptions":null,contracts};
}
/** Only the new source contract requires this field; legacy archives retain absence. */
export function assertSourceEventQualifications(packet:GamePacket){
 if(packet.sourceInputRelease!==PROPS_AI_NFL_EVENT_SOURCE_RELEASE)return;
 for(const p of packet.players)if(p.markets.includes("interceptions")){
  const e=p.sourceEventContracts?.interceptions;
  if(e?.release!==PROPS_AI_SOURCE_EVENT_RELEASE)throw Error("Missing required NFL interception source-event qualification");
  if(!["verified","unresolved"].includes(e.status)||!Array.isArray(e.contracts)||e.status==="verified"!==e.contracts.some(c=>c.status==="verified")||e.statistic!==(e.status==="verified"?"interceptions":null))throw Error("Inconsistent NFL source-event qualification");
 }
 for(const q of [...packet.quotes,...(packet.executionQuotes??[])])if(q.market==="interceptions"&&q.receivedAtProvenance==="provider_response"&&q.sourceEvent?.release!==PROPS_AI_SOURCE_EVENT_RELEASE)throw Error("Missing required source quote event qualification");
 for(const q of [...packet.quotes,...(packet.executionQuotes??[])])if(q.sourceEvent&&(!["verified","unresolved"].includes(q.sourceEvent.status)||q.sourceEvent.statistic!==(q.sourceEvent.status==="verified"?"interceptions":null)))throw Error("Inconsistent source quote event qualification");
}
