/** Exact future decision-pricing evidence; all laws/sources synthetic and offline. */
import assert from 'node:assert/strict';
import {PRODUCT_RELEASE,type GamePacket,type Quote} from '../lib/playerPropsAi/evidenceContract';
import {PROPS_AI_EXECUTION_EVIDENCE_RELEASE} from '../lib/playerPropsAi/publicationContract';
import {PROPS_AI_RELEASE,PROPS_AI_READER_CLAIMS_RELEASE} from '../lib/playerPropsAi/releases';
import {readerAvailabilityContextHash} from '../lib/playerPropsAi/readerClaimFreshness';
import {readerCanonicalContextHash,PROPS_AI_READER_CONTEXT_RELEASE} from '../lib/playerPropsAi/readerContext';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {validateLaw,lawForecast,type AcceptedPlayerLaw} from '../lib/playerPropsAi/law';
import {siteAiDecisions,type SiteAiDecision} from '../lib/playerPropsAi/publication';
import {executionQuotes,quoteContract} from '../lib/playerPropsAi/executionQuotes';
import {priceAiLaw} from '../lib/playerPropsAi/pricing';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import {applyNbaSiteAi,applyNflSiteAi,applyMlbSiteAi} from '../lib/playerPropsAi/siteBindings';
import {buildNbaPlayerPropsMemberSnapshot} from '../lib/services/nba/nbaPlayerPropsProductContract';
import {advanceNbaPlayerPropsCandidateLifecycle} from '../lib/services/nba/nbaPlayerPropsLifecycle';
import {reconcileNflPlayerPropsProductionSnapshot,buildNflPlayerPropsMemberSnapshot} from '../lib/services/football/nflPlayerPropsProductionContract';
import type {NflPlayerPropsRuntimeBoard} from '../lib/services/football/nflPlayerPropsRuntime';
import {qualifyNflSourceEvent} from '../lib/playerPropsAi/sourceEvents';
globalThis.fetch=async()=>{throw Error('Execution evidence proof forbids network');};

const at='2026-11-10T20:50:00Z',opposingAt='2026-11-10T20:49:30Z',start='2026-11-10T22:00:00Z',lock='2026-11-10T21:00:00Z';
const v=(n:number)=>Array<number>(16).fill(n),samples=(a:number,b:number,c:number)=>[a,b,c,...v(c).slice(3)];
function quotes(playerId:string,market:string,line:number,provider='feed-a',book='book-one'):Quote[]{
 return(['over','under'] as const).map(side=>({id:[playerId,market,line,provider,book,side].join(':'),playerId,market,line,provider,book,side,american:-110,
  observedAt:side==='under'?opposingAt:at,receivedAt:side==='under'?opposingAt:at,receivedAtProvenance:'provider_response',opening:false,live:false}));
}
function fixture(sport:GamePacket['sport'],markets:string[],lawValues:Record<string,number[]>,weights=[2,6,2,...v(0).slice(3)]){
 const id=sport==='nfl'?'nfl-bdl-player:1':'synthetic-player';
 const packet:GamePacket={release:PRODUCT_RELEASE,sport,gameId:'synthetic-game',start,lock,cutoff:at,stage:'final',sourceLimitations:[],players:[{id,name:'Synthetic Player',team:'BOS',opponent:'NYK',markets,missing:[],evidence:[]}],quotes:[]};
 const law=validateLaw(sport,packet.players[0],{weights,outcomes:lawValues});
 const review={release:PROPS_AI_RELEASE,gameId:'funded-synthetic',sourceGameId:packet.gameId,start,lock,cutoff:at,issuedAt:at,stage:'final',inputHash:'synthetic-source',inputEvidence:{digest:'synthetic-source'},model:'synthetic',partProvenance:[],criticalContextHashes:criticalContextHashes(packet),marketScopes:{[id]:markets},players:[{playerId:id,law,assessment:'Synthetic complete assessment.',confidence:markets.map(()=>2),exceptions:markets.map(()=>null),coverage:{},sourceReadProofs:{release:PROPS_AI_READER_CLAIMS_RELEASE,contextRelease:PROPS_AI_READER_CONTEXT_RELEASE,originalCriticalContextHash:criticalContextHashes(packet)[id],canonicalContextHash:readerCanonicalContextHash(packet,id),availabilityContextHash:readerAvailabilityContextHash(packet,id)}}]} as unknown as AcceptedGameReview;
 return{packet,review,law,id};
}
function replay(c:SiteAiDecision,law:AcceptedPlayerLaw){
 const proof=c.evidence.executionEvidence!;assert.equal(proof.release,PROPS_AI_EXECUTION_EVIDENCE_RELEASE);assert.equal(proof.pricedAt,at);
 assert.deepEqual(proof.selectedQuote,c.quote);
 const old=priceAiLaw({law,market:c.market,quotes:proof.pricingQuotes.map(q=>({id:q.id,book:q.book,provider:q.provider,line:q.line,side:q.side,american:q.american,availableAt:q.receivedAt,confirmedAt:q.receivedAt,current:true,actionRule:'qualifying_participation'})),now:proof.pricedAt,maxAgeMs:15*60000,confidence:c.evidence.confidence,exception:c.evidence.exception,milestone:quoteContract(c.quote)==='milestone'||c.market==='anytime_td'});
 assert(old);const f=lawForecast(law,c.market,c.line,quoteContract(c.quote)==='milestone'||c.market==='anytime_td');
 assert.deepEqual({side:c.side,grade:c.grade,probability:c.probability,american:c.american,expectedValue:c.expectedValue,fairAmerican:c.fairAmerican,projection:c.projection,over:c.over,under:c.under,push:c.push},
  {side:old.side,grade:old.grade,probability:old.probability,american:old.quote.american,expectedValue:old.expectedValue,fairAmerican:old.fairAmerican,projection:f.mean,over:f.over,under:f.under,push:f.push},'Optional evidence changes zero numerical, side, price or grade fields');
 assert.deepEqual(Object.keys(proof).sort(),['operation','pricedAt','pricingQuotes','release','selectedQuote'],'No inferred rules, timestamps or provider identity are added');
 return old;
}

// Several feeds/lines for the same book must retain their own exact complete
// pricing group. Current price eligibility still belongs to existing code.
const nba=fixture('nba',['points'],{points:[4,16,10,26,...v(10).slice(4)],rebounds:v(4),assists:v(3),threes:v(1)},[2,5,2,1,...v(0).slice(4)]);
nba.packet.quotes=[...quotes(nba.id,'points',10),...quotes(nba.id,'points',20),...quotes(nba.id,'points',10,'feed-b'),...quotes(nba.id,'points',10,'feed-a','book-two')];
nba.packet.quotes.push({...nba.packet.quotes[0],id:'old-quote',receivedAt:'2026-11-10T20:00:00Z',observedAt:'2026-11-10T20:00:00Z'},
 {...nba.packet.quotes[0],id:'opening',opening:true}, {...nba.packet.quotes[0],id:'live',live:true});
const nbaBefore=JSON.stringify(nba.packet),decisions=siteAiDecisions(nba.packet,nba.review,at);
assert.equal(decisions.length,4);assert(decisions.some(c=>c.side==='over'&&c.grade==='Best Angle'));assert(decisions.some(c=>c.side==='under'&&c.grade==='Best Angle'));
assert(decisions.some(c=>c.push===.2),'Integer push mass is retained exactly');
for(const c of decisions){
 replay(c,nba.law);
 const expected=executionQuotes(nba.packet,at).filter(q=>q.playerId===c.playerId&&q.market===c.market&&q.provider===c.provider&&q.book===c.book&&q.line===c.line&&quoteContract(q)===quoteContract(c.quote));
 assert.deepEqual(c.evidence.executionEvidence!.pricingQuotes,expected);assert.equal(expected.length,2);
 assert(c.evidence.executionEvidence!.pricingQuotes.every(q=>!['old-quote','opening','live'].includes(q.id)));
}
assert.equal(JSON.stringify(nba.packet),nbaBefore);

// Future NBA storage/locking keeps both exact feed quotes even when the familiar
// display ladder omits provider/receipt fields. No frontend format is changed.
const baseline=buildNbaPlayerPropsMemberSnapshot({mode:'private_forward_candidate',generatedAt:at,slateDate:'2026-11-10',games:[{gameId:nba.packet.gameId,scheduledStart:start,awayTeam:'BOS',homeTeam:'NYK'}],decisions:[],inputRows:nba.packet.quotes.length});
const applied=applyNbaSiteAi(baseline,nba.packet,decisions,at);
assert.equal(applied.decisions.length,1);
const storedNba=JSON.parse(JSON.stringify(advanceNbaPlayerPropsCandidateLifecycle({now:lock,previous:applied,candidate:applied}).snapshot));
assert.deepEqual(storedNba.decisions[0].aiReview.executionEvidence,applied.decisions[0].aiReview!.executionEvidence);
assert.equal(storedNba.decisions[0].aiReview.executionEvidence.pricingQuotes.length,2);
const oldNba=structuredClone(storedNba);delete oldNba.decisions[0].aiReview.executionEvidence;const oldNbaBytes=JSON.stringify(oldNba);
assert.strictEqual(applyNbaSiteAi(oldNba,nba.packet,decisions,at),oldNba);assert.equal(JSON.stringify(oldNba),oldNbaBytes);
assert(!('executionEvidence'in oldNba.decisions[0].aiReview),'Legacy lock never gains reconstructed execution evidence');

// NFL event-specific declarations are preserved with both exact receipt clocks.
const nfl=fixture('nfl',['interceptions'],{passing_attempts:v(30),passing_completions:v(20),passing_tds:v(1),interceptions:samples(0,1,2)});
nfl.packet.quotes=quotes(nfl.id,'interceptions',.5,'balldontlie');
for(const q of nfl.packet.quotes)q.sourceEvent=qualifyNflSourceEvent({market:q.market,provider:q.provider,providerMarket:'interceptions',rosterPosition:'QB',observationId:q.id});
const nflChoices=siteAiDecisions(nfl.packet,nfl.review,at);assert.equal(nflChoices.length,1);replay(nflChoices[0],nfl.law);
assert.deepEqual(nflChoices[0].evidence.executionEvidence!.pricingQuotes,nfl.packet.quotes);
const empty={decisions:[],counts:{},diagnostics:{}} as unknown as NflPlayerPropsRuntimeBoard;
const appended=applyNflSiteAi(empty,nfl.packet,nflChoices,at);
const native={...appended,decisions:appended.decisions.map(r=>({...r,aiReview:undefined}))};
const appliedNfl=applyNflSiteAi(native,nfl.packet,nflChoices,at);
const beforeLock=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:at,nextBoard:appliedNfl,requireVerifiedInterceptionSource:true});
const storedNfl=JSON.parse(JSON.stringify(reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:lock,nextBoard:appliedNfl,previous:beforeLock,requireVerifiedInterceptionSource:true})));
assert(storedNfl.board.decisions.length>0);assert(storedNfl.memberDecisions.length>0);
for(const r of [...storedNfl.board.decisions,...storedNfl.memberDecisions]){
 assert.equal(r.state,'locked');assert.deepEqual(r.aiReview.executionEvidence,{...nflChoices[0].evidence.executionEvidence,operation:'member_row',selectedQuote:nfl.packet.quotes.find(q=>q.side===r.side)});
 assert.equal(r.aiReview.selectedSide,nflChoices[0].side,'Forecast-selected side is distinct from an opposite offered row');
 assert.equal(r.aiReview.executionEvidence.pricingQuotes[1].receivedAt,opposingAt);assert.equal(r.aiReview.executionEvidence.pricingQuotes[1].sourceEvent.providerMarket,'interceptions');
}
const nflMember=buildNflPlayerPropsMemberSnapshot(storedNfl,lock);assert(nflMember.memberDecisions.length>0);
assert.deepEqual(nflMember.memberDecisions[0].aiReview!.executionEvidence,storedNfl.memberDecisions[0].aiReview.executionEvidence);
const legacyNfl=structuredClone(storedNfl);for(const r of [...legacyNfl.board.decisions,...legacyNfl.memberDecisions])delete r.aiReview.executionEvidence;
const legacyBytes=JSON.stringify(legacyNfl),legacyWriter=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:lock,nextBoard:appliedNfl,previous:legacyNfl,requireVerifiedInterceptionSource:true});
assert(legacyWriter.memberDecisions.every(r=>!r.aiReview!.executionEvidence));assert.equal(JSON.stringify(legacyNfl),legacyBytes);
assert.strictEqual(applyNflSiteAi(legacyNfl.board,nfl.packet,nflChoices,at),legacyNfl.board);

// Current NFL rows can reprice after decision construction. Record the actual
// new row quote/group/clock, retaining the accepted law and forecast direction.
const later='2026-11-10T20:52:00Z',repricedPacket=structuredClone(nfl.packet);
for(const q of repricedPacket.quotes){q.american=q.side==='over'?-125:105;q.receivedAt=q.observedAt=later;}
const repriced=applyNflSiteAi(native,repricedPacket,nflChoices,later);
for(const r of repriced.decisions){
 assert.equal(r.projection,nflChoices[0].projection);assert.equal(r.finalProbability,r.side==='under'?nflChoices[0].under:nflChoices[0].over);
 assert.equal(r.aiReview!.lawHash,nflChoices[0].evidence.lawHash);assert.equal(r.aiReview!.selectedSide,nflChoices[0].side);
 assert.equal(r.aiReview!.executionEvidence!.pricedAt,later);assert.equal(r.aiReview!.executionEvidence!.operation,'member_row');
 assert.deepEqual(r.aiReview!.executionEvidence!.selectedQuote,repricedPacket.quotes.find(q=>q.side===r.side));
 assert.deepEqual(r.aiReview!.executionEvidence!.pricingQuotes,repricedPacket.quotes);assert.equal(r.aiReview!.quoteConfirmedAt,later);
}
assert.deepEqual(nflChoices[0].evidence.executionEvidence!.pricingQuotes,nfl.packet.quotes,'Repricing cannot mutate original decision evidence');
const changedAfterLock=applyNflSiteAi(storedNfl.board,repricedPacket,nflChoices,later);assert.strictEqual(changedAfterLock,storedNfl.board);

// Paired-margin eligibility is replayed from the exact group, including cases
// where a retained opposing quote is too far apart to qualify as a price pair.
const marginPacket=structuredClone(nba.packet);marginPacket.quotes=quotes(nba.id,'points',14.5);
marginPacket.quotes[0].american=-160;marginPacket.quotes[1].american=140;
const margin=siteAiDecisions(marginPacket,nba.review,at);assert.equal(margin.length,1);assert.equal(margin[0].grade,'Lean');assert(margin[0].expectedValue<0);assert.equal(replay(margin[0],nba.law).recommendationBasis,'outcome_confidence_with_paired_margin');
const distant=structuredClone(marginPacket);distant.quotes[1].receivedAt=distant.quotes[1].observedAt='2026-11-10T20:44:00Z';
const noPair=siteAiDecisions(distant,nba.review,at);assert.equal(noPair[0].grade,'Watchlist');assert.equal(noPair[0].evidence.executionEvidence!.pricingQuotes.length,2);assert.equal(replay(noPair[0],nba.law).confidenceLean,null,'Pricing group membership does not imply eligibility under the five-minute pair check');

// MLB offered rows also keep their own actual row quote after a later reprice.
const mlb=fixture('mlb',['batter_hits'],{batter_singles:samples(0,1,2),batter_doubles:v(0),batter_triples:v(0),batter_home_runs:v(0),batter_walks:v(0),batter_strikeouts:v(0),batter_rbis:v(0),batter_runs_scored:v(0),batter_stolen_bases:v(0)});
mlb.packet.quotes=quotes(mlb.id,'batter_hits',.5);const mlbChoices=siteAiDecisions(mlb.packet,mlb.review,at);assert.equal(mlbChoices.length,1);
const mlbLater=structuredClone(mlb.packet);for(const q of mlbLater.quotes){q.receivedAt=q.observedAt=later;q.american=q.side==='over'?-125:105;}
type MlbRow=Parameters<typeof applyMlbSiteAi>[0][number];
const mlbRow={id:'synthetic-mlb',providerIds:{gameId:mlb.packet.gameId,mlbStatsPlayerId:mlb.id,bdlPlayerId:1},market:'batter_hits',line:.5,book:'book-one',side:'over',lockStatus:null,missingFeatures:[],oddsSanity:[]} as unknown as MlbRow;
const mlbApplied=applyMlbSiteAi([mlbRow,{...mlbRow,id:'synthetic-mlb-under',side:'under'}],mlbLater,mlbChoices,later);
for(const r of mlbApplied){assert.equal(r.aiReview!.executionEvidence!.operation,'member_row');assert.deepEqual(r.aiReview!.executionEvidence!.selectedQuote,mlbLater.quotes.find(q=>q.side===r.side));assert.deepEqual(r.aiReview!.executionEvidence!.pricingQuotes,mlbLater.quotes);assert.equal(r.aiReview!.quoteConfirmedAt,later);assert.equal(r.aiReview!.lawHash,mlbChoices[0].evidence.lawHash);}
const lockedMlb=mlbApplied.map(r=>({...r,lockStatus:{status:'locked' as const,lockedAt:lock}}));const lockedMlbBefore=JSON.stringify(lockedMlb);
assert.strictEqual(applyMlbSiteAi(lockedMlb,mlbLater,mlbChoices,later),lockedMlb);assert.equal(JSON.stringify(lockedMlb),lockedMlbBefore);

const milestone=fixture('nfl',['anytime_td'],{touchdowns:samples(0,1,2)});
milestone.packet.quotes=[{...quotes(milestone.id,'anytime_td',1)[0],side:'yes',offerContract:'milestone',american:130}];
const yes=siteAiDecisions(milestone.packet,milestone.review,at);assert.equal(yes.length,1);assert.equal(yes[0].side,'yes');assert.equal(yes[0].push,0);replay(yes[0],milestone.law);
assert.deepEqual(yes[0].evidence.executionEvidence!.pricingQuotes,milestone.packet.quotes);

// Distinct deep clones prevent any caller/source mutation from changing another
// decision, the selected source, or the separately recorded pricing group.
const untouched=JSON.stringify(decisions[1]),first=decisions[0],rawBefore=JSON.stringify(nba.packet);
first.quote.american=250;first.evidence.executionEvidence!.selectedQuote.book='caller mutation';first.evidence.executionEvidence!.pricingQuotes[0].american=300;
assert.equal(JSON.stringify(nba.packet),rawBefore);assert.equal(JSON.stringify(decisions[1]),untouched);
assert.notEqual(first.evidence.executionEvidence!.selectedQuote.american,250);assert.notEqual(first.evidence.executionEvidence!.pricingQuotes[0].book,'caller mutation');
const saved=JSON.stringify(nflChoices[0].evidence.executionEvidence);nfl.packet.quotes[0].sourceEvent!.reason='source mutation';
assert.equal(JSON.stringify(nflChoices[0].evidence.executionEvidence),saved);
const decisionBeforeMemberMutation=JSON.stringify(decisions),otherRowBefore=JSON.stringify(repriced.decisions[1].aiReview!.executionEvidence);
applied.decisions[0].aiReview!.executionEvidence!.selectedQuote.book='member mutation';
repriced.decisions[0].aiReview!.executionEvidence!.pricingQuotes[0].american=999;
assert.equal(JSON.stringify(decisions),decisionBeforeMemberMutation,'A returned NBA row cannot mutate its decision evidence');
assert.equal(JSON.stringify(repriced.decisions[1].aiReview!.executionEvidence),otherRowBefore,'Opposite NFL rows own independent evidence clones');
console.log('Exact execution evidence passed: independent selected/group quote clones, provider and original clocks, replay-identical sides/prices/projections/grades (zero board impact), Over/Under promotions, push/milestone/event contracts, NBA/NFL stored member locks and immutable absent legacy metadata. Offline; no verified book-rule claim.');
