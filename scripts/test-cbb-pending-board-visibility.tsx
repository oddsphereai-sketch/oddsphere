import assert from "node:assert/strict";
import {renderToStaticMarkup} from "react-dom/server";
import {EdgeBoard,cbbBoardEntriesForFilter} from "../app/dev/experience-preview/ActualDailyEdgePreview";
import {adaptCbbProvisionalGame} from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import {advanceCbbProvisionalSnapshot} from "../lib/cbb/provisionalLifecycle";
import {buildCbbProvisionalBoard} from "../lib/cbb/provisionalBoard";
import {normalCdf} from "../lib/cbb/model";
import type {CbbForecast,CbbGame,CbbQuote} from "../lib/cbb/types";
import type {CbbRollingScheduleDto,DailyEdgeGameDto} from "../app/lab/lib/labTypes";

const now="2026-11-04T16:00:00Z";
const start=(id:number)=>new Date(Date.parse("2026-11-04T18:00:00Z")+id*60_000).toISOString();
const team=(id:number)=>({id,name:`School ${id}`,college:`School ${id}`,full_name:`School ${id}`,abbreviation:`S${id}`,conference_id:1});
function analyzedGame(id:number):DailyEdgeGameDto{
 const game:CbbGame={id,date:start(id),season:2026,status:"pre",period:0,home_score:0,away_score:0,home_team:team(id*2),visitor_team:team(id*2+1)};
 const margin=10,sd=12,zero=normalCdf((.5-margin)/sd)-normalCdf((-.5-margin)/sd);
 const forecast:CbbForecast={release:"display-fixture",gameId:id,asOf:now,homeId:game.home_team.id,awayId:game.visitor_team.id,
  homeScore:80,awayScore:70,margin,total:150,homeWinProbability:(1-normalCdf((.5-margin)/sd))/(1-zero),possessions:70,inputStatus:"complete",issues:[],
  uncertainty:{marginSd:sd,totalSd:17,marginTotalCorrelation:0,marginCorrection:0,totalCorrection:0,fitThroughSeason:2025,games:1000}};
 const quote=(market:CbbQuote["market"],line:number|null):CbbQuote=>({gameId:id,market,line,firstPrice:-110,secondPrice:-110,sportsbook:"draftkings",phase:"current",
  providerObservedAt:"2026-11-04T15:59:00Z",fetchedAt:"2026-11-04T15:59:30Z"});
 const board=buildCbbProvisionalBoard(forecast,[quote("moneyline",null),quote("spread",-9.5),quote("total",149.5)]);
 const snapshot=advanceCbbProvisionalSnapshot({existing:null,candidate:board,startsAt:game.date,now});
 return adaptCbbProvisionalGame({game,snapshot,homeLogo:null,awayLogo:null,now});
}
const analyzed=Array.from({length:10},(_,i)=>analyzedGame(i+1));
const scheduled:CbbRollingScheduleDto["games"]=Array.from({length:26},(_,i)=>({id:`schedule-${i+1}`,externalId:i+1,slateDate:"2026-11-04",gameStartAt:start(i+1),
 status:"STATUS_SCHEDULED",awayTeam:`A${i+1}`,awayTeamDisplayName:`Pending away ${i+1}`,awayTeamLogo:null,
 homeTeam:`H${i+1}`,homeTeamDisplayName:`Pending home ${i+1}`,homeTeamLogo:null,venue:null}));
const pending=scheduled.filter(game=>!analyzed.some(row=>row.external_id===game.externalId));
const bytes=JSON.stringify({analyzed,scheduled});
const all=cbbBoardEntriesForFilter(analyzed,scheduled,"all");
assert.equal(all.length,26);assert.equal(all.filter(row=>row.kind==="pending").length,16);
assert.equal(new Set(all.map(row=>row.kind==="analyzed"?row.game.external_id:row.game.externalId)).size,26,"analyzed IDs are never duplicated as schedule-only cards");
assert.deepEqual(all.map(row=>row.game.gameStartAt),[...all.map(row=>row.game.gameStartAt)].sort(),"pending and analyzed entries keep one chronological order");
for(const filter of ["best_angle","lean","watchlist","caution","no_play"] as const){
 const selected=analyzed.slice(0,2);
 assert.deepEqual(cbbBoardEntriesForFilter(selected,pending,filter).map(row=>row.game),selected,
  `${filter} receives only its already-filtered analyzed games; pending fixtures do not acquire a grade`);
 assert.deepEqual(cbbBoardEntriesForFilter([],pending,filter),[]);
}
const render=(games:DailyEdgeGameDto[],schedule:CbbRollingScheduleDto["games"])=>renderToStaticMarkup(<EdgeBoard games={games} sport="cbb" activeId="" activeMarket="moneyline"
 selectGame={()=>{}} prefetchGameDetail={()=>{}} groupByDay cbbScheduledGames={schedule} selectCbbScheduledGame={()=>{}}/>);
const html=render(analyzed,scheduled);
const text=html.replace(/<[^>]*>/g,"");
assert.equal((html.match(/data-game-id=/g)??[]).length,26,"the actual EdgeBoard SSR must include all26 cards, not just the helper output");
assert.match(html,/10 analyzed[^<]*16 pending/);
assert.match(text,/26 found/);
assert.match(html,/>All<span[^>]*>26<\/span>/,"the All count includes pending while analyzed remains10");
assert.match(text,/26 matches/);
for(const game of pending){
 const card=html.split(`data-game-id="${game.id}"`)[1]?.split("</article>")[0];
 assert.ok(card,`${game.id} renders a pending card`);
 assert.ok(card.includes(game.awayTeamDisplayName)&&card.includes(game.homeTeamDisplayName));
 assert.match(card,/Scheduled/);
 assert.doesNotMatch(card,/%|Outcome forecast|Model projects|Watchlist|Best Angle|No Play|priceAmerican|modelProb/,
  "a schedule-only card contains identity/time/status, not an invented forecast, grade or price");
}
const pendingOnly=render([],pending);
assert.equal((pendingOnly.match(/data-game-id=/g)??[]).length,16,"a schedule-only day cannot become a blank board");
assert.match(pendingOnly,/0 analyzed[^<]*16 pending/);
assert.doesNotMatch(pendingOnly,/No games match these filters/);
const pendingSearch=pending.filter(game=>game.externalId===17);
assert.deepEqual(cbbBoardEntriesForFilter([],pendingSearch,"all").map(row=>row.game.id),["schedule-17"],"an already search-filtered pending match remains visible");
assert.equal(JSON.stringify({analyzed,scheduled}),bytes,"presentation cannot mutate the original analyzed or schedule payloads");
console.log("PASS CBB pending board: actual SSR26cards/10analyzed/16pending, chronology/dedup, ungraded filter exclusion, pending-only day, unchanged prediction payloads.");
