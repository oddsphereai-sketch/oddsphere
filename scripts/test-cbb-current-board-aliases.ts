import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeCbbOwlsCurrent} from '../lib/cbb/owlsMarketEvidence';
import {cbbProviderInstitutionName as name} from '../lib/cbb/providerInstitutionIdentity';
import {cbbSplitOrientation} from '../lib/cbb/exactSplitIdentity';
import {matchCbbSourceGame} from '../lib/services/marketIntelligenceV2/shadowSync';
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

// Actual single /ncaab/odds capture 2026-11-06T12:59:51.542Z→12:59:52.228Z.
// Source institution labels, IDs, both prices, contracts and native clocks below
// are copied exactly; no HTTP response time is presented as a native update.
const nov6At="2026-11-06T12:59:52.228Z";
const nov6Actual=[{"game":{"id":10882720,"season":2026,"date":"2026-11-07T02:00:00+00:00","home_team":{"id":67,"abbreviation":"ASU","college":"Arizona State","full_name":"Arizona State Sun Devils"},"visitor_team":{"id":100,"abbreviation":"UNCO","college":"Northern Colorado","full_name":"Northern Colorado Bears"}},"event":{"id":"36285119","eventId":"ncaab:N Colorado@Arizona St-20261107","sport":"ncaab","commence_time":"2026-11-07T02:00:00.000Z","home_team":"Arizona St","away_team":"N Colorado","bookmakers":[{"key":"circa","last_update":"2026-11-06T12:59:30.778Z","markets":[{"key":"spreads","outcomes":[{"name":"N Colorado","price":-110,"point":18.5},{"name":"Arizona St","price":-110,"point":-18.5}]},{"key":"h2h","outcomes":[{"name":"N Colorado","price":1500},{"name":"Arizona St","price":-3400}]},{"key":"totals","outcomes":[{"name":"Over","price":-110,"point":144.5},{"name":"Under","price":-110,"point":144.5}]}]}]},"expectedMarkets":["moneyline","spread","total"]},{"game":{"id":10882748,"season":2026,"date":"2026-11-06T23:30:00+00:00","home_team":{"id":110,"abbreviation":"UPST","college":"South Carolina Upstate","full_name":"South Carolina Upstate Spartans"},"visitor_team":{"id":206,"abbreviation":"SCST","college":"South Carolina State","full_name":"South Carolina State Bulldogs"}},"event":{"id":"34972699","eventId":"ncaab:SC State@South Carolina Upstate-20261106","sport":"ncaab","commence_time":"2026-11-06T23:30:00.0000000Z","home_team":"South Carolina Upstate","away_team":"SC State","bookmakers":[{"key":"draftkings","last_update":"2026-11-06T12:59:15.516Z","markets":[{"key":"h2h","last_update":"2026-11-06T12:59:15.516Z","outcomes":[{"name":"SC State","price":250},{"name":"South Carolina Upstate","price":-310}]},{"key":"spreads","last_update":"2026-11-06T12:59:15.516Z","outcomes":[{"name":"SC State","price":-105,"point":7.5},{"name":"South Carolina Upstate","price":-115,"point":-7.5}]},{"key":"totals","last_update":"2026-11-06T12:59:15.516Z","outcomes":[{"name":"Over","price":-115,"point":148.5},{"name":"Under","price":-105,"point":148.5}]}]}]},"expectedMarkets":["moneyline","spread","total"]},{"game":{"id":10882740,"season":2026,"date":"2026-11-07T01:00:00+00:00","home_team":{"id":283,"abbreviation":"OU","college":"Oklahoma","full_name":"Oklahoma Sooners"},"visitor_team":{"id":298,"abbreviation":"MVSU","college":"Mississippi Valley State","full_name":"Mississippi Valley State Delta Devils"}},"event":{"id":"34972711","eventId":"ncaab:Miss Valley St@Oklahoma-20261107","sport":"ncaab","commence_time":"2026-11-07T01:00:00.0000000Z","home_team":"Oklahoma","away_team":"Miss Valley St","bookmakers":[{"key":"draftkings","last_update":"2026-11-06T12:59:15.516Z","markets":[{"key":"spreads","last_update":"2026-11-06T12:59:15.516Z","outcomes":[{"name":"Miss Valley St","price":-108,"point":38.5},{"name":"Oklahoma","price":-112,"point":-38.5}]},{"key":"totals","last_update":"2026-11-06T12:59:15.516Z","outcomes":[{"name":"Over","price":-115,"point":148.5},{"name":"Under","price":-105,"point":148.5}]}]}]},"expectedMarkets":["spread","total"]},{"game":{"id":10882777,"season":2026,"date":"2026-11-07T02:00:00+00:00","home_team":{"id":75,"abbreviation":"KU","college":"Kansas","full_name":"Kansas Jayhawks"},"visitor_team":{"id":161,"abbreviation":"MTSU","college":"Middle Tennessee","full_name":"Middle Tennessee Blue Raiders"}},"event":{"id":"36285088","eventId":"ncaab:MTSU@Kansas-20261107","sport":"ncaab","commence_time":"2026-11-07T02:00:00.000Z","home_team":"Kansas","away_team":"MTSU","bookmakers":[{"key":"fanduel","last_update":"2026-11-06T12:59:23.557Z","markets":[{"key":"h2h","last_update":"2026-11-06T12:59:23.557Z","outcomes":[{"name":"MTSU","price":7000},{"name":"Kansas","price":-100000}]},{"key":"spreads","last_update":"2026-11-06T12:59:23.557Z","outcomes":[{"name":"MTSU","price":-110,"point":29.5},{"name":"Kansas","price":-110,"point":-29.5}]},{"key":"totals","last_update":"2026-11-06T12:59:23.557Z","outcomes":[{"name":"Over","price":-110,"point":153.5},{"name":"Under","price":-110,"point":153.5}]}]}]},"expectedMarkets":["moneyline","spread","total"]}] as unknown as Array<{game:CbbGame;event:RawOwlsOddsEvent;expectedMarkets:string[]}>;
for(const {game,event,expectedMarkets} of nov6Actual){
 const identity={homeTeamDisplayName:game.home_team.full_name,awayTeamDisplayName:game.visitor_team.full_name,cbbHomeCollege:game.home_team.college,cbbAwayCollege:game.visitor_team.college};
 assert.equal(cbbSplitOrientation(event.away_team!,event.home_team!,identity),'direct','same exact identity is used by named split matching');
 const actual=normalizeCbbOwlsCurrent(game,{success:true,data:[event]},nov6At,nov6At).quotes;
 assert.deepEqual(actual.map(q=>q.market).sort(),expectedMarkets.slice().sort(),`${game.id}: actual offered source pairs restored`);
 for(const q of actual){const source=event.bookmakers![0],m=source.markets!.find(m=>({h2h:'moneyline',spreads:'spread',totals:'total'}[m.key!]===q.market))!;
  assert.equal(q.providerObservedAt,m.last_update??source.last_update);assert.equal(q.fetchedAt,nov6At);assert.equal(q.providerEventId,event.eventId);
  const first=m.outcomes!.find(o=>q.market==='total'?o.name==='Over':o.name===event.home_team)!;
  const second=m.outcomes!.find(o=>q.market==='total'?o.name==='Under':o.name===event.away_team)!;
  assert.equal(q.firstPrice,first.price);assert.equal(q.secondPrice,second.price);assert.equal(q.line,q.market==='moneyline'?null:first.point);
 }
 const ref={id:game.id,externalId:game.id,slateDate:'2026-11-06',gameDate:game.date,homeTeamId:game.home_team.id,awayTeamId:game.visitor_team.id,
  homeAbbr:game.home_team.abbreviation,awayAbbr:game.visitor_team.abbreviation,homeName:game.home_team.full_name,awayName:game.visitor_team.full_name,
  homeLocation:game.home_team.college??'',awayLocation:game.visitor_team.college??''};
 assert.equal(matchCbbSourceGame([ref],event.away_team!,event.home_team!,event.commence_time!)?.game.externalId,game.id,'canonical collector and writer resolve the same real source fixture');
 assert.equal(matchCbbSourceGame([ref],event.home_team!,event.away_team!,event.commence_time!)?.reversed,true);
 assert.deepEqual(normalizeCbbOwlsCurrent(game,{success:true,data:[{...event,home_team:event.away_team,away_team:event.home_team}]},nov6At,nov6At).quotes,actual);
 assert.deepEqual(normalizeCbbOwlsCurrent(game,{success:true,data:[event,event]},nov6At,nov6At).quotes,actual,'duplicate native capture cannot double a book');
 const conflict=structuredClone(event);conflict.bookmakers![0].markets![0].outcomes![0].price=Number(conflict.bookmakers![0].markets![0].outcomes![0].price)-1;
 assert.ok(normalizeCbbOwlsCurrent(game,{success:true,data:[event,conflict]},nov6At,nov6At).rejected.some(x=>x.reason==='conflicting_same_book_market'));
 assert.equal(normalizeCbbOwlsCurrent(game,{success:true,data:[{...event,commence_time:'2026-11-08T02:00:00Z'}]},nov6At,nov6At).quotes.length,0);
 const wrong=game.id===10882720?'Colorado St':game.id===10882748?'South Carolina':game.id===10882740?'Mississippi St':'Tennessee';
 const wrongSource={...event,away_team:wrong};
 assert.equal(normalizeCbbOwlsCurrent(game,{success:true,data:[wrongSource]},nov6At,nov6At).quotes.length,0,'wrong school stays rejected, including actual misleading MGM Tennessee@Kansas');
 assert.equal(matchCbbSourceGame([ref],wrong,event.home_team!,event.commence_time!),null);
}
for(const [a,b]of [['N Colorado','Northern Colorado'],['SC State','South Carolina State'],['Miss Valley St','Mississippi Valley State'],['MTSU','Middle Tennessee']])assert.equal(name(a),name(b));
for(const [a,b]of [['N Colorado','Colorado State'],['SC State','South Carolina'],['Miss Valley St','Mississippi State'],['MTSU','Tennessee'],['MTSU','East Tennessee State']])assert.notEqual(name(a),name(b));
console.log('PASS actual November6 four exact institution aliases: Circa three-market restoration, retail contract recovery, collector/split/writer identity parity, unchanged source clocks/prices, wrong-school/date/duplicate protections.');
