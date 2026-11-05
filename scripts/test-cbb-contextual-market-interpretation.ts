import assert from "node:assert/strict";
import { buildCbbContextualMarketInterpretation, cbbPartialEconomicChange } from "../lib/cbb/contextualMarketInterpretation";
import type { CbbContextualFeatureInput, CbbContextualQuote } from "../lib/cbb/contextualForecastFeatures";
import type { CbbDecisionSplitContext } from "../lib/cbb/decisionSplitContext";
const time = (minute: number) => `2026-11-05T21:${String(minute).padStart(2, "0")}:00Z`;
const quote = (minute: number, firstPrice: number, extra: Partial<CbbContextualQuote> = {}): CbbContextualQuote => ({ gameId: 1, sportsbook: "circa", market: "moneyline", line: null, firstPrice, secondPrice: firstPrice === -110 ? -110 : 100, providerObservedAt: time(minute), fetchedAt: time(minute + 1), requestedAt:time(minute+1), phase: "current", orientationVerified: true, provider: "owls", sourceEventId: "fixture:1", ...extra });
const pressure = (extra: Partial<CbbDecisionSplitContext> = {}): CbbDecisionSplitContext => ({ gameId: 1, market: "moneyline", sourceBook: "circa", physicalFamily: "circa", sourceClass: "professional_adjacent_named_book", provider: "owls", sourceEventId: "fixture:1", line: null, firstMoney: .8, secondMoney: .2, firstTickets: .55, secondTickets: .45, observedAt: time(20), availableBy: time(21), receiptEarliest: time(21), clockBasis: "verified_provider_observation", observationIds: [], ...extra });
const input = (quotes: CbbContextualQuote[], splits: CbbDecisionSplitContext[] = []): CbbContextualFeatureInput => ({ independent: { gameId: 1, asOf: time(0), release: "test", inputStatus: "complete", margin: 2, total: 150 }, asOf: time(59), startsAt: "2026-11-05T23:00:00Z", currentQuotes: quotes.slice(-1), historyQuotes: quotes.slice(0, -1), splitContext: splits });
const stream = (i: CbbContextualFeatureInput) => buildCbbContextualMarketInterpretation(i).streams.find(s => s.book === "circa" && s.market === "moneyline")!;
const q0 = quote(10, -110), q1 = quote(30, -160), q2 = quote(40, -130);
const original = input([q0, q1, q2], [pressure()]), bytes = JSON.stringify(original), buyback = stream(original);
assert.equal(buyback.net?.direction, 1);
assert.equal(buyback.latest?.direction, -1);
assert.equal(buyback.pathResolution, "buyback");
assert.equal(buyback.pressureResponses[0].relation, "toward_composition");
assert.equal(buyback.pressureResponses[0].laterReversal, true);
assert.equal(buyback.pressureResponses[0].latest?.direction, -1);
assert.equal(JSON.stringify(original), bytes, "factual interpretation cannot mutate raw/stored inputs");
const resumption = stream(input([q0, q1, q2, quote(50, -180)]));
assert.equal(resumption.pathResolution, "resumption");
const held = stream(input([q0, quote(30, -110)], [pressure()]));
assert.equal(held.pressureResponses[0].relation, "held_observed");
assert.equal(held.latestObservation, "later_native_unchanged_price");
const against = stream(input([quote(10, -150), quote(30, -110)], [pressure()]));
assert.equal(against.pressureResponses[0].relation, "against_composition");
const reread = stream(input([q0, { ...q0, fetchedAt: time(40) }], [pressure()]));
assert.equal(reread.latestObservation, "fresh_receipt_same_native_state");
assert.equal(reread.pressureResponses[0].relation, "unknown");
assert.match(reread.pressureResponses[0].reason, /reread_is_not_response/);
assert.equal(reread.quotes.length, 1);
assert.equal(cbbPartialEconomicChange("spread", { line: -3, logit: 0 }, { line: -4, logit: -.1 }).direction, null);
assert.equal(cbbPartialEconomicChange("spread", { line: -3, logit: 0 }, { line: -4, logit: .1 }).direction, 1);
assert.equal(cbbPartialEconomicChange("total", { line: 150, logit: 0 }, { line: 151, logit: .1 }).direction, 1);
const bound = stream(input([{ ...q0, sourceEventId: undefined }, { ...q1, sourceEventId: undefined }], [pressure()]));
assert.equal(bound.continuity, "independently_fixture_bound");
assert.equal(bound.pressureResponses[0].continuity, "independently_fixture_bound");
assert.equal(bound.pressureResponses[0].relation, "toward_composition");
const conflict = stream(input([q0, { ...q1, sourceEventId: "different:known:fixture" }], [pressure()]));
assert.equal(conflict.coverage.interrupted, true);
assert.equal(conflict.currentQuote?.eventId, "different:known:fixture", "independent newer current quote survives historic identity interruption");
assert.equal(conflict.net, null);
assert.equal(conflict.pressureResponses[0].relation, "unknown");
const pConflict = stream(input([q0, q1], [pressure({ sourceEventId: "different:pressure:fixture" })]));
assert.equal(pConflict.pressureResponses[0].continuity, "conflict");
assert.equal(pConflict.continuity, "exact_native", "pressure conflict does not erase independent current quote evidence");
const repeatedPressure = stream(input([q0, q1], [pressure(), pressure({ availableBy: time(50) })]));
assert.equal(repeatedPressure.pressures.length, 1);
assert.equal(repeatedPressure.pressures[0].composition, "cumulative_share_not_money_flow");
assert.deepEqual(repeatedPressure.pressures[0].observedAgainAt, [time(50)]);
const publicInput = input([q0, q1], [pressure({ sourceBook: "consensus", physicalFamily: "consensus", sourceClass: "multi_book_consensus", observedAt: null, clockBasis: "capture_upper_bound" })]);
const pub = buildCbbContextualMarketInterpretation(publicInput).streams.find(s => s.role === "public_context")!;
assert.equal(pub.pressureResponses[0].relation, "unknown");
assert.equal(pub.pressureResponses[0].baseline, null);
const retail = buildCbbContextualMarketInterpretation(input([quote(10, -110, { sportsbook: "draftkings" }), quote(30, -130, { sportsbook: "draftkings" })], [pressure({ sourceBook: "draftkings_network", physicalFamily: "draftkings", sourceClass: "retail_network", observedAt: null, clockBasis: "capture_upper_bound" })]));
assert.ok(retail.streams.some(s => s.book === "draftkings" && s.role === "consumer"));
assert.ok(retail.streams.some(s => s.book === "draftkings" && s.role === "retail_context"));
const spread0 = quote(10, -110, { market: "spread", line: -4.5, secondPrice: -110 }), spread1 = quote(40, -110, { market: "spread", line: -3.5, secondPrice: -110 });
const middle = buildCbbContextualMarketInterpretation({ ...input([]), historyQuotes: [q0, spread0], currentQuotes: [q1, spread1] });
const cross = middle.crossMarket[0];
assert.equal(cross.netRelation, "opposed");
assert.deepEqual(cross.favoriteWinUnderdogCover, { favorite: "home", homeMarginLowerExclusive: 0, homeMarginUpperExclusive: 3.5, minimumIntegerHomeMargin: 1, maximumIntegerHomeMargin: 3 });
const noIntegerMiddle = buildCbbContextualMarketInterpretation({ ...input([]), currentQuotes: [q1, { ...spread1, line: -.5 }] }).crossMarket[0];
assert.equal(noIntegerMiddle.favoriteWinUnderdogCover, null);
const late = stream({ ...input([q0, q1]), currentQuotes: [{ ...q2, fetchedAt: "2026-11-05T22:01:00Z" }] });
assert.equal(late.quotes.length, 1, "after-cutoff quote is rejected rather than rejuvenating availability");
assert.ok(buildCbbContextualMarketInterpretation({ ...input([q0]), currentQuotes: [{ ...q0, orientationVerified: false }] }).rejected.length > 0);
const swapped = [q0, q1, q2].map(q => ({ ...q, firstPrice: q.secondPrice, secondPrice: q.firstPrice }));
const mirrored = stream(input(swapped, [pressure({ firstMoney: .2, secondMoney: .8, firstTickets: .45, secondTickets: .55 })]));
assert.equal(mirrored.net?.direction, -buyback.net!.direction!);
assert.equal(mirrored.latest?.direction, -buyback.latest!.direction!);
assert.equal(mirrored.pressureResponses[0].relation, buyback.pressureResponses[0].relation);


// Net cancellation is not a hold; a later different composition retires the
// original episode without deleting its proved historical response.
const cancelled = stream(input([q0, q1, quote(40, -110)], [pressure()]));
assert.equal(cancelled.pressureResponses[0].relation, "returned_to_baseline");
assert.equal(cancelled.pressureResponses[0].hadActualMove, true);
assert.equal(cancelled.pressureResponses[0].laterReversal, true);
const changedPressure = pressure({ observedAt: time(35), availableBy: time(36), receiptEarliest: time(36), firstMoney: .2, secondMoney: .8 });
const retired = stream(input([q0, q1, q2], [pressure(), changedPressure]));
assert.equal(retired.pressureResponses[0].response?.nativeAt, q1.providerObservedAt);
assert.equal(retired.pressureResponses[0].laterPressureChanged, true);
assert.equal(retired.pressureResponses[0].activeCurrent, false);
assert.equal(retired.pressureResponses[0].responseIsCurrent, false);
assert.equal(retired.pressureResponses[1].activeCurrent, true);
assert.equal(retired.pressureResponses[1].relation, "toward_composition");
assert.deepEqual(buyback.chronology.nativeSequence.map(row => row.kind), ["quote", "pressure", "quote", "quote"]);
const sameClockAmbiguity = stream(input([q0, q1], [pressure(), pressure({ firstMoney: .2, secondMoney: .8 })]));
assert.equal(sameClockAmbiguity.pressureResponses[0].activeCurrent, false);
assert.equal(sameClockAmbiguity.pressureResponses[0].relation, "unknown");
// Same-cycle availability bounds establish no response order.
const concurrent = stream(input([q0, { ...q1, fetchedAt: time(20) }], [pressure()]));
assert.equal(concurrent.pressureResponses[0].relation, "unknown");
const captureOnly = stream(input([q0, q1], [pressure({ observedAt: null, clockBasis: "capture_upper_bound" })]));
assert.equal(captureOnly.pressureResponses[0].activeCurrent, false);

const canonical = { kind: "db_inserted_upper_bound" as const, availableBy: time(31), providerEventId: "fixture:1", ingestionRunId: "test:run", observationIds: [1, 2] as [number, number], rawPayloadHashes: ["a".repeat(64), "b".repeat(64)] as [string, string] };
const wide = { ...q1, fetchedAt: time(19), canonicalReceipt: canonical };
const direct = { ...q1, fetchedAt: time(31) };
const equalUpper1 = stream(input([q0, wide, direct], [pressure()]));
const equalUpper2 = stream(input([q0, direct, wide], [pressure()]));
assert.equal(equalUpper1.pressureResponses[0].relation, "toward_composition");
assert.deepEqual(equalUpper1.pressureResponses, equalUpper2.pressureResponses, "whole receipt preference must be input-order independent");
const contradictory = { ...q1, sourceEventId: "known:wrong", canonicalReceipt: canonical };
const internalConflict = stream(input([q0, direct, contradictory], [pressure()]));
assert.equal(internalConflict.currentQuote, null, "a rejected internally contradictory native-ID channel remains an ambiguity sentinel");
assert.equal(internalConflict.continuity, "conflict");
const nullReceipt = { ...q1, canonicalReceipt: null } as unknown as CbbContextualQuote;
assert.ok(buildCbbContextualMarketInterpretation(input([nullReceipt])).rejected.length > 0);
assert.equal(buildCbbContextualMarketInterpretation(input([quote(30, 900, { secondPrice: 900 })])).streams[0].currentQuote, null, "incoherent paired hold cannot become a current source");
const consumerInvalid: CbbContextualFeatureInput = { ...input([]), consumerCurrentQuotes: [{ gameId: 1, sportsbook: "draftkings", market: "moneyline", line: null, firstPrice: -110, secondPrice: -110, providerObservedAt: time(30), fetchedAt: time(20), availableBy: time(35), availabilityKind: "http_response", orientationProof: "native_home_away_fields" }] };
assert.equal(buildCbbContextualMarketInterpretation(consumerInvalid).streams[0].currentQuote, null);

// Actual retained Merrimack fixture tuple already used by feature-contract tests:
// older quarantined history cannot erase its independently attested current pair.
const merrimackQuote: CbbContextualQuote = { gameId: 10882480, provider: "owls", sportsbook: "circa", market: "moneyline", line: null,
  firstPrice: 145, secondPrice: -165, providerObservedAt: "2026-11-02T09:20:02.29+00:00", fetchedAt: "2026-11-02T09:20:46.706+00:00",
  phase: "current", orientationVerified: true, canonicalReceipt: { kind: "db_inserted_upper_bound", availableBy: "2026-11-02T09:20:53.416513+00:00",
    providerEventId: "ncaab:Merrimack@App State-20261102", ingestionRunId: "cbb:2026-11-02:2026-11-02T09:20:46.706Z", observationIds: [5983697, 5983696],
    rawPayloadHashes: ["60baefa356e473151d597bc417e80d95fe498448e3d23bda4d3b0c56ef898e35", "6179b7437dedb7abc4a88c6c6a85b0a63dc4eb84b35ec7616ebd9a21658d7150"] } };
const merrimack: CbbContextualFeatureInput = { independent: { gameId: 10882480, asOf: "2026-11-02T09:47:35.044Z", release: "fixture", inputStatus: "complete", margin: 0, total: 150 },
  asOf: "2026-11-02T09:47:35.044Z", startsAt: "2026-11-02T18:00:00Z", currentQuotes: [merrimackQuote], pathTape: {
    release: "cbb_market_behavior_path_2026_11_04_r5_retained_response_frontier", gameId: 10882480, startsAt: "2026-11-02T18:00:00Z", capturedAt: "2026-11-02T09:47:35.044Z",
    streams: [{ book: "circa", market: "moneyline", quotes: [], flows: [], flowEventIds: [], quarantined: true, quarantinedSourceTimes: ["2026-11-01T17:52:41.737+00:00"], truncatedBefore: "2026-11-01T21:14:51.997+00:00", flowTruncatedBefore: null }] } };
const recovered = buildCbbContextualMarketInterpretation(merrimack).streams[0];
assert.deepEqual(recovered.currentQuote?.rawQuote, merrimackQuote);
assert.equal(recovered.coverage.interrupted, true);
assert.equal(recovered.coverage.truncated, true);
assert.equal(recovered.net, null);
assert.equal(buildCbbContextualMarketInterpretation({ ...merrimack, currentQuotes: [merrimackQuote, { ...merrimackQuote, firstPrice: 146 }] }).streams[0].currentQuote, null);


// Named native ticket-only composition belongs to that physical retail book.
// It can bind its own observed prices without inventing missing money shares.
const mgmQuotes=[quote(10,-110,{sportsbook:"betmgm",market:"spread",line:-3,secondPrice:-110}),quote(30,-110,{sportsbook:"betmgm",market:"spread",line:-4,secondPrice:-110})];
const mgmTickets=pressure({sourceBook:"BetMGM",physicalFamily:"betmgm",sourceClass:"retail_ticket_share",market:"spread",line:-3,firstMoney:null,secondMoney:null,firstTickets:.8,secondTickets:.2});
const mgmReceipt=buildCbbContextualMarketInterpretation(input(mgmQuotes,[mgmTickets]));
const mgm=mgmReceipt.streams.find(s=>s.book==="betmgm"&&s.role==="consumer")!;
assert.equal(mgm.pressureResponses[0].continuity,"exact_native");
assert.equal(mgm.pressureResponses[0].activeCurrent,true);
assert.equal(mgm.pressureResponses[0].direction,1);
assert.equal(mgm.pressureResponses[0].pressure.moneyBalance,null);
assert.ok(mgm.pressureResponses[0].pressure.ticketBalance!>0);
assert.equal(mgm.pressureResponses[0].relation,"unknown","ticket-only shares must not be labeled toward/against missing money");
assert.equal(mgmReceipt.streams.some(s=>s.book==="betmgm"&&s.role==="retail_context"),false);
// A network publication cannot borrow genuine MGM same-book/native-clock proof,
// even when its percentages, line and event labels happen to be identical.
const networkTickets={...mgmTickets,sourceClass:"retail_network" as const};
const networkReceipt=buildCbbContextualMarketInterpretation(input(mgmQuotes,[networkTickets]));
const mgmNetwork=networkReceipt.streams.find(s=>s.book==="betmgm"&&s.role==="retail_context")!;
assert.equal(mgmNetwork.pressureResponses[0].relation,"unknown");
assert.equal(mgmNetwork.pressureResponses[0].baseline,null);
assert.equal(mgmNetwork.pressureResponses[0].activeCurrent,false);
assert.equal(networkReceipt.streams.find(s=>s.book==="betmgm"&&s.role==="consumer")!.pressureResponses.length,0);
const unspecifiedTicketSource=buildCbbContextualMarketInterpretation(input(mgmQuotes,[{...mgmTickets,sourceBook:"unspecified_network"}])).streams.find(s=>s.role==="retail_context")!;
assert.equal(unspecifiedTicketSource.pressureResponses[0].activeCurrent,false);
console.log("CBB contextual market interpretation tests passed");

// Provider IDs occupy their own namespace; the physical book and fixture remain fixed.
const crossProvider=stream(input([q0,{...q1,provider:"balldontlie",sourceEventId:"bdl-other-id"}],[pressure()]));
assert.equal(crossProvider.continuity,"independently_fixture_bound");assert.notEqual(crossProvider.pressureResponses[0].continuity,"conflict");assert.equal(crossProvider.pressures[0].provider,"owls");
const sameProvider=stream(input([q0,{...q1,sourceEventId:"owls-other-id"}]));assert.equal(sameProvider.legs.length,0,"Known same-provider transition cannot be bridged");
const endpoint={...q0,knownBy:q0.fetchedAt};const endpointInput={...input([q1]),sourceBaselineQuotes:[endpoint]};const endpointRead=stream(endpointInput);
assert.equal(endpointRead.baselineNet?.continuity,"exact_native");assert.equal(endpointRead.baselineNet?.historyGap,true);assert.equal(endpointRead.legs.length,0,"Endpoint never invents the missing middle leg");assert.equal(endpointRead.pressureResponses.length,0);
assert.equal(stream({...endpointInput,sourceBaselineQuotes:[{...endpoint,sourceEventId:"wrong"}]}).baselineNet,null);assert.notEqual(stream({...endpointInput,sourceBaselineQuotes:[{...endpoint,sourceEventId:"wrong"}]}).currentQuote,null,"Endpoint identity conflict cannot erase valid current");
assert.equal(stream({...endpointInput,sourceBaselineQuotes:[{...endpoint,provider:"balldontlie",sourceEventId:"provider-own-id"}]}).baselineNet?.continuity,"independently_fixture_bound");
assert.equal(stream({...endpointInput,sourceBaselineQuotes:[{...endpoint,knownBy:"2026-11-06T00:00:00Z"}]}).baselineNet,null,"Future knowledge is unavailable");
const micro={...endpoint,providerObservedAt:"2026-11-05T17:00:00.000123Z",fetchedAt:"2026-11-05T17:01:00.000987Z",knownBy:"2026-11-05T17:01:00.000987Z"};assert.equal(stream({...endpointInput,sourceBaselineQuotes:[micro]}).baselineNet?.baseline.availableBy,micro.fetchedAt,"Original microsecond availability survives interpretation");

// R38 quote-owned identities and request/completion bounds. The Odds API
// supplies prices, not a fabricated split or flow record.
const oddsQuote=(minute:number,price:number,extra:Partial<CbbContextualQuote>={})=>quote(minute,price,{sportsbook:"pinnacle",provider:"the_odds_api",sourceEventId:undefined,providerEventId:"odds:fixture:1",...extra});
const findBook=(i:CbbContextualFeatureInput,book="pinnacle")=>buildCbbContextualMarketInterpretation(i).streams.find(s=>s.book===book&&s.market==="moneyline")!;
const odds= findBook(input([oddsQuote(10,-110),oddsQuote(30,-130)]));
assert.equal(odds.currentQuote?.eventId,"odds:fixture:1");assert.equal(odds.continuity,"exact_native");
assert.equal(odds.currentQuote?.rawQuote.providerEventId,"odds:fixture:1");assert.equal(odds.pressures.length,0,"A quote-owned native ID never creates a money flow");
const twoChannels=oddsQuote(30,-130,{sourceEventId:"odds:fixture:1"});assert.equal(findBook(input([twoChannels])).currentQuote?.eventId,"odds:fixture:1");
const directIdConflict=findBook(input([oddsQuote(30,-130),{...twoChannels,sourceEventId:"other:known:fixture"}]));
assert.equal(directIdConflict.currentQuote,null);assert.equal(directIdConflict.continuity,"conflict","An internally conflicting second ID channel cannot disappear behind a clean quote");
const canonicalIdConflict=findBook(input([{...twoChannels,canonicalReceipt:{...canonical,providerEventId:"other:canonical:fixture"}}]));assert.equal(canonicalIdConflict.currentQuote,null);
const differentNamespaces=findBook(input([oddsQuote(30,-130),quote(30,-130,{sportsbook:"pinnacle"})]));assert.equal(differentNamespaces.continuity,"independently_fixture_bound");assert.notEqual(differentNamespaces.currentQuote,null);
assert.equal(findBook({...input([oddsQuote(30,-130)]),sourceBaselineQuotes:[{...oddsQuote(10,-110),knownBy:time(11)}]}).baselineNet?.continuity,"exact_native");
assert.equal(findBook({...input([oddsQuote(30,-130)]),sourceBaselineQuotes:[{...oddsQuote(10,-110,{providerEventId:"other:known:fixture"}),knownBy:time(11)}]}).baselineNet,null);
const noBorrow=stream(input([quote(10,-110,{sourceEventId:undefined}),quote(30,-130,{sourceEventId:undefined})],[pressure()]));assert.equal(noBorrow.currentQuote?.eventId,null,"A split ID cannot fill an absent quote ID");

const inFlight=stream(input([q0,quote(30,-130,{requestedAt:time(15)})],[pressure()]));
assert.equal(inFlight.currentQuote?.receiptEarliest,time(15));assert.equal(inFlight.currentQuote?.availableBy,time(31));assert.equal(inFlight.currentQuote?.firstPrice,-130);
assert.equal(inFlight.pressureResponses[0].relation,"unknown","A request in flight before pressure availability is not a subsequent book response");
for(const requestedAt of [undefined,"not-a-clock",time(32),""]){const unknownLower=stream(input([q0,quote(30,-130,{requestedAt})],[pressure()]));assert.equal(unknownLower.currentQuote?.receiptEarliest,null);assert.equal(unknownLower.currentQuote?.availableBy,time(31));assert.equal(unknownLower.pressures[0].moneyBalance,.8-.2);assert.equal(unknownLower.pressureResponses[0].relation,"unknown");}
const malformedPressureLower=stream(input([q0,q1],[pressure({receiptEarliest:"not-a-clock"})]));assert.equal(malformedPressureLower.pressures[0].moneyBalance,.8-.2);assert.equal(malformedPressureLower.pressures[0].receiptEarliest,null,"Unknown pressure lower does not erase its available composition");
const canonicalLegacy=stream(input([q0,quote(30,-130,{requestedAt:undefined,fetchedAt:time(22),canonicalReceipt:{...canonical,availableBy:time(35)}})],[pressure()]));
assert.equal(canonicalLegacy.currentQuote?.receiptEarliest,time(22));assert.equal(canonicalLegacy.currentQuote?.availableBy,time(35));assert.equal(canonicalLegacy.pressureResponses[0].relation,"toward_composition","Legacy professional Owls canonical fetchedAt is a collector lower, not completion");

const consumerPair=(minute:number,price:number,extra:Partial<NonNullable<CbbContextualFeatureInput["consumerCurrentQuotes"]>[number]>={}):NonNullable<CbbContextualFeatureInput["consumerCurrentQuotes"]>[number]=>({gameId:1,sportsbook:"betmgm",market:"moneyline",line:null,firstPrice:price,secondPrice:price===-110?-110:100,provider:"the_odds_api",providerEventId:"odds:fixture:1",providerObservedAt:time(minute),fetchedAt:time(minute+1),requestedAt:time(minute+1),availableBy:time(minute+1),availabilityKind:"http_response",orientationProof:"named_fixture_attested",...extra});
const consumerRead=(q:ReturnType<typeof consumerPair>)=>findBook({...input([],[pressure({sourceBook:"betmgm",physicalFamily:"betmgm",sourceClass:"retail_named_book"})]),consumerHistoryQuotes:[consumerPair(10,-110)],consumerCurrentQuotes:[q]},"betmgm");
const consumerFlight=consumerRead(consumerPair(30,-130,{requestedAt:time(15)}));assert.equal(consumerFlight.currentQuote?.receiptEarliest,time(15));assert.equal(consumerFlight.currentQuote?.availableBy,time(31));assert.equal(consumerFlight.pressureResponses[0].relation,"unknown");
const consumerUnknown=consumerRead(consumerPair(30,-130,{requestedAt:"bad-request"}));assert.equal(consumerUnknown.currentQuote?.eventId,"odds:fixture:1");assert.equal(consumerUnknown.currentQuote?.receiptEarliest,null);assert.equal(consumerUnknown.pressureResponses[0].relation,"unknown");
const consumerDb=consumerPair(30,-130,{provider:"owls",sourceEventId:"fixture:1",providerEventId:undefined,requestedAt:undefined,availableBy:time(35),availabilityKind:"db_inserted_upper_bound",canonicalReceipt:{...canonical,availableBy:time(35)}});
assert.equal(consumerRead(consumerDb).currentQuote?.receiptEarliest,null,"Consumer canonical fetchedAt is completion; without a real collection start it cannot supply a causal lower");
const consumerCollection=consumerRead({...consumerDb,canonicalReceipt:{...consumerDb.canonicalReceipt!,collectionStartedAt:time(15)}});assert.equal(consumerCollection.currentQuote?.receiptEarliest,time(15));assert.equal(consumerCollection.pressureResponses[0].relation,"unknown");
assert.equal(consumerRead({...consumerDb,canonicalReceipt:{...consumerDb.canonicalReceipt!,collectionStartedAt:time(22)}}).pressureResponses[0].relation,"toward_composition");
const badCollection=consumerRead({...consumerDb,canonicalReceipt:{...consumerDb.canonicalReceipt!,collectionStartedAt:time(32)}});assert.equal(badCollection.currentQuote?.receiptEarliest,null);assert.equal(badCollection.currentQuote?.availableBy,time(35));

const microPressure=pressure({availableBy:"2026-11-05T21:21:00.000200Z",receiptEarliest:"2026-11-05T21:21:00.000200Z"});
const microRequest=quote(30,-130,{requestedAt:"2026-11-05T21:21:00.000100Z"});assert.equal(stream(input([q0,microRequest],[microPressure])).pressureResponses[0].relation,"unknown","Sub-ms in-flight request cannot be rounded after pressure availability");
assert.equal(stream(input([q0,{...microRequest,requestedAt:"2026-11-05T21:21:00.000300Z"}],[microPressure])).pressureResponses[0].relation,"toward_composition");
const exactCompletion=quote(30,-130,{providerObservedAt:"2026-11-05T21:30:00.000100Z",requestedAt:"2026-11-05T21:30:00.000000Z",fetchedAt:"2026-11-05T21:30:00.000900Z"});assert.equal(stream(input([exactCompletion])).currentQuote?.availableBy,exactCompletion.fetchedAt);
assert.equal(stream(input([{...exactCompletion,providerObservedAt:"2026-11-05T21:30:00.000900Z",fetchedAt:"2026-11-05T21:30:00.000100Z"}])).currentQuote,null,"Native-after-completion is rejected at original clock precision");
const closeLeg=stream(input([{...exactCompletion,firstPrice:-110,secondPrice:-110},{...exactCompletion,providerObservedAt:"2026-11-05T21:30:00.000200Z"}]));assert.equal(closeLeg.quotes.length,2);assert.equal(closeLeg.legs.length,1,"Distinct sub-ms native moves are not a same-clock conflict");
console.log("PASS provider receipt contract: quote-owned channels, provider namespaces, request/availability separation, consumer collection start, unknown lower retention and precise in-flight controls");
const equivalentClock=stream(input([q0,{...q0,providerObservedAt:q0.providerObservedAt.replace("Z","+00:00"),fetchedAt:q0.fetchedAt.replace("Z","+00:00")} ]));assert.equal(equivalentClock.quotes.length,1);assert.equal(equivalentClock.quotes[0].observedAgainAt.length,0,"Equivalent UTC formatting is not a fresh transport reread");
const conflictingRequest=consumerRead({...consumerDb,requestedAt:"bad-request",canonicalReceipt:{...consumerDb.canonicalReceipt!,collectionStartedAt:time(22)}});assert.equal(conflictingRequest.currentQuote?.receiptEarliest,null,"An explicit malformed request cannot be repaired by borrowing another lower channel");assert.equal(conflictingRequest.currentQuote?.availableBy,time(35));
