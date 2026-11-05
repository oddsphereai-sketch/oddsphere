import type { CbbCanonicalReceipt, CbbQuote } from "../../cbb/types";
import type { CbbBehaviorFlow } from "../../cbb/marketBehaviorCandidate";
import { cbbPublishedSourcePressure, type CbbSourcePathQuarantine } from "../../cbb/marketBehaviorPath";
import { cbbEvidenceReceiptBounds } from "../../cbb/marketReceiptTime";
import { CBB_CANONICAL_MARKET_EVIDENCE_RELEASE, CBB_CANONICAL_CONSUMER_CONTEXT_BOOKS, type CbbCanonicalPricePair, type CbbCanonicalSplitPair,
  type CbbCanonicalQuarantinedSource, type pairCbbCanonicalMarketEvidence } from "./cbbCanonicalMarketEvidence";

export type CbbCanonicalBehaviorQuote = CbbQuote & {provider:"owls";orientationVerified:true;canonicalReceipt:CbbCanonicalReceipt};
const family=(book:string)=>["pinnacle","ps3838"].includes(book)?"pinnacle":book;
const consumerBook=(book:string)=>(CBB_CANONICAL_CONSUMER_CONTEXT_BOOKS as readonly string[]).includes(book);
function safeObservationId(id:number|string):number|null {
  if(typeof id==="string"&&!/^\d+$/.test(id))return null;
  const n=Number(id);return Number.isSafeInteger(n)&&n>0?n:null;
}
function receipt(pair:CbbCanonicalPricePair|CbbCanonicalSplitPair,decisionAt:string):CbbCanonicalReceipt|null {
  const first=safeObservationId(pair.first.observationId),second=safeObservationId(pair.second.observationId);
  if(first===null||second===null||first===second)return null;
  const canonical:CbbCanonicalReceipt={kind:"db_inserted_upper_bound",availableBy:pair.availability.availableBy,
    providerEventId:pair.providerEventId,ingestionRunId:pair.ingestionRunId,observationIds:[first,second],
    rawPayloadHashes:[pair.first.rawPayloadHash,pair.second.rawPayloadHash]};
  const bounds=cbbEvidenceReceiptBounds({fetchedAt:pair.recordedFetchedAt,canonicalReceipt:canonical});
  const retailResponse=pair.kind==="price"&&consumerBook(pair.book);
  if(!Number.isFinite(bounds.available)||bounds.available>Date.parse(decisionAt)||Date.parse(pair.sourceAt)>bounds.available||
    !Number.isFinite(Date.parse(pair.sourceAt))||!Number.isFinite(Date.parse(pair.availability.runStartedAt))||
    (retailResponse?Date.parse(pair.availability.runStartedAt)>bounds.earliest:Date.parse(pair.availability.runStartedAt)!==bounds.earliest))return null;
  return canonical;
}
/** Translate already-qualified pairs without replacing recorded run-start clocks
 * with DB insertion times. No provider requests, database reads or new authority. */
export function cbbCanonicalBehaviorInputs(evidence:ReturnType<typeof pairCbbCanonicalMarketEvidence>) {
  if(evidence.release!==CBB_CANONICAL_MARKET_EVIDENCE_RELEASE)throw new Error("CBB canonical behavior evidence release mismatch");
  const historyQuotes:CbbCanonicalBehaviorQuote[]=[],contextQuotes:CbbCanonicalBehaviorQuote[]=[],historyFlows:CbbBehaviorFlow[]=[];
  const sourceQuarantines:CbbCanonicalQuarantinedSource[]=structuredClone(evidence.quarantinedSources);
  const quarantine=(pair:CbbCanonicalPricePair|CbbCanonicalSplitPair)=>sourceQuarantines.push({gameId:pair.gameId,book:pair.book,
    family:family(pair.book),market:pair.market,sourceAt:pair.sourceAt,kind:pair.kind,reason:"candidate_receipt_lineage_or_safe_ids_invalid",
    observationIds:[pair.first.observationId,pair.second.observationId]});
  for(const pair of [...evidence.pricePairs,...(evidence.retailPricePairs??[])]){
    const canonicalReceipt=receipt(pair,evidence.decisionAt);
    if(pair.gameId!==evidence.gameId||!canonicalReceipt){quarantine(pair);continue;}
    const destination=consumerBook(pair.book)?contextQuotes:historyQuotes;
    destination.push({provider:"owls",gameId:pair.gameId,sportsbook:pair.book,market:pair.market,line:pair.first.ownLine,
      firstPrice:pair.first.priceAmerican,secondPrice:pair.second.priceAmerican,providerObservedAt:pair.sourceAt,
      fetchedAt:pair.recordedFetchedAt,phase:"current",orientationVerified:true,canonicalReceipt});
  }
  // Retail and single-axis rows stay native context. They are never converted
  // into missing percentages, a professional source or direct flow authority.
  const splitContext=structuredClone(evidence.splitPairs);
  for(const pair of evidence.splitPairs){
    if(pair.book!=="circa"||pair.sourceClass!=="professional_adjacent_named_book"||
      pair.evidenceClass!=="complete_money_and_tickets"||!pair.directFlowEligible)continue;
    const canonicalReceipt=receipt(pair,evidence.decisionAt);
    if(pair.gameId!==evidence.gameId||!canonicalReceipt){quarantine(pair);continue;}
    if(pair.first.money===null||pair.second.money===null||pair.first.tickets===null||pair.second.tickets===null){quarantine(pair);continue;}
    if(!cbbPublishedSourcePressure([pair.first.money,pair.second.money,pair.first.tickets,pair.second.tickets]))continue;
    historyFlows.push({provider:"owls",gameId:pair.gameId,sourceBook:pair.book,market:pair.market,line:pair.first.ownLine,
      firstMoney:pair.first.money,secondMoney:pair.second.money,firstTickets:pair.first.tickets,secondTickets:pair.second.tickets,
      observedAt:pair.sourceAt,fetchedAt:pair.recordedFetchedAt,canonicalReceipt,orientationVerified:true,
      sourceEventId:pair.providerEventId,sourceIdentity:"independent_named_fixture_join"});
  }
  const quarantinedSources:CbbSourcePathQuarantine[]=[...new Map(sourceQuarantines.filter(q=>q.gameId===evidence.gameId).map(q=>{
    const mapped={book:q.family,market:q.market,sourceAt:q.sourceAt,reason:`canonical_${q.kind}:${q.reason}`};
    return [JSON.stringify(mapped),mapped];
  })).values()];
  return {historyQuotes,contextQuotes,historyFlows,quarantinedSources,splitContext,sourceQuarantines};
}
