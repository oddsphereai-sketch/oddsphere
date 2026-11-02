import fs from "node:fs";
import assert from "node:assert/strict";
import artifact from "../../lib/cbb/artifacts/candidate-r3.json";
import {forecastCbbCurrentBatch} from "../../lib/cbb/currentScoreRuntime";
import {matchCbbProviderVenue} from "../../lib/cbb/providerVenueIdentity";
import {normalizeCbbOwlsCurrent} from "../../lib/cbb/owlsMarketEvidence";
import type {CbbGame,CbbTrainingGame} from "../../lib/cbb/types";
import type {RawOwlsOddsResponse} from "../../lib/providers/owls/owlsSharpBookOdds";
import type {fetchCbbDayEvents} from "../../lib/services/cbb/fetchCbbDayEvents";

const [fixtureFile,sourceFile,outputFile]=process.argv.slice(2);
if(!fixtureFile||!sourceFile||!outputFile)throw new Error("Usage: trace-cbb-cornell-market-inputs.ts FROZEN_FIXTURE_JSON CURRENT_BOARD_JSON OUTPUT_JSON; local files only");
const input=JSON.parse(fs.readFileSync(fixtureFile,"utf8")) as {games:CbbGame[];training:{games:CbbTrainingGame[]};odds:RawOwlsOddsResponse;official:Awaited<ReturnType<typeof fetchCbbDayEvents>>};
const source=JSON.parse(fs.readFileSync(sourceFile,"utf8"));
const game=input.games.find(g=>g.id===10882496);assert.ok(game);
const board=source.rows.find((r:{snapshot:{gameId:number}})=>r.snapshot.gameId===game.id)?.snapshot.board;assert.ok(board);
assert.equal(game.home_team.id,180);assert.equal(game.visitor_team.id,358);
const venue=matchCbbProviderVenue(game,input.official.events,input.official.fetchedAt);
const forecast=forecastCbbCurrentBatch([{id:game.id,date:game.date,season:game.season,homeId:game.home_team.id,awayId:game.visitor_team.id,
  neutral:venue?.timeConfirmed?venue.neutral:null}],board.asOf,input.training.games)[0].forecast;
const reproducesPublished=Math.abs(forecast.margin-board.score.margin)<1e-8;
const rawEvents=(Array.isArray(input.odds.data)?input.odds.data:Object.values(input.odds.data??{}).flat())
 .filter((event):event is NonNullable<typeof event>=>event!==null&&event.home_team==="Cornell"&&event.away_team==="Pepperdine")
 .map(event=>({id:event.id,sport:event.sport,home_team:event.home_team,away_team:event.away_team,commence_time:event.commence_time,
  bookmakers:event.bookmakers?.filter(book=>["circa","pinnacle","ps3838"].includes(book.key??""))}));
const named=normalizeCbbOwlsCurrent(game,input.odds,input.official.fetchedAt,board.asOf);
const result={game,decisionAt:board.asOf,rawFullGameEvents:rawEvents,venue,forecast,publishedScore:board.score,reproducesPublished,
 prior:{asOf:artifact.prior.asOf,season:artifact.prior.season,home:artifact.prior.teams["180"],away:artifact.prior.teams["358"]},
 currentSeasonCompletedGames:input.training.games.filter(g=>[180,358].includes(g.homeId)||[180,358].includes(g.awayId)),
 qualifiedAtOriginalCapture:named.quotes.filter(q=>["circa","pinnacle","ps3838"].includes(q.sportsbook)),
 conclusion:reproducesPublished?"Frozen released inputs reproduce the independent margin. Relative movement preserves the unresolved starting-level discrepancy.":"Frozen replay does not exactly reproduce the later published margin. Resolve venue/training/capture inputs before claiming independent-input parity or authorizing any winner replacement.",
 limitation:"Frozen raw response is an earlier capture, not a new provider check or complete roster/independent-input accuracy attestation.",providerRequests:0,databaseWrites:0};
fs.writeFileSync(outputFile,JSON.stringify(result,null,2));
console.log(JSON.stringify({gameId:game.id,margin:forecast.margin,publishedMargin:board.score.margin,reproducesPublished,venue,priorGames:[artifact.prior.teams["180"].games,artifact.prior.teams["358"].games],rawEvents:rawEvents.length,outputFile,providerRequests:0,databaseWrites:0}));
