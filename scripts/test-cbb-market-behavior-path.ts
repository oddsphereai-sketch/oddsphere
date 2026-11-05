import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import { readCbbMarketBehaviorPath, cbbPublishedSourcePressure, expandCbbMarketBehaviorPathStream, CBB_MARKET_BEHAVIOR_PATH_RELEASE, CBB_MARKET_PATH_MAX_STATES } from "../lib/cbb/marketBehaviorPath";
import { CBB_CURRENT_SCORE_RELEASE } from "../lib/cbb/currentScoreRuntime";
import { cbbExactMarketCenter } from "../lib/cbb/marketReaderResearch";
import { normalCdf, cbbThresholdProbabilities } from "../lib/cbb/model";
import type { CbbBehaviorFlow } from "../lib/cbb/marketBehaviorCandidate";
import type { CbbForecast, CbbQuote } from "../lib/cbb/types";

const start = "2026-11-02T19:00:00.000Z";
const time = (minutes: number) => new Date(Date.parse("2026-11-02T15:00:00.000Z") + minutes * 60_000).toISOString();
function forecast(minutes = 50): CbbForecast {
  const margin = 12, total = 150, sd = 11;
  const zero = normalCdf((.5 - margin) / sd) - normalCdf((-.5 - margin) / sd);
  return { release: CBB_CURRENT_SCORE_RELEASE, gameId: 777, asOf: time(minutes), homeId: 1, awayId: 2,
    homeScore: 81, awayScore: 69, margin, total, homeWinProbability: (1 - normalCdf((.5 - margin) / sd)) / (1 - zero),
    possessions: 70, inputStatus: "complete", issues: [], uncertainty: { marginSd: sd, totalSd: 16,
      marginTotalCorrelation: 0, marginCorrection: 0, totalCorrection: 0, fitThroughSeason: 2025, games: 1000 } };
}
const quote = (minute: number, firstPrice = -110, secondPrice = -110, line = -3.5, book = "circa"): CbbQuote => ({
  gameId: 777, sportsbook: book, market: "spread", line, firstPrice, secondPrice, provider: "owls", phase: "current",
  providerObservedAt: time(minute), fetchedAt: time(minute + 1), ...{ orientationVerified: true },
});
const flow = (minute = 15, line = -3.5): CbbBehaviorFlow => ({ provider: "owls", gameId: 777, sourceBook: "circa", market: "spread", line,
  firstMoney: .1, secondMoney: .9, firstTickets: .6, secondTickets: .4, observedAt: time(minute), fetchedAt: time(minute + 1),
  orientationVerified: true, sourceEventId: "verified-native-fixture", sourceIdentity: "independent_named_fixture_join" });
const run = (currentQuotes: CbbQuote[], extra: Partial<Parameters<typeof readCbbMarketBehaviorPath>[0]> = {}) =>
  readCbbMarketBehaviorPath({ independent: forecast(), startsAt: start, currentQuotes, excludedFamilies: ["draftkings"], ...extra });
const source = (read: ReturnType<typeof run>) => read.streams.find(s => s.book === "circa" && s.market === "spread")!;
const q0 = quote(0), q1 = quote(10, -170, 145), q2 = quote(20, -115, -105);
const originalBytes = JSON.stringify([q0, q1, q2]);
const first = run([q1], { seedQuotes: [q0], independent: forecast(12) });
const buyback = run([q2], { previous: first.tape, flows: [flow()] });
const direct = run([q2], { seedQuotes: [q0], flows: [flow()] });
assert.equal(buyback.tape.release, CBB_MARKET_BEHAVIOR_PATH_RELEASE);
assert.equal(source(buyback).recentDirection, -1);
assert.equal(source(buyback).pattern, "buyback");
assert.equal(source(buyback).hasReversal, true);
assert.equal(source(buyback).pressureDirection, -1, "post-flow adverse reaction survives the small positive net endpoint delta");
assert.equal(source(direct).recentDirection, 1);
assert.equal(source(direct).pressureDirection, 0, "the direct positive path records opposed native response without claiming aligned authority");
assert.ok(Math.abs(source(buyback).netDelta! - source(direct).netDelta!) < 1e-9);
assert.notDeepEqual(source(buyback), source(direct), "same endpoints with different observed paths have different posture");
assert.equal(JSON.stringify([q0, q1, q2]), originalBytes, "caller-owned original receipts remain exact");
const held = run([quote(25, -115, -105)], { previous: buyback.tape });
assert.equal(source(held).recentDirection, -1);
assert.equal(source(held).pressureDirection, -1, "a later unchanged paired price does not erase an adverse buyback");
const resumed = run([quote(35, -150, 130)], { previous: held.tape });
assert.equal(source(resumed).pattern, "resumption");
assert.equal(source(resumed).recentDirection, 1);
assert.equal(source(resumed).pressureDirection, 0, "reversed bound pressure remains explicit conflict, never clean confirmation");
assert.equal(source(resumed).boundFlows[0].subsequentlyReversed, true);
const lineChange = run([quote(20, -115, -105, -4.5)], { seedQuotes: [quote(0, -150, 130, -5.5)], flows: [flow(15, -5.5)] });
assert.equal(source(lineChange).pressureDirection, -1, "flow binds its own source line before the subsequent line+juice reaction");
assert.equal(source(lineChange).boundFlows[0].sourceState.line, -5.5);
assert.equal(source(lineChange).boundFlows[0].reaction.after.line, -4.5);
assert.equal(source(lineChange).boundFlows[0].flow.line, -5.5, "no target contract is substituted for the native flow threshold");
const supportiveFlow={...flow(5),firstMoney:.8,secondMoney:.2,firstTickets:.4,secondTickets:.6};
const supportStart=run([q1],{seedQuotes:[q0],flows:[supportiveFlow]});
assert.equal(source(supportStart).boundFlows[0].currentResolution,"ongoing");
const partial=run([q2],{previous:supportStart.tape});
assert.equal(source(partial).boundFlows[0].currentResolution,"contested");
assert.equal(source(partial).currentResolution,"contested");
assert.equal(source(partial).pressureDirection,0);
const full=run([{...q1,providerObservedAt:time(30),fetchedAt:time(31)}],{previous:partial.tape});
assert.equal(source(full).boundFlows[0].currentResolution,"resumed");
assert.equal(source(full).currentResolution,"resumed");
assert.equal(source(full).boundFlows[0].subsequentlyReversed,true,"historical buyback remains audit evidence after current fullresumption");
assert.equal(source(full).pressureDirection,1,"full economic resumption can restore the same native flow without inventing a new split");
const cancellation=run([{...q0,providerObservedAt:time(30),fetchedAt:time(31)}],{previous:partial.tape});
assert.equal(source(cancellation).boundFlows[0].currentResolution,"cancelled");
assert.equal(source(cancellation).currentResolution,"cancelled");
assert.equal(source(cancellation).boundFlows[0].currentUnresolvedDirection,0);
assert.equal(source(cancellation).pressureDirection,0);
const wrongSourceLine = run([q2], { seedQuotes: [q0], flows: [flow(15, -4.5)] });
assert.equal(source(wrongSourceLine).boundFlows.length, 0, "an unobserved native threshold cannot bind even if the provider supplied a percentage");
const noEarlierReceipt = run([q2], { seedQuotes: [q0], flows: [{ ...flow(), fetchedAt: time(22) }] });
assert.equal(source(noEarlierReceipt).boundFlows.length, 0, "later collection cannot be backdated into the already received reaction");
const future = run([{ ...q2, fetchedAt: time(55) }], { seedQuotes: [q0] });
assert.equal(source(future).status, "unavailable");
const stale = run([q2], { seedQuotes: [q0], independent: forecast(90) });
assert.equal(source(stale).status, "unavailable");
assert.equal(source(stale).reason, "latest_source_pair_unavailable_or_stale");
const receiptRetained = run([{ ...q2, fetchedAt: time(45) }], { previous: buyback.tape });
assert.equal(expandCbbMarketBehaviorPathStream(receiptRetained.tape, receiptRetained.tape.streams[0]).quotes.at(-1)!.fetchedAt, q2.fetchedAt, "re-observation preserves the first genuine receipt");
const ambiguous = run([q2, { ...q2, providerObservedAt: "2026-11-02T15:20:00+00:00", firstPrice: -130 }], { previous: first.tape });
assert.equal(source(ambiguous).status, "conflicting");
assert.deepEqual(ambiguous.quarantinedKeys, ["circa:spread"]);
assert.equal(expandCbbMarketBehaviorPathStream(ambiguous.tape, ambiguous.tape.streams[0]).quotes.filter(q => Date.parse(q.providerObservedAt) === Date.parse(q2.providerObservedAt)).length, 2,
  "conflicting original pairs are preserved rather than last-write-wins");
const stillAmbiguous = run([quote(35)], { previous: ambiguous.tape });
assert.equal(source(stillAmbiguous).status, "conflicting", "a later receipt cannot launder quarantined source history");
const flowConflict = run([q2], { previous: first.tape, flows: [flow(), { ...flow(), firstMoney: .9, secondMoney: .1 }] });
assert.equal(source(flowConflict).status, "conflicting");
const truncated = run([q0, q1, q2, quote(30, -150, 130)], { flows: [flow()], limitPerSource: 2 });
assert.equal(truncated.tape.streams[0].quotes.length, 2);
assert.equal(truncated.tape.streams[0].truncatedBefore, q2.providerObservedAt);
assert.equal(source(truncated).coverage, "truncated_window");
assert.equal(source(truncated).boundFlows.length, 0, "flow cannot bridge a discarded source interval");
assert.equal(source(truncated).intervals.length, 1);
const reobservedTruncated = run([quote(30, -150, 130)], { previous: truncated.tape, seedQuotes: [q0], limitPerSource: 2 });
assert.equal(source(reobservedTruncated).coverage, "truncated_window");
assert.equal(source(reobservedTruncated).boundFlows.length, 0, "an old anchor cannot reconstruct a truncated path");
const excluded = run([q2], { seedQuotes: [q0], excludedFamilies: ["circa"] });
assert.equal(source(excluded).status, "unavailable");
assert.equal(source(excluded).reason, "evaluated_target_family_excluded");
const alias = run([quote(20, -115, -105, -3.5, "ps3838")], { seedQuotes: [quote(0, -110, -110, -3.5, "pinnacle")], excludedFamilies: ["ps3838"] });
assert.equal(alias.streams[0].reason, "evaluated_target_family_excluded");
const oldArrivesLate = run([q1, q2], { seedQuotes: [{ ...q0, fetchedAt: time(40) }] });
assert.equal(source(oldArrivesLate).status, "conflicting", "late historical arrival never fabricates an ordered observed path");
const center = cbbExactMarketCenter(forecast(), q0, .5);
const targetProbability = cbbThresholdProbabilities({ ...forecast(), margin: center }, "spread", -4.5);
const fairAtChangedLine = targetProbability.first / (targetProbability.first + targetProbability.second);
const american = (p: number) => p >= .5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
const compensated = run([quote(20, american(fairAtChangedLine * 1.03), american((1 - fairAtChangedLine) * 1.03), -4.5)], { seedQuotes: [q0] });
assert.equal(source(compensated).recentDirection, 0, "line and counter-juice compensation has no invented movement");
const totalBefore = { ...q0, market: "total" as const, line: 150.5 };
const totalAfter = { ...q2, market: "total" as const, line: 149.5, firstPrice: -110, secondPrice: -110 };
const total = run([totalAfter], { seedQuotes: [totalBefore], flows: [{ ...flow(), market: "total", line: 150.5 }] });
assert.equal(total.streams[0].pressureDirection, -1, "native Over flow and Total reaction use the same canonical axis direction");
const mlBefore = { ...q0, market: "moneyline" as const, line: null, firstPrice: -150, secondPrice: 130 };
const mlAfter = { ...q2, market: "moneyline" as const, line: null, firstPrice: -170, secondPrice: 145 };
const ml = run([mlAfter], { seedQuotes: [mlBefore], flows: [{ ...flow(), market: "moneyline", line: null, firstMoney: .8, secondMoney: .2, firstTickets: .4, secondTickets: .6 }] });
assert.equal(ml.streams[0].pressureDirection, 1, "Moneyline price economics preserve canonical home direction");
assert.throws(() => run([q2], { previous: { ...buyback.tape, gameId: 9 } }), /identity/);
assert.throws(() => run([q2], { previous: { ...buyback.tape, capturedAt: time(51) } }), /cutoff/);
assert.throws(() => run([q2], { limitPerSource: 1 }), /retention/);
assert.equal(cbbPublishedSourcePressure([.8,.2,.8,.2])?.direction,1,"80/80 concentration remains meaningful at zero money-ticket gap");
assert.equal(cbbPublishedSourcePressure([.2,.8,.2,.8])?.direction,-1);
assert.equal(cbbPublishedSourcePressure([.4,.6,.2,.8])?.direction,1,"nonzero gap direction does not require a money majority");
assert.equal(cbbPublishedSourcePressure([.6,.4,.8,.2])?.direction,-1);
assert.equal(cbbPublishedSourcePressure([.5,.5,.5,.5])?.direction,0);
assert.equal(cbbPublishedSourcePressure([.43,.58,.58,.43])?.direction,-1,"published whole-percent99/101 pairs preserve pressure");
assert.equal(cbbPublishedSourcePressure([.58,.43,.57,.43])?.direction,0,"rounded one-point gap is uncertain");
assert.equal(cbbPublishedSourcePressure([.57,.43,.58,.43])?.direction,0);
assert.equal(cbbPublishedSourcePressure([.433,.568,.4,.6]),null,"decimal discrepancies cannot borrow whole-percent rounding tolerance");
assert.equal(cbbPublishedSourcePressure([.43,.59,.4,.6]),null,"a102-percent pair fails closed");
assert.equal(cbbPublishedSourcePressure([.435,.565,.4,.6])?.direction,1,"coherent decimal pairs remain valid");
const concentrated=run([q1],{seedQuotes:[q0],flows:[{...flow(5),firstMoney:.8,secondMoney:.2,firstTickets:.8,secondTickets:.2}]});
assert.equal(source(concentrated).pressureDirection,1);
const publishedRounding={...flow(),firstMoney:.43,secondMoney:.58,firstTickets:.58,secondTickets:.43};
const roundedPath=run([q2],{previous:first.tape,flows:[publishedRounding]});
assert.equal(source(roundedPath).pressureDirection,-1);
assert.equal(source(roundedPath).boundFlows[0].flow.secondMoney,.58,"source rounded percentages are never renormalized");
const roundedUnknown=run([q1],{seedQuotes:[q0],flows:[{...flow(5),firstMoney:.58,secondMoney:.43,firstTickets:.57,secondTickets:.43}]});
assert.equal(source(roundedUnknown).pressureDirection,null);
for(const invalid of [{...flow(),firstMoney:.433,secondMoney:.568},{...flow(),firstMoney:.43,secondMoney:.59}]){
 const invalidPath=run([q2],{seedQuotes:[q0],flows:[invalid]});
 assert.equal(invalidPath.tape.streams[0].flows.length,0);
}
const metadata=(fetchedAt:string,availableBy:string,id:number)=>({kind:"db_inserted_upper_bound" as const,availableBy,
 providerEventId:"ncaab:Away-College@Home-University-20261102",ingestionRunId:`cbb:2026-11-02:${fetchedAt}`,
 observationIds:[id,id+1] as [number,number],rawPayloadHashes:[createHash("sha256").update(`native-${id}`).digest("hex"),createHash("sha256").update(`native-${id+1}`).digest("hex")] as [string,string]});
const boundedStart={...q0,canonicalReceipt:metadata(q0.fetchedAt,time(2),1001)};
const overlapFetched=time(21),overlapFlow={...flow(10),firstMoney:.8,secondMoney:.2,firstTickets:.4,secondTickets:.6,
 fetchedAt:overlapFetched,canonicalReceipt:metadata(overlapFetched,time(22),1003)};
const overlapQuote={...q2,fetchedAt:overlapFetched,canonicalReceipt:metadata(overlapFetched,time(23),1005)};
const overlapping=run([overlapQuote],{seedQuotes:[boundedStart],flows:[overlapFlow]});
assert.equal(source(overlapping).boundFlows.length,0,"same-run DB insertion order never proves flow response ordering");
const unchangedRecapture={...quote(9),fetchedAt:time(11),canonicalReceipt:metadata(time(11),time(12),1011)};
const betweenFlow={...flow(10),fetchedAt:time(11),canonicalReceipt:metadata(time(11),time(11.5),1013)};
const unchangedAfter={...quote(20),canonicalReceipt:metadata(time(21),time(22),1015)};
const knownHeld=run([unchangedRecapture,unchangedAfter],{seedQuotes:[boundedStart],flows:[betweenFlow]});
assert.equal(source(knownHeld).boundFlows.length,1,"a newer identical recapture must retain a provably known pre-flow state");
assert.equal(source(knownHeld).boundFlows[0].sourceState.providerObservedAt,boundedStart.providerObservedAt);
assert.equal(source(knownHeld).boundFlows[0].response,"held","the identical post-flow pair is a hold, not sharp confirmation");
const changedRecapture=run([{...unchangedRecapture,firstPrice:-120},unchangedAfter],{seedQuotes:[boundedStart],flows:[betweenFlow]});
assert.equal(source(changedRecapture).boundFlows.length,0,"a changed ambiguous pre-flow state cannot borrow an earlier receipt");
const laterObserved={...quote(30,-130,110),canonicalReceipt:metadata(time(31),time(32),1007)};
const ordered=run([laterObserved],{previous:overlapping.tape});
assert.equal(source(ordered).pressureDirection,1,"a later independent run can prove availability ordering conservatively");
const capacityQuotes: CbbQuote[] = [], capacityFlows: CbbBehaviorFlow[] = [];
for (const book of ["circa", "pinnacle", "bookmaker"]) for (const market of ["moneyline", "spread", "total"] as const) {
  for (let i = 0; i < CBB_MARKET_PATH_MAX_STATES; i++) {
    const minute = i * 15, line = market === "moneyline" ? null : market === "spread" ? -3.5 : 150.5;
    capacityQuotes.push({ ...quote(minute, -110 - i % 3, -110 + i % 3, -3.5, book), market, line });
    capacityFlows.push({ ...flow(minute + 5), sourceBook: book, market, line,
      sourceEventId: "ncaab:Away-College@Home-University-20261102" });
  }
}
const capacityArgs = { independent: forecast(480), startsAt: "2026-11-03T03:00:00.000Z", currentQuotes: capacityQuotes, excludedFamilies: [] };
const denseTape = readCbbMarketBehaviorPath({ ...capacityArgs, flows: capacityFlows }).tape;
const nativeTape = readCbbMarketBehaviorPath({ ...capacityArgs, flows: capacityFlows.filter(f => f.sourceBook === "circa") }).tape;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
assert.equal(denseTape.streams.length, 9);
assert.ok(denseTape.streams.every(s => s.quotes.length <= 32 && s.flows.length <= 32));
assert.ok(bytes(denseTape) < 64 * 1024, "dense nine-stream native receipts must fit64KiB/game");
assert.ok(bytes(denseTape) * 120 < 8 * 1024 * 1024, "120-game compact tape read must remain below8MiB");
const longUniqueEventIds = capacityFlows.map((f, i) => ({ ...f, sourceEventId: `${"x".repeat(252)}${String(i).padStart(4,"0")}` }));
const longIdTape = readCbbMarketBehaviorPath({ ...capacityArgs, flows: longUniqueEventIds }).tape;
assert.ok(bytes(longIdTape) < 144 * 1024, "even every retained native event ID changing at its256-character bound stays bounded");
const canonicalQuotes=capacityQuotes.map((q,i)=>({...q,canonicalReceipt:metadata(q.fetchedAt,new Date(Date.parse(q.fetchedAt)+1000).toISOString(),2001+i*2)}));
const canonicalFlows=capacityFlows.map((f,i)=>({...f,canonicalReceipt:metadata(f.fetchedAt,new Date(Date.parse(f.fetchedAt)+1000).toISOString(),4001+i*2)}));
const canonicalDenseTape=readCbbMarketBehaviorPath({...capacityArgs,currentQuotes:canonicalQuotes,flows:canonicalFlows}).tape;
const canonicalNativeTape=readCbbMarketBehaviorPath({...capacityArgs,currentQuotes:canonicalQuotes.filter(q=>q.sportsbook!=="bookmaker"),flows:canonicalFlows.filter(f=>f.sourceBook==="circa")}).tape;
assert.ok(canonicalDenseTape.streams.every(s=>s.quotes.length<=32&&s.flows.length<=32));
assert.ok(bytes(canonicalNativeTape)<=64*1024,"actual two professional books/Circa native flow mix including random64hex hashes must fit64KiB/game");
assert.ok(bytes(canonicalNativeTape)*120<=8*1024*1024,"actual120-game full-lineage tape read must fit8MiB");
assert.ok(bytes(canonicalDenseTape)<=128*1024,"theoretical nine-stream native quote+flow density remains below128KiB/game");
for(const stream of canonicalDenseTape.streams){
 const expanded=expandCbbMarketBehaviorPathStream(canonicalDenseTape,stream);
 assert.deepEqual(expanded.quotes,canonicalQuotes.filter(q=>q.sportsbook===stream.book&&q.market===stream.market));
 assert.deepEqual(expanded.flows,canonicalFlows.filter(f=>f.sourceBook===stream.book&&f.market===stream.market));
}
const preciseReceipt={...metadata(q0.fetchedAt,"2026-11-02T15:01:03.630193+00:00",9001),
 rawPayloadHashes:["ABCDEF0123456789".repeat(4),createHash("sha256").update("exact-case").digest("hex")] as [string,string]};
const preciseQuote={...q0,canonicalReceipt:preciseReceipt};
const alternateDay={...quote(20),providerObservedAt:"2026-11-01T23:59:59.999Z",fetchedAt:"2026-11-02T00:00:00.123Z",
 canonicalReceipt:{...metadata("2026-11-02T00:00:00.123Z","2026-11-02T00:00:01.001234+00:00",9003),ingestionRunId:"cbb:2026-11-01:2026-11-02T00:00:00.123Z"}};
const mixedClockTape=run([preciseQuote],{seedQuotes:[alternateDay]}).tape;
const mixedExpanded=expandCbbMarketBehaviorPathStream(mixedClockTape,mixedClockTape.streams[0]);
assert.deepEqual(mixedExpanded.quotes,[alternateDay,preciseQuote],"microsecond upperbounds, timestamp formats, alternate dates/run prefixes and hash case all round trip exactly");

console.log(JSON.stringify({capacity:"original_canonical_metadata_included",denseNineStreamBytes:bytes(canonicalDenseTape),dense120GameReadBytes:bytes(canonicalDenseTape)*120,
 nativeTwoPriceBookCircaFlowBytes:bytes(canonicalNativeTape),native120GameReadBytes:bytes(canonicalNativeTape)*120}));
assert.throws(() => run([q2], { limitPerSource: 33 }), /retention/);
console.log(JSON.stringify({capacity:"compact_tape_only; ephemeral intervals are not persisted",statesPerSource:CBB_MARKET_PATH_MAX_STATES,
  cadenceMinutes:15,nominalCoverageHours:31*15/60,denseNineStreamBytes:bytes(denseTape),dense120GameReadBytes:bytes(denseTape)*120,
  productionCircaFlowMixBytes:bytes(nativeTape),production120GameReadBytes:bytes(nativeTape)*120,
  uniqueMaximumLengthEventIdBytes:bytes(longIdTape),uniqueMaximumLengthEventId120GameReadBytes:bytes(longIdTape)*120}));
console.log("PASS CBB observed paired path: buyback/resumption/holds, native flow contracts, receipt clocks, persistent ambiguity, exclusion and bounded contiguous coverage.");

const transported={...quote(20,-115,-105,-3.5,"pinnacle"),provider:"the_odds_api" as const,providerEventId:"exact-toa-event",requestedAt:time(14)};
const transportedRead=run([transported],{seedQuotes:[{...q0,sportsbook:"pinnacle"}],flows:[{...flow(),sourceBook:"pinnacle"}]});
const transportedStream=transportedRead.tape.streams.find(s=>s.book==="pinnacle"&&s.market==="spread")!;
for(const row of transportedStream.quotes)assert.equal(Object.keys(row).length,row.length,"In-memory transport tuples contain explicit JSON slots rather than sparse holes");
const rawTransport=transportedStream.quotes.find(row=>row[8]?.providerEventId===transported.providerEventId)!;assert.equal(rawTransport[7],null);
const priorSparse=[...rawTransport];delete priorSparse[7];assert.equal(JSON.stringify(priorSparse),JSON.stringify(rawTransport),"Explicit null padding preserves the existing R6 stored wire exactly");
const expandedTransport=expandCbbMarketBehaviorPathStream(JSON.parse(JSON.stringify(transportedRead.tape)),JSON.parse(JSON.stringify(transportedStream)));
const restoredTransport=expandedTransport.quotes.find(q=>q.providerObservedAt===transported.providerObservedAt)!;
assert.equal(restoredTransport.provider,"the_odds_api");assert.equal(restoredTransport.providerEventId,transported.providerEventId);
assert.equal(restoredTransport.requestedAt,transported.requestedAt);
assert.equal(transportedRead.streams.find(s=>s.book==="pinnacle"&&s.market==="spread")!.boundFlows.length,0,"no apparent reaction when the quote request began before flow availability");
const oldTape=structuredClone(first.tape);oldTape.release="cbb_market_behavior_path_2026_11_04_r5_retained_response_frontier";
const oldTapeBytes=JSON.stringify(oldTape);run([q2],{previous:oldTape});assert.equal(JSON.stringify(oldTape),oldTapeBytes,"old retained tape is never mutated by migration");
console.log("PASS CBB transport path: new provider/event/request clock round trip, old R5 compatibility and overlapping-request reaction rejection.");
