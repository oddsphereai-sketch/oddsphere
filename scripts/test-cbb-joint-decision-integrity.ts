import assert from "node:assert/strict";
import {readCbbMarketBehavior,CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE} from "../lib/cbb/marketBehaviorCandidate";
import {CBB_CURRENT_SCORE_RELEASE} from "../lib/cbb/currentScoreRuntime";
import {normalCdf} from "../lib/cbb/model";
import type {CbbForecast,CbbQuote} from "../lib/cbb/types";

const asOf="2026-11-03T18:30:00Z",startsAt="2026-11-03T23:00:00Z";
function forecast(margin:number):CbbForecast{
 const total=150,marginSd=11,zero=normalCdf((.5-margin)/marginSd)-normalCdf((-.5-margin)/marginSd);
 return {release:CBB_CURRENT_SCORE_RELEASE,gameId:1,asOf,homeId:1,awayId:2,
  margin,total,homeScore:(total+margin)/2,awayScore:(total-margin)/2,possessions:70,
  homeWinProbability:(1-normalCdf((.5-margin)/marginSd))/(1-zero),inputStatus:"complete",issues:[],
  uncertainty:{marginSd,totalSd:16,marginTotalCorrelation:0,marginCorrection:0,totalCorrection:0,fitThroughSeason:2025,games:1000}};
}
function quote(book:string,market:"spread"|"moneyline",line:number|null,firstPrice:number,secondPrice:number,time:string):CbbQuote{
 return {gameId:1,market,line,firstPrice,secondPrice,sportsbook:book,provider:"owls",phase:"current",
  providerObservedAt:`2026-11-03T${time}:00Z`,fetchedAt:`2026-11-03T${time}:30Z`,
  ...{orientationVerified:true}};
}
const spread=(book:string,center:number,time:string)=>quote(book,"spread",-center,-110,-110,time);
const target=spread("fanduel",4.5,"18:24");
function read(base:CbbForecast,current:CbbQuote[],originals:CbbQuote[]=[],extra:Partial<Parameters<typeof readCbbMarketBehavior>[0]>={}){
 return readCbbMarketBehavior({independent:base,independentInputKey:"integrity-fixture",startsAt,targets:[target],
  currentQuotes:[...current,target],anchors:originals.length?{release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,
   gameId:1,startsAt,independentRelease:base.release,independentInputKey:"integrity-fixture",
   capturedAt:"2026-11-03T18:01:00Z",quotes:originals}:null,...extra});
}

// A failed joint law must not quietly fall back to the old spread-only
// correction that ignored this current moneyline in the first place.
const inconsistent=read(forecast(4),[
 spread("circa",5.5,"18:20"),quote("circa","moneyline",null,150,-170,"18:20"),
],[spread("circa",3.5,"18:00")]);
assert.equal(inconsistent.receipt.jointMarginDecision?.status,"unresolved");
assert.equal(inconsistent.receipt.jointMarginDecision?.candidates[0].reason,"native_contract_probability_ordering_conflict");
assert.equal(inconsistent.receipt.margin.status,"unresolved");
assert.equal(inconsistent.receipt.margin.delta,0);
assert.equal(inconsistent.forecast.margin,4,"inconsistent ML/spread cannot leave an old spread-only correction applied");
assert.equal(inconsistent.forecast.uncertainty.marginSd,11);

// Both contracts are individually fresh, but their separate captures do not
// attest that they coexisted as one current physical-book joint state.
const olderMoneyline=quote("circa","moneyline",null,-200,170,"17:35"),newerSpread=spread("circa",5.5,"18:20");
const mixed=read(forecast(4),[olderMoneyline,newerSpread]);
assert.equal(mixed.receipt.jointMarginDecision?.status,"unresolved");
assert.equal(mixed.receipt.jointMarginDecision?.candidates[0].reason,"native_joint_state_frame_not_attested");
assert.equal(mixed.forecast.margin,4);assert.equal(mixed.forecast.uncertainty.marginSd,11);
// A genuine shared current response can attest both still-current contracts
// even when the sportsbook last changed their prices at different times.
const recaptured=read(forecast(4),[
 {...olderMoneyline,fetchedAt:"2026-11-03T18:21:00Z"},
 {...newerSpread,fetchedAt:"2026-11-03T18:21:00Z"},
]);
assert.equal(recaptured.receipt.jointMarginDecision?.status,"applied");
assert.ok(recaptured.forecast.margin>0);assert.ok(Math.abs(recaptured.forecast.uncertainty.marginSd-11)>1);

// Equal movement direction does not establish equal current winner stance.
// Pinnacle's later move toward HOME still leaves it on AWAY, opposite Circa.
const opposed=read(forecast(0),[spread("circa",4.5,"18:20"),spread("pinnacle",-4.5,"18:25")],
 [spread("circa",3.5,"18:00"),spread("pinnacle",-5.5,"18:00")]);
assert.equal(opposed.receipt.jointMarginDecision?.status,"unresolved");
assert.equal(opposed.receipt.jointMarginDecision?.reason,"current_professional_winner_opposition");
assert.equal(opposed.forecast.margin,0,"newest repricing alone cannot discard a fresh opposite current winner");
assert.equal(opposed.receipt.margin.delta,0);

// First capture still supports a correction when complete current native
// books agree on the winner but disagree on the precise numerical law.
const consensus=read(forecast(-3),[
 quote("circa","moneyline",null,-150,130,"18:20"),spread("circa",3.5,"18:20"),
 quote("pinnacle","moneyline",null,-160,140,"18:20"),spread("pinnacle",4,"18:20"),
]);
assert.equal(consensus.receipt.jointMarginDecision?.status,"applied");
assert.equal(consensus.receipt.jointMarginDecision?.authority?.reason,"current_native_source_preference");
assert.equal(consensus.receipt.jointMarginDecision?.sourceBook,"circa");
assert.ok(consensus.forecast.margin>0,"a fallible independent away winner can flip without a historical episode");
assert.equal(consensus.forecast.margin,consensus.receipt.jointMarginDecision?.candidates.find(c=>c.book==="circa")?.margin,
 "apply one whole native source law rather than average sources or retain the old winner");
assert.ok(Math.abs(consensus.forecast.homeScore-consensus.forecast.awayScore-consensus.forecast.margin)<1e-8);
assert.ok(Math.abs(consensus.forecast.homeScore+consensus.forecast.awayScore-consensus.forecast.total)<1e-8);

// A static peer has a valid current law, but no moving onset. It cannot
// erase another source's genuine response and force the book-name default.
const partialOriginals=[
 quote("circa","moneyline",null,-150,130,"18:00"),spread("circa",3.5,"18:00"),
 quote("pinnacle","moneyline",null,-150,130,"18:00"),spread("pinnacle",3.5,"18:00"),
];
const partialCurrent=[
 quote("circa","moneyline",null,-150,130,"18:20"),spread("circa",3.5,"18:20"),
 quote("pinnacle","moneyline",null,-170,145,"18:25"),spread("pinnacle",4.5,"18:25"),
];
const partialRepricing=read(forecast(-3),partialCurrent,partialOriginals);
assert.equal(partialRepricing.receipt.jointMarginDecision?.sourceBook,"pinnacle");
assert.equal(partialRepricing.receipt.jointMarginDecision?.authority?.reason,"latest_observed_repricing");
const partialResponse=read(forecast(-3),partialCurrent,partialOriginals,{splitContext:[{
 gameId:1,market:"spread",sourceBook:"pinnacle",physicalFamily:"pinnacle",sourceClass:"professional_adjacent_named_book",provider:"owls",
 sourceEventId:"native-fixture-1",line:-3.5,firstMoney:.8,secondMoney:.2,firstTickets:.6,secondTickets:.4,
 observedAt:"2026-11-03T18:10:00Z",availableBy:"2026-11-03T18:11:00Z",receiptEarliest:"2026-11-03T18:11:00Z",
 clockBasis:"verified_provider_observation",observationIds:[],
}]});
assert.equal(partialResponse.receipt.pressureDecisions.find(p=>p.book==="pinnacle")?.resolution,"ongoing");
assert.equal(partialResponse.receipt.jointMarginDecision?.sourceBook,"pinnacle");
assert.equal(partialResponse.receipt.jointMarginDecision?.authority?.reason,"qualified_source_response",
 "real native response precedes static source preference even when the peer has no moving onset");
assert.ok(partialResponse.forecast.margin>0);

// A rejected current ML lane still has retained price history. Joint source
// selection must only inspect lanes belonging to its eligible current law.
const withheldLane=read(forecast(-3),[
 quote("circa","moneyline",null,-200,170,"18:26"),spread("circa",4,"18:20"),
 quote("pinnacle","moneyline",null,-170,145,"18:25"),spread("pinnacle",4.5,"18:25"),
],partialOriginals,{currentSourceProblems:[{book:"circa",market:"moneyline",reason:"invalid_current_pair"}]});
assert.equal(withheldLane.receipt.jointMarginDecision?.sourceBook,"pinnacle");
assert.equal(withheldLane.receipt.jointMarginDecision?.candidates.find(c=>c.book==="circa")?.reason,"one_native_contract_independent_residual_shape");
assert.equal(withheldLane.receipt.currentProfessionalQuotes.some(q=>q.sportsbook==="circa"&&q.market==="moneyline"),false);
console.log("PASS CBB joint decision integrity: inconsistent-law no-fallback, shared state, winner opposition, static correction and partial-onset native authority");
