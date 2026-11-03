import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {matchCbbSourceGame} from '../lib/services/marketIntelligenceV2/shadowSync';
import {cbbSplitOrientation,cbbSplitTeamMatches} from '../lib/cbb/exactSplitIdentity';
import {normalizeCbbOwlsCurrent,normalizeCbbOwlsHistory} from '../lib/cbb/owlsMarketEvidence';
import {matchOwlsDisplayEvent,owlsDisplayProviderSide} from '../lib/providers/owls/owlsBookDisplayHistory';
import {predictionMarketTeamMatches} from '../lib/providers/owls/owlsPredictionMarkets';
import {computeSlateDate} from '../lib/dates/slateDate';
import type {CbbGame} from '../lib/cbb/types';
import type {DailyEdgeGameDto} from '../app/lab/lib/labTypes';
import type {RawOwlsOddsEvent} from '../lib/providers/owls/owlsSharpBookOdds';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/cbb-market-identity-slate-20261103.json',import.meta.url),'utf8'));
type Team={id:number;external_id:number;display_name:string;location:string;abbreviation:string};
type Fixture={id:number;external_id:number;game_date:string;home:Team;away:Team};
const sourceGames=(fixture.games as Fixture[]).map(g=>({id:g.id,externalId:Number(g.external_id),slateDate:computeSlateDate('cbb',g.game_date),gameDate:g.game_date,
 homeTeamId:g.home.id,awayTeamId:g.away.id,homeName:g.home.display_name,awayName:g.away.display_name,homeLocation:g.home.location,awayLocation:g.away.location,
 homeAbbr:g.home.abbreviation,awayAbbr:g.away.abbreviation}));
assert.equal(sourceGames.length,299);
let forward=0,reverse=0;
for(const g of sourceGames){
 assert.equal(matchCbbSourceGame(sourceGames,g.awayName,g.homeName,g.gameDate)?.game.externalId,g.externalId,`complete seven-day fixture ${g.externalId}`);forward++;
 assert.equal(matchCbbSourceGame(sourceGames,g.homeName,g.awayName,g.gameDate)?.reversed,true);reverse++;
 const future={...g,id:g.id+1000000,externalId:g.externalId+1000000,gameDate:new Date(Date.parse(g.gameDate)+7*86400000).toISOString()};
 future.slateDate=computeSlateDate('cbb',future.gameDate);
 assert.equal(matchCbbSourceGame([g,future],g.awayName,g.homeName,future.gameDate)?.game.externalId,future.externalId,'newly arriving date uses the new fixture');
 assert.equal(matchCbbSourceGame([g,{...g,id:g.id+1,externalId:g.externalId+1}],g.awayName,g.homeName,g.gameDate),null,'duplicate physical fixture is never guessed');
}
for(const e of fixture.publicEvents){
 const matched=matchCbbSourceGame(sourceGames,e.away,e.home,e.start);
 assert.equal(matched?.game.externalId,10882618,'actual Playbook Cal Baptist Lancers full name restores all three public panels');
 assert.equal(matchCbbSourceGame(sourceGames,e.home,e.away,e.start)?.reversed,true);
 assert.equal(matchCbbSourceGame(sourceGames,e.away,e.home,'2026-11-05T03:00:00Z'),null);
}
const events=fixture.events as RawOwlsOddsEvent[];
assert.equal(events.length,21);
for(const e of events){
 const match=matchCbbSourceGame(sourceGames,e.away_team!,e.home_team!,e.commence_time!);
 if(e.away_team==='Colorado St') {assert.equal(match,null,'wrong opponent never becomes Fullerton');continue;}
 assert.ok(match,`stored source ${e.away_team}@${e.home_team}`);
 const g=match.game;
 const own={homeTeamDisplayName:g.homeName,awayTeamDisplayName:g.awayName,cbbHomeCollege:g.homeLocation,cbbAwayCollege:g.awayLocation};
 assert.equal(cbbSplitOrientation(e.away_team!,e.home_team!,own),'direct','split display follows canonical source orientation');
 assert.equal(cbbSplitOrientation(e.home_team!,e.away_team!,own),'reversed');
 const game={id:g.externalId,date:g.gameDate,home_team:{id:g.homeTeamId,full_name:g.homeName,college:g.homeLocation},visitor_team:{id:g.awayTeamId,full_name:g.awayName,college:g.awayLocation}} as CbbGame;
 const dto={sport:'cbb',external_id:g.externalId,gameStartAt:g.gameDate,homeTeam:g.homeAbbr,awayTeam:g.awayAbbr,...own,lockState:'open',lockedAt:null} as DailyEdgeGameDto;
 // Synthetic quotes test contract transport, never reconstructed real prices.
 const observed='2026-11-03T12:00:00Z',receipt='2026-11-03T12:01:00Z';
 const quoteEvent={...e,sport:'ncaab',bookmakers:[{key:'draftkings',last_update:observed,markets:[{key:'spreads',outcomes:[
  {name:e.home_team,price:-110,point:-3.5},{name:e.away_team,price:-110,point:3.5}]}]}]};
 assert.equal(normalizeCbbOwlsCurrent(game,{success:true,data:[quoteEvent]},receipt,receipt).quotes[0]?.line,-3.5);
 assert.equal(normalizeCbbOwlsHistory(game,{homeTeam:e.home_team!,awayTeam:e.away_team!},[
  {book:'pinnacle',market:'spreads',side:'home',price:-110,pointValue:-3.5,recordedAt:observed,recordedAtUtc:observed},
  {book:'pinnacle',market:'spreads',side:'away',price:-110,pointValue:3.5,recordedAt:observed,recordedAtUtc:observed}],receipt,receipt).quotes.length,1);
 const book=e.bookmakers![0].key!;
 assert.equal(matchOwlsDisplayEvent(events,dto,'cbb',book)?.eventId,e.eventId,'book-specific native ID owns its chart');
 assert.equal(owlsDisplayProviderSide({...e,home_team:e.away_team,away_team:e.home_team},dto,'home','cbb'),'away');
 assert.equal(predictionMarketTeamMatches({team:e.away_team!,sideCode:''},g.awayAbbr,g.awayName,'cbb',g.awayLocation,true),true);
 assert.equal(matchOwlsDisplayEvent([...events,{...e,eventId:'duplicate-native-id'}],dto,'cbb',book),null,'overlapping native book ownership stays ambiguous');
}
const pfw=sourceGames.find(g=>g.externalId===10882593)!;
const pfwDto={sport:'cbb',gameStartAt:pfw.gameDate,homeTeam:pfw.homeAbbr,awayTeam:pfw.awayAbbr,homeTeamDisplayName:pfw.homeName,awayTeamDisplayName:pfw.awayName,cbbHomeCollege:pfw.homeLocation,cbbAwayCollege:pfw.awayLocation,lockState:'open',lockedAt:null}as DailyEdgeGameDto;
assert.equal(matchOwlsDisplayEvent(events,pfwDto,'cbb'),null,'two complementary IDs cannot become one generic native ID');
assert.match(matchOwlsDisplayEvent(events,pfwDto,'cbb','pinnacle')!.eventId!,/:IPFW@/);
assert.match(matchOwlsDisplayEvent(events,pfwDto,'cbb','draftkings')!.eventId!,/:Purdue FW@/);
const native=events.find(e=>e.away_team==='IPFW')!;
const splitCatalog=[{...native,eventId:'spread-native',bookmakers:[{key:'pinnacle',markets:[{key:'spreads'}]}]},
 {...native,eventId:'total-native',bookmakers:[{key:'pinnacle',markets:[{key:'totals'}]}]}];
assert.equal(matchOwlsDisplayEvent(splitCatalog,pfwDto,'cbb','pinnacle'),null);
assert.equal(matchOwlsDisplayEvent(splitCatalog,pfwDto,'cbb','pinnacle','spread')?.eventId,'spread-native');
assert.equal(matchOwlsDisplayEvent(splitCatalog,pfwDto,'cbb','pinnacle','total')?.eventId,'total-native');
assert.equal(matchOwlsDisplayEvent([...splitCatalog,{...splitCatalog[0],eventId:'duplicate-spread'}],pfwDto,'cbb','pinnacle','spread'),null);
for(const [source,expected]of [['AR-Pine Bluff','Arkansas'],['CA Baptist','Cal State Fullerton'],['S Dakota St','San Diego State'],['Wildcats','Kansas State']])
 assert.equal(cbbSplitTeamMatches(source,{homeTeamDisplayName:expected,cbbHomeCollege:expected},'home'),false);
// New unlocked aliases must not change historical/locked prediction-contract matching.
assert.equal(predictionMarketTeamMatches({team:'AR-Pine Bluff',sideCode:''},'UAPB','Arkansas-Pine Bluff Golden Lions','cbb','Arkansas-Pine Bluff',false),false);
console.log(`PASS CBB identity coverage: ${forward} seven-day fixtures, ${reverse} reverse orientations, future rollover/duplicates, 20 verified source events, wrong-opponent rejection, quote/history/split/chart agreement and immutable legacy matching.`);
