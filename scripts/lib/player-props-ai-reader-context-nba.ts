import assert from 'node:assert/strict';
import {nbaAuthorityFixture,nbaAuthorityReview} from '../test-player-props-ai-nba-lock-authority';
import {parseEspnGameInjuriesPayload} from '../../lib/services/nba/espnNbaInjuries';
import {adaptNbaToDailyEdgeResponse} from '../../lib/services/nba/adaptNbaToDailyEdgeResponse';
import {liveNbaPacket} from '../../lib/playerPropsAi/liveSources';
import {siteAiDecisions} from '../../lib/playerPropsAi/publication';
import {readerCanonicalContextHash} from '../../lib/playerPropsAi/readerContext';
import {readerAvailabilityContextHash} from '../../lib/playerPropsAi/readerClaimFreshness';
import {applyNbaSiteAi,restoreNbaNativeGame} from '../../lib/playerPropsAi/siteBindings';
import {advanceNbaPlayerPropsCandidateLifecycle} from '../../lib/services/nba/nbaPlayerPropsLifecycle';
import {mergeNbaHandoffs,testNbaSourceAuthority,testNbaHandoffCapture} from '../../lib/playerPropsAi/nbaLockAuthority';
export function nbaSharedEspnReaderClockProof(){
globalThis.fetch=async()=>{throw Error('Two ESPN forms counterexample forbids HTTP');};
const f=nbaAuthorityFixture(),at=f.packet.cutoff,later='2026-11-10T22:27:00Z',old='2026-11-10T22:20:00Z',newer='2026-11-10T22:22:00Z',eventId='401234567';
const baseline=f.snapshot([f.row(),f.row('a','rebounds'),f.row('b')]);
function report(status:string,otherClock:string){const row=(name:string,id:string,state:string,date:string)=>({athlete:{id,displayName:name,position:{abbreviation:'G'}},status:state,date,details:{type:'Ankle'}});const r=parseEspnGameInjuriesPayload({injuries:[{team:{abbreviation:'BOS'},injuries:[row('Synthetic a','actor-a','Questionable',old),row('Other Player','other-id',status,otherClock)]},{team:{abbreviation:'NYK'},injuries:[]}]},eventId,'BOS','NYK');assert(r);return r;}
const intel={pick_side:null,pick_label:null,grade:'held',effective_confidence:null,current_price:{odds_american:null,sportsbook:null,fetched_at:at},other_side_price:{odds_american:null},splits:{pick_side:null,other_side:null,sharp_signal_side:'none'},rationale:[],model_prob_on_pick:null,market_no_vig_prob_pick:null,opp_ev_percentage_pick:null,consensus_line:null};
function source(swapped=false){
 const cachedReport=report('Out',swapped?newer:old),currentReport=report('Questionable',swapped?old:newer);
 const memberGame=adaptNbaToDailyEdgeResponse({as_of:at,slate_date_et:'2026-11-10',market_signals_capability:'unavailable',games:[{game_external_id:Number(eventId),home_abbr:'NYK',away_abbr:'BOS',tip_iso_utc:f.packet.start,locked_at:null,quick_read:'Synthetic held daily-edge context',projection:{home_score:100,away_score:100,total:200,spread_home:0},intelligence:{ml:{...intel,market:'moneyline'},spread:{...intel,market:'spread'},total:{...intel,market:'total'},top_grade:'held',sources:{limited_book_coverage:false,book_count:0,has_lines:false,has_opportunities:false}},injuries:{away_known:true,home_known:true,away_players:cachedReport.teams.get('BOS'),home_players:cachedReport.teams.get('NYK')}}]} as never).games[0];
 const observations=f.packet.quotes.map(q=>({canonicalPlayerId:q.playerId,canonicalGameId:f.packet.gameId,playerName:`Synthetic ${q.playerId}`,playerTeam:'BOS',market:q.market,sportsbook:q.book,line:q.line,side:q.side,americanPrice:q.american,provider:q.provider,providerObservationId:q.id,isOpening:false,isLive:false,observedAt:q.observedAt,receivedAt:q.receivedAt,fetchedAt:q.receivedAt}));
 const state={updatedAt:at,games:[],boxes:[],advanced:[],players:[]};
 const packet=liveNbaPacket({game:{id:f.packet.gameId,start:f.packet.start,away:'BOS',home:'NYK'},window:{gameId:f.packet.gameId,stage:'final',cutoff:at,lock:f.packet.lock},snapshot:baseline,market:{updatedAt:at,observations},prior:state,current:state,currentObservations:observations,context:[{generated_at:at,payload:{games:[memberGame]}}],participationReports:[{gameId:f.packet.gameId,start:f.packet.start,awayTeam:'BOS',homeTeam:'NYK',expectedEventId:eventId,availableAt:at,report:currentReport}]} as never);
 const forms=packet.players[0].evidence.filter(e=>e.kind==='availability');assert.equal(forms.length,2);assert(forms.some(e=>e.source.startsWith('cached NBA')));assert(forms.some(e=>e.source.startsWith('same-cycle')));
 return packet;
}
const original=source(),r=nbaAuthorityReview(original),originalChoices=siteAiDecisions(original,r,at),before=applyNbaSiteAi(baseline,original,originalChoices,at),swapped=source(true),choices=siteAiDecisions(swapped,r,later),candidate=applyNbaSiteAi(restoreNbaNativeGame(before,baseline,swapped,later),swapped,choices,later);
const frame=mergeNbaHandoffs([testNbaSourceAuthority(()=>later)(swapped,r),testNbaHandoffCapture(()=>later)(candidate.decisions,swapped,r,'ai'),testNbaHandoffCapture(()=>later)(candidate.decisions,swapped,r,'native')]);
const locked=advanceNbaPlayerPropsCandidateLifecycle({now:'2026-11-10T22:30:01Z',previous:before,candidate,lockHandoff:frame}).snapshot;
assert.equal(originalChoices.length,3);assert.equal(choices.length,0,'Same ESPN actor IDs retain one medical authority across actual cached and current report forms');assert.equal(readerAvailabilityContextHash(original,'a'),readerAvailabilityContextHash(swapped,'a'));assert.notEqual(readerCanonicalContextHash(original,'a'),readerCanonicalContextHash(swapped,'a'));assert(locked.decisions.every(row=>!row.aiReview),'Real changed teammate ESPN authority cannot become a stale AI first lock');
}
