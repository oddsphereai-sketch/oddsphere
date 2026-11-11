import assert from 'node:assert/strict';
import {nbaPlayedStateFixture} from './player-props-ai-nba-played-fixture';
import {nbaAuthorityFixture,nbaAuthorityReview} from '../test-player-props-ai-nba-lock-authority';
import {parseEspnGameInjuriesPayload} from '../../lib/services/nba/espnNbaInjuries';
import {adaptNbaToDailyEdgeResponse} from '../../lib/services/nba/adaptNbaToDailyEdgeResponse';
import {liveNbaPacket} from '../../lib/playerPropsAi/liveSources';
import {siteAiDecisions} from '../../lib/playerPropsAi/publication';
import {digest} from '../../lib/playerPropsAi/evidence';
import type {GamePacket,Json} from '../../lib/playerPropsAi/evidenceContract';
import {readerCanonicalContextHash} from '../../lib/playerPropsAi/readerContext';
import {readerAvailabilityContextHash} from '../../lib/playerPropsAi/readerClaimFreshness';
import {applyNbaSiteAi,restoreNbaNativeGame} from '../../lib/playerPropsAi/siteBindings';
import {advanceNbaPlayerPropsCandidateLifecycle} from '../../lib/services/nba/nbaPlayerPropsLifecycle';
import {mergeNbaHandoffs,testNbaSourceAuthority,testNbaHandoffCapture} from '../../lib/playerPropsAi/nbaLockAuthority';
type MedicalRow={team:'BOS'|'NYK';name:string;id:string;status:string;date:string;position:string;detail:string;expectedReturn:string};
/** Both actual ESPN encodings must agree on facts, independent of which one has
 * the newer provider clock. Full source records and accepted text stay exact. */
export function nbaSharedEspnReaderClockProof(){
 globalThis.fetch=async()=>{throw Error('Two ESPN forms counterexample forbids HTTP');};
 const f=nbaAuthorityFixture(),at=f.packet.cutoff,later='2026-11-10T22:27:00Z',old='2026-11-10T22:20:00Z',newer='2026-11-10T22:22:00Z',eventId='401234567';
 const mappedId=(id:string)=>`nba-bdl-player:${id==='a'?1:2}`;
 const baseline=f.snapshot([f.row(),f.row('a','rebounds'),f.row('b')].map(row=>({...row,playerId:mappedId(row.playerId)})));
 const rows:MedicalRow[]=[['Synthetic a','actor-a','Questionable'],['Other Player','other-id','Questionable'],['Opponent Player','opponent-id','Out']].map(([name,id,status],i)=>({team:i===2?'NYK':'BOS',name,id,status,date:old,position:'G',detail:'Ankle',expectedReturn:'2026-11-12'}));
 const changed=(index:number,values:Partial<MedicalRow>)=>rows.map((row,i)=>i===index?{...row,...values}:{...row});
 function report(records:MedicalRow[]){
  const r=parseEspnGameInjuriesPayload({injuries:['BOS','NYK'].map(team=>({team:{abbreviation:team},injuries:records.filter(row=>row.team===team).map(row=>({athlete:{id:row.id,displayName:row.name,position:{abbreviation:row.position}},status:row.status,date:row.date,details:{type:row.detail,returnDate:row.expectedReturn}}))}))},eventId,'BOS','NYK');assert(r);return r;
 }
 const intel={pick_side:null,pick_label:null,grade:'held',effective_confidence:null,current_price:{odds_american:null,sportsbook:null,fetched_at:at},other_side_price:{odds_american:null},splits:{pick_side:null,other_side:null,sharp_signal_side:'none'},rationale:[],model_prob_on_pick:null,market_no_vig_prob_pick:null,opp_ev_percentage_pick:null,consensus_line:null};
 function source(cachedRows=rows,currentRows=rows,cutoff=at){
  const cachedReport=report(cachedRows),currentReport=report(currentRows);
  const memberGame=adaptNbaToDailyEdgeResponse({as_of:at,slate_date_et:'2026-11-10',market_signals_capability:'unavailable',games:[{game_external_id:Number(eventId),home_abbr:'NYK',away_abbr:'BOS',tip_iso_utc:f.packet.start,locked_at:null,quick_read:'Synthetic held daily-edge context',projection:{home_score:100,away_score:100,total:200,spread_home:0},intelligence:{ml:{...intel,market:'moneyline'},spread:{...intel,market:'spread'},total:{...intel,market:'total'},top_grade:'held',sources:{limited_book_coverage:false,book_count:0,has_lines:false,has_opportunities:false}},injuries:{away_known:true,home_known:true,away_players:cachedReport.teams.get('BOS'),home_players:cachedReport.teams.get('NYK')}}]} as never).games[0];
  const observations=f.packet.quotes.map(q=>({canonicalPlayerId:mappedId(q.playerId),canonicalGameId:f.packet.gameId,playerName:`Synthetic ${q.playerId}`,playerTeam:'BOS',market:q.market,sportsbook:q.book,line:q.line,side:q.side,americanPrice:q.american,provider:q.provider,providerObservationId:q.id,isOpening:false,isLive:false,observedAt:q.observedAt,receivedAt:q.receivedAt,fetchedAt:q.receivedAt}));
  const state=nbaPlayedStateFixture(at,[1,2],[14,18,20],[4,6,8]);
  const packet=liveNbaPacket({game:{id:f.packet.gameId,start:f.packet.start,away:'BOS',home:'NYK'},window:{gameId:f.packet.gameId,stage:'final',cutoff,lock:f.packet.lock},snapshot:baseline,market:{updatedAt:at,observations},prior:state,current:state,currentObservations:observations,context:[{generated_at:at,payload:{games:[memberGame]}}],participationReports:[{gameId:f.packet.gameId,start:f.packet.start,awayTeam:'BOS',homeTeam:'NYK',expectedEventId:eventId,availableAt:cutoff,report:currentReport}]} as never);
  const forms=packet.players[0].evidence.filter(e=>e.kind==='availability');assert.equal(forms.length,2);assert(forms.some(e=>e.source.startsWith('cached NBA')));assert(forms.some(e=>e.source.startsWith('same-cycle')));return packet;
 }
 const original=source(),originalBytes=digest(original),review=nbaAuthorityReview(original),reviewBytes=digest(review),choices=siteAiDecisions(original,review,at),before=applyNbaSiteAi(baseline,original,choices,at);
 assert.equal(choices.length,3);assert(before.decisions.every(row=>row.grade==='Best Angle'));
 const tuple=(row:typeof before.decisions[number])=>({player:row.playerId,name:row.playerName,market:row.market,line:row.line,projection:row.projection,probability:row.probability,price:row.americanPrice,book:row.sportsbook,side:row.side,grade:row.grade,ev:row.expectedValue,assessment:row.aiReview?.assessment,coverage:row.aiReview?.coverage,lawHash:row.aiReview?.lawHash,inputHash:row.aiReview?.inputHash});
 function firstLock(packet:GamePacket,accepted=review){
  const current=siteAiDecisions(packet,accepted,later),candidate=applyNbaSiteAi(restoreNbaNativeGame(before,baseline,packet,later),packet,current,later);
  const frame=mergeNbaHandoffs([testNbaSourceAuthority(()=>later)(packet,accepted),testNbaHandoffCapture(()=>later)(candidate.decisions,packet,accepted,'ai'),testNbaHandoffCapture(()=>later)(candidate.decisions,packet,accepted,'native')]);
  return{choices:current,locked:advanceNbaPlayerPropsCandidateLifecycle({now:'2026-11-10T22:30:01Z',previous:before,candidate,lockHandoff:frame}).snapshot};
 }
 // Tied→current newer, tied→cached newer, current→cached and cached→current:
 // semantic equality does not depend on either encoding or winner cardinality.
 const allNew=rows.map(row=>({...row,date:newer}));
 for(const packet of [source(rows,rows,later),source(rows,allNew,later),source(allNew,rows,later),source(allNew,allNew,later),source([...rows,rows[1]],allNew,later),source(allNew,[...rows,rows[1]],later)]){
  const inputBytes=digest(packet),result=firstLock(packet);assert.equal(result.choices.length,3,'Same-state actual ESPN clock/duplicate refresh retains every reviewed actor');
  assert.equal(readerCanonicalContextHash(original,mappedId('a')),readerCanonicalContextHash(packet,mappedId('a')));assert.equal(readerAvailabilityContextHash(original,mappedId('a')),readerAvailabilityContextHash(packet,mappedId('a')));
  assert.deepEqual(result.locked.decisions.map(tuple),before.decisions.map(tuple),'Actual first locks retain AI laws, accepted text, projections, probabilities, exact prices and grades');assert.equal(digest(packet),inputBytes);
 }
 for(const initial of [source(rows,allNew),source(allNew,rows)]){
  const accepted=nbaAuthorityReview(initial);
  for(const packet of [source(rows,rows,later),source(rows,allNew,later),source(allNew,rows,later)])assert.equal(siteAiDecisions(packet,accepted,later).length,3,'Switching the same-fact source winner retains the accepted read');
 }
 // Every real medical field remains material for own, teammate and opponent.
 for(let i=0;i<rows.length;i++)for(const values of [{status:rows[i].status==='Out'?'Available':'Out'},{detail:'Back'},{position:'C'},{expectedReturn:'2026-11-20'},{name:'Different Reported Player'},{id:'different-provider-id'}])for(const cached of [false,true]){
  const altered=changed(i,values),packet=source(cached?altered:rows,cached?rows:altered,later);assert.notEqual(readerCanonicalContextHash(original,mappedId('a')),readerCanonicalContextHash(packet,mappedId('a')));
  const result=firstLock(packet);assert.equal(result.choices.length,0,'Substantive medical facts remain material across either actual encoding');assert(result.locked.decisions.every(row=>!row.aiReview));
 }
 // Same two status/detail alternatives, only clocks change the effective winner.
 for(const field of ['status','detail'] as const)for(const index of [0,1,2]){
  const alternatives=changed(index,field==='status'?{status:rows[index].status==='Out'?'Available':'Out'}:{detail:'Back'}),latestAlternatives=alternatives.map(row=>({...row,date:newer}));
  const originalWinner=source(rows,latestAlternatives),accepted=nbaAuthorityReview(originalWinner),switched=source(allNew,alternatives,later),tied=source(rows,alternatives,later);
  for(const packet of [switched,tied]){assert.notEqual(readerCanonicalContextHash(originalWinner,mappedId('a')),readerCanonicalContextHash(packet,mappedId('a')));assert.equal(siteAiDecisions(packet,accepted,later).length,0,'True clock-selected status/detail changes or equal-clock conflict invalidate the read');}
 }
 // Unrecognized fields/types, non-null internal IDs and conflicting alias values
 // cannot enter the shared semantic record or disappear under clock stripping.
 const object=(value:Json)=>value as Record<string,Json>;
 for(const mutate of [(row:Record<string,Json>)=>{row.extraMedicalFact='unknown';},(row:Record<string,Json>)=>{row.injuryType='conflicting alias';},(row:Record<string,Json>)=>{row.source_player_id='conflicting-id';},(row:Record<string,Json>)=>{row.player_id=123;},(row:Record<string,Json>)=>{row.position={unknown:true};},(row:Record<string,Json>)=>{row.reported_at='not-a-clock';}]){
  const packet=source(rows,allNew,later);for(const player of packet.players){const entry=player.evidence.find(e=>e.source.startsWith('same-cycle'))!,row=(object(object(object(entry.value).context).away).players as Json[]).map(object)[1];mutate(row);}
  assert.notEqual(readerCanonicalContextHash(original,mappedId('a')),readerCanonicalContextHash(packet,mappedId('a')));assert.equal(siteAiDecisions(packet,review,later).length,0,'Unknown/malformed/conflicting fields stay fail-closed');
 }
 const stored=firstLock(source(rows,allNew,later)).locked,storedBytes=digest(stored);assert.deepEqual(advanceNbaPlayerPropsCandidateLifecycle({now:'2026-11-10T22:30:01Z',previous:stored,candidate:baseline,lockHandoff:{observations:[],proofs:[]}}).snapshot.decisions,stored.decisions);assert.equal(digest(stored),storedBytes);
 assert.equal(digest(original),originalBytes);assert.equal(digest(review),reviewBytes,'Accepted proofs/text/law and original source archives are never rewritten');
}
