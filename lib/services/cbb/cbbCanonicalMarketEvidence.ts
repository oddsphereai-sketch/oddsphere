import {cbbProviderFixtureIdentity} from "../../cbb/providerInstitutionIdentity";
import { cbbSplitOrientation } from "../../cbb/exactSplitIdentity";
import { cbbImpliedProbability } from "../../cbb/marketEvidence";
import { cbbAvailabilityUpperBoundMs } from "../../cbb/marketReceiptTime";
import { computeSlateDate } from "../../dates/slateDate";
import type { CbbGame, CbbMarket } from "../../cbb/types";
import type { MarketPriceObservationV2, MarketSplitObservationV2 } from "../../types/domain/MarketIntelligenceV2";

export const CBB_CANONICAL_MARKET_EVIDENCE_RELEASE = "cbb_canonical_market_evidence_2026_11_05_r5_general_consumer_context" as const;
export type CbbCanonicalPriceRow = MarketPriceObservationV2 & { id: number | string; inserted_at: string };
export type CbbCanonicalSplitRow = MarketSplitObservationV2 & { id: number | string; inserted_at: string };
/** An opaque native event ID needs an independent named fixture/time join.
 * A current collector release is never assigned to a historical row. */
export type CbbCanonicalEventAttestation = {
  provider: "owls";
  providerEventId: string;
  gameId: number;
  homeTeam: string;
  awayTeam: string;
  startsAt: string;
  identity: "independent_named_fixture_join";
};
type SourceIdentity = {
  kind: "native_event_institution_date" | "independent_named_fixture_join";
  orientation: "direct" | "reversed";
};
type NativeSide = {
  observationId: number | string;
  selectionKey: string;
  rawPayloadHash: string;
  ownLine: number | null;
  priceAmerican: number | null;
  insertedAt: string;
  sourceAt: string;
  recordedFetchedAt: string;
};
type PairLineage = {
  gameId: number;
  canonicalMarketId: string;
  market: CbbMarket;
  provider: "owls";
  book: string;
  providerEventId: string;
  ingestionRunId: string;
  sourceAt: string;
  /** Original stored clock: collector start for professional rows, response
   * completion for the existing retail journal. Never substitute one for another. */
  recordedFetchedAt: string;
  sourceIdentity: SourceIdentity;
  availability: {
    kind: "db_inserted_upper_bound";
    runStartedAt: string;
    availableBy: string;
    responseArrival: "not_attested";
    sameRunResponseOrdering: "unknown";
  };
};
export type CbbCanonicalPricePair = PairLineage & {
  kind: "price";
  first: NativeSide & { priceAmerican: number; decimalPrice: number | null; noVigProbability: number | null };
  second: NativeSide & { priceAmerican: number; decimalPrice: number | null; noVigProbability: number | null };
};
export type CbbCanonicalSplitPair = PairLineage & {
  kind: "split";
  sourceType: MarketSplitObservationV2["source_type"];
  sourceClass: "professional_adjacent_named_book" | "retail_named_book" | "retail_ticket_share";
  evidenceClass: "complete_money_and_tickets" | "money_only_context" | "tickets_only_context";
  directFlowEligible: boolean;
  splitLineBasis: "provider_explicit";
  sourceTimestampVerified: true;
  first: NativeSide & { money: number | null; tickets: number | null };
  second: NativeSide & { money: number | null; tickets: number | null };
};
export type CbbCanonicalQuarantinedSource = {
  gameId: number;
  book: string;
  family: string;
  market: CbbMarket;
  sourceAt: string;
  kind: "price" | "split";
  reason: string;
  observationIds: Array<number | string>;
};
export type CbbCanonicalEvidenceRejection = { kind: "price" | "split"; observationIds: Array<number | string>; reason: string };
type Common = {
  gameId: number; market: CbbMarket; canonicalMarketId: string; book: string; event: string;
  run: string; runStartedAt: string; observed: string; fetched: string; inserted: string;
  selection: string; id: number | string; hash: string; sourceIdentity: SourceIdentity;
};
export const CBB_CANONICAL_CONSUMER_CONTEXT_BOOKS=Object.freeze(["draftkings","betmgm","fanduel","fanatics","bovada","hardrock","betr","stations","south_point","wynn"] as const);
const MARKETS: CbbMarket[] = ["moneyline", "spread", "total"];
const family = (book: string) => book === "ps3838" ? "pinnacle" : book;
const epoch = (value: string | null | undefined) => typeof value === "string" ? Date.parse(value) : NaN;
const validId = (id: number | string) => typeof id === "number" ? Number.isSafeInteger(id) && id > 0 : /^\d+$/.test(id) && !/^0+$/.test(id);
const validHash = (hash: string | null | undefined): hash is string => typeof hash === "string" && /^[0-9a-f]{64}$/i.test(hash);
const validPrice = (price: number | null): price is number => typeof price === "number" && Number.isSafeInteger(price) && Math.abs(price) >= 100;
const ownSides = (market: CbbMarket) => market === "total" ? ["over", "under"] : ["home", "away"];
function identity(game: CbbGame, eventId: string, attestations: CbbCanonicalEventAttestation[]): SourceIdentity | null {
  const own=cbbProviderFixtureIdentity(game);
  const orientation=(h:string,a:string):SourceIdentity["orientation"]|null=>cbbSplitOrientation(a,h,own);
  const named = eventId.match(/^ncaab:(.+)@(.+)-(\d{8})$/i);
  if (named) {
    const dates = [game.date.slice(0, 10), computeSlateDate("cbb", game.date)].map(d => d.replaceAll("-", ""));
    const mapped = orientation(named[2], named[1]);
    return mapped && dates.includes(named[3]) ? { kind: "native_event_institution_date", orientation: mapped } : null;
  }
  const matching = attestations.filter(a => a.provider === "owls" && a.providerEventId === eventId && a.gameId === game.id &&
    a.identity === "independent_named_fixture_join" && Number.isFinite(epoch(a.startsAt)) && Math.abs(epoch(a.startsAt) - epoch(game.date)) <= 600_000 &&
    orientation(a.homeTeam, a.awayTeam) !== null);
  const unique = new Map(matching.map(a => [JSON.stringify([a.homeTeam, a.awayTeam, epoch(a.startsAt)]), a]));
  if (unique.size !== 1) return null;
  const match = [...unique.values()][0];
  return { kind: "independent_named_fixture_join", orientation: orientation(match.homeTeam, match.awayTeam)! };
}
function common(row: CbbCanonicalPriceRow | CbbCanonicalSplitRow, game: CbbGame, decision: number,
  attestations: CbbCanonicalEventAttestation[], kind: "price" | "split",retailBooks:ReadonlySet<string>): Common | string {
  if (row.provider !== "owls" || row.league !== "cbb") return "unsupported_or_unattributed_provider_or_league";
  if (!validId(row.id) || !validHash(row.raw_payload_hash)) return "native_observation_id_or_payload_hash_missing";
  if (row.canonical_event_id !== String(game.id) || !MARKETS.includes(row.market_type)) return "canonical_fixture_or_market_mismatch";
  const market = row.market_type;
  if (row.canonical_market_id !== `${game.id}:${market}` || !ownSides(market).some(side => row.selection_key === `${game.id}:${market}:${side}`)) {
    return "canonical_market_or_selection_mismatch";
  }
  const event = row.provider_event_id;
  const sourceIdentity = typeof event === "string" && event.trim() ? identity(game, event, attestations) : null;
  if (!event || !sourceIdentity) return "native_event_identity_unverifiable_or_wrong_fixture";
  const run = row.ingestion_run_id, runStartedAt = typeof run === "string" ? run.match(/^cbb:\d{4}-\d{2}-\d{2}:(.+)$/)?.[1] : null;
  if (!run || !runStartedAt || !Number.isFinite(epoch(runStartedAt))) return "native_ingestion_run_unverifiable";
  const observed = kind === "price" ? (row as CbbCanonicalPriceRow).provider_timestamp : (row as CbbCanonicalSplitRow).source_observed_at;
  const fetched = row.fetched_at, inserted = row.inserted_at;
  const retailResponse = kind === "price" && retailBooks.has((row as CbbCanonicalPriceRow).sportsbook) &&
    (row as CbbCanonicalPriceRow).sharp_book === false;
  // CBB's existing collector records its run-start clock in fetched_at.
  // The DB insertion upper bound, not that earlier clock, proves availability.
  // The retail journal deliberately records its completed response in fetched_at.
  // Preserve that actual clock and the separate run start; professional/split
  // rows retain their existing exact run-start contract.
  if (!observed || ![observed, fetched, inserted].every(t => Number.isFinite(epoch(t))) ||
    (retailResponse ? epoch(runStartedAt) > epoch(fetched) : epoch(runStartedAt) !== epoch(fetched)) ||
    epoch(fetched) > epoch(inserted) || epoch(observed) > epoch(inserted) || retailResponse && epoch(observed) > epoch(fetched) || cbbAvailabilityUpperBoundMs(inserted) > decision || epoch(observed) >= epoch(game.date)) {
    return "source_or_recorded_capture_or_db_availability_clock_invalid";
  }
  const book = kind === "price" ? (row as CbbCanonicalPriceRow).sportsbook : (row as CbbCanonicalSplitRow).source_book;
  if (kind === "price" && !(["circa", "pinnacle", "ps3838","bookmaker"].includes(book)&&(row as CbbCanonicalPriceRow).sharp_book===true||
    retailBooks.has(book)&&(row as CbbCanonicalPriceRow).sharp_book===false)) {
    return "unsupported_professional_price_source";
  }
  if (kind === "split") {
    const split = row as CbbCanonicalSplitRow;
    const expectedType = book === "circa" ? "sharp_adjacent_book" : ["draftkings", "betmgm"].includes(book) ? "retail_book" : null;
    const ticketOnlyRetail = book === "betmgm" && split.source_type === "retail_ticket_share" && split.money_pct === null && split.bets_pct !== null;
    if (!expectedType || split.source_type !== expectedType && !ticketOnlyRetail) return "unsupported_or_misclassified_named_split_source";
    if (split.source_timestamp_verified !== true || split.split_line_basis !== "provider_explicit") return "unverified_source_time_or_contract";
  }
  return { gameId:game.id, market, canonicalMarketId:row.canonical_market_id, book, event, run, runStartedAt,
    observed, fetched, inserted, selection:row.selection_key, id:row.id, hash:row.raw_payload_hash, sourceIdentity };
}
const rowFingerprint = (row: CbbCanonicalPriceRow|CbbCanonicalSplitRow) => JSON.stringify(Object.keys(row).sort().map(key=>[key,(row as unknown as Record<string,unknown>)[key]]));
const groupKey = (c: Common) => JSON.stringify(["owls", c.event, c.run, c.gameId, c.canonicalMarketId, c.book, epoch(c.observed), epoch(c.fetched)]);
function ownLines(market: CbbMarket, first: number | null, second: number | null) {
  if (market === "moneyline") return first === null && second === null;
  if (first === null || second === null || !Number.isFinite(first) || !Number.isFinite(second) || !Number.isInteger(first * 2) || !Number.isInteger(second * 2)) return false;
  return market === "spread" ? first === -second : first > 0 && first === second;
}
function exactInsertedAtOrAfter(first:string,second:string){
  if(epoch(first)!==epoch(second))return epoch(first)>epoch(second);
  const fraction=(value:string)=>value.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/)?.[1].slice(3)??"";
  const a=fraction(first),b=fraction(second),width=Math.max(a.length,b.length);
  return a.padEnd(width,"0")>=b.padEnd(width,"0");
}
function lineage(first: Common, second: Common): PairLineage {
  return { gameId:first.gameId, canonicalMarketId:first.canonicalMarketId, market:first.market, provider:"owls", book:first.book,
    providerEventId:first.event, ingestionRunId:first.run, sourceAt:first.observed, recordedFetchedAt:first.fetched,
    sourceIdentity:first.sourceIdentity, availability:{kind:"db_inserted_upper_bound",runStartedAt:first.runStartedAt,
      availableBy:exactInsertedAtOrAfter(first.inserted,second.inserted)?first.inserted:second.inserted,
      responseArrival:"not_attested",sameRunResponseOrdering:"unknown"} };
}
function side(c: Common, line: number | null, price: number | null): NativeSide {
  return {observationId:c.id,selectionKey:c.selection,rawPayloadHash:c.hash,ownLine:line,priceAmerican:price,insertedAt:c.inserted,sourceAt:c.observed,recordedFetchedAt:c.fetched};
}
/** Pure source-row qualification. This function neither loads history nor
 * declares a queried/sampled history complete, nor claims causality or bettor identity. */
export function pairCbbCanonicalMarketEvidence(args: {
  game: CbbGame;
  decisionAt: string;
  priceRows?: CbbCanonicalPriceRow[];
  splitRows?: CbbCanonicalSplitRow[];
  eventAttestations?: CbbCanonicalEventAttestation[];
  /** General retail prices remain observation context, never professional flow
   * authority. Default preserves the preceding reader's exact source roster. */
  consumerPriceContext?:boolean;
}) {
  const retailBooks:ReadonlySet<string>=new Set(args.consumerPriceContext?CBB_CANONICAL_CONSUMER_CONTEXT_BOOKS:["draftkings","betmgm"]);
  const decision = epoch(args.decisionAt), start = epoch(args.game.date);
  if (![decision, start].every(Number.isFinite) || decision >= start) throw new Error("CBB canonical evidence requires a pregame fixture/cutoff");
  const rejected: CbbCanonicalEvidenceRejection[] = [];
  const pricePairs: CbbCanonicalPricePair[] = [],retailPricePairs:CbbCanonicalPricePair[]=[], splitPairs: CbbCanonicalSplitPair[] = [];
  const quarantined = new Map<string,CbbCanonicalQuarantinedSource>();
  const markSource = (source:{gameId:number;book:string;market:CbbMarket;sourceAt:string},kind:"price"|"split",reason:string,ids:Array<number|string>) => {
    const key=JSON.stringify([kind,source.gameId,family(source.book),source.market,epoch(source.sourceAt),reason]);
    const existing=quarantined.get(key);
    const observationIds=[...new Map([...(existing?.observationIds??[]),...ids].map(id=>[String(id),id])).values()];
    quarantined.set(key,{...source,family:family(source.book),kind,reason,observationIds});
  };
  const markCommon = (c:Common,kind:"price"|"split",reason:string,ids:Array<number|string>) =>
    markSource({gameId:c.gameId,book:c.book,market:c.market,sourceAt:c.observed},kind,reason,ids);
  for (const kind of ["price", "split"] as const) {
    const rows = kind === "price" ? args.priceRows ?? [] : args.splitRows ?? [];
    const groups = new Map<string, Array<{row:CbbCanonicalPriceRow|CbbCanonicalSplitRow;c:Common}>>();
    const qualified:Array<{row:CbbCanonicalPriceRow|CbbCanonicalSplitRow;c:Common}>=[];
    for(const row of rows){
      const c=common(row,args.game,decision,args.eventAttestations??[],kind,retailBooks);
      if(typeof c==="string"){rejected.push({kind,observationIds:[row.id],reason:c});continue;}
      qualified.push({row,c});
    }
    const idFingerprints = new Map<string,Set<string>>();
    for(const {row} of qualified){const key=String(row.id),values=idFingerprints.get(key)??new Set<string>();values.add(rowFingerprint(row));idFingerprints.set(key,values);}
    for (const {row,c} of qualified) {
      if(idFingerprints.get(String(row.id))!.size>1){
        const reason="conflicting_native_observation_id";rejected.push({kind,observationIds:[row.id],reason});markCommon(c,kind,reason,[row.id]);continue;
      }
      const key=groupKey(c);groups.set(key,[...(groups.get(key)??[]),{row,c}]);
    }
    const conflictingSources = new Set<string>();
    const bySourceSide = new Map<string,Set<string>>();
    for(const group of groups.values()) for(const {row,c} of group){
      const sourceKey=JSON.stringify([c.gameId,c.market,family(c.book),epoch(c.observed)]);
      const sideKey=JSON.stringify([sourceKey,c.selection]);
      const tuple=kind==="price"?[(row as CbbCanonicalPriceRow).line,(row as CbbCanonicalPriceRow).american_price]:
        [(row as CbbCanonicalSplitRow).market_line,(row as CbbCanonicalSplitRow).market_price,(row as CbbCanonicalSplitRow).money_pct,(row as CbbCanonicalSplitRow).bets_pct];
      const values=bySourceSide.get(sideKey)??new Set<string>();values.add(JSON.stringify(tuple));bySourceSide.set(sideKey,values);
      if(values.size>1)conflictingSources.add(sourceKey);
    }
    for (const group of groups.values()) {
      const sourceKey=JSON.stringify([group[0].c.gameId,group[0].c.market,family(group[0].c.book),epoch(group[0].c.observed)]);
      if(conflictingSources.has(sourceKey)){const reason="contradictory_same_source_time_native_frames",ids=group.map(g=>g.c.id);rejected.push({kind,observationIds:ids,reason});markCommon(group[0].c,kind,reason,ids);continue;}
      const ids = group.map(g=>g.row.id), market=group[0].c.market, selections=ownSides(market).map(s=>`${args.game.id}:${market}:${s}`);
      // Exact repeated transport rows may be ignored. Conflicting copies of an
      // ID, or multiple distinct observations for one side, remain ambiguous.
      const unique = [...new Map(group.map(g=>[rowFingerprint(g.row),g])).values()];
      const firstRows=unique.filter(g=>g.c.selection===selections[0]),secondRows=unique.filter(g=>g.c.selection===selections[1]);
      if (firstRows.length!==1||secondRows.length!==1||String(firstRows[0].c.id)===String(secondRows[0].c.id)) {
        rejected.push({kind,observationIds:ids,reason:"missing_or_ambiguous_opposing_side_same_native_frame"});markCommon(group[0].c,kind,"missing_or_ambiguous_opposing_side_same_native_frame",ids);continue;
      }
      const a=firstRows[0],b=secondRows[0],base=lineage(a.c,b.c);
      if(kind==="price") {
        const first=a.row as CbbCanonicalPriceRow,second=b.row as CbbCanonicalPriceRow;
        if(!ownLines(market,first.line,second.line)||!validPrice(first.american_price)||!validPrice(second.american_price)) {
          rejected.push({kind,observationIds:ids,reason:"invalid_own_selection_line_or_price_pair"});markCommon(group[0].c,kind,"invalid_own_selection_line_or_price_pair",ids);continue;
        }
        const hold=cbbImpliedProbability(first.american_price)+cbbImpliedProbability(second.american_price);
        if(hold<.98||hold>1.3){rejected.push({kind,observationIds:ids,reason:"incoherent_two_sided_price_hold"});markCommon(group[0].c,kind,"incoherent_two_sided_price_hold",ids);continue;}
        const destination=retailBooks.has(base.book)?retailPricePairs:pricePairs;
        destination.push({...base,kind:"price",first:{...side(a.c,first.line,first.american_price),priceAmerican:first.american_price,
          decimalPrice:first.decimal_price,noVigProbability:first.no_vig_probability},second:{...side(b.c,second.line,second.american_price),
          priceAmerican:second.american_price,decimalPrice:second.decimal_price,noVigProbability:second.no_vig_probability}});
      } else {
        const first=a.row as CbbCanonicalSplitRow,second=b.row as CbbCanonicalSplitRow;
        const percentages=[first.money_pct,second.money_pct,first.bets_pct,second.bets_pct];
        const moneyComplete=first.money_pct!==null&&second.money_pct!==null,ticketsComplete=first.bets_pct!==null&&second.bets_pct!==null;
        const moneyAbsent=first.money_pct===null&&second.money_pct===null,ticketsAbsent=first.bets_pct===null&&second.bets_pct===null;
        if(first.source_type!==second.source_type||!ownLines(market,first.market_line,second.market_line)||percentages.some(n=>n!==null&&(!Number.isFinite(n)||n<0||n>1))||
          (!moneyComplete&&!moneyAbsent)||(!ticketsComplete&&!ticketsAbsent)||(!moneyComplete&&!ticketsComplete)||
          moneyComplete&&Math.abs(first.money_pct!+second.money_pct!-1)>.03||ticketsComplete&&Math.abs(first.bets_pct!+second.bets_pct!-1)>.03||
          [first.market_price,second.market_price].some(p=>p!==null&&!validPrice(p))) {
          rejected.push({kind,observationIds:ids,reason:"incomplete_or_incoherent_native_split_pair"});markCommon(group[0].c,kind,"incomplete_or_incoherent_native_split_pair",ids);continue;
        }
        splitPairs.push({...base,kind:"split",sourceType:first.source_type,sourceClass:first.source_book==="circa"?"professional_adjacent_named_book":first.source_type==="retail_ticket_share"?"retail_ticket_share":"retail_named_book",
          evidenceClass:moneyComplete&&ticketsComplete?"complete_money_and_tickets":moneyComplete?"money_only_context":"tickets_only_context",directFlowEligible:moneyComplete&&ticketsComplete,
          splitLineBasis:"provider_explicit",sourceTimestampVerified:true,first:{...side(a.c,first.market_line,first.market_price),money:first.money_pct,tickets:first.bets_pct},
          second:{...side(b.c,second.market_line,second.market_price),money:second.money_pct,tickets:second.bets_pct}});
      }
    }
  }
  function quarantine<T extends CbbCanonicalPricePair|CbbCanonicalSplitPair>(pairs:T[]):T[] {
    const groups=new Map<string,T[]>();
    for(const pair of pairs){const key=JSON.stringify([pair.gameId,pair.market,family(pair.book),epoch(pair.sourceAt)]);groups.set(key,[...(groups.get(key)??[]),pair]);}
    return [...groups.values()].flatMap(group=>{
      const tuples=group.map(p=>p.kind==="price"?[p.first.ownLine,p.second.ownLine,p.first.priceAmerican,p.second.priceAmerican]:
        [p.first.ownLine,p.second.ownLine,p.first.priceAmerican,p.second.priceAmerican,p.first.money,p.second.money,p.first.tickets,p.second.tickets]);
      if(new Set(tuples.map(t=>JSON.stringify(t))).size>1){const reason="contradictory_same_source_time_native_frames",ids=group.flatMap(p=>[p.first.observationId,p.second.observationId]);rejected.push({kind:group[0].kind,observationIds:ids,reason});markSource(group[0],group[0].kind,reason,ids);return [];}
      return group;
    });
  }
  const qualifiedPrices=quarantine(pricePairs),qualifiedSplits=quarantine(splitPairs),qualifiedRetail=quarantine(retailPricePairs);
  return {release:CBB_CANONICAL_MARKET_EVIDENCE_RELEASE,gameId:args.game.id,decisionAt:args.decisionAt,
    pricePairs:qualifiedPrices,retailPricePairs:qualifiedRetail,splitPairs:qualifiedSplits,rejected,quarantinedSources:[...quarantined.values()],
    completeness:"not_asserted" as const,causalLeadership:"not_attested" as const};
}
