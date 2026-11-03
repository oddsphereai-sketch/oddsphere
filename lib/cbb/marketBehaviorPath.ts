import { cbbExactMarketCenter } from "./marketReaderResearch";
import { cbbImpliedProbability } from "./marketEvidence";
import type { CbbCanonicalReceipt, CbbForecast, CbbMarket, CbbQuote } from "./types";
import { cbbEvidenceAvailableAt, cbbEvidenceProvablyBefore } from "./marketReceiptTime";
import type { CbbBehaviorFlow } from "./marketBehaviorCandidate";

export const CBB_MARKET_BEHAVIOR_PATH_RELEASE = "cbb_market_behavior_path_2026_11_02_r3_compact_native_frontier" as const;
const BOOKS = ["circa", "pinnacle", "bookmaker"];
const MARKETS: CbbMarket[] = ["moneyline", "spread", "total"];
// Current writer cadence is15 minutes:32 states cover7h45, exceeding the
// three-hour flow window plus its two-hour pre-flow source-state allowance.
// Faster or unusually active paths truncate explicitly and never bridge a gap.
export const CBB_MARKET_PATH_MAX_STATES = 32;
const MAX_QUOTES = CBB_MARKET_PATH_MAX_STATES;
const MAX_FLOWS = CBB_MARKET_PATH_MAX_STATES;
export const cbbPathBookFamily = (book: string) => ["pinnacle", "ps3838"].includes(book.toLowerCase()) ? "pinnacle" : book.toLowerCase();
type PathQuote = CbbQuote & { orientationVerified?: boolean };
type Direction = -1 | 0 | 1;
export type CbbMarketCanonicalReceiptTuple=[availableBy:string,eventIndex:number,runIndex:number,firstId:number,secondId:number,firstHash:string,secondHash:string];
export type CbbMarketPathQuoteTuple = [observedAt: string, fetchedAt: string, line: number | null,
  firstPrice: number, secondPrice: number, originalBook: string|null, provider: CbbQuote["provider"]|0|1|2|null, canonicalReceipt?: CbbCanonicalReceipt|CbbMarketCanonicalReceiptTuple];
export type CbbMarketPathFlowTuple = [observedAt: string, fetchedAt: string, line: number | null,
  firstMoney: number, secondMoney: number, firstTickets: number, secondTickets: number, originalBook: string|null, eventIdIndex: number, canonicalReceipt?: CbbCanonicalReceipt|CbbMarketCanonicalReceiptTuple];
export type CbbMarketPathStreamTape = {
  book: string;
  market: CbbMarket;
  /** Complete physical-book pairs, with original receipt or explicit bounds. */
  quotes: CbbMarketPathQuoteTuple[];
  flows: CbbMarketPathFlowTuple[];
  flowEventIds: string[];
  canonicalEvents?:string[];
  canonicalRuns?:string[];
  clockPrefix?:string;
  canonicalRunPrefix?:string;
  quarantined: boolean;
  quarantinedSourceTimes: string[];
  /** Observations before this retained boundary were dropped, not reconstructed. */
  truncatedBefore: string | null;
  flowTruncatedBefore: string | null;
};
export type CbbMarketBehaviorPathTape = {
  release: typeof CBB_MARKET_BEHAVIOR_PATH_RELEASE|"cbb_market_behavior_path_2026_11_02_r2_availability_bounds";
  gameId: number;
  startsAt: string;
  capturedAt: string;
  streams: CbbMarketPathStreamTape[];
};
export type CbbSourcePathQuarantine = {book:string;market:CbbMarket;sourceAt:string;reason:string};
export type CbbMarketPathInterval = {
  before: CbbQuote;
  after: CbbQuote;
  delta: number;
  direction: Direction;
};
export type CbbMarketPathFlowBinding = {
  flow: CbbBehaviorFlow;
  sourceState: CbbQuote;
  reaction: CbbMarketPathInterval;
  flowDirection: Direction;
  /** Direction of the source's economic reaction, not a point bonus or causal claim. */
  reactionDirection: Direction;
  response: "aligned" | "opposed" | "held";
  subsequentlyReversed: boolean;
  currentUnresolvedDelta:number;
  currentUnresolvedDirection:Direction;
  currentResolution:"held"|"ongoing"|"contested"|"resumed"|"cancelled"|"reversed";
};
export type CbbMarketPathStreamRead = {
  book: string;
  market: CbbMarket;
  status: "observed" | "unavailable" | "conflicting";
  reason: string;
  intervals: CbbMarketPathInterval[];
  netDelta: number | null;
  recentDirection: Direction;
  currentUnresolvedDelta:number|null;
  currentUnresolvedDirection:Direction;
  currentResolution:"unknown"|"held"|"ongoing"|"contested"|"resumed"|"cancelled"|"reversed";
  pattern: "unknown" | "held" | "ongoing" | "buyback" | "resumption";
  hasReversal: boolean;
  boundFlows: CbbMarketPathFlowBinding[];
  /** Latest fresh aligned flow/reaction. A later reversal is explicit conflict (0). */
  pressureDirection: Direction | null;
  coverage: "retained_window" | "truncated_window";
};
const HASH_ALPHABET="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
// Lowercase SHA256 hex uses lossless43-character base64url. Unusual native
// uppercase/mixed-case text stays literal so its original case also survives.
function packHash(hash:string){
  if(!/^[a-f0-9]{64}$/.test(hash))return hash;
  let output="",bits=0,value=0;
  for(let i=0;i<hash.length;i+=2){value=(value<<8)|Number.parseInt(hash.slice(i,i+2),16);bits+=8;
    while(bits>=6){bits-=6;output+=HASH_ALPHABET[(value>>bits)&63];}}
  return output+HASH_ALPHABET[(value<<(6-bits))&63];
}
function expandHash(hash:string){
  if(/^[a-f0-9]{64}$/i.test(hash))return hash;
  if(!/^[A-Za-z0-9_-]{43}$/.test(hash))return "";
  let output="",bits=0,value=0;
  for(const character of hash){value=(value<<6)|HASH_ALPHABET.indexOf(character);bits+=6;
    if(bits>=8){bits-=8;output+=((value>>bits)&255).toString(16).padStart(2,"0");}}
  return output.length===64&&(value&((1<<bits)-1))===0?output:"";
}
const expandRun=(run:string,stream:CbbMarketPathStreamTape)=>!stream.canonicalRunPrefix?run:run.startsWith("~")?run.slice(1):stream.canonicalRunPrefix+run;
const expandClock=(clock:string,stream:CbbMarketPathStreamTape)=>!stream.clockPrefix?clock:clock.startsWith("~")?clock.slice(1):stream.clockPrefix+clock;
function expandReceipt(source:CbbCanonicalReceipt|CbbMarketCanonicalReceiptTuple|undefined,stream:CbbMarketPathStreamTape):CbbCanonicalReceipt|undefined{
  if(!source)return undefined;
  if(!Array.isArray(source))return structuredClone(source);
  return {kind:"db_inserted_upper_bound",availableBy:expandClock(source[0],stream),providerEventId:stream.canonicalEvents?.[source[1]]??"",
    ingestionRunId:expandRun(stream.canonicalRuns?.[source[2]]??"",stream),observationIds:[source[3],source[4]],rawPayloadHashes:[expandHash(source[5]),expandHash(source[6])]};
}
/** Compact tuples share native event/run IDs. Original timestamp strings,
 * safe IDs, prices and hashes all expand without reconstructing evidence. */
export function expandCbbMarketBehaviorPathStream(tape:CbbMarketBehaviorPathTape,stream:CbbMarketPathStreamTape){
  const quotes:PathQuote[]=stream.quotes.map(q=>{
    const canonicalReceipt=expandReceipt(q[7],stream),provider=q[6]===0?"owls":q[6]===1?"balldontlie":q[6]===2?"sharpapi":q[6];
    return {gameId:tape.gameId,market:stream.market,sportsbook:q[5]??stream.book,providerObservedAt:expandClock(q[0],stream),fetchedAt:expandClock(q[1],stream),line:q[2],firstPrice:q[3],secondPrice:q[4],
      ...(provider===null?{}:{provider}),...(canonicalReceipt?{canonicalReceipt}:{}),phase:"current",orientationVerified:true};
  });
  const flows:CbbBehaviorFlow[]=stream.flows.map(f=>{
    const canonicalReceipt=expandReceipt(f[9],stream);
    return {provider:"owls",gameId:tape.gameId,market:stream.market,sourceBook:f[7]??stream.book,observedAt:expandClock(f[0],stream),fetchedAt:expandClock(f[1],stream),line:f[2],
      firstMoney:f[3],secondMoney:f[4],firstTickets:f[5],secondTickets:f[6],...(canonicalReceipt?{canonicalReceipt}:{}),
      sourceEventId:stream.flowEventIds[f[8]],sourceIdentity:"independent_named_fixture_join",orientationVerified:true};
  });
  return {quotes,flows};
}
const sign = (n: number): Direction => Math.abs(n) <= 1e-7 ? 0 : n > 0 ? 1 : -1;
const pair = (q: CbbQuote) => JSON.stringify([q.line, q.firstPrice, q.secondPrice]);
const sourceTime = (q: CbbQuote) => Date.parse(q.providerObservedAt);
const receiptTime = cbbEvidenceAvailableAt;
const flowPair = (flow: CbbBehaviorFlow) => JSON.stringify([flow.line, flow.firstMoney, flow.secondMoney, flow.firstTickets, flow.secondTickets]);
const fair = (q: CbbQuote) => cbbImpliedProbability(q.firstPrice) / (cbbImpliedProbability(q.firstPrice) + cbbImpliedProbability(q.secondPrice));
function eligibleQuote(q: PathQuote, gameId: number, at: number, start: number) {
  if (q.gameId !== gameId || q.orientationVerified !== true || q.phase !== "current" ||
    !BOOKS.includes(cbbPathBookFamily(q.sportsbook)) || !MARKETS.includes(q.market) ||
    typeof q.providerObservedAt !== "string" || q.providerObservedAt.length > 40 || typeof q.fetchedAt !== "string" || q.fetchedAt.length > 40 ||
    !Number.isFinite(sourceTime(q)) || !Number.isFinite(receiptTime(q)) ||
    sourceTime(q) > receiptTime(q) || receiptTime(q) > at || sourceTime(q) >= start ||
    q.market !== "moneyline" && (q.line === null || !Number.isFinite(q.line) || !Number.isInteger(q.line * 2)) ||
    q.market === "total" && q.line! <= 0) return false;
  try {
    const hold = cbbImpliedProbability(q.firstPrice) + cbbImpliedProbability(q.secondPrice);
    return hold >= .98 && hold <= 1.3;
  } catch { return false; }
}
function eligibleFlow(flow: CbbBehaviorFlow, gameId: number, at: number, start: number) {
  const observed = Date.parse(flow.observedAt), received = cbbEvidenceAvailableAt(flow);
  return flow.provider === "owls" && flow.gameId === gameId && flow.orientationVerified === true &&
    flow.sourceIdentity === "independent_named_fixture_join" && typeof flow.sourceEventId === "string" && !!flow.sourceEventId.trim() && flow.sourceEventId.length <= 256 &&
    typeof flow.observedAt === "string" && flow.observedAt.length <= 40 && typeof flow.fetchedAt === "string" && flow.fetchedAt.length <= 40 &&
    BOOKS.includes(cbbPathBookFamily(flow.sourceBook)) && MARKETS.includes(flow.market) &&
    (flow.market === "moneyline" ? flow.line === null : flow.line !== null && Number.isFinite(flow.line) && Number.isInteger(flow.line * 2)) &&
    cbbPublishedSourcePressure([flow.firstMoney,flow.secondMoney,flow.firstTickets,flow.secondTickets])!==null &&
    Number.isFinite(observed) && Number.isFinite(received) && observed <= received && received <= at && observed < start;
}
/** The established published-source contract: gap direction, or concentration
 * when the money/ticket shares are equal. Preserve the original unit shares. */
export function cbbPublishedSourcePressure(values:Array<number|null|undefined>):{
  direction:Direction;moneyPct:number;ticketPct:number;gap:number;rounded:boolean;
}|null {
  if(values.length!==4||!values.every(v=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=1))return null;
  const percentages=(values as number[]).map(v=>v*100);
  let rounded=false;
  for(const pair of [percentages.slice(0,2),percentages.slice(2,4)]){
    const discrepancy=Math.abs(pair[0]+pair[1]-100);
    if(discrepancy<=1e-4)continue;
    // Unit fractions such as.58 may multiply to57.99999999999999; validate
    // the published integer without changing the retained source percentage.
    const integers=pair.map(Math.round);
    if(!pair.every((v,i)=>Math.abs(v-integers[i])<=1e-7)||Math.abs(integers[0]+integers[1]-100)>1)return null;
    rounded=true;
  }
  const moneyPct=percentages[0],ticketPct=percentages[2],gap=moneyPct-ticketPct;
  const pressure=rounded&&Math.abs(gap)>1e-9&&Math.abs(gap)<=1+1e-7?0:
    Math.abs(gap)>1e-9?Math.sign(gap):Math.sign(moneyPct-50);
  return {direction:pressure>0?1:pressure<0?-1:0,moneyPct,ticketPct,gap,rounded};
}
function flowDirection(flow:CbbBehaviorFlow):Direction {
  return cbbPublishedSourcePressure([flow.firstMoney,flow.secondMoney,flow.firstTickets,flow.secondTickets])?.direction??0;
}
/** Source chronology is observed, never proof of causality, bettor identity,
 * leadership, or of the independent model having consumed the same news.
 * Original forecast anchors live separately and are never changed here. */
export function readCbbMarketBehaviorPath(args: {
  independent: CbbForecast;
  startsAt: string;
  currentQuotes: CbbQuote[];
  seedQuotes?: CbbQuote[];
  previous?: CbbMarketBehaviorPathTape | null;
  flows?: CbbBehaviorFlow[];
  excludedFamilies: string[];
  quarantinedSources?: CbbSourcePathQuarantine[];
  limitPerSource?: number;
}) {
  const base = args.independent, at = Date.parse(base.asOf), start = Date.parse(args.startsAt);
  if (![at, start].every(Number.isFinite) || at >= start - 3600_000) throw new Error("CBB path requires an open prelock fixture");
  const limit = args.limitPerSource ?? MAX_QUOTES;
  if (!Number.isInteger(limit) || limit < 2 || limit > MAX_QUOTES) throw new Error("CBB path retention bound invalid");
  const previous = args.previous;
  if (previous && (![CBB_MARKET_BEHAVIOR_PATH_RELEASE,"cbb_market_behavior_path_2026_11_02_r2_availability_bounds"].includes(previous.release) || previous.gameId !== base.gameId ||
    previous.startsAt !== args.startsAt || !Number.isFinite(Date.parse(previous.capturedAt)) || Date.parse(previous.capturedAt) > at)) {
    throw new Error("CBB path prior identity/cutoff mismatch");
  }
  const excluded = new Set(args.excludedFamilies.map(cbbPathBookFamily));
  const tape: CbbMarketBehaviorPathTape = { release: CBB_MARKET_BEHAVIOR_PATH_RELEASE, gameId: base.gameId,
    startsAt: args.startsAt, capturedAt: base.asOf, streams: [] };
  const reads: CbbMarketPathStreamRead[] = [];
  for (const book of BOOKS) for (const market of MARKETS) {
    const old = previous?.streams.find(s => s.book === book && s.market === market);
    const forced = (args.quarantinedSources??[]).filter(q=>cbbPathBookFamily(q.book)===book&&q.market===market&&Number.isFinite(Date.parse(q.sourceAt))&&Date.parse(q.sourceAt)<=at);
    const incoming = [...(args.seedQuotes ?? []), ...args.currentQuotes].filter(q =>
      cbbPathBookFamily(q.sportsbook) === book && q.market === market && eligibleQuote(q, base.gameId, at, start));
    const expanded = old ? expandCbbMarketBehaviorPathStream(previous!, old) : {quotes:[],flows:[]};
    const raw = [...expanded.quotes, ...incoming].filter(q => eligibleQuote(q, base.gameId, at, start));
    const incomingFlows = (args.flows ?? []).filter(f => cbbPathBookFamily(f.sourceBook) === book && f.market === market && eligibleFlow(f, base.gameId, at, start));
    const rawFlows = [...expanded.flows, ...incomingFlows].filter(f => eligibleFlow(f, base.gameId, at, start));
    if (!raw.length && !rawFlows.length && !old && !forced.length) continue;
    const times = new Map<number, CbbQuote[]>();
    for (const q of raw) times.set(sourceTime(q), [...(times.get(sourceTime(q)) ?? []), q]);
    const quarantinedTimes = new Set([...(old?.quarantinedSourceTimes ?? []),...forced.map(q=>q.sourceAt)]);
    let quarantined = (old?.quarantined ?? false)||forced.length>0;
    const deduped = [...times.entries()].sort(([a], [b]) => a - b).flatMap(([time, quotes]) => {
      if (new Set(quotes.map(pair)).size !== 1) {
        quarantined = true; quarantinedTimes.add(new Date(time).toISOString());
        // Preserve distinct conflicting original pairs; never last-write-win them.
        return [...new Map(quotes.sort((a, b) => receiptTime(b) - receiptTime(a)).map(q => [pair(q), structuredClone(q)])).values()];
      }
      return [structuredClone(quotes.reduce((a, b) => receiptTime(a) <= receiptTime(b) ? a : b))];
    });
    const dropped = deduped.length > limit;
    const quotes = deduped.slice(-limit);
    const boundary = quotes[0]?.providerObservedAt ?? old?.truncatedBefore ?? null;
    const flowTimes = new Map<number, CbbBehaviorFlow[]>();
    for (const flow of rawFlows) {
      const time = Date.parse(flow.observedAt);
      flowTimes.set(time, [...(flowTimes.get(time) ?? []), flow]);
    }
    const dedupedFlows = [...flowTimes.entries()].sort(([a], [b]) => a - b).flatMap(([time, rows]) => {
      if (new Set(rows.map(flowPair)).size > 1) {
        quarantined = true; quarantinedTimes.add(new Date(time).toISOString());
        return [...new Map(rows.sort((a, b) => receiptTime(b) - receiptTime(a)).map(f => [flowPair(f), structuredClone(f)])).values()];
      }
      return [structuredClone(rows.reduce((a, b) => receiptTime(a) <= receiptTime(b) ? a : b))];
    });
    const flows = dedupedFlows.slice(-MAX_FLOWS);
    const flowEventIds = [...new Set(flows.map(f => f.sourceEventId))];
    const canonicalEvents:string[]=[],canonicalRuns:string[]=[];
    const firstRun=quotes.find(q=>q.canonicalReceipt)?.canonicalReceipt?.ingestionRunId??flows.find(f=>f.canonicalReceipt)?.canonicalReceipt?.ingestionRunId;
    const canonicalRunPrefix=firstRun?.match(/^cbb:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}T/)?.[0];
    const compactRun=(run:string)=>!canonicalRunPrefix?run:run.startsWith(canonicalRunPrefix)?run.slice(canonicalRunPrefix.length):`~${run}`;
    const firstClock=quotes[0]?.providerObservedAt??flows[0]?.observedAt;
    const clockPrefix=firstClock&&/^\d{4}-\d{2}-\d{2}T/.test(firstClock)?firstClock.slice(0,11):undefined;
    const compactClock=(clock:string)=>!clockPrefix?clock:clock.startsWith(clockPrefix)?clock.slice(clockPrefix.length):`~${clock}`;
    const intern=(values:string[],value:string)=>{const index=values.indexOf(value);if(index>=0)return index;values.push(value);return values.length-1;};
    const compactReceipt=(source:CbbCanonicalReceipt):CbbMarketCanonicalReceiptTuple=>[compactClock(source.availableBy),intern(canonicalEvents,source.providerEventId),
      intern(canonicalRuns,compactRun(source.ingestionRunId)),source.observationIds[0],source.observationIds[1],packHash(source.rawPayloadHashes[0]),packHash(source.rawPayloadHashes[1])];
    const compactQuotes=quotes.map((q):CbbMarketPathQuoteTuple=>{
      const packed:CbbMarketPathQuoteTuple=[compactClock(q.providerObservedAt),compactClock(q.fetchedAt),q.line,q.firstPrice,q.secondPrice,
        q.sportsbook===book?null:q.sportsbook,q.provider==="owls"?0:q.provider==="balldontlie"?1:q.provider==="sharpapi"?2:null];
      if(q.canonicalReceipt)packed[7]=compactReceipt(q.canonicalReceipt);return packed;
    });
    const compactFlows=flows.map((f):CbbMarketPathFlowTuple=>{
      const packed:CbbMarketPathFlowTuple=[compactClock(f.observedAt),compactClock(f.fetchedAt),f.line,f.firstMoney,f.secondMoney,f.firstTickets,f.secondTickets,
        f.sourceBook===book?null:f.sourceBook,flowEventIds.indexOf(f.sourceEventId)];
      if(f.canonicalReceipt)packed[9]=compactReceipt(f.canonicalReceipt);return packed;
    });
    const stream:CbbMarketPathStreamTape={book,market,quotes:compactQuotes,flows:compactFlows,flowEventIds,
      ...(canonicalEvents.length?{canonicalEvents,canonicalRuns,...(canonicalRunPrefix?{canonicalRunPrefix}:{})}:{}),...(clockPrefix?{clockPrefix}:{}),quarantined,
      quarantinedSourceTimes: [...quarantinedTimes].sort().slice(-MAX_QUOTES),
      truncatedBefore: dropped ? boundary : old?.truncatedBefore ?? null,
      flowTruncatedBefore: dedupedFlows.length > MAX_FLOWS ? flows[0].observedAt : old?.flowTruncatedBefore ?? null };
    tape.streams.push(stream);
    const read: CbbMarketPathStreamRead = { book, market, status: "unavailable", reason: "no_observed_adjacent_pair",
      intervals: [], netDelta: null, recentDirection: 0, currentUnresolvedDelta:null,currentUnresolvedDirection:0,currentResolution:"unknown",pattern: "unknown", hasReversal: false,
      boundFlows: [], pressureDirection: null, coverage: stream.truncatedBefore ? "truncated_window" : "retained_window" };
    reads.push(read);
    if (excluded.has(book)) { read.reason = "evaluated_target_family_excluded"; continue; }
    if (quarantined) { read.status = "conflicting"; read.reason = "ambiguous_same_source_time"; continue; }
    const latest = quotes.at(-1);
    if (!latest || at - sourceTime(latest) > 3600_000) { read.reason = "latest_source_pair_unavailable_or_stale"; continue; }
    // Every retained adjacent receipt must be ordered. Never bridge an arrival
    // regression or use an older quote newly fetched after a later source pair.
    for (let i = 1; i < quotes.length; i++) {
      const before = quotes[i - 1], after = quotes[i];
      if (sourceTime(before) >= sourceTime(after) || receiptTime(before) > receiptTime(after)) {
        read.status = "conflicting"; read.reason = "source_receipt_order_conflict"; break;
      }
      const delta = pair(before) === pair(after) ? 0 :
        cbbExactMarketCenter(base, after, fair(after)) - cbbExactMarketCenter(base, before, fair(before));
      read.intervals.push({ before, after, delta, direction: sign(delta) });
    }
    if (read.status === "conflicting" || !read.intervals.length) continue;
    read.status = "observed"; read.reason = "observed_source_price_path_no_causal_claim";
    read.netDelta = read.intervals.reduce((sum, interval) => sum + interval.delta, 0);
    read.currentUnresolvedDelta=read.netDelta;read.currentUnresolvedDirection=sign(read.netDelta);
    const moving = read.intervals.filter(interval => interval.direction !== 0);
    const runs = moving.filter((interval, index) => index === 0 || interval.direction !== moving[index - 1].direction);
    read.recentDirection = moving.at(-1)?.direction ?? 0;
    read.hasReversal = runs.length > 1;
    const initialDirection=moving[0]?.direction??0;
    let cumulative=0;
    const frontier=Math.max(0,...read.intervals.map(interval=>{cumulative+=interval.delta;return cumulative*initialDirection;}));
    const fullPriceResumption=initialDirection!==0&&read.netDelta*initialDirection>=frontier-1e-7;
    read.currentResolution=initialDirection===0?"held":read.currentUnresolvedDirection===0?"cancelled":
      read.currentUnresolvedDirection!==initialDirection?"reversed":read.hasReversal?(fullPriceResumption?"resumed":"contested"):"ongoing";
    read.pattern = runs.length >= 3 ? "resumption" : runs.length === 2 ? "buyback" : runs.length ? "ongoing" : "held";
    for (const flow of flows) {
      const observed = Date.parse(flow.observedAt);
      if (at - observed > 3 * 3600_000) continue;
      // The last genuine source state at/before the flow owns its threshold.
      // If that state was truncated away, there is no retrospective binding.
      const state = quotes.filter(q => sourceTime(q) <= observed).at(-1);
      if (!state || state.line !== flow.line || observed - sourceTime(state) > 2 * 3600_000 || !cbbEvidenceProvablyBefore(state, flow)) continue;
      const reactions = read.intervals.filter(interval => sourceTime(interval.before) >= sourceTime(state) &&
        sourceTime(interval.after) > observed && cbbEvidenceProvablyBefore(flow, interval.after));
      const reaction = reactions.find(interval => interval.direction !== 0) ?? reactions.at(-1);
      if (!reaction) continue;
      const flowSign = flowDirection(flow), index = read.intervals.indexOf(reaction);
      const subsequentlyReversed = reaction.direction !== 0 && read.intervals.slice(index + 1).some(interval => interval.direction !== 0 && interval.direction !== reaction.direction);
      const sourceCenter=cbbExactMarketCenter(base,state,fair(state));
      const displacements=read.intervals.filter(interval=>sourceTime(interval.after)>observed)
        .map(interval=>cbbExactMarketCenter(base,interval.after,fair(interval.after))-sourceCenter);
      const currentUnresolvedDelta=displacements.at(-1)??0,currentUnresolvedDirection=sign(currentUnresolvedDelta);
      const frontier=Math.max(0,...displacements.map(delta=>delta*reaction.direction));
      const fullResumption=reaction.direction!==0&&currentUnresolvedDelta*reaction.direction>=frontier-1e-7;
      const currentResolution=reaction.direction===0?"held":currentUnresolvedDirection===0?"cancelled":
        currentUnresolvedDirection!==reaction.direction?"reversed":subsequentlyReversed?(fullResumption?"resumed":"contested"):"ongoing";
      read.boundFlows.push({flow,sourceState:state,reaction,flowDirection:flowSign,reactionDirection:reaction.direction,
        response:reaction.direction===0?"held":reaction.direction===flowSign?"aligned":"opposed",subsequentlyReversed,
        currentUnresolvedDelta,currentUnresolvedDirection,currentResolution});
    }
    const lastBound=read.boundFlows.at(-1);
    if(lastBound&&lastBound.flowDirection!==0)read.pressureDirection=lastBound.response==="aligned"&&["ongoing","resumed"].includes(lastBound.currentResolution)&&
      lastBound.currentUnresolvedDirection===lastBound.flowDirection?lastBound.currentUnresolvedDirection:0;
  }
  return { tape, streams: reads, quarantinedKeys: tape.streams.filter(s => s.quarantined).map(s => `${s.book}:${s.market}`) };
}
