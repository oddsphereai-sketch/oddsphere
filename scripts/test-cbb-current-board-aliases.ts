import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeCbbOwlsCurrent} from '../lib/cbb/owlsMarketEvidence';
import {cbbProviderInstitutionName as name} from '../lib/cbb/providerInstitutionIdentity';
import {cbbSplitOrientation} from '../lib/cbb/exactSplitIdentity';
import type {CbbGame} from '../lib/cbb/types';
import type {RawOwlsOddsEvent} from '../lib/providers/owls/owlsSharpBookOdds';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/owls-cbb-current-board-discovery-20261104.json',import.meta.url),'utf8'));
const events=fixture.events as RawOwlsOddsEvent[];
const at=fixture.fetchedAt as string;
assert.ok(Date.parse(at)>Date.parse(fixture.originalDecisionCutoff),'later discovery never masquerades as original cutoff evidence');
for(const [a,b]of [['N Dakota St','North Dakota State'],['CSU Northridge','Cal State Northridge'],['CS Northridge','Cal State Northridge'],['LMU','Loyola Marymount']])assert.equal(name(a),name(b));
for(const [a,b]of [['N Dakota','N Dakota St'],['Colorado State','CSU Northridge'],['Loyola Chicago','LMU'],['Loyola Maryland','LMU'],['Queens (NY)','Queens University'],['Maryland','Maryland Eastern Shore']])assert.notEqual(name(a),name(b));
let restored=0;
for(const game of fixture.games as CbbGame[]){
 const identity={homeTeamDisplayName:game.home_team.full_name,awayTeamDisplayName:game.visitor_team.full_name,cbbHomeCollege:game.home_team.college,cbbAwayCollege:game.visitor_team.college};
 const own=events.filter(e=>cbbSplitOrientation(e.away_team!,e.home_team!,identity)!==null);
 assert.ok(own.length>0,`${game.id} actual native event restored`);
 const normalized=normalizeCbbOwlsCurrent(game,{success:true,data:own},at,at).quotes;
 for(const event of own){
  const normal=normalizeCbbOwlsCurrent(game,{success:true,data:[event]},at,at).quotes;
  if(event.bookmakers![0].key==='novig'){assert.equal(normal.length,0,'unsupported exchange stays rejected');continue;}
  assert.ok(normal.length>0,`${game.id} ${event.bookmakers![0].key} actual source contains valid exact pairs`);
  const reversed={...event,home_team:event.away_team,away_team:event.home_team};
  assert.deepEqual(normalizeCbbOwlsCurrent(game,{success:true,data:[reversed]},at,at).quotes,normal,'reversed native orientation retains canonical outcomes/prices');
  for(const q of normal){
   const book=event.bookmakers!.find(b=>b.key===q.sportsbook)!;
   const market=book.markets!.find(m=>m.key===(q.market==='moneyline'?'h2h':q.market==='spread'?'spreads':'totals'))!;
   const first=market.outcomes!.find(o=>q.market==='total'?o.name==='Over':name(o.name!)===name(game.home_team.college!))!;
   const second=market.outcomes!.find(o=>q.market==='total'?o.name==='Under':name(o.name!)===name(game.visitor_team.college!))!;
   assert.equal(q.firstPrice,first.price);assert.equal(q.secondPrice,second.price);
   assert.equal(q.line,q.market==='moneyline'?null:first.point);
   assert.equal(q.providerObservedAt,market.last_update??book.last_update);
   assert.equal(q.fetchedAt,at);
  }
  for(const bad of [{...event,away_team:'Wrong school'},{...event,sport:'ncaaw'},{...event,commence_time:new Date(Date.parse(game.date)+3600000).toISOString()}])assert.equal(normalizeCbbOwlsCurrent(game,{success:true,data:[bad]},at,at).quotes.length,0);
  assert.equal(normalizeCbbOwlsCurrent(game,{success:true,data:[event]},at,fixture.originalDecisionCutoff).quotes.length,0,'post-cutoff capture rejected');
  const conflicting=structuredClone(event);
  conflicting.bookmakers![0].markets![0].outcomes![0].price=Number(conflicting.bookmakers![0].markets![0].outcomes![0].price)+1;
  const conflict=normalizeCbbOwlsCurrent(game,{success:true,data:[event,conflicting]},at,at);
  assert.ok(conflict.rejected.some(r=>r.reason==='conflicting_same_book_market'),'conflicting duplicate never guesses a price');
  assert.deepEqual(normalizeCbbOwlsCurrent(game,{success:true,data:[event,event]},at,at).quotes,normal,'identical duplicate is idempotent');
 }
 if([10882644,10882641].includes(game.id)){
  assert.deepEqual(normalized.filter(q=>q.sportsbook==='pinnacle').map(q=>q.market).sort(),['moneyline','spread','total'],'complete actual professional contracts restored');restored++;
 }
 if(game.id===10882644)assert.equal(normalizeCbbOwlsCurrent(game,{success:true,data:own.map(e=>({...e,away_team:'N Dakota'}))},at,at).quotes.length,0,'North Dakota cannot become North Dakota State');
 if(game.id===10882641){
  assert.ok(normalized.some(q=>q.sportsbook==='betmgm'),'CS Northridge retail spelling restored too');
  assert.equal(normalizeCbbOwlsCurrent(game,{success:true,data:own.map(e=>({...e,away_team:'Colorado State'}))},at,at).quotes.length,0,'Colorado State cannot become Cal State Northridge');
 }

 if(game.id===10882643){
  assert.ok(normalized.some(q=>q.sportsbook==='draftkings'),'LMU retail source restored');
  for(const wrongHome of ['Loyola Chicago','Loyola Maryland'])assert.equal(normalizeCbbOwlsCurrent(game,{success:true,data:own.map(e=>({...e,home_team:wrongHome}))},at,at).quotes.length,0,'other Loyola institution cannot become LMU');
  const wrong={...game,visitor_team:{...game.visitor_team,college:'Queens (NY)',full_name:'Queens (NY) Knights'}};
  assert.equal(normalizeCbbOwlsCurrent(wrong,{success:true,data:own},at,at).quotes.length,0,'wrong Queens New York cannot match Royals');
 }
 if(game.id===10882634){
  const bad=events.filter(e=>e.home_team==='High Point'&&e.away_team==='Maryland');
  assert.ok(bad.some(e=>e.bookmakers!.some(b=>b.key==='draftkings')),'retain actual misleading DK Maryland source');
  assert.equal(normalizeCbbOwlsCurrent(game,{success:true,data:bad},at,at).quotes.length,0,'actual Maryland opponent remains rejected; never aliases UMES');
 }
}
assert.equal(restored,2);
console.log('PASS CBB actual November4 aliases: restored professional pairs, exact source prices/clocks, reverse orientation, wrong school/time/league, duplicate conflicts, Queens/UMES negatives.');
