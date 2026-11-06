/** Evidence-only assembly for the contextual reader. It never calls the legacy
 * forecast selector, grades a wager, fetches data, writes a snapshot or repairs
 * a stored quote. All clocks and source identities remain observation-owned. */
import {cbbPathBookFamily,readCbbMarketBehaviorPath,expandCbbMarketBehaviorPathStream,type CbbMarketBehaviorPathTape} from "../../cbb/marketBehaviorPath";
import {cbbEvidenceReceiptBounds,cbbAvailabilityUpperBoundMs} from "../../cbb/marketReceiptTime";
import {cbbContextualConsumerBook,type CbbContextualFeatureInput,type CbbContextualConsumerQuote} from "../../cbb/contextualForecastFeatures";
import {buildCbbContextualMarketInterpretation,cbbInterpretationIdentityContinuity,cbbInterpretationQuoteIdentity} from "../../cbb/contextualMarketInterpretation";
import type {CbbDecisionSplitContext} from "../../cbb/decisionSplitContext";
import type {CbbForecast,CbbQuote} from "../../cbb/types";
import type {CbbBehaviorFlow} from "../../cbb/marketBehaviorCandidate";
import {cbbCanonicalBehaviorInputs} from "./cbbCanonicalBehaviorInputs";
import type {pairCbbCanonicalMarketEvidence} from "./cbbCanonicalMarketEvidence";
import {CBB_PROVIDER_IDENTITY_RELEASE} from "../../cbb/providerInstitutionIdentity";

export const CBB_CONTEXTUAL_READER_INPUT_RELEASE="cbb_contextual_reader_input_2026_11_06_r6_verified_provider_school_identity" as const;
const professional=(book:string)=>["circa","pinnacle","bookmaker"].includes(cbbPathBookFamily(book));
// The journal query uses its actual producer roster. A directly normalized
// provider quote may be another physical consumer book (e.g. Caesars); it must
// not disappear merely because no historical column existed for that name.
const consumer=(book:string)=>Boolean(book.trim())&&!professional(book);
const LIMIT=32;
type Quote=CbbQuote&{orientationVerified?:boolean};
function asConsumer(q:Quote):CbbContextualConsumerQuote|null{
 if(!consumer(q.sportsbook)||q.phase!=="current")return null;
 if("canonicalReceipt" in q&&(!q.canonicalReceipt||typeof q.canonicalReceipt!=="object"||Array.isArray(q.canonicalReceipt)))return null;
 const orientationProof=q.orientationVerified===true?"named_fixture_attested":q.provider==="balldontlie"&&q.orientationVerified===undefined?"native_home_away_fields":null;
 if(!orientationProof)return null;
 let availableBy:string;try{const bound=cbbEvidenceReceiptBounds(q).available;if(!Number.isFinite(bound))return null;availableBy=q.canonicalReceipt?.availableBy??q.fetchedAt;}catch{return null;}
 return {gameId:q.gameId,sportsbook:cbbContextualConsumerBook(q.sportsbook),market:q.market,line:q.line,firstPrice:q.firstPrice,secondPrice:q.secondPrice,
  providerObservedAt:q.providerObservedAt,provider:q.provider,availableBy,availabilityKind:q.canonicalReceipt?"db_inserted_upper_bound":"http_response",orientationProof,
  fetchedAt:q.fetchedAt,...(q.requestedAt!==undefined?{requestedAt:q.requestedAt}:{}),...(q.sourceEventId!==undefined?{sourceEventId:q.sourceEventId}:{}),...(q.providerEventId!==undefined?{providerEventId:q.providerEventId}:{}),
  ...(q.canonicalReceipt?{canonicalReceipt:structuredClone(q.canonicalReceipt)}:{}),observationScope:"retained_market_pair"};
}
function retain<T extends {sportsbook:string;market:string;providerObservedAt:string}>(quotes:readonly T[]){
 const groups=new Map<string,T[]>(),truncated:Array<{book:string;market:CbbQuote["market"]}>=[];
 for(const q of quotes){const k=cbbPathBookFamily(q.sportsbook)+":"+q.market;groups.set(k,[...(groups.get(k)??[]),q]);}
 const retained:T[]=[];
 for(const [key,rows] of groups){
  const unique=[...new Map(rows.map(q=>[JSON.stringify(q),q])).values()].sort((a,b)=>Date.parse(a.providerObservedAt)-Date.parse(b.providerObservedAt)||JSON.stringify(a).localeCompare(JSON.stringify(b)));
  // Keep one contiguous suffix. Retaining the first quote plus a suffix would
  // create an unmarked interior gap and fabricate a traversable response leg.
  if(unique.length>LIMIT){const [book,market]=key.split(":");truncated.push({book,market:market as CbbQuote["market"]});retained.push(...unique.slice(-LIMIT));}
  else retained.push(...unique);
 }
 return {retained,truncated};
}
function baseInput(f:CbbForecast,startsAt:string):CbbContextualFeatureInput{return{independent:{gameId:f.gameId,asOf:f.asOf,release:f.release,inputStatus:f.inputStatus,margin:f.margin,total:f.total,homeWinProbability:f.homeWinProbability,uncertainty:structuredClone(f.uncertainty)},asOf:f.asOf,startsAt,currentQuotes:[]};}
function nativeKey(value:string){const ms=Date.parse(value),fraction=value.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1]??"";return Number.isFinite(ms)&&!(fraction.length>9&&/[1-9]/.test(fraction.slice(9)))?BigInt(ms)*BigInt(1000000)+BigInt(fraction.slice(3,9).padEnd(6,"0")):null;}
function compatiblePath(path:CbbMarketBehaviorPathTape|null|undefined,f:CbbForecast,startsAt:string){return path&&path.gameId===f.gameId&&path.startsAt===startsAt&&Number.isFinite(cbbAvailabilityUpperBoundMs(path.capturedAt))&&cbbAvailabilityUpperBoundMs(path.capturedAt)<=Date.parse(f.asOf)?path:null;}
function arrived(q:Quote|CbbContextualConsumerQuote,at:number){const native=cbbAvailabilityUpperBoundMs(q.providerObservedAt);let available:number;try{available="availabilityKind"in q?cbbAvailabilityUpperBoundMs(q.availableBy):cbbEvidenceReceiptBounds(q).available;}catch{return false;}return Number.isFinite(native)&&Number.isFinite(available)&&native<=at&&available<=at;}
export type CbbContextualLastKnownState={book:string;market:CbbQuote["market"];status:"last_known_observation"|"last_known_with_later_unqualified_observation"|"conflicted_latest_price_state";nativeAt:string;availableBy?:string;availabilityKind?:string;nativeAgeHours?:number;availabilityAgeHours?:number;laterUnqualifiedObservations?:Array<{nativeAt:string;fetchedAt:string;reason:string}>;meaning?:string};
/** knownBy is the already-qualified decision's knowledge upper bound; it is
 * never a new native observation time or provider response completion. */
type PriceQuarantine={book:string;market:CbbQuote["market"];sourceAt:string;reason:string;knownBy:string};
export type CbbContextualCurrentSourceProblem={book:string;market:CbbQuote["market"];reason:string;sourceAt?:string};
export type CbbContextualAssembledInput=CbbContextualFeatureInput&{sourceStateEvidence:{release:typeof CBB_CONTEXTUAL_READER_INPUT_RELEASE;providerIdentityRelease?:string;gameId:number;startsAt:string;priceQuarantines:PriceQuarantine[];sourceBaselineQuotes:NonNullable<CbbContextualFeatureInput["sourceBaselineQuotes"]>}};
export function assembleCbbContextualReaderInput(args:{independent:CbbForecast;startsAt:string;currentQuotes:readonly Quote[];
 canonical:ReturnType<typeof pairCbbCanonicalMarketEvidence>;splitContext:readonly CbbDecisionSplitContext[];
 currentSourceProblems?:readonly CbbContextualCurrentSourceProblem[];
 flows?:readonly CbbBehaviorFlow[];previousInput?:CbbContextualFeatureInput|null;previousPath?:CbbMarketBehaviorPathTape|null;
 legacyAnchorQuotes?:readonly (Quote&{anchorCapturedAt?:string;knownBy?:string})[];
 historyComplete:{price:boolean;split:boolean;consumer:boolean}}){
 const f=args.independent,at=Date.parse(f.asOf),previous=args.previousInput;
 if(f.inputStatus!=="complete"||!Number.isFinite(at)||at>=Date.parse(args.startsAt)-3_600_000||args.canonical.gameId!==f.gameId||args.canonical.decisionAt!==f.asOf)throw Error("CBB contextual input fixture/cutoff mismatch");
 if(previous&&(previous.independent.gameId!==f.gameId||previous.startsAt!==args.startsAt||Date.parse(previous.asOf)>at))throw Error("CBB contextual prior input identity/cutoff mismatch");
 const native=cbbCanonicalBehaviorInputs(args.canonical),direct=args.currentQuotes.filter(q=>q.gameId===f.gameId);
 if(direct.length!==args.currentQuotes.length)throw Error("CBB contextual current cross-game observation");
 const priorPath=compatiblePath(args.previousPath??previous?.pathTape,f,args.startsAt),pathQuotes=priorPath?priorPath.streams.flatMap(stream=>expandCbbMarketBehaviorPathStream(priorPath,stream).quotes):[];
 const allPro:Quote[]=[...(previous?.historyQuotes??[]),...previous?.currentQuotes??[],...pathQuotes.filter(q=>professional(q.sportsbook)),...native.historyQuotes,...direct.filter(q=>professional(q.sportsbook))];
 const allConsumer:CbbContextualConsumerQuote[]=[...(previous?.consumerHistoryQuotes??[]),...(previous?.consumerCurrentQuotes??[]),...pathQuotes.filter(q=>consumer(q.sportsbook)).flatMap(q=>asConsumer(q)??[]),...native.contextQuotes.flatMap(q=>asConsumer(q)??[]),...direct.flatMap(q=>asConsumer(q)??[])];
 // A future row never consumes the bounded past window or creates a frontier.
 // Invalid but arrived rows remain raw evidence for ambiguity/rejection review.
 const pastPro=allPro.filter(q=>arrived(q,at)),pastConsumer=allConsumer.filter(q=>arrived(q,at)),initial=baseInput(f,args.startsAt);
 const interpretation=buildCbbContextualMarketInterpretation({...initial,historyQuotes:pastPro,consumerHistoryQuotes:pastConsumer,pathTape:priorPath,consumerQuarantinedSources:[...(previous?.consumerQuarantinedSources??[]),...native.quarantinedSources.filter(q=>consumer(q.book))]});
 type Qualified={raw:Quote|CbbContextualConsumerQuote;book:string;market:CbbQuote["market"];nativeAt:string;availableBy:string;eventId:string|null;provider:string|null};
 const qualified:Qualified[]=[];
 for(const [isConsumer,rows]of [[false,pastPro],[true,pastConsumer]]as const)for(const raw of rows){if(!isConsumer&&"phase"in raw&&raw.phase!=="current")continue;
  const one=buildCbbContextualMarketInterpretation({...initial,...(isConsumer?{consumerHistoryQuotes:[raw as CbbContextualConsumerQuote]}:{historyQuotes:[raw as Quote]})}).streams.flatMap(s=>s.quotes.map(q=>({s,q}))).at(0);if(one)qualified.push({raw,book:one.s.book,market:one.s.market,nativeAt:one.q.nativeAt,availableBy:one.q.availableBy,eventId:one.q.eventId,provider:one.q.provider});
 }
 const unqualifiedDirect=direct.filter(q=>arrived(q,at)&&!qualified.some(r=>JSON.stringify(r.raw)===JSON.stringify(professional(q.sportsbook)?q:asConsumer(q))));
 const previousState=(previous as Partial<CbbContextualAssembledInput>|undefined)?.sourceStateEvidence;
 if(previousState&&(previousState.gameId!==f.gameId||previousState.startsAt!==args.startsAt))throw Error("CBB contextual prior source-state identity mismatch");
 const cutoff=nativeKey(f.asOf)!;
 const currentSourceProblems=(args.currentSourceProblems??[]).map(problem=>{
  const source=typeof problem.sourceAt==="string"?nativeKey(problem.sourceAt):null;
  const identified=typeof problem.book==="string"&&Boolean(problem.book.trim())&&["moneyline","spread","total"].includes(problem.market);
  // A provider outage is not a price state. These are contract/identity
  // rejection categories from normalization, never a fabricated quote clock.
  const priceProblem=/ambig|incoherent|conflict|identity|orientation|mismatch|invalid_(?:price|line|contract|quote)|incomplete.*pair/.test(problem.reason);
  const disposition=!identified||!priceProblem?"descriptive_source_problem_only":source===null?"unknown_native_clock":source>cutoff?"future_native_clock":"arrived_native_price_rejection";
  return{...structuredClone(problem),disposition};
 });
 const currentQuarantines:PriceQuarantine[]=currentSourceProblems.flatMap(problem=>problem.disposition==="arrived_native_price_rejection"?[{book:cbbPathBookFamily(problem.book.trim().toLowerCase()),market:problem.market,reason:problem.reason,sourceAt:problem.sourceAt!,knownBy:f.asOf}]:[]);
 const priceQuarantines:PriceQuarantine[]=[...new Map([...(previousState?.priceQuarantines??[]),...native.quarantinedSources.filter(q=>q.reason.startsWith("canonical_price:")).map(q=>({...q,knownBy:f.asOf})),...currentQuarantines].filter(q=>{const known=nativeKey(q.knownBy),source=nativeKey(q.sourceAt);return known!==null&&known<=cutoff&&source!==null&&source<=cutoff;}).map(q=>[JSON.stringify(q),q])).values()];
 const selectedPro:Quote[]=[],selectedConsumer:CbbContextualConsumerQuote[]=[],lastKnownStates:CbbContextualLastKnownState[]=[];
 for(const key of new Set(qualified.map(q=>`${q.book}:${q.market}`))){const own=qualified.filter(q=>`${q.book}:${q.market}`===key),stream=interpretation.streams.find(s=>`${s.book}:${s.market}`===key),latest=own.reduce((best,q)=>nativeKey(q.nativeAt)!>nativeKey(best.nativeAt)!?q:best),frontier=own.filter(q=>nativeKey(q.nativeAt)===nativeKey(latest.nativeAt));
  const quarantined=priceQuarantines.some(q=>cbbPathBookFamily(q.book)===latest.book&&q.market===latest.market&&nativeKey(q.sourceAt)!>=nativeKey(latest.nativeAt)!);
  if(stream?.continuity==="conflict"||quarantined){lastKnownStates.push({book:latest.book,market:latest.market,status:"conflicted_latest_price_state",nativeAt:latest.nativeAt,meaning:"raw conflict/quarantine retained; no tie-selected current measurement"});continue;}
  const conflictingIds=cbbInterpretationIdentityContinuity(frontier)==="conflict",economics=new Set(frontier.map(q=>JSON.stringify([q.raw.line,q.raw.firstPrice,q.raw.secondPrice])));if(conflictingIds||economics.size>1){lastKnownStates.push({book:latest.book,market:latest.market,status:"conflicted_latest_price_state",nativeAt:latest.nativeAt});continue;}
  // Select a whole latest receipt, never copy a fresh timestamp/opaque ID onto
  // an older quote. Earlier receipts remain in history for response proofs.
  frontier.sort((a,b)=>cbbAvailabilityUpperBoundMs(b.availableBy)-cbbAvailabilityUpperBoundMs(a.availableBy)||Number(Boolean(b.eventId))-Number(Boolean(a.eventId))||JSON.stringify(a.raw).localeCompare(JSON.stringify(b.raw)));
  const chosen=frontier[0],isConsumer="availabilityKind"in chosen.raw;if(isConsumer)selectedConsumer.push(chosen.raw as CbbContextualConsumerQuote);else selectedPro.push(chosen.raw as Quote);
  const laterUnqualifiedObservations=unqualifiedDirect.filter(q=>cbbPathBookFamily(q.sportsbook)===chosen.book&&q.market===chosen.market&&nativeKey(q.providerObservedAt)!>=nativeKey(chosen.nativeAt)!).map(q=>({nativeAt:q.providerObservedAt,fetchedAt:q.fetchedAt,reason:"later_arrived_direct_observation_failed_source_qualification"}));
  lastKnownStates.push({book:chosen.book,market:chosen.market,status:laterUnqualifiedObservations.length?"last_known_with_later_unqualified_observation":"last_known_observation",nativeAt:chosen.raw.providerObservedAt,availableBy:"availabilityKind"in chosen.raw?chosen.raw.availableBy:chosen.raw.canonicalReceipt?.availableBy??chosen.raw.fetchedAt,availabilityKind:"availabilityKind"in chosen.raw?chosen.raw.availabilityKind:chosen.raw.canonicalReceipt?"db_inserted_upper_bound":"http_response",nativeAgeHours:(at-Date.parse(chosen.raw.providerObservedAt))/3600000,availabilityAgeHours:(at-cbbAvailabilityUpperBoundMs(chosen.availableBy))/3600000,laterUnqualifiedObservations,meaning:"latest_qualified_native_state; not_a_new_or_fresh_executable_offer"});
 }
 const sourceBaselineQuotes:Array<NonNullable<CbbContextualFeatureInput["sourceBaselineQuotes"]>[number]>=[];
 const oldBaselines=previous?.sourceBaselineQuotes??previousState?.sourceBaselineQuotes??[];
 const legacyBaselines=(args.legacyAnchorQuotes??[]).map(q=>({...q,knownBy:q.knownBy??q.anchorCapturedAt??q.canonicalReceipt?.availableBy??q.fetchedAt}));
 const candidates=[...oldBaselines,...legacyBaselines,...qualified.map(q=>({...q.raw,knownBy:q.availableBy}))];
 const baselineGroups=new Map<string,typeof candidates>();
 for(const q of candidates){if(!Number.isFinite(cbbAvailabilityUpperBoundMs(q.knownBy))||cbbAvailabilityUpperBoundMs(q.knownBy)>at||!arrived(q,at))continue;
  const raw=consumer(q.sportsbook)&&!("availabilityKind"in q)?asConsumer(q as Quote):q;if(!raw)continue;
  const one=buildCbbContextualMarketInterpretation({...initial,...("availabilityKind"in raw?{consumerHistoryQuotes:[raw]}:{historyQuotes:[raw]})}).streams.find(s=>s.quotes.length);
  if(!one||cbbAvailabilityUpperBoundMs(one.quotes[0].availableBy)>cbbAvailabilityUpperBoundMs(q.knownBy))continue;
  const key=one.book+":"+one.market;baselineGroups.set(key,[...(baselineGroups.get(key)??[]),{...raw,knownBy:q.knownBy}]);
 }
 for(const [key,rows]of baselineGroups){rows.sort((a,b)=>Number(nativeKey(a.providerObservedAt)!-nativeKey(b.providerObservedAt)!)||cbbAvailabilityUpperBoundMs(a.knownBy)-cbbAvailabilityUpperBoundMs(b.knownBy));const earliest=rows[0],peers=rows.filter(q=>nativeKey(q.providerObservedAt)===nativeKey(earliest.providerObservedAt));
  const ids=peers.map(q=>({provider:q.provider??null,eventId:cbbInterpretationQuoteIdentity(q).eventId}));
  const oldConflict=priceQuarantines.some(q=>q.reason==="source_baseline_ambiguity"&&cbbPathBookFamily(q.book)+":"+q.market===key&&nativeKey(q.sourceAt)!<=nativeKey(earliest.providerObservedAt)!);
  if(oldConflict||new Set(peers.map(q=>JSON.stringify([q.line,q.firstPrice,q.secondPrice]))).size>1||cbbInterpretationIdentityContinuity(ids)==="conflict"){const [book,market]=key.split(":");if(!oldConflict)priceQuarantines.push({book,market:market as CbbQuote["market"],sourceAt:earliest.providerObservedAt,knownBy:f.asOf,reason:"source_baseline_ambiguity"});continue;}
  sourceBaselineQuotes.push(structuredClone(earliest));
 }
 const proRetention=retain(pastPro),consumerRetention=retain(pastConsumer);
 const path=readCbbMarketBehaviorPath({independent:f,startsAt:args.startsAt,currentQuotes:selectedPro,seedQuotes:pastPro,previous:priorPath,flows:[...(args.flows??[]),...native.historyFlows],excludedFamilies:[],quarantinedSources:native.quarantinedSources});
 // Contextual interpretation reads all observed states itself; this assembly
 // does not turn a pressure percentage into a direction or a score correction.
 const splits:CbbDecisionSplitContext[]=[],seenSplits=new Set<CbbDecisionSplitContext>();
 const flattenSplits=(rows:readonly CbbDecisionSplitContext[])=>{for(const row of rows){if(seenSplits.has(row))continue;seenSplits.add(row);if(row.gameId!==f.gameId)throw Error("CBB contextual split cross-game observation");if(row.sourceHistory)flattenSplits(row.sourceHistory);const copy={...row};delete copy.sourceHistory;splits.push(copy);}};flattenSplits([...(previous?.splitContext??[]),...args.splitContext]);
 const splitGroups=new Map<string,CbbDecisionSplitContext[]>();
 for(const row of splits){if(row.gameId!==f.gameId)throw Error("CBB contextual split cross-game observation");const key=row.physicalFamily+":"+row.market;splitGroups.set(key,[...(splitGroups.get(key)??[]),row]);}
 const boundedSplits:CbbDecisionSplitContext[]=[];
 for(const rows of splitGroups.values()){
  const flat=rows;
  const ordered=[...new Map(flat.filter(row=>Number.isFinite(cbbAvailabilityUpperBoundMs(row.availableBy))&&cbbAvailabilityUpperBoundMs(row.availableBy)<=at&&(!row.observedAt||cbbAvailabilityUpperBoundMs(row.observedAt)<=at)).map(row=>[JSON.stringify(row),row])).values()].sort((a,b)=>Date.parse(a.availableBy)-Date.parse(b.availableBy));
  boundedSplits.push(...ordered.slice(-LIMIT));
 }
 const input:CbbContextualAssembledInput={...baseInput(f,args.startsAt),sourceBaselineQuotes,currentQuotes:selectedPro,historyQuotes:proRetention.retained,
  consumerCurrentQuotes:selectedConsumer,consumerHistoryQuotes:consumerRetention.retained,consumerQuarantinedSources:[...(previous?.consumerQuarantinedSources??[]),...native.quarantinedSources.filter(q=>consumer(q.book))],
  consumerTruncatedSources:[...(previous?.consumerTruncatedSources??[]),...consumerRetention.truncated],pathTape:path.tape,splitContext:boundedSplits,
  sourceStateEvidence:{release:CBB_CONTEXTUAL_READER_INPUT_RELEASE,providerIdentityRelease:CBB_PROVIDER_IDENTITY_RELEASE,gameId:f.gameId,startsAt:args.startsAt,priceQuarantines,sourceBaselineQuotes}};
 return {release:CBB_CONTEXTUAL_READER_INPUT_RELEASE,input,pathTape:path.tape,coverage:{...args.historyComplete,
  historyStart:"bounded_retained_window_not_market_open" as const,consumerRetainedStates:consumerRetention.retained.length,splitRetainedStates:boundedSplits.length,
   nativeQuarantines:native.quarantinedSources,currentSourceProblems,consumerRetentionPerBookMarket:LIMIT,professionalHistoryTruncated:proRetention.truncated,lastKnownStates,sourceStateMeaning:"last_known_not_verified_current_offer" as const,rawQuoteRejections:interpretation.rejected,unqualifiedDirectObservations:unqualifiedDirect},providerRequests:0 as const,databaseWrites:0 as const};
}
