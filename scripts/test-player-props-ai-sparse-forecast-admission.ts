/** Actual future-wire admission/publication and existing-law lock controls. */
import assert from 'node:assert/strict';
import {nbaAuthorityFixture,nbaAuthorityDraft,nbaAuthorityReview} from './test-player-props-ai-nba-lock-authority';
import {encodeCanonicalScenarioLaw} from '../lib/playerPropsAi/generativeCoordinates';
import {parseJointReview} from '../lib/playerPropsAi/request';
import {validateLaw,lawForecast,type PlayerLaw} from '../lib/playerPropsAi/law';
import {sourceMeanAdmissionSupport,sourceForecastIssues} from '../lib/playerPropsAi/forecastSanity';
import {sourceConstraintCards,namedSourceCorrection,SOURCE_CONSTRAINT_CARDS_RELEASE} from '../lib/playerPropsAi/sourceConstraintCards';
import {siteAiDecisions} from '../lib/playerPropsAi/publication';
import {applyNbaSiteAi} from '../lib/playerPropsAi/siteBindings';
import {advanceNbaPlayerPropsCandidateLifecycle} from '../lib/services/nba/nbaPlayerPropsLifecycle';
import {encodeNbaPlayerPropsPrivatePayload,decodeNbaPlayerPropsPrivatePayload} from '../lib/services/nba/nbaPlayerPropsPrivateStore';
import {digest} from '../lib/playerPropsAi/evidence';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import type {GamePacket} from '../lib/playerPropsAi/evidenceContract';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import type {NbaPlayerPropsMemberSnapshot} from '../lib/services/nba/nbaPlayerPropsProductContract';
const v=(n:number)=>Array<number>(16).fill(n),f=nbaAuthorityFixture();globalThis.fetch=async()=>{throw Error('Sparse admission test forbids HTTP');};
const packet:GamePacket=structuredClone(f.packet);packet.players=packet.players.slice(0,1);packet.players[0].evidence=packet.players[0].evidence.filter(e=>e.kind!=='recent_games'||!e.id.endsWith(':2'));packet.quotes=packet.quotes.filter(q=>q.playerId===packet.players[0].id);packet.executionQuotes=packet.executionQuotes!.filter(q=>q.playerId===packet.players[0].id);
const actor=packet.players[0],raw=(points:number[],weights:number[]):PlayerLaw=>({weights,outcomes:{points,rebounds:[4,6,...v(6).slice(2)],assists:[2,4,...v(3).slice(2)],threes:v(0)}});
const bad=raw([0,5000,...v(18).slice(2)],[1,9,...v(0).slice(2)]),goodOver=raw([14,18,...v(18).slice(2)],[1,9,...v(0).slice(2)]),goodUnder=raw([14,18,...v(18).slice(2)],[9,1,...v(0).slice(2)]);
function draft(p:GamePacket,law:PlayerLaw,exceptions?:('forecast_declined'|'source_event_unresolved'|null)[]){const d=nbaAuthorityDraft(p);d.players[p.players[0].id].law=encodeCanonicalScenarioLaw('nba',p.players[0],law);if(exceptions)d.players[p.players[0].id].exceptions=exceptions;return d;}
function accepted(p:GamePacket,d:ReturnType<typeof draft>){return{...nbaAuthorityReview(f.packet),players:parseJointReview(p,d).players,criticalContextHashes:criticalContextHashes(p),marketScopes:Object.fromEntries(p.players.map(p=>[p.id,[...p.markets]])),inputHash:digest(p),inputEvidence:{digest:digest(p)}} as AcceptedGameReview;}
const before=digest(packet),badBefore=digest(bad),envelope=sourceMeanAdmissionSupport(packet,actor).points;
assert.deepEqual([envelope.minimum,envelope.maximum,envelope.playedGames,envelope.state],[14,18.4,2,'played_prior_range']);
assert.throws(()=>parseJointReview(packet,draft(packet,bad)),/S:mean/);assert(sourceForecastIssues(packet,actor,validateLaw('nba',actor,bad)).some(i=>i.code==='forecast_mean_outside_supplied_support'));
const feedback=namedSourceCorrection(packet,draft(packet,bad));assert.equal(feedback.status,'ready');if(feedback.status==='ready'){assert(feedback.text.includes('mean points=4500 outside [14,18.4]'));assert(feedback.bytes<=1984);assert(!feedback.text.includes(actor.name));}
const card=sourceConstraintCards(packet)[0];assert.equal(card.release,SOURCE_CONSTRAINT_CARDS_RELEASE);assert.deepEqual(card.statistics.points!.meanAdmissionSupport,envelope);assert.deepEqual(card.marketMeanAdmissionSupport.points,envelope);
const declined=accepted(packet,draft(packet,bad,['forecast_declined',null]));assert.deepEqual(declined.players[0].sourceDeclinedMarkets,['points']);const held=siteAiDecisions(packet,declined,packet.cutoff);assert.equal(held.length,1);assert.equal(held[0].market,'rebounds');
for(const [law,side]of [[goodOver,'over'],[goodUnder,'under']] as const){const review=accepted(packet,draft(packet,law)),choices=siteAiDecisions(packet,review,packet.cutoff);assert.equal(choices.length,2);const points=choices.find(c=>c.market==='points')!;assert.equal(points.side,side);assert.equal(points.grade,'Best Angle');assert.equal(points.probability,.9);assert.equal(points.projection,lawForecast(review.players[0].law!,'points',15.5).mean);}
const role=structuredClone(packet);(role.players[0].evidence.find(e=>e.kind==='independent_model')!.value as {independentProjection:number}).independentProjection=30;
const expanded=sourceMeanAdmissionSupport(role,role.players[0]).points;assert.equal(expanded.maximum,30);const roleLaw=raw([14,30,...v(18).slice(2)],[1,9,...v(0).slice(2)]);assert.equal(siteAiDecisions(role,accepted(role,draft(role,roleLaw)),role.cutoff).find(c=>c.market==='points')!.grade,'Best Angle','A genuine new quantitative source head expands sparse qualification');
const noHistory=structuredClone(packet);noHistory.players[0].markets=['points'];noHistory.players[0].evidence=noHistory.players[0].evidence.filter(e=>e.kind!=='recent_games');noHistory.quotes=noHistory.quotes.filter(q=>q.market==='points');noHistory.executionQuotes=noHistory.executionQuotes!.filter(q=>q.market==='points');
const noRange=namedSourceCorrection(noHistory,draft(noHistory,goodOver));assert.equal(noRange.status,'ready');if(noRange.status==='ready'){assert(noRange.text.includes('mean support unavailable points'));assert(noRange.bytes<=1984);}assert.throws(()=>parseJointReview(noHistory,draft(noHistory,goodOver)),/S:support/);assert.deepEqual(accepted(noHistory,draft(noHistory,goodOver,['forecast_declined'])).players[0].sourceDeclinedMarkets,['points']);
// The original accepted mathematical law and its original public payload retain
// their own contract. New admission must not rerun against an existing lock.
const prior=accepted(packet,draft(packet,goodOver));prior.release='player_props_ai_2026_11_11_r33_two_phase_review_window';prior.players[0].law=validateLaw('nba',actor,bad);prior.players[0].sourceDeclinedMarkets=[];const storedBefore=digest(prior),oldChoices=siteAiDecisions(packet,prior,packet.cutoff);assert.equal(oldChoices.find(c=>c.market==='points')!.projection,4500);
const published=applyNbaSiteAi(f.snapshot([f.row('a'),f.row('a','rebounds')]),packet,oldChoices,packet.cutoff),locked=advanceNbaPlayerPropsCandidateLifecycle({now:'2026-11-10T22:30:01Z',previous:published,candidate:published}).snapshot;
const newer=applyNbaSiteAi(f.snapshot([f.row('a'),f.row('a','rebounds')]),packet,siteAiDecisions(packet,accepted(packet,draft(packet,goodUnder)),packet.cutoff),packet.cutoff);
const retained=advanceNbaPlayerPropsCandidateLifecycle({now:'2026-11-10T22:31:00Z',previous:locked,candidate:newer}).snapshot;assert.deepEqual(retained.decisions,locked.decisions);assert.deepEqual(decodeNbaPlayerPropsPrivatePayload<NbaPlayerPropsMemberSnapshot>(encodeNbaPlayerPropsPrivatePayload(retained,'candidate_snapshot'),'candidate_snapshot')!.decisions,locked.decisions);
assert.equal(digest(prior),storedBefore);assert.equal(digest(packet),before);assert.equal(digest(bad),badBefore);
console.log(JSON.stringify({result:'PASS',productPath:'actual parse → scope decline/qualified law → exact price/grade → stored first lock/reader',sparseFixtureImpact:{unsupportedOldBestAngles:2,explicitDeclineBestAngles:1,supportedOverBestAngles:2,supportedUnderBestAngles:2,sourceHeadRecoveryBestAngles:2},limits:'Synthetic source-unit correctness and paired promotion/recovery only; no live board, accuracy or cost claim'}));
