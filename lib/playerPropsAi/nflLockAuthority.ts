/** Forward NFL lock handoff. Digest bindings are not an authentication/signing
 * service. The existing trusted sport writer supplies its actual capture clocks.
 * No numeric law/source-qualification rule, persistence, HTTP or timer exists.
 */
import assert from 'node:assert/strict';
import {digest,instant,validatePacket} from './evidence';
import {criticalContextHashes} from './criticalContext';
import {unresolvedForecastMarkets} from './sourceEvents';
import {nflPlayerPropsRuntimePolicy,type NflPlayerPropsRuntimeDecision as Row} from '../services/football/nflPlayerPropsRuntime';
import type {GamePacket,Quote} from './evidenceContract';
import type {AcceptedGameReview} from './reviewer';
import {propsTeam} from './teamIdentity';
import {executionQuotes} from './executionQuotes';
import {quoteContract} from './executionQuotes';
import {sameNflPropActorName} from './nflPlayerIdentity';
import {lawForecast} from './law';
import {playerParticipationEligibility,qualifiedParticipationException} from './participationEligibility';
import {qualifyNflSourceParticipation} from './siteBindings';
import {reviewedReaderContextCurrent} from './readerClaimFreshness';
import {siteAiDecisions} from './publication';
import {PROPS_AI_EXECUTION_EVIDENCE_RELEASE} from './publicationContract';
import {PROPS_AI_ESTIMATE_RELEASE,PROPS_AI_NFL_DECISION_RELEASE} from './releases';
import {nflNativePublicationContext} from './nflNativeQualification';
export type State='qualified'|'declined'|'context_changed'|'unreviewed_actor'|'unreviewed_scope'|'source_unresolved'|'review_lookup_unavailable'|'review_authority_missing';
type Bound<T> = T&{binding:string};
export type Authority=Bound<{gameId:string;actorId:string;scheduledStart:string;team:string;opponent:string;lockAt:string;observedAt:string;currentContextHash:string;participationBlocked:boolean;participationReason:string|null;review:null|{release:string;inputHash:string;stage:string;issuedAt:string;contextHash:string|null;lawHash:string|null;playerDigest:string|null};scopes:{market:string;status:State}[]}>;
export type Proof=Bound<{gameId:string;actorId:string;event:string;kind:'ai'|'native';rowHash:string;contextHash:string;readyAt:string;quoteConfirmedAt:string;sourcePacketHash?:string}>;
/** Only an explicit current collector set can establish withdrawal. Missing
 * execution metadata or a failed load must never be interpreted as an empty set. */
type CurrentExecution=Pick<Quote,'playerId'|'market'|'line'|'side'|'provider'|'book'|'american'|'offerContract'>;
type ExecutionAuthority=Bound<{gameId:string;scheduledStart:string;lockAt:string;observedAt:string;order:number;sourcePacketHash:string;actors:{id:string;markets:string[]}[];quotes:CurrentExecution[]}>;
let executionOrder=0;
const owned=new WeakSet<object>();
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
const seal=<T extends object>(v:T):Bound<T>=>{const result=freeze({...v,binding:digest(v)});owned.add(result);return result;};
function verify(v:Bound<object>){assert(owned.has(v),'Authority/proof must originate in this capture; binding cannot be retagged');const {binding,...plain}=v;assert.equal(digest(plain),binding,'Authority/proof binding changed');}
export const actor=(r:Row)=>r.providerPlayerId!==null&&r.providerPlayerId!==undefined?`nfl-bdl-player:${r.providerPlayerId}`:null;
const rowHash=(r:Row)=>digest(JSON.parse(JSON.stringify(r)));
export const event=(r:Row)=>JSON.stringify([r.gameId,actor(r),propsTeam(r.team),propsTeam(r.opponent),instant(r.scheduledStart),instant(r.lockAt),r.market,r.line,r.side,r.sportsbook.toLowerCase().replace(/[^a-z0-9]/g,''),r.provider]);
/** observedAt is sampled when this immutable observation is actually made,
 * before overlay; it must never be reconstructed from reviewedAt/args.now. */
function buildAuthorities(packet:GamePacket,review:AcceptedGameReview|null,observedAt:string,lookupAvailable=true):Authority[]{
 validatePacket(packet);assert.equal(packet.sport,'nfl');
 const gameId=packet.sourceGameId??packet.gameId,contexts=criticalContextHashes(packet);
 assert(instant(packet.cutoff)<=instant(observedAt),'Authority observation precedes source availability');
 const inputHash=review?.inputHash??review?.inputEvidence.digest;
 if(review){assert(review.issuedAt&&inputHash,'Exact review timestamp and input digest required');assert.equal(inputHash,review.inputEvidence.digest,'Immutable submitted input digest mismatch');assert.equal(review.sourceGameId??review.gameId,gameId);assert.equal(instant(review.lock),instant(packet.lock));assert.equal(instant(review.start),instant(packet.start));assert(instant(review.issuedAt!)<=instant(observedAt),'Review not available at authority observation');}
 return packet.players.map(p=>{const old=review?.players.find(r=>r.playerId===p.id),stored=review?.marketScopes?.[p.id]??[],unresolved=unresolvedForecastMarkets(p),same=old&&reviewedReaderContextCurrent(packet,review!,p.id),participation=playerParticipationEligibility(packet,p);
  const scopes=[...new Set([...p.markets,...stored])].map(market=>({market,status:(unresolved.includes(market)?'source_unresolved':!lookupAvailable?'review_lookup_unavailable':!review?'review_authority_missing':!old?'unreviewed_actor':!same?'context_changed':!stored.includes(market)?'unreviewed_scope':!old.law||(old.sourceDeclinedMarkets??[]).includes(market)?'declined':'qualified')as State}));
  return seal({gameId,actorId:p.id,scheduledStart:packet.start,team:propsTeam(p.team),opponent:propsTeam(p.opponent),lockAt:packet.lock,observedAt,currentContextHash:contexts[p.id],participationBlocked:participation.blocked,participationReason:participation.reason,review:review?{release:review!.release,inputHash:inputHash!,stage:review!.stage,issuedAt:review!.issuedAt!,contextHash:review!.criticalContextHashes[p.id]??null,lawHash:old?.law?.hash??null,playerDigest:old?digest(old):null}:null,scopes});
 });
}
/** readyAt is sampled after the actual native construction/AI overlay. Passing
 * a backdated board.evaluatedAt instead would violate this caller contract. */
function proveRow(row:Row,kind:'ai'|'native',contextHash:string,readyAt:string,quoteConfirmedAt:string,sourcePacketHash?:string):Proof{
 assert(actor(row),'Exact provider actor identity required');assert.equal(Boolean(row.aiReview),kind==='ai');
 if(kind==='native')assert(!String(row.modelRelease).startsWith('player_props_ai_'),'An AI forecast cannot be relabeled as a native baseline');
 if(kind==='ai')assert.equal(quoteConfirmedAt,row.aiReview!.quoteConfirmedAt,'Exact stored AI quote confirmation required');
 assert(instant(row.observedAt)<=instant(quoteConfirmedAt),'Confirmation precedes the selected quote');
 return seal({gameId:row.gameId,actorId:actor(row)!,event:event(row),kind,rowHash:rowHash(row),contextHash,readyAt,quoteConfirmedAt,...(sourcePacketHash?{sourcePacketHash}:{})});
}
/** The trusted writer calls this only after the immutable row and source packet
 * actually exist. Current provider quote identity/price supplies confirmation;
 * neither board.evaluatedAt nor a review time can stand in for actual readiness. */
function captureRowProofs(rows:Row[],packet:GamePacket,kind:'ai'|'native',readyAt:string,review?:AcceptedGameReview|null,nativeRows?:readonly Row[]):Proof[]{
 assert(instant(packet.cutoff)<=instant(readyAt),'Packet not available at row observation');
 if(!Object.hasOwn(packet,'executionQuotes')||!Array.isArray(packet.executionQuotes))return[];
 const contexts=criticalContextHashes(packet),sourcePacketHash=digest(packet),quotes=executionQuotes(packet,readyAt),proofs:Proof[]=[];
 const choices=kind==='ai'&&review?siteAiDecisions(packet,review,readyAt):[];
 const book=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
 for(const row of rows){
  const id=actor(row),player=packet.players.find(p=>p.id===id);
  if(!player||row.state==='locked'||row.gameId!==(packet.sourceGameId??packet.gameId)||Boolean(row.aiReview)!==(kind==='ai')||instant(row.scheduledStart)!==instant(packet.start)||instant(row.lockAt)!==instant(packet.lock)||propsTeam(row.team)!==propsTeam(player.team)||propsTeam(row.opponent)!==propsTeam(player.opponent)||!sameNflPropActorName(row.playerName,player.name,row.providerPlayerId)||!player.markets.includes(row.market))continue;
  if(row.projection===null||!Number.isFinite(row.projection)||!Number.isFinite(row.finalProbability)||row.finalProbability<0||row.finalProbability>1||row.grade==='Held')continue;
  if(kind==='native'){
   const heads=player.evidence.filter(e=>e.kind==='independent_model'&&e.source===row.modelRelease&&e.value&&typeof e.value==='object'&&!Array.isArray(e.value)&&e.value.market===row.market&&e.value.context);
   if(!heads.length||heads.some(e=>digest((e.value as Record<string,unknown>).context)!==digest(row.forecastContext)))continue;
  }
  if(kind==='ai'){
   const approved=review?.players.find(p=>p.playerId===id),e=row.aiReview;
   if(!review||!e||!approved?.law||!reviewedReaderContextCurrent(packet,review,id!)||e.release!==review.release||e.inputHash!==(review.inputHash??review.inputEvidence.digest)||e.lawHash!==approved.law.hash||e.stage!==review.stage||instant(e.reviewedAt)!==instant(review.issuedAt!)||!review.marketScopes[id!]?.includes(row.market)||approved.sourceDeclinedMarkets?.includes(row.market))continue;
   if(row.modelRelease!==e.release||row.calibrationRelease!==PROPS_AI_ESTIMATE_RELEASE||row.decisionRelease!==PROPS_AI_NFL_DECISION_RELEASE)continue;
   const index=review.marketScopes[id!].indexOf(row.market),f=lawForecast(approved.law,row.market,row.line,row.side==='yes'||row.market==='anytime_td'),prob=row.side==='under'?f.under:f.over,loss=row.side==='under'?f.over:f.under;
   const participation=playerParticipationEligibility(packet,player);
   if(e.exception!==qualifiedParticipationException(participation,approved.exceptions[index])||!e.sourceEligibility||digest(e.sourceEligibility)!==digest(participation))continue;
   if(e.confidence!==approved.confidence[index]||e.assessment!==approved.assessment||Math.abs(row.projection-f.mean)>1e-10||Math.abs(row.finalProbability-prob)>1e-10||Math.abs(row.expectedValue-(prob*(row.americanPrice>0?row.americanPrice/100:100/-row.americanPrice)-loss))>1e-10)continue;
   // The accepted conditional-law exception stays immutable. Publication may
   // independently add a genuine current own-player participation hold. Bind
   // that exact qualification, grade and evidence rather than either rejecting
   // the valid No Play or accepting an arbitrary replacement exception.
   const choice=choices.find(c=>c.playerId===id&&c.market===row.market&&c.line===row.line&&c.provider===row.provider&&book(c.book)===book(row.sportsbook)&&quoteContract(c.quote)===(row.side==='yes'?'milestone':'two_way'));
   const selected=quotes.find(q=>q.playerId===id&&q.market===row.market&&q.line===row.line&&q.side===row.side&&q.provider===row.provider&&book(q.book)===book(row.sportsbook)&&q.american===row.americanPrice&&quoteContract(q)===(row.side==='yes'?'milestone':'two_way'));
   // Only the writer's actual original baseline can establish the separate
   // missing-context hold. A row-supplied marker or a broad native head cannot.
   const qualification=nativeRows?nflNativePublicationContext(packet,id!,nativeRows).qualification:null;
   if(e.nativeQualification&&!nativeRows||digest(e.nativeQualification??null)!==digest(qualification))continue;
   if(!choice||!selected||row.grade!==(qualification||choice.evidence.exception?'No Play':row.side!==choice.side?'Watchlist':choice.grade))continue;
   const {executionEvidence:storedExecution,...storedEvidence}=e,{executionEvidence:ignoredExecution,...expectedEvidence}=choice.evidence;void ignoredExecution;
   if(digest(storedEvidence)!==digest({...expectedEvidence,...(qualification?{nativeQualification:qualification}:{}),quoteConfirmedAt:selected.receivedAt}))continue;
   const group=quotes.filter(q=>q.playerId===id&&q.market===row.market&&q.line===row.line&&q.provider===row.provider&&book(q.book)===book(row.sportsbook)&&quoteContract(q)===quoteContract(selected));
   if(!storedExecution||storedExecution.release!==PROPS_AI_EXECUTION_EVIDENCE_RELEASE||storedExecution.operation!=='member_row'||digest(storedExecution.selectedQuote)!==digest(selected)||digest(storedExecution.pricingQuotes)!==digest(group)||instant(storedExecution.pricedAt)<instant(selected.receivedAt)||instant(storedExecution.pricedAt)<instant(e.reviewedAt)||instant(storedExecution.pricedAt)>instant(readyAt)||instant(storedExecution.pricedAt)>=instant(packet.lock))continue;
  }
  const quote=quotes.find(q=>q.playerId===id&&q.market===row.market&&q.line===row.line&&q.side===row.side&&quoteContract(q)===(row.side==='yes'?'milestone':'two_way')&&book(q.book)===book(row.sportsbook)&&q.provider===row.provider&&q.american===row.americanPrice&&instant(q.observedAt)===instant(row.observedAt)&&q.receivedAtProvenance==='provider_response'&&!q.opening&&!q.live&&instant(q.observedAt)<=instant(q.receivedAt)&&instant(q.receivedAt)<=instant(readyAt)&&(!row.aiReview||row.aiReview.quoteConfirmedAt===q.receivedAt));
  if(quote)proofs.push(proveRow(row,kind,contexts[id!],readyAt,quote.receivedAt,sourcePacketHash));
 }
 return proofs;
}
function eligible(row:Row|undefined,proof:Proof|undefined,a:Authority,kind:'ai'|'native',now:string){
 if(!row||!proof)return false;verify(proof);
 assert.equal(proof.rowHash,rowHash(row),'Row changed after actual availability proof');assert.equal(proof.event,event(row));
 const nativeAge=instant(a.lockAt)-instant(row.observedAt);if(kind==='native'&&(nativeAge<0||nativeAge>nflPlayerPropsRuntimePolicy().maximumQuoteAgeHours*3600000))return false;
 return instant(row.lockAt)===instant(a.lockAt)&&instant(row.scheduledStart)===instant(a.scheduledStart)&&propsTeam(row.team)===a.team&&propsTeam(row.opponent)===a.opponent&&instant(a.lockAt)-instant(proof.quoteConfirmedAt)<=nflPlayerPropsRuntimePolicy().maximumQuoteAgeHours*3600000&&proof.kind===kind&&proof.actorId===a.actorId&&proof.gameId===a.gameId&&proof.contextHash===a.currentContextHash&&instant(proof.quoteConfirmedAt)<=instant(proof.readyAt)&&instant(proof.readyAt)-instant(proof.quoteConfirmedAt)<=nflPlayerPropsRuntimePolicy().maximumQuoteAgeHours*3600000&&instant(proof.readyAt)<=instant(now)&&instant(proof.readyAt)<instant(a.lockAt)&&instant(proof.quoteConfirmedAt)<instant(a.lockAt);
}
export function availableBeforeLock(row:Row,proof:Proof|undefined,now:string){
 if(!proof)return false;
 return eligible(row,proof,{actorId:proof.actorId,gameId:row.gameId,currentContextHash:proof.contextHash,lockAt:row.lockAt,scheduledStart:row.scheduledStart,team:propsTeam(row.team),opponent:propsTeam(row.opponent)}as Authority,row.aiReview?'ai':'native',now);
}
/** Repeated overlays can share an event while their immutable row differs.
 * Authenticate every relevant proof before selecting the exact row; another
 * genuine capture is neither this row's proof nor evidence of tampering. */
function exactRowProof(row:Row,proofs:readonly Proof[],now:string,authority?:Authority){
 const key=event(row),hash=rowHash(row),kind=row.aiReview?'ai':'native';
 return proofs.filter(p=>p.event===key).map(p=>{verify(p);return p;})
  .filter(p=>p.rowHash===hash&&(authority?eligible(row,p,authority,kind,now):availableBeforeLock(row,p,now)))
  .sort((a,b)=>instant(b.readyAt)-instant(a.readyAt)||a.binding.localeCompare(b.binding))[0];
}
export function supersedes(a:Authority,previous:Row[],now:string){
 verify(a);if(instant(now)<instant(a.lockAt)||instant(a.observedAt)>=instant(a.lockAt))return false;
 const prior=previous.filter(r=>r.state!=='locked'&&actor(r)===a.actorId&&r.gameId===a.gameId&&r.aiReview);
 // An older source observation cannot revoke a review that did not yet exist.
 if(prior.some(r=>instant(r.aiReview!.reviewedAt)>instant(a.observedAt)))return false;
 if(a.scopes.some(s=>s.status==='context_changed'||s.status==='source_unresolved'||s.status==='review_lookup_unavailable'||s.status==='review_authority_missing'))return true;
 if(!a.review||instant(a.review.issuedAt)>=instant(a.lockAt))return false;
 if(!prior.length)return true;
 // A routine native refresh must not revoke the same still-valid early read.
 const rank=(s:string)=>s==='final'?2:s==='early'?1:0;
 return prior.every(r=>rank(a.review!.stage)>rank(r.aiReview!.stage)||rank(a.review!.stage)===rank(r.aiReview!.stage)&&instant(a.review!.issuedAt)>instant(r.aiReview!.reviewedAt));
}
/** Existing stored locks always win. For future new locks, an authority proves
 * source/review availability independently from numeric candidate readiness. */
export function resolveScope(args:{authority:Authority;market:string;previousLocked?:Row;candidate?:Row;candidateProof?:Proof;native?:Row;nativeProof?:Proof;now:string}):{kind:string;row:Row|null;status?:State;reason?:string}{
 if(args.previousLocked?.state==='locked'){assert.equal(actor(args.previousLocked),args.authority.actorId);assert.equal(args.previousLocked.gameId,args.authority.gameId);assert.equal(args.previousLocked.market,args.market);return{kind:'locked_preserved',row:args.previousLocked};}
 const a=args.authority;verify(a);const status=a.scopes.find(s=>s.market===args.market)?.status??'unreviewed_scope';
 const observedBeforeLock=instant(a.observedAt)<instant(a.lockAt)&&(!a.review||instant(a.review.issuedAt)<instant(a.lockAt));
 if(!observedBeforeLock)return{kind:'unavailable',row:null,status,reason:'No genuinely prelock authority observation'};
 if(status==='qualified'&&a.review&&args.candidate?.market===args.market&&args.candidate.aiReview&&eligible(args.candidate,args.candidateProof,a,'ai',args.now)){
  const e=args.candidate!.aiReview!;
  if(e.release===a.review.release&&e.inputHash===a.review.inputHash&&e.lawHash===a.review.lawHash&&e.stage===a.review.stage&&instant(e.reviewedAt)===instant(a.review.issuedAt))return{kind:'qualified_ai',row:qualifyAuthorityParticipation(args.candidate,a),status};
 }
 if(status!=='source_unresolved'&&args.native?.market===args.market&&!args.native.aiReview&&args.native.grade!=='Held'&&Number.isFinite(args.native.projection)&&Number.isFinite(args.native.finalProbability)&&args.native.finalProbability>=0&&args.native.finalProbability<=1&&Number.isFinite(args.native.expectedValue)&&Number.isInteger(args.native.americanPrice)&&Math.abs(args.native.americanPrice)>=100&&eligible(args.native,args.nativeProof,a,'native',args.now))return{kind:'native_baseline',row:qualifyAuthorityParticipation(args.native,a),status};
 return{kind:'unavailable',row:null,status,reason:'No eligible exact prelock candidate/baseline; never resurrect an older AI scope'};
}
function qualifyAuthorityParticipation(row:Row,a:Authority):Row{
 // Its guarded AI publication already owns the exact source exception and
 // eligibility evidence. Keep that actual No Play tuple stable for its proof;
 // adding a native health-hold label here would change the captured row hash.
 if(row.aiReview&&row.grade==='No Play')return row;
 return a.participationBlocked&&row.gameId===a.gameId&&actor(row)===a.actorId&&instant(row.scheduledStart)===instant(a.scheduledStart)&&instant(row.lockAt)===instant(a.lockAt)&&propsTeam(row.team)===a.team&&propsTeam(row.opponent)===a.opponent?{...row,grade:row.grade==='Held'?'Held':'No Play',healthHolds:[...new Set([...row.healthHolds,`source_participation_unavailable:${a.participationReason}`])]}:row;
}

export type SourceFrame={gameId:string;kind:'ai'|'native'|'authority';sourcePacketHash:string;cutoff:string;readyAt:string;lockAt:string};
export type NflLockHandoff={authorities:Authority[];nativeRows:Row[];nativeProofs:Proof[];candidateProofs:Proof[];sourceFrames?:SourceFrame[];executionAuthorities?:ExecutionAuthority[]};
/** Freeze source + constructed rows together, then sample the real observation
 * clock. Production callers never supply a hash or reuse board.evaluatedAt.
 * Clock injection exists solely for deterministic offline boundary controls. */
function captureBundle(rows:Row[],packet:GamePacket,review:AcceptedGameReview|null,kind:'ai'|'native',clock:()=>string,nativeRows?:readonly Row[]):NflLockHandoff{
 const source:GamePacket=freeze(JSON.parse(JSON.stringify(packet)));
 const gameId=source.sourceGameId??source.gameId;
 const readyAt=clock();validatePacket(source);
 const gameRows=rows.filter(r=>r.gameId===gameId);
 // Native fallback owns its separate qualification. An AI proof must validate
 // the already materialized publication exactly, never repair its grade here.
 const frozen:Row[]=freeze(JSON.parse(JSON.stringify(kind==='native'?qualifyNflSourceParticipation(gameRows,source,readyAt):gameRows)));
 const originalNative=nativeRows?freeze(JSON.parse(JSON.stringify(nativeRows))) as Row[]:undefined;
 const proofs=captureRowProofs(frozen,source,kind,readyAt,review,originalNative);
 return{authorities:[],nativeRows:kind==='native'?frozen:[],nativeProofs:kind==='native'?proofs:[],candidateProofs:kind==='ai'?proofs:[],sourceFrames:[{gameId,kind,sourcePacketHash:digest(source),cutoff:source.cutoff,readyAt,lockAt:source.lock}]};
}
function observeAuthority(packet:GamePacket,review:AcceptedGameReview|null,lookupAvailable:boolean,clock:()=>string):NflLockHandoff{
 // The information is fully materialized at entry. Observe it BEFORE any
 // overlay/hash work; readiness of a later numeric candidate is separate.
 const observedAt=clock(),source:GamePacket=freeze(JSON.parse(JSON.stringify(packet)));
 const gameId=source.sourceGameId??source.gameId,sourcePacketHash=digest(source);
 const authorities=buildAuthorities(source,review,observedAt,lookupAvailable);
 const executionAuthorities=Array.isArray(source.executionQuotes)?[seal({gameId,scheduledStart:source.start,lockAt:source.lock,observedAt,order:++executionOrder,sourcePacketHash,actors:source.players.map(p=>({id:p.id,markets:[...p.markets]})),quotes:executionQuotes(source,observedAt).map(q=>({playerId:q.playerId,market:q.market,line:q.line,side:q.side,provider:q.provider,book:q.book,american:q.american,...(q.offerContract?{offerContract:q.offerContract}:{})}))})]:[];
 return{authorities,nativeRows:[],nativeProofs:[],candidateProofs:[],executionAuthorities,sourceFrames:[{gameId,kind:'authority',sourcePacketHash,cutoff:source.cutoff,readyAt:observedAt,lockAt:source.lock}]};
}
export function observeNflSourceAuthority(packet:GamePacket,review:AcceptedGameReview|null,lookupAvailable:boolean):NflLockHandoff{assert.equal(arguments.length,3,'Production authority rejects supplied clocks/hashes');return observeAuthority(packet,review,lookupAvailable,()=>new Date().toISOString());}
export function testNflSourceAuthority(clock:()=>string){assert.equal(process.env.NODE_ENV,'test');return(packet:GamePacket,review:AcceptedGameReview|null,lookupAvailable=true)=>observeAuthority(packet,review,lookupAvailable,clock);}
export function testNflAuthority(packet:GamePacket,review:AcceptedGameReview|null,at:string,lookupAvailable=true){assert.equal(process.env.NODE_ENV,'test');return buildAuthorities(packet,review,at,lookupAvailable);}
export function testNflHandoffProof(...args:Parameters<typeof proveRow>){assert.equal(process.env.NODE_ENV,'test');return proveRow(...args);}
/** Production takes no caller clock, hash or availability label. */
export function captureNflHandoffBundle(rows:Row[],packet:GamePacket,review:AcceptedGameReview|null,kind:'ai'|'native',nativeRows?:readonly Row[]):NflLockHandoff{assert(arguments.length===4||arguments.length===5&&Array.isArray(nativeRows),'Production capture rejects supplied clocks/hashes');return captureBundle(rows,packet,review,kind,()=>new Date().toISOString(),nativeRows);}
/** Exact same constructor under an explicit offline test clock. */
export function testNflHandoffCapture(clock:()=>string){assert.equal(process.env.NODE_ENV,'test','Injected capture clocks are offline-test only');return(rows:Row[],packet:GamePacket,review:AcceptedGameReview|null,kind:'ai'|'native',nativeRows?:readonly Row[])=>captureBundle(rows,packet,review,kind,clock,nativeRows);}
export function mergeNflHandoffs(frames:NflLockHandoff[]):NflLockHandoff{return{authorities:frames.flatMap(f=>f.authorities),nativeRows:frames.flatMap(f=>f.nativeRows),nativeProofs:frames.flatMap(f=>f.nativeProofs),candidateProofs:frames.flatMap(f=>f.candidateProofs),sourceFrames:frames.flatMap(f=>f.sourceFrames??[]),executionAuthorities:frames.flatMap(f=>f.executionAuthorities??[])}};
/** Prepare only future locks; the authoritative existing reconciler still owns
 * lock construction, evidence merging, member selection and every stored lock. */
export function prepareNflLockHandoff(args:NflLockHandoff&{nextRows:Row[];previousRows:Row[];previousGeneratedAt?:string;now:string}){
 const currentExecutions=new Map<string,ExecutionAuthority>();
 for(const capture of [...(args.executionAuthorities??[])].filter(c=>instant(c.observedAt)<=instant(args.now)&&instant(c.observedAt)<instant(c.lockAt)).map(c=>{verify(c);return c;}).sort((a,b)=>instant(b.observedAt)-instant(a.observedAt)||b.order-a.order))if(!currentExecutions.has(capture.gameId))currentExecutions.set(capture.gameId,capture);
 const executionAllows=(row:Row):boolean|undefined=>{
  const capture=currentExecutions.get(row.gameId);if(!capture)return undefined;
  const id=actor(row),book=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
  return instant(row.scheduledStart)===instant(capture.scheduledStart)&&instant(row.lockAt)===instant(capture.lockAt)
   &&capture.actors.some(p=>p.id===id&&p.markets.includes(row.market))
   &&capture.quotes.some(q=>q.playerId===id&&q.market===row.market&&q.line===row.line&&q.side===row.side&&q.provider===row.provider&&book(q.book)===book(row.sportsbook)&&q.american===row.americanPrice&&quoteContract(q)===(row.side==='yes'?'milestone':'two_way'));
 };
 const rank=(a:Authority)=>a.review?.stage==='final'?2:a.review?.stage==='early'?1:0;
 const ordered=[...args.authorities].filter(a=>{verify(a);return instant(a.observedAt)<=instant(args.now)&&instant(a.observedAt)<instant(a.lockAt);}).sort((a,b)=>instant(b.observedAt)-instant(a.observedAt)||rank(b)-rank(a)||instant(b.review?.issuedAt??b.observedAt)-instant(a.review?.issuedAt??a.observedAt)||a.binding.localeCompare(b.binding));
 const latest=new Map<string,Authority>();
 for(const a of ordered){const key=JSON.stringify([a.gameId,a.actorId]);const prior=latest.get(key);if(!prior)latest.set(key,a);else if(instant(a.observedAt)===instant(prior.observedAt)&&rank(a)===rank(prior)&&instant(a.review?.issuedAt??a.observedAt)===instant(prior.review?.issuedAt??prior.observedAt)&&a.binding!==prior.binding)throw Error('Conflicting same-time actor authorities');}
 const active=[...latest.values()].filter(a=>supersedes(a,args.previousRows,args.now));
 const diagnostics:{actorId:string|null;market:string;kind:string;status:string|null}[]=[],nextRows:Row[]=[];
 const preferredEvents=new Set<string>();
 for(const originalRow of args.nextRows){
  if(originalRow.state==='locked'){nextRows.push(originalRow);continue;}
  const currentAuthority=latest.get(JSON.stringify([originalRow.gameId,actor(originalRow)])),row=currentAuthority?qualifyAuthorityParticipation(originalRow,currentAuthority):originalRow;
  if(executionAllows(row)===false){diagnostics.push({actorId:actor(row),market:row.market,kind:'unavailable',status:'current_execution_withdrawn'});continue;}
  if(instant(args.now)<instant(row.lockAt)){nextRows.push(row);continue;}
  const a=active.find(a=>a.actorId===actor(row)&&a.gameId===row.gameId);
  if(!a){
   const proof=exactRowProof(row,row.aiReview?args.candidateProofs:args.nativeProofs,args.now);
   if(availableBeforeLock(row,proof,args.now)){nextRows.push(row);if(row.aiReview)preferredEvents.add(event(row));}
   else diagnostics.push({actorId:actor(row),market:row.market,kind:'unavailable',status:'candidate_not_available_prelock'});
   continue;
  }
  const baseline=args.nativeRows.filter(r=>event(r)===event(row)).flatMap(native=>{
   const proof=exactRowProof(native,args.nativeProofs,args.now,a);return proof?[{row:native,proof}]:[];
  }).sort((x,y)=>instant(y.proof.readyAt)-instant(x.proof.readyAt)||x.proof.binding.localeCompare(y.proof.binding))[0];
  const result=resolveScope({authority:a,market:row.market,candidate:row,candidateProof:exactRowProof(row,args.candidateProofs,args.now,a),native:baseline?.row,nativeProof:baseline?.proof,now:args.now});
  const withdrawn=result.row&&executionAllows(result.row)===false;
  if(result.row&&!withdrawn)nextRows.push(result.row);
  diagnostics.push({actorId:a.actorId,market:row.market,kind:withdrawn?'unavailable':result.kind,status:withdrawn?'current_execution_withdrawn':result.status??null});
 }
 const sourceBlocks=(row:Row)=>{const a=latest.get(JSON.stringify([row.gameId,actor(row)]));return Boolean(a&&qualifyAuthorityParticipation(row,a)!==row);};
 const suppressPrevious=(row:Row)=>row.state!=='locked'&&(executionAllows(row)===false||sourceBlocks(row)||instant(args.now)>=instant(row.lockAt)&&(active.some(a=>a.actorId===actor(row)&&a.gameId===row.gameId)||Boolean(row.aiReview&&preferredEvents.has(event(row)))||Boolean(args.previousGeneratedAt&&instant(args.previousGeneratedAt)>=instant(row.lockAt))));
 return{nextRows,suppressPrevious,diagnostics};
}
