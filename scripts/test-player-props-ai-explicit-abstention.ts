/** Real source normalization, admission and publication; all HTTP is forbidden. */
import assert from 'node:assert/strict';
import {sourceFixture,accepted} from './test-player-props-ai-exact-paired-confidence';
import {parseJointReview,parseJointPlayerReview} from '../lib/playerPropsAi/request';
import {encodeCanonicalScenarioLaw} from '../lib/playerPropsAi/generativeCoordinates';
import {PROPS_AI_WIRE_RELEASE} from '../lib/playerPropsAi/scenarioCoordinates';
import {siteAiDecisions,siteReviewQualification} from '../lib/playerPropsAi/publication';
import {PROPS_AI_RELEASE,propsReviewHasMemberExecutionContracts,propsReviewHasVerifiedReaderClaims} from '../lib/playerPropsAi/releases';
import {digest} from '../lib/playerPropsAi/evidence';
import type {GamePacket} from '../lib/playerPropsAi/evidenceContract';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import {compileReaderClaims} from '../lib/playerPropsAi/readerClaims';
import {applyNbaSiteAi,applyNflSiteAi,applyMlbSiteAi} from '../lib/playerPropsAi/siteBindings';
import {advanceNbaPlayerPropsCandidateLifecycle} from '../lib/services/nba/nbaPlayerPropsLifecycle';
import {reconcileNflPlayerPropsProductionSnapshot,buildNflPlayerPropsMemberSnapshot} from '../lib/services/football/nflPlayerPropsProductionContract';
globalThis.fetch=async()=>{throw Error('Explicit abstention proof forbids network');};
const at='2026-11-10T22:23:00Z';
let controls=0,declinedRows=0,supportedPromotions=0;
function raw(packet:GamePacket,review:AcceptedGameReview){
 return{wireRelease:PROPS_AI_WIRE_RELEASE,players:Object.fromEntries(review.players.map(p=>{
  const proof=p.sourceReadProofs!;
  return[p.playerId,{assessment:proof.assessment,coverage:proof.areas,gaps:proof.gaps,exceptions:proof.exceptions,
   priorRead:p.priorRead,evidenceIds:p.evidenceIds,confidence:p.confidence,
   law:p.law?encodeCanonicalScenarioLaw(packet.sport,packet.players.find(x=>x.id===p.playerId)!,{weights:p.law.integerWeights!,outcomes:p.law.outcomes}):null}];
 }))};
}
for(const sport of ['nba','nfl','mlb'] as const)for(const side of ['over','under'] as const){
 const f=sourceFixture(sport,side),p=f.packet.players[0],baseline=accepted(f.packet,side);
 const before=digest({packet:f.packet,baseline});
 assert.equal(siteAiDecisions(f.packet,baseline,at).length,1);supportedPromotions++;
 const draft=raw(f.packet,baseline),row=draft.players[p.id];
 assert.deepEqual(parseJointReview(f.packet,draft).players,baseline.players);controls++;
 row.exceptions=p.markets.map(()=> 'forecast_declined');
 const parsed=parseJointReview(f.packet,draft),single=parseJointPlayerReview(f.packet,p.id,row);
 assert.deepEqual(parsed.players[0],single);assert.deepEqual(single.sourceDeclinedMarkets,p.markets);controls+=2;
 assert.deepEqual(single.law,baseline.players[0].law,'Abstention never clamps or rewrites a valid law');
 assert.deepEqual(single.confidence,baseline.players[0].confidence,'Even strong confidence cannot override explicit abstention');controls+=2;
 const declined={...baseline,players:parsed.players};
 assert.equal(siteAiDecisions(f.packet,declined,at).length,0);declinedRows++;
 const q=siteReviewQualification(f.packet,declined,at);assert.equal(q.qualifiedLawPlayers,0);assert.equal(q.sourceDeclinedScopes,p.markets.length);controls+=3;
 // A new supported decision can explicitly reopen in the SAME existing bounded
 // response process. Nothing is replayed or automatically promoted by the guard.
 row.exceptions=p.markets.map(()=>null);
 const reopened={...baseline,players:parseJointReview(f.packet,draft).players};
 assert.deepEqual(siteAiDecisions(f.packet,reopened,at),siteAiDecisions(f.packet,baseline,at));controls++;
 // Original accepted/locked generations keep exactly their stored qualification.
 const old=structuredClone(baseline);old.release='player_props_ai_2026_11_16_r44_hibner_official_alias';
 old.players[0].sourceReadProofs!.exceptions=p.markets.map(()=> 'forecast_declined');
 const oldBefore=JSON.stringify(old),originalChoices=siteAiDecisions(f.packet,old,at);
 assert.equal(originalChoices.length,1,'New admission must not reinterpret original R44 records');
 assert.equal(JSON.stringify(old),oldBefore);controls+=2;
 // Future abstention cannot replace or suppress an already locked original.
 const emptyChoices=siteAiDecisions(f.packet,declined,at);
 if(f.nba){
  const applied=applyNbaSiteAi(f.nba,f.packet,originalChoices,at);
  const frozen=advanceNbaPlayerPropsCandidateLifecycle({now:f.packet.lock,previous:applied,candidate:applied}).snapshot;
  const bytes=JSON.stringify(frozen);assert.strictEqual(applyNbaSiteAi(frozen,f.packet,emptyChoices,at),frozen);assert.equal(JSON.stringify(frozen),bytes);controls+=2;
 }else if(f.nfl){
  const applied=applyNflSiteAi(f.nfl,f.packet,originalChoices,at);
  const beforeLock=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:at,nextBoard:applied});
  const frozen=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:f.packet.lock,nextBoard:applied,previous:beforeLock});
  const lockedDraft={...frozen.board,publicationEnabled:false as const,trackingEnabled:false as const};
  const bytes=JSON.stringify(frozen),draftBytes=JSON.stringify(lockedDraft);assert.strictEqual(applyNflSiteAi(lockedDraft,f.packet,emptyChoices,at),lockedDraft);
  assert.equal(JSON.stringify(lockedDraft),draftBytes);controls++;
  assert.deepEqual(buildNflPlayerPropsMemberSnapshot(frozen,f.packet.lock).memberDecisions,frozen.memberDecisions);assert.equal(JSON.stringify(frozen),bytes);controls+=3;
 }else if(f.mlb){
  const applied=applyMlbSiteAi(f.mlb,f.packet,originalChoices,at),frozen=applied.map(r=>({...r,lockStatus:{status:'locked' as const,lockedAt:f.packet.lock}}));
  const bytes=JSON.stringify(frozen);assert.strictEqual(applyMlbSiteAi(frozen,f.packet,emptyChoices,at),frozen);assert.equal(JSON.stringify(frozen),bytes);controls+=2;
 }
 assert.equal(digest({packet:f.packet,baseline}),before);controls++;
}
// Two scopes on one actor: an explicit abstention is local to that market. A
// conditional availability caveat does not mean the reviewer abstained.
const f=sourceFixture('nba','over'),packet=structuredClone(f.packet),p=packet.players[0];
p.markets=['points','rebounds'];
const baseline=accepted(packet,'over'),draft=raw(packet,baseline),row=draft.players[p.id];
row.exceptions=['forecast_declined',null];
const local=parseJointReview(packet,draft).players[0];assert.deepEqual(local.sourceDeclinedMarkets,['points']);
assert(local.law);assert.equal(local.confidence.length,2);controls+=3;
row.exceptions=[null,'forecast_declined'];assert.deepEqual(parseJointReview(packet,draft).players[0].sourceDeclinedMarkets,['rebounds']);controls++;
row.exceptions=[null,null];assert.deepEqual(parseJointReview(packet,draft).players[0].sourceDeclinedMarkets,[]);controls++;
const unknown=compileReaderClaims(packet)[p.id].claims.find(c=>['own_availability_unknown','source_missing','source_unavailable'].includes(c.kind));
assert(unknown);row.exceptions=[unknown.id,null];
assert.deepEqual(parseJointReview(packet,draft).players[0].sourceDeclinedMarkets,[],'Own status silence remains a caveat, not automatic abstention');controls++;
row.exceptions=['invented_reason',null];assert.throws(()=>parseJointReview(packet,draft),/source|claim|reason/i);controls++;
for(const release of ['player_props_ai_2026_11_16_r44_hibner_official_alias',PROPS_AI_RELEASE]){assert(propsReviewHasVerifiedReaderClaims(release));assert(propsReviewHasMemberExecutionContracts(release));controls+=2;}
assert.equal(PROPS_AI_RELEASE,'player_props_ai_2026_11_19_r55_ready_game_admission');
console.log(JSON.stringify({explicitAbstention:true,controls,allSports:3,qualifiedOverAndUnderControls:supportedPromotions,abstainedCurrentOffersRemoved:declinedRows,
 scopeLocal:true,originalLawExact:true,originalR44ReaderPrecedenceExact:true,networkOrPaidCalls:0}));
