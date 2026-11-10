import {GENERATIVE_WIRE_RELEASE as LEGACY_R4_WIRE_RELEASE} from "../lib/playerPropsAi/generativeCoordinates";
import {compileReaderClaims} from "../lib/playerPropsAi/readerClaims";
import {PROPS_AI_WIRE_RELEASE} from "../lib/playerPropsAi/scenarioCoordinates";
import {verifiedReaderFixture} from "./lib/player-props-ai-reader-fixture";
/** Synthetic original-part admission proof. Every network request is forbidden. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {OriginalPartActorAdmission,type ActorAdmissionProposal,type ActorAdmissionLineage} from "../lib/playerPropsAi/actorAdmission";
import {PRODUCT_RELEASE,type GamePacket,type Player,type Json} from "../lib/playerPropsAi/evidenceContract";
import {digest} from "../lib/playerPropsAi/evidence";
import {readerEvidence,READER_AREAS} from "../lib/playerPropsAi/readerCoverage";
import {evidenceAliases} from "../lib/playerPropsAi/input";
import {independentPriorEvents} from "../lib/playerPropsAi/priorEvents";
import {encodeCanonicalScenarioLaw} from "../lib/playerPropsAi/generativeCoordinates";
import {jointReviewRequest,parseJointReview,parseJointPlayerReview} from "../lib/playerPropsAi/request";
import {serializeAiRequest} from "../lib/playerPropsAi/openai";
import {playerSubset} from "../lib/playerPropsAi/partitions";
import {PROPS_AI_PRIMARY_MODEL,PROPS_AI_STRONG_MODEL} from "../lib/playerPropsAi/releases";

globalThis.fetch=async()=>{throw Error("Actor admission proof forbids network and paid calls");};
const now="2026-11-09T21:00:00Z",v=(n:number)=>Array<number>(16).fill(n),clone=<T>(x:T):T=>structuredClone(x);
const sha=(x:string)=>createHash("sha256").update(x).digest("hex");
const players:Player[]=["a","b","c"].map((id,index)=>({id,name:`Synthetic ${id}`,team:"BOS",opponent:"NYK",markets:["points"],missing:[],evidence:[
  ...[10,20,30].map((points,i)=>({id:`${id}:game:${i}`,kind:"recent_games" as const,source:"synthetic stats",availableAt:now,
    value:{game:{startTime:`2026-11-0${i+5}T18:00:00Z`,homeTeam:"BOS",awayTeam:"NYK"},box:{minutes:30,points:points+index,oreb:1,dreb:3,ast:2,fg3m:1}}})),
  {id:`${id}:prior`,kind:"independent_model" as const,source:"synthetic native",availableAt:now,value:{market:"points",line:20.5+index,independentProjection:20+index,
    selectedSide:"under",independentSelectedSideProbability:.6,independentEventStatus:"stored_native_reference_side",probabilityOfUnspecifiedIndependentSide:null,finalArbitratedSide:"over"}},
]}));
const packet:GamePacket={release:PRODUCT_RELEASE,sport:"nba",gameId:"synthetic",sourceGameId:"synthetic",start:"2026-11-09T23:00:00Z",lock:"2026-11-09T22:00:00Z",cutoff:now,stage:"final",sourceLimitations:[],
  sharedGameContext:{schema:"exact_original_peer_background",actors:["a","b","c","outside-this-part"],meaning:"Preserve the exact original game background"},players,
  quotes:players.flatMap((p,index)=>(["over","under"] as const).map(side=>({id:`${p.id}:${side}`,playerId:p.id,market:"points",line:20.5+index,book:"synthetic-book",provider:"synthetic",side,american:110,receivedAt:now,observedAt:now,receivedAtProvenance:"provider_response" as const,opening:false,live:false})))
};
players[1].evidence.push({id:'b:availability',kind:'availability',source:'synthetic exact-game report',availableAt:now,value:{context:{away:{team:'BOS',known:true,players:[]},home:{team:'NYK',known:true,players:[]}}}});
const aliases=evidenceAliases(packet),facts=readerEvidence(packet);
const alias=(id:string)=>[...aliases].find(([,source])=>source===id)![0];
type RawRow={assessment:string|{claimIds:string[];judgment:string};priorRead:Record<string,string>;coverage:Record<string,{claimIds:string[];judgment:string;effect:string;observation?:string}>;evidenceIds:string[];gaps:string[];law:{weights:number[];outcomes:Record<string,number[]>}|null;confidence:number[];exceptions:(string|null)[]};
function row(p:Player,bad=false):RawRow{
  const index=players.findIndex(player=>player.id===p.id),scores=bad?v(50):[10+index,30+index,...v(20+index).slice(2)];
  return verifiedReaderFixture(packet,p.id,{assessment:"The supplied facts require a cautious conditional forecast.",priorRead:Object.fromEntries(independentPriorEvents(p).map(prior=>[alias(prior.sourceId),prior.preferredOutcome])),
    coverage:Object.fromEntries(READER_AREAS.map(area=>[area,{status:facts[p.id][area].status,factIds:facts[p.id][area].facts.slice(0,1).map(f=>f.id),effect:"uncertain",observation:"The supplied evidence requires contextual caution."}])),
    evidenceIds:[alias(p.evidence[0].id)],gaps:[],law:encodeCanonicalScenarioLaw("nba",p,{weights:[1,1,...v(0).slice(2)],outcomes:{points:scores,rebounds:v(4),assists:v(2),threes:v(1)}}),confidence:[2],exceptions:[null]});
}
const good=Object.fromEntries(players.map(p=>[p.id,row(p)])),first={wireRelease:PROPS_AI_WIRE_RELEASE,players:{...clone(good),b:row(players[1],true)}};
const wire=(value:unknown)=>" \n"+JSON.stringify(value)+"\n";
const lineage=(phase:1|2,model:ActorAdmissionLineage["model"]=PROPS_AI_PRIMARY_MODEL):ActorAdmissionLineage=>({part:1,phase,model,requestedTier:"default",actualTier:"default",responseId:`synthetic-phase-${phase}`,requestHash:sha(`synthetic-exact-request-${phase}`)});
function commit(session:OriginalPartActorAdmission,proposal:ActorAdmissionProposal){
  session.retain(proposal,{receiptRecorded:true,receiptId:`synthetic:${proposal.lineage.phase}`,actualMicro:1000,
    archivedInputDigest:proposal.sourceInputHash,archivedRequestSha256:proposal.lineage.requestHash,archivedDraftSha256:proposal.draftSha256});
}
function setup(model:ActorAdmissionLineage["model"]=PROPS_AI_PRIMARY_MODEL){
  const session=new OriginalPartActorAdmission(packet),text=wire(first),proposal=session.propose(text,lineage(1,model));
  assert.equal(proposal.globalEnvelopeValid,true);assert.deepEqual(proposal.admittedActors.map(actor=>actor.playerId),["a","c"]);
  assert.deepEqual(proposal.rejectedActors.map(actor=>actor.playerId),["b"]);assert.equal(proposal.draftSha256,sha(text));assert.equal(proposal.draftBytes,Buffer.byteLength(text));
  assert.throws(()=>session.propose(text,lineage(2)),/sequential/);assert.equal(session.retainedCanonicalHash("a"),null,"Inspection alone never retains before billing/archive receipt");
  commit(session,proposal);assert.deepEqual(session.pendingActorIds(),["b"]);return {session,proposal};
}
const originalHash=digest(packet),requestBefore=serializeAiRequest(jointReviewRequest(packet,PROPS_AI_PRIMARY_MODEL,7000,"P1 mean check"),{serviceTier:"default"});
const {session,proposal}=setup(),aHash=session.retainedCanonicalHash("a"),cHash=session.retainedCanonicalHash("c");
const regressed=clone(good);regressed.a=row(players[0],true);
const correction=session.propose(wire({wireRelease:PROPS_AI_WIRE_RELEASE,players:regressed}),lineage(2));
assert.deepEqual(correction.requestedActorIds,["a","b","c"]);assert.deepEqual(correction.consumedActorIds,["b"]);assert.deepEqual(correction.ignoredActorIds,["a","c"]);assert.deepEqual(correction.admittedActors.map(actor=>actor.playerId),["b"]);
assert.throws(()=>session.finish(),/Incomplete/);commit(session,correction);
const finished=session.finish();const originalClaimCatalog=compileReaderClaims(packet);assert.equal(finished.review.players.length,3);assert.equal(session.retainedCanonicalHash("a"),aHash);assert.equal(session.retainedCanonicalHash("c"),cHash);
assert.deepEqual(finished.actorProvenance.map(actor=>[actor.playerId,actor.phase]),[["a",1],["b",2],["c",1]]);assert.equal(new Set(finished.actorProvenance.map(actor=>actor.playerId)).size,3);
assert.equal(digest(finished.review),digest(parseJointReview(packet,finished.raw)),"Final original full parser validates the combined raw actors");
for(const actor of finished.review.players)assert.equal(actor.sourceReadProofs?.catalogHash,digest(originalClaimCatalog[actor.playerId]),"Retained factual readings remain bound to their original actor catalog across phases");
const unrestricted=clone(good);unrestricted.a.assessment="The report says the player is Out.";const rejectedProse=new OriginalPartActorAdmission(packet).propose(wire({wireRelease:PROPS_AI_WIRE_RELEASE,players:unrestricted}),lineage(1));assert.equal(rejectedProse.globalEnvelopeValid,false);assert.equal(rejectedProse.admittedActors.length,0,"Unrestricted prose is never admitted under future wireR5");
assert.equal(digest(parseJointPlayerReview(packet,"a",good.a)),proposal.admittedActors[0].canonicalHash);
assert.equal(digest(packet),originalHash);assert.equal(digest(session.packet),originalHash);
assert.equal(serializeAiRequest(jointReviewRequest(packet,PROPS_AI_PRIMARY_MODEL,7000,"P1 mean check"),{serviceTier:"default"}),requestBefore,"Retention does not change any request/input/schema or token envelope");
assert.throws(()=>session.propose(wire(first),lineage(2)),/sequential|unadmitted/);assert.throws(()=>commit(session,correction),/already committed/);
assert.throws(()=>session.packet.players[0].markets.push("rebounds"));assert.throws(()=>proposal.admittedActors[0].rawActorHash="changed");assert.throws(()=>finished.actorProvenance[0].marketScope.push("rebounds"));

for(const invalid of [null,{wireRelease:"wrong",players:good},{wireRelease:LEGACY_R4_WIRE_RELEASE,players:good},{wireRelease:PROPS_AI_WIRE_RELEASE,players:{}},
  {wireRelease:PROPS_AI_WIRE_RELEASE,players:{a:good.a,b:good.b}},{wireRelease:PROPS_AI_WIRE_RELEASE,players:{...good,extra:good.a}},
  {wireRelease:PROPS_AI_WIRE_RELEASE,players:good,extra:"unexpected"},{wireRelease:PROPS_AI_WIRE_RELEASE,players:{...good,a:null}}]){
  const badSession=new OriginalPartActorAdmission(packet),badProposal=badSession.propose(wire(invalid),lineage(1));
  assert.equal(badProposal.globalEnvelopeValid,false);assert.equal(badProposal.admittedActors.length,0);commit(badSession,badProposal);assert.equal(badSession.pendingActorIds().length,3);assert.throws(()=>badSession.finish());
}
{
  const badSession=new OriginalPartActorAdmission(packet),badProposal=badSession.propose("{broken JSON",lineage(1));assert.equal(badProposal.admittedActors.length,0);assert.equal(badProposal.globalEnvelopeValid,false);commit(badSession,badProposal);assert.throws(()=>badSession.finish());
}
for(const values of [{a:good.a,b:good.b},{...clone(good),extra:good.a},{...clone(good),a:null}]){
  const {session:s}=setup(),old=s.retainedCanonicalHash("a"),badProposal=s.propose(wire({wireRelease:PROPS_AI_WIRE_RELEASE,players:values}),lineage(2));
  assert.equal(badProposal.admittedActors.length,0);assert.equal(badProposal.globalEnvelopeValid,false);commit(s,badProposal);assert.equal(s.retainedCanonicalHash("a"),old);assert.throws(()=>s.finish());
}
{
  const {session:s}=setup(),bad=s.propose(wire(first),lineage(2));assert.equal(bad.admittedActors.length,0);commit(s,bad);assert.deepEqual(s.pendingActorIds(),["b"]);assert.throws(()=>s.finish(),/whole part/);
}
// Source/physical interpretation failures in unconsumed actors may be ignored;
// malformed full response shapes may never be ignored.
{
  const {session:s}=setup(),ignored=clone(good);ignored.a.law!.outcomes.points_excluding_made_threes=v(10000);ignored.a.law!.outcomes.threes=v(10000);
  assert.throws(()=>parseJointReview(packet,{wireRelease:PROPS_AI_WIRE_RELEASE,players:ignored}));
  const validTarget=s.propose(wire({wireRelease:PROPS_AI_WIRE_RELEASE,players:ignored}),lineage(2));assert.equal(validTarget.globalEnvelopeValid,true);assert.deepEqual(validTarget.admittedActors.map(actor=>actor.playerId),["b"]);commit(s,validTarget);
  assert.equal(s.finish().review.players[0].law!.hash,finished.review.players[0].law!.hash);
}
// An entirely schema-valid new actor still must pass the SAME original parser's
// source citations, prior, semantic coverage, physical and numerical checks.
{
  const invalid=clone(good);invalid.b.assessment={claimIds:[originalClaimCatalog.b.areas.availability.requiredClaimIds[0]],judgment:'supports'};
  const s=new OriginalPartActorAdmission(packet),p=s.propose(wire({wireRelease:PROPS_AI_WIRE_RELEASE,players:invalid}),lineage(1));
  assert.equal(p.globalEnvelopeValid,true);assert(!p.admittedActors.some(actor=>actor.playerId==="b"));assert.match(p.rejectedActors.find(actor=>actor.playerId==="b")!.reason,/Unknown source|directional effect/);
}
{
 const initial=clone(good);initial.b.assessment={claimIds:[originalClaimCatalog.b.areas.availability.requiredClaimIds[0]],judgment:'supports'};
 const claimsSession=new OriginalPartActorAdmission(packet),firstClaims=claimsSession.propose(wire({wireRelease:PROPS_AI_WIRE_RELEASE,players:initial}),lineage(1));
 assert.equal(firstClaims.globalEnvelopeValid,true);assert.deepEqual(firstClaims.admittedActors.map(a=>a.playerId),['a','c']);commit(claimsSession,firstClaims);
 const heldA=claimsSession.retainedCanonicalHash('a'),corrected=clone(good);corrected.a.law!.outcomes.points_excluding_made_threes=v(10000);
 const secondClaims=claimsSession.propose(wire({wireRelease:PROPS_AI_WIRE_RELEASE,players:corrected}),lineage(2));
 assert.deepEqual(secondClaims.admittedActors.map(a=>a.playerId),['b']);assert.deepEqual(secondClaims.ignoredActorIds,['a','c']);commit(claimsSession,secondClaims);
 const completeClaims=claimsSession.finish();assert.equal(claimsSession.retainedCanonicalHash('a'),heldA);
 for(const actor of completeClaims.review.players)assert.equal(actor.sourceReadProofs?.catalogHash,digest(originalClaimCatalog[actor.playerId]));
 assert.equal(completeClaims.review.players.find(a=>a.playerId==='b')!.coverage.availability.effect,'uncertain','Only the corrected source interpretation is consumed after its recorded known charge');
}
for(const kind of ["unknown","unrecorded","input","request","draft"] as const){
  const s=new OriginalPartActorAdmission(packet),p=s.propose(wire(first),lineage(1));
  assert.throws(()=>s.retain(p,{receiptRecorded:kind!=="unrecorded",receiptId:"synthetic",actualMicro:kind==="unknown"?null:1000,
    archivedInputDigest:kind==="input"?sha("wrong"):p.sourceInputHash,archivedRequestSha256:kind==="request"?sha("wrong"):p.lineage.requestHash,archivedDraftSha256:kind==="draft"?sha("wrong"):p.draftSha256}));
  assert.equal(s.retainedCanonicalHash("a"),null);assert.throws(()=>s.propose(wire(first),lineage(2)),/Unsafe|sequential/);assert.throws(()=>s.finish());
  assert.throws(()=>commit(s,p),/Unsafe/,"A later caller assertion cannot convert an unknown/missing archive receipt into admission");
}
{
  const {session:s}=setup(),old=s.retainedCanonicalHash("a"),p=s.propose(wire({wireRelease:PROPS_AI_WIRE_RELEASE,players:good}),lineage(2));
  assert.throws(()=>s.retain(p,{receiptRecorded:true,receiptId:"phase2-unknown",actualMicro:null,archivedInputDigest:p.sourceInputHash,archivedRequestSha256:p.lineage.requestHash,archivedDraftSha256:p.draftSha256}),/known-usage/);
  assert.equal(s.retainedCanonicalHash("a"),old,"Earlier admitted actors remain exact after a later unsafe receipt");assert.equal(s.retainedCanonicalHash("b"),null);assert.throws(()=>s.finish(),/Unsafe/);
}
for(const corruption of ["cross-player-citation","prior-event","extra-actor-field"] as const){
  const invalid=clone(good);
  if(corruption==="cross-player-citation")invalid.b.evidenceIds=[alias(players[0].evidence[0].id)];
  else if(corruption==="prior-event")invalid.b.priorRead[alias(players[1].evidence.at(-1)!.id)]="over";
  else Object.assign(invalid.b,{extra:"not-requested"});
  const s=new OriginalPartActorAdmission(packet),p=s.propose(wire({wireRelease:PROPS_AI_WIRE_RELEASE,players:invalid}),lineage(1));
  assert.equal(p.globalEnvelopeValid,false);assert.equal(p.admittedActors.length,0,"A changed schema/citation/prior contract cannot be called an original-envelope actor admission");
}
{
  const s=new OriginalPartActorAdmission(packet),other=new OriginalPartActorAdmission(packet),p=s.propose(wire(first),lineage(1));assert.throws(()=>commit(other,p),/foreign/);assert.throws(()=>s.propose(wire(first),lineage(1)),/sequential/);
}
{
  const {session:s}=setup(PROPS_AI_STRONG_MODEL);assert.throws(()=>s.propose(wire({wireRelease:PROPS_AI_WIRE_RELEASE,players:good}),lineage(2,PROPS_AI_STRONG_MODEL)),/primary model/);
  const p=s.propose(wire({wireRelease:PROPS_AI_WIRE_RELEASE,players:good}),lineage(2));commit(s,p);const result=s.finish();assert.equal(result.actorProvenance[0].model,PROPS_AI_STRONG_MODEL);assert.equal(result.actorProvenance[1].model,PROPS_AI_PRIMARY_MODEL);
}
const subset=playerSubset(packet,["b"]);assert.notEqual(digest([...evidenceAliases(subset)]),digest([...aliases]));assert.notEqual(digest(readerEvidence(subset).b),digest(facts.b));assert.notEqual(digest(subset.sharedGameContext),digest(packet.sharedGameContext));
assert.equal(session.aliasesHash,digest([...aliases]));assert.equal(session.factsHash,digest(facts));assert.equal(digest(session.marketScopes),digest(Object.fromEntries(players.map(p=>[p.id,p.markets]))));
const priorOnly=clone(packet);priorOnly.players[1].evidence=priorOnly.players[1].evidence.filter(e=>e.kind!=="recent_games");assert.notEqual(digest(priorOnly),session.sourceInputHash);
assert.equal(digest(packet),originalHash);assert.equal(digest(proposal.admittedActors[0].raw),proposal.admittedActors[0].rawActorHash);assert.equal(digest(proposal.admittedActors[0].canonical),proposal.admittedActors[0].canonicalHash);
// Keep arbitrary synthetic source data strictly JSON and exercise the exact peer context.
assert.equal((session.packet.sharedGameContext as Record<string,Json>).schema,"exact_original_peer_background");
console.log("Original-part actor admission passed: full schema and actual shared actor/full parsers, unchanged alias/fact/source/request universes, immutable validated actors, ignored resampled regressions, exact receipt/archive hashes, known-billing prerequisite, disjoint model/phase lineage, incomplete whole-part refusal and two sequential phases. No I/O or paid calls.");
