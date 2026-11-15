/** New source qualification only. Never reinterpret an original accepted law. */
import type {GamePacket,Quote} from './evidenceContract';
import type {SourceEventQualification} from './sourceEvents';

export const PROPS_AI_NFL_EXECUTION_CONTRACT_RELEASE='player_props_nfl_execution_contract_2026_11_15_r1_binary_anytime' as const;
const REASON='Unsupported canonical binary anytime-touchdown threshold. Retain the supplied declaration and price as unqualified context; do not clamp the line or infer a touchdown-count contract.';

export function qualifyUnsupportedNflAnytime(args:{market:string;line:number;providerMarket?:string|null;normalizedOfferType?:string|null;observationId?:string|null}):SourceEventQualification|undefined{
  if(args.market!=='anytime_td'||args.line===0.5)return undefined;
  return {release:PROPS_AI_NFL_EXECUTION_CONTRACT_RELEASE,status:'unresolved',statistic:null,
    providerMarket:args.providerMarket??null,observationId:args.observationId??null,rosterPosition:null,
    threshold:args.line,normalizedOfferType:args.normalizedOfferType??null,reason:REASON};
}
function qualifiedQuote(q:Quote):Quote{
  if(q.market!=='anytime_td'||q.line===0.5)return q;
  if(q.sourceEvent?.release===PROPS_AI_NFL_EXECUTION_CONTRACT_RELEASE)return q;
  return {...q,sourceEvent:qualifyUnsupportedNflAnytime({market:q.market,line:q.line,
    providerMarket:q.sourceEvent?.providerMarket,observationId:q.sourceEvent?.observationId,
    normalizedOfferType:q.offerContract??null})};
}
/** Keep every supplied actor/market/quote. Only unusable event authority changes. */
export function qualifyNflExecutionContracts(packet:GamePacket):GamePacket{
  if(packet.sport!=='nfl')throw Error('NFL execution qualification requires NFL source');
  const quotes=packet.quotes.map(qualifiedQuote),execution=packet.executionQuotes?.map(qualifiedQuote);
  return {...packet,sourceExecutionContractRelease:PROPS_AI_NFL_EXECUTION_CONTRACT_RELEASE,quotes,
    ...(execution?{executionQuotes:execution}:{}),sourceLimitations:[...packet.sourceLimitations,
      'Canonical NFL anytime touchdown is the binary own-score event at line 0.5. Other thresholds remain unsupported source references, not count events. A supported 0.5 offer in the same market remains eligible; no original source label or line is inferred or replaced.']};
}
export function assertNflExecutionContracts(packet:GamePacket){
  // Other sports keep the existing constant-time source guard. This NFL epoch
  // must not add a per-quote scan to every NBA/MLB execution lookup.
  if(packet.sport!=='nfl'){
    if(packet.sourceExecutionContractRelease!==undefined)throw Error('NFL execution-contract source on another sport');
    return;
  }
  const all=[...packet.quotes,...(packet.executionQuotes??[])];
  const declared=packet.sourceExecutionContractRelease;
  if(declared===undefined){
    if(all.some(q=>q.sourceEvent?.release===PROPS_AI_NFL_EXECUTION_CONTRACT_RELEASE)
      ||packet.players.some(p=>String(p.sourceEventContracts?.anytime_td?.release)===PROPS_AI_NFL_EXECUTION_CONTRACT_RELEASE))throw Error('Unbound NFL execution-contract qualification');
    return;
  }
  if(packet.sport!=='nfl'||declared!==PROPS_AI_NFL_EXECUTION_CONTRACT_RELEASE)throw Error('Unknown NFL execution-contract source');
  for(const q of all){
    if(q.sourceEvent?.release===PROPS_AI_NFL_EXECUTION_CONTRACT_RELEASE&&q.market!=='anytime_td')throw Error('NFL binary qualification on a different event');
    if(q.market!=='anytime_td')continue;
    const e=q.sourceEvent;
    if(q.line===0.5){if(e?.release===PROPS_AI_NFL_EXECUTION_CONTRACT_RELEASE)throw Error('Supported binary event falsely held');continue;}
    if(!Number.isFinite(q.line)||e?.release!==PROPS_AI_NFL_EXECUTION_CONTRACT_RELEASE||e.status!=='unresolved'||e.statistic!==null
      ||e.threshold!==q.line||e.reason!==REASON||!(e.providerMarket===null||typeof e.providerMarket==='string')
      ||!(e.observationId===null||typeof e.observationId==='string')||!(e.normalizedOfferType===null||typeof e.normalizedOfferType==='string'))throw Error('Unsupported NFL binary event lacks exact held source qualification');
  }
  if(packet.players.some(p=>String(p.sourceEventContracts?.anytime_td?.release)===PROPS_AI_NFL_EXECUTION_CONTRACT_RELEASE))throw Error('Quote qualification cannot silently decline an entire numeric market');
}
