/** Actual pre-lock NBA source/row handoff. No IO, inference, persistence or clock
 * reconstruction. The trusted existing writer supplies materialized source rows;
 * these digest bindings are not independent signatures or provider attestations. */
import assert from 'node:assert/strict';
import type {NbaPlayerPropsMemberDecision as Row,NbaPlayerPropsMemberSnapshot} from '../services/nba/nbaPlayerPropsProductContract';
import {PROPS_AI_NBA_CURRENT_SOURCE_RELEASE} from './nbaSourceIdentity';
import type {NbaPlayerPropPriceObservation} from '../services/nba/nbaPlayerPropsContract';
import type {GamePacket,Quote} from './evidenceContract';
import type {AcceptedGameReview} from './reviewer';
import {digest,instant,validatePacket} from './evidence';
import {criticalContextHashes} from './criticalContext';
import {reviewedReaderContextCurrent} from './readerClaimFreshness';
import {playerParticipationEligibility} from './participationEligibility';
import {executionQuotes,quoteBook,quoteContract} from './executionQuotes';
import {siteAiDecisions} from './publication';
import {PROPS_AI_EXECUTION_EVIDENCE_RELEASE} from './publicationContract';
import {PROPS_AI_ESTIMATE_RELEASE} from './releases';

export const NBA_PROPS_LOCK_AUTHORITY_RELEASE='nba_props_lock_authority_2026_11_10_r1_prelock_source' as const;
type Status='qualified'|'declined'|'context_changed'|'unreviewed_actor'|'unreviewed_scope'|'review_lookup_unavailable'|'review_authority_missing';
type Bound<T>=T&{binding:string};
type Actor={actorId:string;contextHash:string;scopes:{market:string;status:Status}[];review:null|{release:string;inputHash:string;stage:string;issuedAt:string;lawHash:string|null}};
type Observation=Bound<{gameId:string;start:string;lock:string;cutoff:string;observedAt:string;order:number;sourcePacketHash:string;completeExecution:boolean;quotes:Quote[];actors:Actor[]}>;
type Proof=Bound<{row:Row;kind:'ai'|'native';contextHash:string;readyAt:string;sourcePacketHash:string;executionQuote:Quote}>;
export type NbaLockHandoff={observations:Observation[];proofs:Proof[]};
export type NbaLockDiagnostic={scope:string;kind:string;status:string|null};
const owned=new WeakSet<object>();let observationOrder=0;
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function seal<T extends object>(value:T):Bound<T>{const result=freeze({...value,binding:digest(value)});owned.add(result);return result;}
function verify(value:Bound<object>){assert(owned.has(value),'NBA authority must originate in this actual capture');const{binding,...plain}=value;assert.equal(digest(plain),binding,'NBA authority binding changed');}
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
export const nbaLockScope=(row:Pick<Row,'gameId'|'playerId'|'market'>)=>JSON.stringify([row.gameId,row.playerId,row.market]);
const sameTime=(a:string,b:string)=>instant(a)===instant(b);
const close=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-10;
const gameId=(packet:GamePacket)=>packet.sourceGameId??packet.gameId;
function rowInPacket(row:Row,packet:GamePacket){const p=packet.players.find(p=>p.id===row.playerId);return p&&row.gameId===gameId(packet)&&sameTime(row.scheduledStart,packet.start)&&row.team===p.team&&row.opponent===p.opponent&&p.markets.includes(row.market);}
function publicEvent(row:Row,q:Quote){return q.playerId===row.playerId&&q.market===row.market&&q.line===row.line&&q.side===row.side&&quoteBook(q.book)===quoteBook(row.sportsbook)&&q.american===row.americanPrice&&quoteContract(q)==='two_way';}
function numericRow(row:Row){return Number.isFinite(row.projection)&&Number.isFinite(row.probability)&&row.probability>=0&&row.probability<=1&&Number.isFinite(row.expectedValue)&&Number.isInteger(row.americanPrice)&&Math.abs(row.americanPrice)>=100;}
function observe(packet:GamePacket,review:AcceptedGameReview|null,lookupAvailable:boolean,clock:()=>string):NbaLockHandoff{
 const observedAt=clock(),source=clone(packet);validatePacket(source);assert.equal(source.sport,'nba');assert(instant(source.cutoff)<=instant(observedAt),'NBA source was not available at its observation');
 if(review){assert(review.issuedAt&&instant(review.issuedAt)<=instant(observedAt),'NBA review was not available at observation');assert.equal(review.sourceGameId??review.gameId,gameId(source));assert(sameTime(review.start,source.start)&&sameTime(review.lock,source.lock));assert.equal(review.inputHash??review.inputEvidence.digest,review.inputEvidence.digest);}
 const contexts=criticalContextHashes(source),actors:Actor[]=source.players.map(player=>{
  const row=review?.players.find(r=>r.playerId===player.id),scopes=review?.marketScopes[player.id]??[];
  return{actorId:player.id,contextHash:contexts[player.id],review:review?{release:review.release,inputHash:review.inputHash??review.inputEvidence.digest,stage:review.stage,issuedAt:review.issuedAt!,lawHash:row?.law?.hash??null}:null,
   scopes:[...new Set([...player.markets,...scopes])].map(market=>({market,status:(!lookupAvailable?'review_lookup_unavailable':!review?'review_authority_missing':!row?'unreviewed_actor':!reviewedReaderContextCurrent(source,review,player.id)?'context_changed':!scopes.includes(market)?'unreviewed_scope':!row.law||row.sourceDeclinedMarkets?.includes(market)?'declined':'qualified')as Status}))};
 });
 return{observations:[seal({gameId:gameId(source),start:source.start,lock:source.lock,cutoff:source.cutoff,observedAt,order:++observationOrder,sourcePacketHash:digest(source),completeExecution:Array.isArray(source.executionQuotes),quotes:clone(executionQuotes(source,observedAt)),actors})],proofs:[]};
}
function capture(rows:readonly Row[],packet:GamePacket,review:AcceptedGameReview|null,kind:'ai'|'native',clock:()=>string):NbaLockHandoff{
 const source=clone(packet),frozenRows=clone(rows),readyAt=clock();validatePacket(source);assert.equal(source.sport,'nba');assert(instant(source.cutoff)<=instant(readyAt),'NBA source not ready at numeric capture');
 if(!Array.isArray(source.executionQuotes)||instant(readyAt)>=instant(source.lock))return{observations:[],proofs:[]};
 const contexts=criticalContextHashes(source),quotes=executionQuotes(source,readyAt),choices=kind==='ai'&&review?siteAiDecisions(source,review,readyAt):[],proofs:Proof[]=[];
 for(const row of frozenRows){
  if(row.lockedAt!==null||!rowInPacket(row,source)||!numericRow(row)||Boolean(row.aiReview)!==(kind==='ai')||instant(row.evaluatedAt)>instant(readyAt))continue;
  let quote:Quote|undefined;
  if(kind==='ai'){
   // Future reviewed rows use the exact current source label; native aliases
   // and every previously stored lock retain their own identity contract.
   if(row.playerName!==source.players.find(p=>p.id===row.playerId)!.name)continue;
   const choice=choices.find(c=>c.playerId===row.playerId&&c.market===row.market&&c.line===row.line&&c.side===row.side&&quoteBook(c.book)===quoteBook(row.sportsbook)&&c.american===row.americanPrice),e=row.aiReview;
   if(!choice||!e||!review||e.release!==review.release||e.inputHash!==(review.inputHash??review.inputEvidence.digest)||e.lawHash!==choice.evidence.lawHash||e.stage!==review.stage||!sameTime(e.reviewedAt,review.issuedAt!)||e.selectedSide!==row.side||e.confidence!==choice.evidence.confidence||e.exception!==choice.evidence.exception||e.assessment!==choice.evidence.assessment||row.grade!==choice.grade||!close(row.projection,choice.projection)||!close(row.probability,choice.probability)||!close(row.expectedValue,choice.expectedValue))continue;
   const proof=e.executionEvidence;
   if(row.modelRelease!==e.release||row.calibrationRelease!==PROPS_AI_ESTIMATE_RELEASE||row.decisionRelease!==(e.selectionRelease??e.publicationRelease)||row.marketEvidenceMode!=='ai_joint_law'||row.gradePolicySource!=='ai_source_review'||row.targetExcludedProbability!==null||row.targetExcludedBooks!==0||row.targetExcludedReferenceBooks!==0||instant(row.evaluatedAt)<instant(source.cutoff)||instant(row.evaluatedAt)<instant(e.reviewedAt))continue;
   if(proof?.release!==PROPS_AI_EXECUTION_EVIDENCE_RELEASE||!publicEvent(row,proof.selectedQuote)||proof.selectedQuote.id!==choice.quote.id||digest(proof.selectedQuote)!==digest(choice.quote)||!sameTime(e.quoteConfirmedAt,choice.quote.receivedAt)||instant(proof.pricedAt)<instant(choice.quote.receivedAt)||instant(proof.pricedAt)>instant(row.evaluatedAt))continue;
   const{executionEvidence:ignoredStored,...storedMetadata}=e,{executionEvidence:expectedExecution,...expectedMetadata}=choice.evidence;void ignoredStored;
   if(digest(storedMetadata)!==digest(expectedMetadata)||!expectedExecution||proof.operation!==expectedExecution.operation||digest(proof.pricingQuotes)!==digest(expectedExecution.pricingQuotes))continue;
   quote=choice.quote;
  }else{
   if(String(row.modelRelease).startsWith('player_props_ai_'))continue;
   const player=source.players.find(p=>p.id===row.playerId)!;
   if(playerParticipationEligibility(source,player).blocked)continue;
   // Native NBA rows do not store the provider. This is an actual current
   // confirmation of their public book/line/side/price, not an invented claim
   // about which feed originally generated the native forecast.
   quote=quotes.filter(q=>publicEvent(row,q)&&row.priceLadder.some(p=>quoteBook(p.sportsbook)===quoteBook(q.book)&&p.line===q.line&&p.side===q.side&&p.americanPrice===q.american&&sameTime(p.observedAt,q.observedAt))).sort((a,b)=>instant(b.receivedAt)-instant(a.receivedAt)||a.id.localeCompare(b.id))[0];
  }
  if(quote)proofs.push(seal({row,kind,contextHash:contexts[row.playerId],readyAt,sourcePacketHash:digest(source),executionQuote:clone(quote)}));
 }
 return{observations:[],proofs};
}
export function observeNbaSourceAuthority(packet:GamePacket,review:AcceptedGameReview|null,lookupAvailable:boolean):NbaLockHandoff{assert.equal(arguments.length,3,'Production NBA observation rejects supplied clocks');return observe(packet,review,lookupAvailable,()=>new Date().toISOString());}
export function captureNbaHandoffBundle(rows:readonly Row[],packet:GamePacket,review:AcceptedGameReview|null,kind:'ai'|'native'):NbaLockHandoff{assert.equal(arguments.length,4,'Production NBA capture rejects supplied clocks');return capture(rows,packet,review,kind,()=>new Date().toISOString());}
export function testNbaSourceAuthority(clock:()=>string){assert.equal(process.env.NODE_ENV,'test');return(packet:GamePacket,review:AcceptedGameReview|null,lookupAvailable=true)=>observe(packet,review,lookupAvailable,clock);}
export function testNbaHandoffCapture(clock:()=>string){assert.equal(process.env.NODE_ENV,'test');return(rows:readonly Row[],packet:GamePacket,review:AcceptedGameReview|null,kind:'ai'|'native')=>capture(rows,packet,review,kind,clock);}
export function mergeNbaHandoffs(frames:readonly NbaLockHandoff[]):NbaLockHandoff{assert(frames.length<=256,'NBA handoff frame bound');return{observations:frames.flatMap(f=>f.observations),proofs:frames.flatMap(f=>f.proofs)};}

/** A persisted actual pre-lock publication may supply its exact existing values
 * when a later native candidate lacks that AI-only scope. Missing metadata is
 * never reconstructed. This is not a claim of fresh provider contact at lock. */
function durablePrevious(row:Row,generatedAt:string|undefined,now:string){
 try{
  const e=row.aiReview,p=e?.executionEvidence;if(row.lockedAt!==null||!e||!p||!generatedAt||p.release!==PROPS_AI_EXECUTION_EVIDENCE_RELEASE||!numericRow(row))return false;
  const lock=instant(row.scheduledStart)-3600000,q=p.selectedQuote;
  return instant(now)>=lock&&row.modelRelease===e.release&&row.decisionRelease===(e.selectionRelease??e.publicationRelease)&&row.marketEvidenceMode==='ai_joint_law'&&row.gradePolicySource==='ai_source_review'&&instant(row.evaluatedAt)<=instant(generatedAt)&&instant(generatedAt)<lock&&instant(e.reviewedAt)<=instant(row.evaluatedAt)&&instant(p.pricedAt)<=instant(row.evaluatedAt)&&instant(p.pricedAt)>=instant(q.receivedAt)&&instant(row.evaluatedAt)-instant(q.receivedAt)<=15*60000&&instant(q.observedAt)<=instant(q.receivedAt)&&instant(q.receivedAt)<lock&&q.receivedAtProvenance==='provider_response'&&q.opening===false&&q.live===false&&publicEvent(row,q)&&sameTime(e.quoteConfirmedAt,q.receivedAt)&&e.selectedSide===row.side&&Boolean(e.lawHash)&&Boolean(e.inputHash);
 }catch{return false;}
}
export function prepareNbaLockHandoff(args:NbaLockHandoff&{nextRows:readonly Row[];previousRows:readonly Row[];previousGeneratedAt?:string;now:string}){
 const existingLocks=new Set(args.previousRows.filter(r=>r.lockedAt!==null).map(nbaLockScope));
 const rows=[...args.nextRows,...args.previousRows].filter(r=>!existingLocks.has(nbaLockScope(r))),games=new Set(rows.map(r=>r.gameId));
 const overrides=new Map<string,Row|null>(),diagnostics:NbaLockDiagnostic[]=[];
 // Exact stored locks take precedence before optional new metadata is inspected.
 if(!games.size)return{overrides,diagnostics};
 const observations=args.observations.filter(o=>games.has(o.gameId)&&instant(o.observedAt)<=instant(args.now)&&instant(o.observedAt)<instant(o.lock)).map(o=>{verify(o);return o;}).sort((a,b)=>instant(b.observedAt)-instant(a.observedAt)||b.order-a.order);
 const proofs=args.proofs.filter(p=>games.has(p.row.gameId)).map(p=>{verify(p);return p;});
 const latest=new Map<string,Observation>();for(const o of observations)if(!latest.has(o.gameId))latest.set(o.gameId,o);
 for(const [scope,row]of new Map(rows.map(r=>[nbaLockScope(r),r]))){
  const lock=instant(row.scheduledStart)-3600000;if(instant(args.now)<lock)continue;
  const prior=args.previousRows.find(r=>nbaLockScope(r)===scope),observation=latest.get(row.gameId);
  if(observation){
   const actor=observation.actors.find(a=>a.actorId===row.playerId),status=actor?.scopes.find(s=>s.market===row.market)?.status??'unreviewed_actor';
   const eligible=proofs.filter(p=>nbaLockScope(p.row)===scope&&instant(p.readyAt)<lock&&instant(p.readyAt)<=instant(args.now)&&p.contextHash===actor?.contextHash&&sameTime(p.row.scheduledStart,observation.start)&&instant(observation.lock)===lock&&observation.completeExecution&&observation.quotes.some(q=>q.id===p.executionQuote.id&&digest(q)===digest(p.executionQuote))).sort((a,b)=>instant(b.readyAt)-instant(a.readyAt)||a.binding.localeCompare(b.binding));
   const reviewed=status==='qualified'&&actor?.review?eligible.find(p=>p.kind==='ai'&&p.row.aiReview?.release===actor.review!.release&&p.row.aiReview.inputHash===actor.review!.inputHash&&p.row.aiReview.lawHash===actor.review!.lawHash&&p.row.aiReview.stage===actor.review!.stage&&sameTime(p.row.aiReview.reviewedAt,actor.review!.issuedAt)):undefined;
   const selected=reviewed??eligible.find(p=>p.kind==='native');
   overrides.set(scope,selected?.row??null);diagnostics.push({scope,kind:selected?.kind??'unavailable',status});continue;
  }
  if(prior?.aiReview){const valid=durablePrevious(prior,args.previousGeneratedAt,args.now);overrides.set(scope,valid?prior:null);diagnostics.push({scope,kind:valid?'previous_prelock_publication':'unavailable',status:valid?'qualified':'missing_prelock_execution_evidence'});}
  else if(row.aiReview){overrides.set(scope,null);diagnostics.push({scope,kind:'unavailable',status:'candidate_not_observed_prelock'});}
 }
 return{overrides,diagnostics};
}

/** Only the actual complete current collector and owned source observation may
 * authorize withdrawing an entire game's unlocked execution rows. */
export const NBA_PROPS_WITHDRAWAL_AUTHORITY_RELEASE='nba_props_withdrawal_authority_2026_11_11_r1_complete_current_source' as const;
export type NbaWithdrawalAuthority=Bound<{release:typeof NBA_PROPS_WITHDRAWAL_AUTHORITY_RELEASE;gameId:string;start:string;cutoff:string;observedAt:string;sourcePacketHash:string;previousDigest:string;snapshotDigest:string}>;
export function captureNbaWithdrawalAuthority(args:{packet:GamePacket;source:NbaLockHandoff;currentObservations:readonly NbaPlayerPropPriceObservation[];collectorFindings:readonly string[];previous:NbaPlayerPropsMemberSnapshot;candidate:NbaPlayerPropsMemberSnapshot}):NbaWithdrawalAuthority{
 const {packet,previous,candidate}=args,id=gameId(packet),observation=args.source.observations[0];
 assert(observation&&args.source.observations.length===1);verify(observation);
 assert.equal(observation.sourcePacketHash,digest(packet));assert.equal(packet.sourceInputRelease,PROPS_AI_NBA_CURRENT_SOURCE_RELEASE);
 assert.equal(packet.sourceOfferSetStatus,'empty');assert(Array.isArray(packet.executionQuotes)&&packet.executionQuotes.length===0);
 assert(args.collectorFindings.every(finding=>finding==='owls_player_props_empty_for_slate'),'Withdrawal requires complete successful configured collectors; missing, optional failures, rejected or ambiguous sources cannot mean empty');
 assert(Array.isArray(args.currentObservations)&&!args.currentObservations.some(q=>q.canonicalGameId===id&&!q.isOpening&&!q.isLive),'Withdrawal requires successful zero current collector rows, not filtered, failed or partial offers');
 assert(instant(packet.cutoff)<=instant(observation.observedAt)&&instant(observation.observedAt)<instant(packet.lock));
 assert(sameTime(candidate.generatedAt,observation.observedAt));assert(instant(previous.generatedAt)<=instant(observation.observedAt));
 const game=previous.games.find(g=>g.gameId===id);assert(game&&sameTime(game.scheduledStart,packet.start));
 const candidateGame=candidate.games.find(g=>g.gameId===id);assert(candidateGame&&digest(game)===digest(candidateGame));
 assert(previous.decisions.some(r=>r.gameId===id),'Withdrawal requires prior canonical execution identity');
 for(const row of previous.decisions.filter(r=>r.gameId===id&&r.lockedAt===null)){assert(rowInPacket(row,packet),'Withdrawal source must identify each removed canonical scope');assert(instant(row.evaluatedAt)<=instant(packet.cutoff),'Withdrawal source predates the canonical game publication');}
 const expected=previous.decisions.filter(r=>r.gameId!==id||r.lockedAt!==null),sorted=(rows:readonly Row[])=>[...rows].sort((a,b)=>nbaLockScope(a).localeCompare(nbaLockScope(b)));
 assert.equal(digest(sorted(candidate.decisions)),digest(sorted(expected)),'Withdrawal may remove only this game unlocked rows; every other game and stored lock stays exact');
 return seal({release:NBA_PROPS_WITHDRAWAL_AUTHORITY_RELEASE,gameId:id,start:packet.start,cutoff:packet.cutoff,observedAt:observation.observedAt,sourcePacketHash:observation.sourcePacketHash,previousDigest:digest(previous),snapshotDigest:digest(candidate)});
}
export function assertNbaWithdrawalAuthority(authority:NbaWithdrawalAuthority,snapshot:NbaPlayerPropsMemberSnapshot,previous:NbaPlayerPropsMemberSnapshot){
 verify(authority);assert.equal(authority.release,NBA_PROPS_WITHDRAWAL_AUTHORITY_RELEASE);assert.equal(authority.snapshotDigest,digest(snapshot));assert.equal(authority.previousDigest,digest(previous));
}
