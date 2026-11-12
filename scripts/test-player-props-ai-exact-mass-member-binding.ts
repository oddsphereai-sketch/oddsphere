/** Exact future decision-pricing evidence; all laws/sources synthetic and offline. */
import assert from 'node:assert/strict';
import {PRODUCT_RELEASE,type GamePacket,type Quote} from '../lib/playerPropsAi/evidenceContract';
import {PROPS_AI_RELEASE,PROPS_AI_READER_CLAIMS_RELEASE,LEGACY_PROPS_AI_LAW_RELEASE,LEGACY_PROPS_AI_GRADE_RELEASE,LEGACY_PROPS_AI_SELECTION_RELEASE,PROPS_AI_GRADE_RELEASE} from '../lib/playerPropsAi/releases';
import {readerAvailabilityContextHash} from '../lib/playerPropsAi/readerClaimFreshness';
import {readerCanonicalContextHash,PROPS_AI_READER_CONTEXT_RELEASE} from '../lib/playerPropsAi/readerContext';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {validateLaw} from '../lib/playerPropsAi/law';
import {siteAiDecisions} from '../lib/playerPropsAi/publication';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import {applyNbaSiteAi,applyNflSiteAi,applyMlbSiteAi} from '../lib/playerPropsAi/siteBindings';
import {buildNbaPlayerPropsMemberSnapshot} from '../lib/services/nba/nbaPlayerPropsProductContract';
import {advanceNbaPlayerPropsCandidateLifecycle} from '../lib/services/nba/nbaPlayerPropsLifecycle';
import {reconcileNflPlayerPropsProductionSnapshot,buildNflPlayerPropsMemberSnapshot} from '../lib/services/football/nflPlayerPropsProductionContract';
import type {NflPlayerPropsRuntimeBoard} from '../lib/services/football/nflPlayerPropsRuntime';
globalThis.fetch=async()=>{throw Error('Execution evidence proof forbids network');};

const at='2026-11-10T20:50:00Z',opposingAt='2026-11-10T20:49:30Z',start='2026-11-10T22:00:00Z',lock='2026-11-10T21:00:00Z';
const v=(n:number)=>Array<number>(16).fill(n);
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

import {digest} from '../lib/playerPropsAi/evidence';

// Deliberately post-admission numerical boundary cases; the separate reader and
// semantic admission suite supplies full-parser controls. No unsupported source
// fixture is presented as a real qualified player's forecast.
const zero=()=>Array<number>(16).fill(0);
let cases=0;
for(const sport of ['nba','nfl','mlb'] as const){
 const market=sport==='nba'?'points':sport==='nfl'?'receptions':'batter_hits';
 const outcomes:Record<string,number[]>=sport==='nba'?{points:[1,0,...zero().slice(2)],rebounds:zero(),assists:zero(),threes:zero()}
  :sport==='nfl'?{receptions:[1,0,...zero().slice(2)]}
  :{batter_singles:[1,0,...zero().slice(2)],batter_doubles:zero(),batter_triples:zero(),batter_home_runs:zero(),batter_walks:zero(),batter_strikeouts:zero(),batter_rbis:zero(),batter_runs_scored:zero(),batter_stolen_bases:zero()};
 for(const legacy of [false,true]){
  const f=fixture(sport,[market],outcomes,[5,2,...zero().slice(2)]);
  if(legacy){const body={release:LEGACY_PROPS_AI_LAW_RELEASE,weights:[...f.law.weights],outcomes:structuredClone(f.law.outcomes)};f.review.players[0].law={...body,hash:digest(body)};f.review.release='player_props_ai_2026_11_11_r35_terminal_wave_guard';}
  const originalLaw=JSON.stringify(f.review.players[0].law);
  f.packet.quotes=quotes(f.id,market,.5);for(const q of f.packet.quotes)q.american=q.side==='over'?-250:200;
  const choices=siteAiDecisions(f.packet,f.review,at);assert.equal(choices.length,1);const choice=choices[0];
  assert.equal(choice.evidence.gradeRelease,legacy?LEGACY_PROPS_AI_GRADE_RELEASE:PROPS_AI_GRADE_RELEASE);
  if(legacy){assert.equal(choice.evidence.selectionRelease,LEGACY_PROPS_AI_SELECTION_RELEASE);assert(choice.expectedValue>0);assert.equal(choice.grade,'Best Angle');assert(!choice.exactEventMass);}
  else{assert.equal(choice.expectedValue,0);assert.notEqual(choice.grade,'Best Angle');assert(choice.exactEventMass);}
  if(sport==='nba'){
   const baseline=buildNbaPlayerPropsMemberSnapshot({mode:'private_forward_candidate',generatedAt:at,slateDate:'2026-11-10',games:[{gameId:f.packet.gameId,scheduledStart:start,awayTeam:'BOS',homeTeam:'NYK'}],decisions:[],inputRows:2});
   const applied=applyNbaSiteAi(baseline,f.packet,choices,at);assert.equal(applied.decisions.length,1);assert.equal(applied.decisions[0].expectedValue,choice.expectedValue);assert.equal(applied.decisions[0].grade,choice.grade);
   const locked=advanceNbaPlayerPropsCandidateLifecycle({now:lock,previous:applied,candidate:applied}).snapshot,bytes=JSON.stringify(locked);
   assert.strictEqual(applyNbaSiteAi(locked,f.packet,choices,at),locked);assert.equal(JSON.stringify(locked),bytes);
   assert(!('exactEventMass' in applied.decisions[0]));assert(!('exactEventMass' in applied.decisions[0].aiReview!));
  }else if(sport==='nfl'){
   const empty={decisions:[],counts:{},diagnostics:{}} as unknown as NflPlayerPropsRuntimeBoard;
   const applied=applyNflSiteAi(empty,f.packet,choices,at);assert(applied.decisions.length>0);
   const over=applied.decisions.find(r=>r.side==='over')!;assert.equal(over.expectedValue,choice.expectedValue);
   if(!legacy)assert.notEqual(over.grade,'Best Angle');
   const before=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:at,nextBoard:applied});
   const locked=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:lock,nextBoard:applied,previous:before});
   const bytes=JSON.stringify(locked),draft={...locked.board,publicationEnabled:false as const,trackingEnabled:false as const};assert.strictEqual(applyNflSiteAi(draft,f.packet,choices,at),draft);assert.deepEqual(buildNflPlayerPropsMemberSnapshot(locked,lock).memberDecisions,locked.memberDecisions);assert.equal(JSON.stringify(locked),bytes);
   if(!legacy){const missing=structuredClone(choices);delete missing[0].exactEventMass;assert.throws(()=>applyNflSiteAi(empty,f.packet,missing,at),/integer event mass/);}
  }else{
   type Row=Parameters<typeof applyMlbSiteAi>[0][number];
   const row={id:'synthetic',providerIds:{gameId:f.packet.gameId,mlbStatsPlayerId:f.id,bdlPlayerId:1},market,line:.5,book:'book-one',side:'over',lockStatus:null,missingFeatures:[],oddsSanity:[]} as unknown as Row;
   const applied=applyMlbSiteAi([row],f.packet,choices,at);assert.equal(applied[0].expectedValue,choice.expectedValue);if(!legacy)assert.notEqual(applied[0].playGrade,'BEST_ANGLE');
   const locked=applied.map(r=>({...r,lockStatus:{status:'locked' as const,lockedAt:lock}})),bytes=JSON.stringify(locked);assert.strictEqual(applyMlbSiteAi(locked,f.packet,choices,at),locked);assert.equal(JSON.stringify(locked),bytes);
  }
  // A later actual execution price must recompute exact new-law EV. Legacy
  // rows keep their original arithmetic and every source law remains unchanged.
  const later=structuredClone(f.packet);for(const q of later.quotes){q.american=q.side==='over'?-249:200;q.receivedAt=q.observedAt='2026-11-10T20:52:00Z';}
  if(sport==='nfl'){const repriced=applyNflSiteAi({decisions:[],counts:{},diagnostics:{}} as unknown as NflPlayerPropsRuntimeBoard,later,choices,'2026-11-10T20:52:00Z');assert(repriced.decisions.find(r=>r.side==='over')!.expectedValue>0);}
  assert.equal(JSON.stringify(f.review.players[0].law),originalLaw);cases++;
 }
}
console.log(JSON.stringify({actualMemberBindings:true,crossSportLegacyAndExactCases:cases,zeroEVCoherent:true,currentPriceRecomputed:true,lockedWriterReaderPrecedence:true,noPublicIntegerMass:true,networkCalls:0}));

// Actual source normalization + full current wire admission must carry the exact
// event ordering through both NBA member fallback paths. Extreme admitted safe
// prices exercise rounding boundaries; they are not alleged real market offers.
import {normalizeBallDontLieNbaPlayerProps} from '../lib/services/nba/nbaPlayerPropsProviders';
import {mergeNbaPlayerPropsMarketHistory} from '../lib/services/nba/nbaPlayerPropsPrivateStore';
import {liveNbaPacket} from '../lib/playerPropsAi/liveSources';
import {nbaAuthorityFixture,nbaAuthorityReview} from './test-player-props-ai-nba-lock-authority';
import {nbaPlayedStateFixture} from './lib/player-props-ai-nba-played-fixture';
import {validatePacket} from '../lib/playerPropsAi/evidence';
import {priceAiLaw} from '../lib/playerPropsAi/pricing';
let sourceOrderCases=0;
for(const [lower,higher] of [[200,201],[-111,-110],[9007199254740893,9007199254740894],[-9007199254740894,-9007199254740893],[200,200]]){
 const f=nbaAuthorityFixture(),clock=f.packet.cutoff,id='nba-bdl-player:1',game={id:'g',start:f.packet.start,home:'NYK',away:'BOS'};
 const normalized=normalizeBallDontLieNbaPlayerProps({values:[{vendor:'a-lower',price:lower},{vendor:'z-higher',price:higher}].map((q,i)=>({id:123+i,game_id:7,player_id:1,player:{first_name:'Current',last_name:'Name',team_id:1},prop_type:'points',vendor:q.vendor,line_value:15.5,updated_at:clock,market:{type:'over_under',over_odds:q.price,under_odds:-110}})),fetchedAt:clock,events:{'7':{canonicalGameId:'g',homeTeam:'NYK',awayTeam:'BOS',scheduledStart:game.start}},canonicalPlayers:{'1':id}});
 assert.equal(normalized.rejectedRows,0);assert.equal(normalized.rows.length,4);
 const current=normalized.rows.map(q=>({...q,receivedAt:clock})),market=mergeNbaPlayerPropsMarketHistory({previous:null,current,slateDate:'2026-11-10',capturedAt:clock}).history;
 const native={...f.row(),playerId:id,playerName:'Current Name',sportsbook:'native-unavailable'},baseline=f.snapshot([native]),state=nbaPlayedStateFixture('2026-11-10T22:20:00Z',[1],[14,18,20],[4,6,8]);
 const packet=liveNbaPacket({game,window:{gameId:'g',stage:'final',cutoff:clock,lock:f.packet.lock},snapshot:baseline,market,prior:state,current:state,currentObservations:current});
 validatePacket(packet);assert.equal(packet.executionQuotes?.length,4);
 for(const legacy of [false,true]){
  const review=nbaAuthorityReview(packet,[1,1,...Array<number>(14).fill(0)]);
  if(legacy){const law=review.players[0].law!;const body={release:LEGACY_PROPS_AI_LAW_RELEASE,weights:[...law.weights],outcomes:structuredClone(law.outcomes)};review.players[0].law={...body,hash:digest(body)};review.release='player_props_ai_2026_11_11_r35_terminal_wave_guard';}
  const before=JSON.stringify(review),choices=siteAiDecisions(packet,review,clock);assert.equal(choices.length,2);assert(choices.every(c=>c.probability===.5));
  const law=review.players[0].law!;
  const direct:NonNullable<ReturnType<typeof priceAiLaw>>=priceAiLaw({law,market:'points',quotes:packet.executionQuotes!.map(q=>({id:q.id,book:q.book,provider:q.provider,line:q.line,side:q.side,american:q.american,availableAt:q.receivedAt,confirmedAt:q.receivedAt,current:true,actionRule:'qualifying_participation'})),now:clock,maxAgeMs:900000,confidence:2,exception:null})!;
  const sameDisplay=choices[0].expectedValue===choices[1].expectedValue;
  const expected=legacy&&sameDisplay||lower===higher?'a-lower':'z-higher';
  assert.equal(direct.quote.book,expected);
  for(const ordered of [choices,[...choices].reverse()])for(const candidate of [baseline,f.snapshot([])]){
   const applied=applyNbaSiteAi(candidate,packet,ordered,clock),row=applied.decisions[0];
   assert.equal(row.sportsbook,expected);assert.equal(row.americanPrice,expected==='a-lower'?lower:higher);assert.equal(row.aiReview?.executionEvidence?.selectedQuote.american,row.americanPrice);
   assert(!('exactEventMass' in row));assert(!('exactEventMass' in row.aiReview!));
   const locked=advanceNbaPlayerPropsCandidateLifecycle({now:packet.lock,previous:applied,candidate:applied}).snapshot,bytes=JSON.stringify(locked);
   assert.strictEqual(applyNbaSiteAi(locked,packet,ordered,clock),locked);assert.equal(JSON.stringify(locked),bytes);sourceOrderCases++;
  }
  assert.equal(JSON.stringify(review),before);
 }
}
console.log(JSON.stringify({actualSourceAndFullWireAdmission:true,sourceOrderMemberCases:sourceOrderCases,exactOrderAndTrueTie:true,legacyOrderExact:true,allStoredLocksOpaque:true,networkCalls:0}));
