/** Prospective source-event qualification, separate from the immutable mathematical law. */
import type {GamePacket,Player,Quote} from "./evidenceContract";
export const PROPS_AI_SOURCE_EVENT_RELEASE="player_props_source_event_2026_11_09_r1_interception_contract" as const;
export const UNRESOLVED_INTERCEPTION_EVENT="Source interception event is unresolved; passing and defensive contracts cannot be interchanged.";
export type SourceEventQualification={release:typeof PROPS_AI_SOURCE_EVENT_RELEASE;providerMarket:string|null;status:"verified"|"unresolved";statistic:"interceptions"|null;reason:string;rosterPosition:string|null};
export type MarketEventQualification={release:typeof PROPS_AI_SOURCE_EVENT_RELEASE;status:"verified"|"unresolved";statistic:"interceptions"|null;contracts:(SourceEventQualification&{provider:string;book:string})[]};
const defense=new Set(["CB","S","FS","SS","DB","LB","ILB","OLB","MLB","DE","DT","DL","NT","EDGE"]);
export function qualifyNflSourceEvent(args:{market:string;provider:string;providerMarket:string|null;rosterPosition:string|null}):SourceEventQualification|undefined{
 if(args.market!=="interceptions")return undefined;
 const raw=args.providerMarket?.trim()??null,position=args.rosterPosition?.trim().toUpperCase()??null;
 // A defensive roster role exposes a source-context conflict. It does not prove
 // defensive wager semantics or that a non-QB cannot ever throw a pass.
 const conflict=position!==null&&defense.has(position);
 const declared=args.provider==="balldontlie"&&raw==="interceptions";
 const verified=declared&&!conflict;
 return {release:PROPS_AI_SOURCE_EVENT_RELEASE,providerMarket:raw,status:verified?"verified":"unresolved",statistic:verified?"interceptions":null,rosterPosition:position,
  reason:conflict?"Captured defensive role does not establish this offered passing event; exact source contract requires clarification.":declared?"BALLDONTLIE documents this exact category as interceptions thrown.":"No verified provider-specific thrown-interception declaration for this raw label; never infer it from player position."};
}
export function sourceEventUsable(q:Pick<Quote,"market"|"sourceEvent">){return !q.sourceEvent||q.sourceEvent.status==="verified"&&q.sourceEvent.statistic===q.market;}
export function qualifiedForecastMarkets(p:Pick<Player,"markets"|"sourceEventContracts">){return p.markets.filter(m=>p.sourceEventContracts?.[m]?.status!=="unresolved");}
export function unresolvedForecastMarkets(p:Pick<Player,"markets"|"sourceEventContracts">){return p.markets.filter(m=>p.sourceEventContracts?.[m]?.status==="unresolved");}
export function sourceEventSummary(quotes:readonly Quote[]):MarketEventQualification{
 const contracts=[...new Map(quotes.filter(q=>q.market==="interceptions"&&q.sourceEvent).map(q=>{const value={...q.sourceEvent!,provider:q.provider,book:q.book};return[JSON.stringify(value),value];})).values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 const verified=contracts.some(c=>c.status==="verified");return {release:PROPS_AI_SOURCE_EVENT_RELEASE,status:verified?"verified":"unresolved",statistic:verified?"interceptions":null,contracts};
}
/** Only the new source contract requires this field; legacy archives retain absence. */
export function assertSourceEventQualifications(packet:GamePacket){
 if(packet.sourceInputRelease!=="player_props_ai_nfl_source_2026_11_09_r3_event_qualification")return;
 for(const p of packet.players)if(p.markets.includes("interceptions")&&p.sourceEventContracts?.interceptions?.release!==PROPS_AI_SOURCE_EVENT_RELEASE)throw Error("Missing required NFL interception source-event qualification");
 for(const q of [...packet.quotes,...(packet.executionQuotes??[])])if(q.market==="interceptions"&&q.receivedAtProvenance==="provider_response"&&q.sourceEvent?.release!==PROPS_AI_SOURCE_EVENT_RELEASE)throw Error("Missing required source quote event qualification");
}
