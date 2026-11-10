/** Actual source/parser/binding/lifecycle; synthetic sources and zero HTTP. */
import assert from 'node:assert/strict';
import {PRODUCT_RELEASE,type GamePacket,type Quote} from '../lib/playerPropsAi/evidenceContract';
import {digest} from '../lib/playerPropsAi/evidence';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {encodeCanonicalScenarioLaw,GENERATIVE_WIRE_RELEASE} from '../lib/playerPropsAi/generativeCoordinates';
import {parseJointReview} from '../lib/playerPropsAi/request';
import {readerEvidence,READER_AREAS} from '../lib/playerPropsAi/readerCoverage';
import {evidenceAliases} from '../lib/playerPropsAi/input';
import {independentPriorEvents} from '../lib/playerPropsAi/priorEvents';
import {PROPS_AI_RELEASE} from '../lib/playerPropsAi/releases';
import {siteAiDecisions} from '../lib/playerPropsAi/publication';
import {applyNbaSiteAi,restoreNbaNativeGame} from '../lib/playerPropsAi/siteBindings';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import {buildNbaPlayerPropsMemberSnapshot,type NbaPlayerPropsMemberDecision as Row} from '../lib/services/nba/nbaPlayerPropsProductContract';
import {advanceNbaPlayerPropsCandidateLifecycle} from '../lib/services/nba/nbaPlayerPropsLifecycle';
import {mergeNbaHandoffs,testNbaSourceAuthority,testNbaHandoffCapture,type NbaLockHandoff} from '../lib/playerPropsAi/nbaLockAuthority';
globalThis.fetch=async()=>{throw Error('NBA handoff test forbids HTTP and paid calls');};
const v=(n:number)=>Array<number>(16).fill(n),start='2026-11-10T23:30:00Z',lock='2026-11-10T22:30:00Z',sourceAt='2026-11-10T22:23:00Z',after='2026-11-10T22:30:01Z';
export function nbaAuthorityFixture(cutoff=sourceAt){
 const players=['a','b'].map(id=>({id,name:`Synthetic ${id}`,team:'BOS',opponent:'NYK',markets:id==='a'?['points','rebounds']:['points'],missing:[],evidence:[
  ...[14,18,20].map((points,i)=>({id:`${id}:log:${i}`,kind:'recent_games' as const,source:'synthetic recorded source',availableAt:'2026-11-10T20:00:00Z',value:{game:{startTime:`2026-11-0${5+i}T23:30:00Z`,homeTeam:'BOS',awayTeam:'NYK'},box:{points,reb:[4,6,8][i],ast:[2,4,3][i],fg3m:[1,2,1][i],minutes:30}}})),
  {id:`${id}:prior`,kind:'independent_model' as const,source:'synthetic-native',availableAt:'2026-11-10T20:00:00Z',value:{market:'points',line:15.5,independentProjection:18.4,independentOver:.8,independentUnder:.2,role:[],matchup:[]}},
 ]}));
 const quotes:Quote[]=players.flatMap(p=>p.markets.flatMap(market=>(['over','under'] as const).map(side=>({id:[p.id,market,side,cutoff].join('|'),playerId:p.id,market,line:market==='points'?15.5:5.5,book:'book',provider:'synthetic',side,american:-110,observedAt:cutoff,receivedAt:cutoff,receivedAtProvenance:'provider_response' as const,opening:false,live:false}))));
 const packet:GamePacket={release:PRODUCT_RELEASE,sport:'nba',gameId:'g',start,lock,cutoff,stage:'final',sourceLimitations:[],players,quotes,executionQuotes:structuredClone(quotes)};
 const row=(id='a',market:'points'|'rebounds'='points'):Row=>({decisionKey:`native:${id}:${market}`,gameId:'g',scheduledStart:start,homeTeam:'NYK',awayTeam:'BOS',playerId:id,playerName:`Synthetic ${id}`,team:'BOS',opponent:'NYK',market,line:market==='points'?15.5:5.5,projection:market==='points'?18.4:6.5,independentProjection:market==='points'?18.4:6.5,independentProbability:.75,independentSide:'over',modelRelease:'synthetic-native',calibrationRelease:'synthetic-native',decisionRelease:'synthetic-native',side:'over',probability:.75,grade:'Lean',sportsbook:'book',americanPrice:-110,expectedValue:.43,targetExcludedProbability:.5,targetExcludedBooks:2,targetExcludedReferenceBooks:1,marketEvidenceMode:'candidate_projection',gradePolicySource:'forecast_only',role:[],production:[],matchup:[],priceLadder:quotes.filter(q=>q.playerId===id&&q.market===market).map(q=>({sportsbook:q.book,line:q.line,side:q.side as 'over'|'under',americanPrice:q.american,observedAt:q.observedAt})),movement:null,evaluatedAt:cutoff,lockedAt:null});
 const snapshot=(rows:readonly Row[],at=cutoff)=>buildNbaPlayerPropsMemberSnapshot({mode:'private_forward_candidate',generatedAt:at,slateDate:'2026-11-10',games:[{gameId:'g',scheduledStart:start,homeTeam:'NYK',awayTeam:'BOS'}],decisions:rows,inputRows:quotes.length});
 return{packet,row,snapshot};
}
export function nbaAuthorityDraft(packet:GamePacket,weights=[2,6,2,...v(0).slice(3)]){
 const aliases=evidenceAliases(packet),facts=readerEvidence(packet);
 const raw={wireRelease:GENERATIVE_WIRE_RELEASE,players:Object.fromEntries(packet.players.map(p=>[p.id,{assessment:'The supplied production supports the conditional estimate.',priorRead:Object.fromEntries(independentPriorEvents(p).map(e=>[[...aliases].find(([,id])=>id===e.sourceId)![0],e.preferredOutcome])),coverage:Object.fromEntries(READER_AREAS.map(area=>[area,{status:facts[p.id][area].status,factIds:facts[p.id][area].facts.slice(0,1).map(f=>f.id),effect:'uncertain',observation:'The supplied context requires appropriate caution.'}])),evidenceIds:[[...aliases].find(([,id])=>id===p.evidence[0].id)![0]],gaps:[],confidence:p.markets.map(()=>2),exceptions:p.markets.map(()=>null),law:encodeCanonicalScenarioLaw('nba',p,{weights,outcomes:{points:[14,18,20,...v(18).slice(3)],rebounds:[4,6,8,...v(6).slice(3)],assists:[2,4,3,...v(3).slice(3)],threes:[1,2,1,...v(1).slice(3)]}})}]))};
 return raw;
}
export function nbaAuthorityReview(packet:GamePacket,weights=[2,6,2,...v(0).slice(3)],issuedAt=packet.cutoff){
 const parsed=parseJointReview(packet,nbaAuthorityDraft(packet,weights)),inputHash=digest(packet);
 return{release:PROPS_AI_RELEASE,gameId:'funded',sourceGameId:packet.sourceGameId??packet.gameId,start:packet.start,lock:packet.lock,cutoff:packet.cutoff,issuedAt,stage:packet.stage,inputHash,inputEvidence:{digest:inputHash},model:'synthetic',partProvenance:[],criticalContextHashes:criticalContextHashes(packet),marketScopes:Object.fromEntries(packet.players.map(p=>[p.id,p.markets])),players:parsed.players}as unknown as AcceptedGameReview;
}
function main(){
 const previousEnv=process.env.NODE_ENV;Object.assign(process.env,{NODE_ENV:'test'});
 try{
 const f=nbaAuthorityFixture(),review=nbaAuthorityReview(f.packet),choices=siteAiDecisions(f.packet,review,sourceAt);
 assert.equal(choices.length,3);assert(choices.every(c=>c.grade==='Best Angle'));
 // Native canonical preselection cannot suppress a different qualified AI event.
 const native={...f.row(),line:22.5,side:'under' as const,sportsbook:'other',independentSide:'under' as const};
 const baseline=f.snapshot([native,f.row('a','rebounds')]),applied=applyNbaSiteAi(baseline,f.packet,choices,sourceAt);
 assert.equal(applied.decisions.length,3);assert(applied.decisions.every(r=>r.aiReview));
 const recovered=applied.decisions.find(r=>r.playerId==='a'&&r.market==='points')!;
 assert.equal(recovered.line,15.5);assert.equal(recovered.sportsbook,'book');assert.equal(recovered.independentProbability,null);assert.equal(recovered.independentSide,undefined);assert.equal(recovered.projection,choices.find(c=>c.playerId==='a'&&c.market==='points')!.projection);
 assert.deepEqual(applyNbaSiteAi(baseline,f.packet,[...choices].reverse(),sourceAt).decisions,applied.decisions,'Fallback event ties are deterministic');
 assert.strictEqual(applyNbaSiteAi(baseline,{...f.packet,executionQuotes:[]},choices,sourceAt),baseline,'No current offer cannot resurrect archived prices');
 assert.strictEqual(applyNbaSiteAi(baseline,f.packet,[],sourceAt),baseline,'No qualified AI event preserves native output');
 const underReview=nbaAuthorityReview(f.packet,[8,1,1,...v(0).slice(3)]),underChoices=siteAiDecisions(f.packet,underReview,sourceAt),under=applyNbaSiteAi(f.snapshot([{...native,grade:'No Play'}]),f.packet,underChoices,sourceAt).decisions.find(r=>r.playerId==='a'&&r.market==='points')!;
 assert.equal(under.side,'under');assert.equal(under.grade,'Best Angle','A genuinely qualified Under also promotes');
 const locked={...native,lockedAt:'2026-11-10T22:00:00Z'},protectedSnapshot=f.snapshot([locked]);
 assert.strictEqual(applyNbaSiteAi(protectedSnapshot,f.packet,choices,sourceAt).decisions.find(r=>r.playerId==='a'&&r.market==='points'),locked);
 assert.deepEqual(restoreNbaNativeGame(applied,baseline,f.packet,sourceAt).decisions,baseline.decisions,'Restoration uses the actual native baseline');
 const empty={observations:[],proofs:[]}satisfies NbaLockHandoff;
 // Exact last published pre-lock AI-only scopes survive a fresh native-only
 // invocation after lock. Original values, prices and evidence remain exact.
 const durable=advanceNbaPlayerPropsCandidateLifecycle({now:after,previous:applied,candidate:f.snapshot([],after),lockHandoff:empty});
 assert.equal(durable.snapshot.decisions.length,3);assert(durable.snapshot.decisions.every(r=>r.lockedAt===new Date(lock).toISOString()));
 for(const r of durable.snapshot.decisions){const prior=applied.decisions.find(p=>p.playerId===r.playerId&&p.market===r.market)!;assert.deepEqual({...r,lockedAt:null},prior);}
 const missingMetadata=f.snapshot(applied.decisions.map(r=>{const{executionEvidence:ignored,...legacy}=r.aiReview!;void ignored;return{...structuredClone(r),aiReview:legacy};}));
 assert.equal(advanceNbaPlayerPropsCandidateLifecycle({now:after,previous:missingMetadata,candidate:f.snapshot([],after),lockHandoff:empty}).snapshot.decisions.length,0,'Absent legacy execution fields are never reconstructed');
 // Actual pre-lock final numeric readiness wins even if the later final lookup
 // or source reload crosses the lock, without replacing any existing lock.
 const finalReview=nbaAuthorityReview(f.packet,[1,4,5,...v(0).slice(3)],'2026-11-10T22:26:00Z'),finalAt='2026-11-10T22:26:01Z';
 const finalCandidate=applyNbaSiteAi(baseline,f.packet,siteAiDecisions(f.packet,finalReview,finalAt),finalAt);
 const frames=[testNbaSourceAuthority(()=>sourceAt)(f.packet,review),testNbaHandoffCapture(()=>sourceAt)(baseline.decisions,f.packet,review,'native'),testNbaSourceAuthority(()=>finalAt)(f.packet,finalReview),testNbaHandoffCapture(()=>finalAt)(finalCandidate.decisions,f.packet,finalReview,'ai')];
 const crossed=advanceNbaPlayerPropsCandidateLifecycle({now:after,previous:applied,candidate:finalCandidate,lockHandoff:mergeNbaHandoffs(frames)});
 assert.equal(crossed.snapshot.decisions.length,3);assert(crossed.snapshot.decisions.every(r=>r.aiReview?.inputHash===finalReview.inputHash));assert(crossed.snapshot.decisions.every(r=>r.projection===finalCandidate.decisions.find(c=>c.playerId===r.playerId&&c.market===r.market)!.projection));
 const mutations:((row:Row)=>Row)[]=[
  (row:Row)=>({...row,modelRelease:'forged-model'}),
  (row:Row)=>({...row,aiReview:{...row.aiReview!,gradeRelease:'forged-grade'}}),
  (row:Row)=>({...row,aiReview:{...row.aiReview!,sourceEligibility:{...row.aiReview!.sourceEligibility!,reason:'forged-source-status'}}}),
  (row:Row)=>({...row,aiReview:{...row.aiReview!,assessment:'A forged explanation.'}}),
  (row:Row)=>({...row,aiReview:{...row.aiReview!,executionEvidence:{...row.aiReview!.executionEvidence!,pricedAt:'2026-11-10T22:22:59Z'}}}),
 ];for(const mutate of mutations){const tampered=finalCandidate.decisions.map(mutate);assert.equal(testNbaHandoffCapture(()=>finalAt)(tampered,f.packet,finalReview,'ai').proofs.length,0,'Correct numbers alone cannot seal forged public provenance');}
 const stored=structuredClone(durable.snapshot),storedBytes=JSON.stringify(stored);
 const lockedAgain=advanceNbaPlayerPropsCandidateLifecycle({now:after,previous:stored,candidate:finalCandidate,lockHandoff:{observations:[{} as never],proofs:[{} as never]}});
 assert.equal(JSON.stringify(stored),storedBytes);assert.deepEqual(lockedAgain.snapshot.decisions,stored.decisions,'Stored locks precede even malformed new optional authority');
 // New genuinely observed context or current offer removals revoke stale AI.
 const changed=structuredClone(f.packet);changed.players[0].evidence.push({id:'new-injury',kind:'availability',source:'synthetic exact own report',availableAt:'2026-11-10T22:27:00Z',value:{status:'questionable'}});changed.cutoff='2026-11-10T22:27:00Z';
 const changedFrames=mergeNbaHandoffs([...frames,testNbaSourceAuthority(()=>changed.cutoff)(changed,finalReview)]);
 const changedResult=advanceNbaPlayerPropsCandidateLifecycle({now:after,previous:applied,candidate:finalCandidate,lockHandoff:changedFrames});
 assert(!changedResult.snapshot.decisions.some(r=>r.playerId==='a'&&r.aiReview));assert(changedResult.snapshot.decisions.some(r=>r.playerId==='b'&&r.aiReview));
 const removed={...f.packet,cutoff:'2026-11-10T22:27:00Z',executionQuotes:[]};
 assert.equal(advanceNbaPlayerPropsCandidateLifecycle({now:after,previous:applied,candidate:finalCandidate,lockHandoff:mergeNbaHandoffs([...frames,testNbaSourceAuthority(()=>removed.cutoff)(removed,finalReview)])}).snapshot.decisions.length,0,'A genuine pre-lock empty current collector set cannot resurrect old AI');
 const noLookup=mergeNbaHandoffs([testNbaSourceAuthority(()=>sourceAt)(f.packet,null,false),testNbaHandoffCapture(()=>sourceAt)(baseline.decisions,f.packet,null,'native')]);
 const fallback=advanceNbaPlayerPropsCandidateLifecycle({now:after,previous:applied,candidate:baseline,lockHandoff:noLookup});
 assert.equal(fallback.snapshot.decisions.length,1,'Only a native row with actual quote/ready proof can replace unknown AI authority');assert.equal(fallback.snapshot.decisions[0].market,'rebounds');assert(!fallback.snapshot.decisions[0].aiReview);
 const lateFrames=mergeNbaHandoffs([testNbaSourceAuthority(()=>after)(f.packet,finalReview),testNbaHandoffCapture(()=>after)(finalCandidate.decisions,f.packet,finalReview,'ai')]);
 assert.equal(advanceNbaPlayerPropsCandidateLifecycle({now:after,previous:null,candidate:finalCandidate,lockHandoff:lateFrames}).snapshot.decisions.length,0,'Late observation is never backdated into a new lock');
 const nativeOnly=advanceNbaPlayerPropsCandidateLifecycle({now:after,previous:baseline,candidate:baseline});assert.equal(nativeOnly.snapshot.decisions.length,2,'Native-only legacy lifecycle remains unchanged');
 console.log('NBA qualified event/lock handoff passed: deterministic Over/Under recovery, all actor/market scopes, exact metadata and legacy locks, native restoration, durable AI-only first locks, actual final readiness before cross-lock reads, changed context, withdrawn offers, unknown lookup/native proof and late refusal. All source/SQL/HTTP/AI paths synthetic; no paid calls.');
 }finally{if(previousEnv===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Object.assign(process.env,{NODE_ENV:previousEnv});}
}
if(process.argv[1]?.endsWith('test-player-props-ai-nba-lock-authority.ts'))main();
