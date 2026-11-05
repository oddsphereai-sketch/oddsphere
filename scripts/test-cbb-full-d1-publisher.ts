import type {CbbGame} from "../lib/cbb/types";
import fs from "node:fs";
import {gunzipSync} from "node:zlib";
import {normalizeCbbTheOddsApiCurrent,fetchCbbTheOddsApiCurrent,CBB_THE_ODDS_API_CURRENT_RELEASE} from "../lib/services/cbb/cbbTheOddsApiCurrent";
import type {RawOwlsOddsEvent} from "../lib/providers/owls/owlsSharpBookOdds";
import assert from "node:assert/strict";
import {mock} from "node:test";
import {computeSlateDate} from "../lib/dates/slateDate";
import {cbbDivisionOneFixture} from "../lib/cbb/divisionOneMembership";
import {cbbOfficialD1FixtureContext} from "../lib/cbb/crossDivisionIdentity";
import {buildCbbRollingSchedule,applyCbbScheduleCoverage,excludeAnalyzedCbbScheduleGames} from "../lib/services/cbb/cbbRollingSchedule";
import {refreshCbbMemberBoard} from "../lib/services/cbb/cbbMemberPipeline";
import {writeCbbMemberGame,type CbbStoredMemberGame} from "../lib/services/cbb/cbbMemberGameStore";
import {writeLockedCbbTracking} from "../lib/services/cbb/cbbTrackingWriter";
import {gradePrediction} from "../lib/services/predictionGrader";
import {forecastCbbFullDivisionOneBatch} from "../lib/cbb/fullDivisionOneForecast";
import {buildCbbGameForecastBoard} from "../lib/cbb/gameForecastBoard";
import {advanceCbbProvisionalSnapshot} from "../lib/cbb/provisionalLifecycle";
import {adaptCbbProvisionalGame} from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import {readCbbCurrentTraining,CBB_CURRENT_TRAINING_RELEASE} from "../lib/services/cbb/cbbCurrentSeasonTraining";
import type {PredictionRecordRow} from "../lib/types/domain/Tracking";
import type {DailyEdgeResponse} from "../app/lab/lib/labTypes";
import type {CbbBallDontLieClient} from "../lib/cbb/ballDontLie";
import type {OwlsInsightClient} from "../lib/providers/owls/owlsInsightClient";
import {readFullD1Fixture,type ForwardSource} from "./lib/cbbFullD1OfflineInputs";

async function main(){
  const now="2026-11-05T05:00:00.000Z",day="2026-11-05";
  mock.timers.enable({apis:["Date"],now:new Date(now)});
  const source=readFullD1Fixture<ForwardSource>("forward-source");
  const games=source.games.filter(g=>computeSlateDate("cbb",g.date)===day&&cbbDivisionOneFixture(g).eligible);
  const official=source.officialDays.find(d=>d.day===day)!;
  const teams=new Map(games.flatMap(g=>[g.home_team,g.visitor_team]).map(t=>[t.id,
    {id:t.id,abbreviation:t.abbreviation,display_name:t.full_name,logo_url:null}]));
  const schedule=buildCbbRollingSchedule({anchorDate:day,teams:[...teams.values()],games:games.map(g=>({
    external_id:g.id,slate_date:day,game_date:g.date,status:"STATUS_SCHEDULED",away_team_id:g.visitor_team.id,
    home_team_id:g.home_team.id,venue:cbbOfficialD1FixtureContext(g,official.events,official.fetchedAt)?.venue??null}))});
  const stored=new Map<string,unknown>([["cbb::member-game::nov4-owner-record",{lockedAt:"2026-11-04T22:00Z",exactOwnerPayload:true}]]);
  const original=JSON.stringify(stored.get("cbb::member-game::nov4-owner-record"));
  const tracked:Record<string,unknown>[]=[];
  const db={from:(table:string)=>{
    if(table==="games")return {select:()=>{let id=0;const q={eq:(field:string,value:unknown)=>{if(field==="external_id")id=Number(value);return q;},returns:()=>q,
      maybeSingle:async()=>{const g=games.find(g=>g.id===id)!;return {data:{id,external_id:id,game_date:g.date,slate_date:day,
        home_team:{external_id:g.home_team.id,display_name:g.home_team.full_name},
        away_team:{external_id:g.visitor_team.id,display_name:g.visitor_team.full_name}},error:null};}};return q;}};
    if(table==="prediction_records")return {select:()=>{const q={eq:()=>q,then:(resolve:(x:unknown)=>unknown)=>resolve({data:tracked,error:null})};return q;},
      insert:async(row:Record<string,unknown>)=>{tracked.push(structuredClone(row));return {error:null};}};
    if(table==="market_split_observations_v2")return {select:()=>{const q={eq:()=>q,in:()=>q,gte:()=>q,lte:()=>q,order:()=>q,
      range:async()=>({data:[],error:null})};return q;}};
    assert.equal(table,"lab_response_snapshots");
    return {select:()=>({in:async(_:string,keys:string[])=>({data:keys.filter(k=>stored.has(k)).map(k=>({snapshot_key:k,payload:stored.get(k)})),error:null}),
      eq:(_:string,key:string)=>({maybeSingle:async()=>({data:stored.has(key)?{payload:stored.get(key)}:null,error:null})})}),
      upsert:async(row:{snapshot_key:string;payload:unknown})=>{stored.set(row.snapshot_key,structuredClone(row.payload));return {error:null};}};
  }} as unknown as NonNullable<Parameters<typeof refreshCbbMemberBoard>[0]["db"]>;
  let providerCalls=0,owlsCalls=0,freeCalls=0;
  const provider={get calls(){return providerCalls;},gamesForDates:async()=>{providerCalls++;return games;}} as unknown as CbbBallDontLieClient;
  const owls={odds:async()=>{owlsCalls++;return {body:{success:true,data:[]}};},
    splits:async()=>{owlsCalls++;return {body:{success:true,data:[]}};}} as unknown as OwlsInsightClient;
  const fetcher=(async()=>{freeCalls++;return new Response(JSON.stringify({events:official.events}));}) as typeof fetch;
  const family={complete:true,reason:"offline_empty_source",highWaterId:0,lastId:0,rows:0,bytes:0,queries:0};
  const canonicalHistoryReader=(async()=>({release:"cbb_canonical_reader_history_2026_11_05_r3_indexed_price_watermark",complete:true,
    asOf:now,since:now,sourceWindow:"six_hour_bootstrap_or_explicit_since",providerRequests:0,databaseWrites:0,
    priceRows:[],splitRows:[],retailPriceRows:[],price:family,split:family,retailPrice:family,elapsedMs:0})) as NonNullable<Parameters<typeof refreshCbbMemberBoard>[0]["canonicalHistoryReader"]>;
  let published:DailyEdgeResponse|null=null;
  const saveSnapshot=(async(input:{payload:DailyEdgeResponse})=>{published=structuredClone(input.payload);
    return {ok:true,snapshotKey:"offline",expiresAt:now,staleUntil:now};}) as NonNullable<Parameters<typeof refreshCbbMemberBoard>[0]["saveSnapshot"]>;
  const result=await refreshCbbMemberBoard({anchorDate:day,season:2026,now,bdlKey:"offline",owlsKey:"offline",provider,owls,
    trainingGames:[],db,fetcher,loadSchedule:async()=>schedule,saveSnapshot,canonicalHistoryReader,fallbackOdds:[]});
  assert.equal(result.sourceGames,65);assert.equal(result.published,65);assert.equal(result.scheduleOnly,0);
  assert.equal(result.unpublishedIncomplete.length,0);assert.equal(result.written,65);assert.equal(result.trackingInserted,0);
  assert.equal((published as DailyEdgeResponse|null)?.games.length,65);assert.equal(providerCalls,2);assert.equal(owlsCalls,2);assert.equal(freeCalls,1);
  assert.equal(JSON.stringify(stored.get("cbb::member-game::nov4-owner-record")),original);
  // Exercise the real sole writer with an injected, bounded source read. The
  // raw prices below are captured Owls contracts in documented Odds API wire
  // form: this proves the handoff, not additional live provider coverage.
  const sourceCapture=JSON.parse(gunzipSync(fs.readFileSync(new URL("./fixtures/cbb-source-admission-20261105.json.gz",import.meta.url))).toString()) as {
    capturedAt:string;games:CbbGame[];events:RawOwlsOddsEvent[]};
  const quoteGame=sourceCapture.games.find(g=>g.id===10882706)!;
  const native=sourceCapture.events.filter(e=>e.away_team==="Penn").map((e,i)=>({...e,id:`contract-${i}`,sport_key:"basketball_ncaab"}));
  // Keep one event with all its source books; each API event remains unique.
  const event={...native[0],bookmakers:native.flatMap(e=>e.bookmakers??[])};
  let sourceReads=0;
  const theOddsApiReader=(async args=>{sourceReads++;args.onRequest?.("quota");args.onRequest?.("current");
    const evidence=normalizeCbbTheOddsApiCurrent([quoteGame],[event],sourceCapture.capturedAt,sourceCapture.capturedAt);
    return {release:CBB_THE_ODDS_API_CURRENT_RELEASE,status:"read",requestedAt:sourceCapture.capturedAt,availableAt:sourceCapture.capturedAt,
      requests:2,paidRequests:1,creditsUsed:3,creditsRemaining:9997,...evidence};}) as typeof fetchCbbTheOddsApiCurrent;
  const beforeConnected=new Map([...stored].map(([key,value])=>[key,structuredClone(value)]));
  const connected=await refreshCbbMemberBoard({anchorDate:day,season:2026,now:sourceCapture.capturedAt,bdlKey:"offline",owlsKey:"offline",theOddsApiKey:"dummy",
    theOddsApiReader,provider,owls,trainingGames:[],db,fetcher,loadSchedule:async()=>schedule,saveSnapshot,canonicalHistoryReader,fallbackOdds:[]});
  assert.equal(sourceReads,1);assert.equal(connected.published,65);assert.equal(connected.currentSourceCoverage.theOddsApiRequests,2);
  assert.ok(connected.currentSourceCoverage.quotesByProvider.the_odds_api>0);
  const connectedMember=(stored.get(`cbb::member-game::${quoteGame.id}`) as CbbStoredMemberGame).memberGame;
  for(const key of ["moneyline","first_inning","total"] as const){
    const market=connectedMember.markets[key];assert.ok(market.priceAmerican!==null,`${key} exact target quote reaches the card`);
    assert.ok(market.oddsTrail?.length);assert.ok(market.opposingOddsTrail?.stops.length,`${key} both source sides reach the reader`);
  }
  assert.equal(JSON.stringify(stored.get("cbb::member-game::nov4-owner-record")),original);
  // One failed transport must not prevent the other exact source from
  // completing the same board. Provider failure remains visible in telemetry.
  stored.clear();for(const [key,value] of beforeConnected)stored.set(key,value);
  const outageOwls={odds:async()=>{throw Error("offline source outage");},splits:async()=>({body:{success:true,data:[]}})} as unknown as OwlsInsightClient;
  const outage=await refreshCbbMemberBoard({anchorDate:day,season:2026,now:sourceCapture.capturedAt,bdlKey:"offline",owlsKey:"offline",theOddsApiKey:"dummy",
    theOddsApiReader,provider,owls:outageOwls,trainingGames:[],db,fetcher,loadSchedule:async()=>schedule,saveSnapshot,canonicalHistoryReader,fallbackOdds:[]});
  assert.equal(outage.published,65);assert.ok(outage.providerWarnings.includes("Owls current odds request failed"));
  assert.ok(outage.currentSourceCoverage.quotesByProvider.the_odds_api>0);
  // Restore only this in-memory harness before earlier-clock lifecycle cases.
  stored.clear();for(const [key,value] of beforeConnected)stored.set(key,value);
  const tbd=source.games.find(g=>g.id===10882930)!;
  assert.ok(tbd,"actual frozen future fixture with unconfirmed official tip time");
  const tbdTeams=[tbd.home_team,tbd.visitor_team].map(t=>({id:t.id,abbreviation:t.abbreviation,display_name:t.full_name,logo_url:null}));
  const tbdSchedule=buildCbbRollingSchedule({anchorDate:day,teams:[...new Map([...teams.values(),...tbdTeams].map(t=>[t.id,t])).values()],games:[
    ...games.map(g=>({external_id:g.id,slate_date:day,game_date:g.date,status:"STATUS_SCHEDULED",away_team_id:g.visitor_team.id,home_team_id:g.home_team.id,venue:null})),
    {external_id:tbd.id,slate_date:computeSlateDate("cbb",tbd.date),game_date:tbd.date,status:"STATUS_SCHEDULED",away_team_id:tbd.visitor_team.id,home_team_id:tbd.home_team.id,venue:null}]});
  const sourceFetcher=(async(input:string|URL|Request)=>{const key=new URL(String(input)).searchParams.get("dates");
    return new Response(JSON.stringify({events:source.officialDays.find(d=>d.day.replaceAll("-","")===key)?.events??[]}));}) as typeof fetch;
  const late=source.games.find(g=>computeSlateDate("cbb",g.date)==="2026-11-11"&&g.date.startsWith("2026-11-12")&&
    !cbbDivisionOneFixture(g).crossDivision&&forecastCbbFullDivisionOneBatch([g],now,[],new Map(source.officialDays.map(d=>[d.day,d])))[0].forecast.inputStatus==="complete")!;
  assert.ok(late,"actual late ET fixture crosses the last requested UTC midnight");
  const lateTeams=[late.home_team,late.visitor_team].map(t=>({id:t.id,abbreviation:t.abbreviation,display_name:t.full_name,logo_url:null}));
  const lateSchedule=buildCbbRollingSchedule({anchorDate:day,teams:[...new Map([...teams.values(),...lateTeams].map(t=>[t.id,t])).values()],games:[
    ...games.map(g=>({external_id:g.id,slate_date:day,game_date:g.date,status:"STATUS_SCHEDULED",away_team_id:g.visitor_team.id,home_team_id:g.home_team.id,venue:null})),
    {external_id:late.id,slate_date:computeSlateDate("cbb",late.date),game_date:late.date,status:"STATUS_SCHEDULED",away_team_id:late.visitor_team.id,home_team_id:late.home_team.id,venue:null}]});
  const dateCalls:string[][]=[];
  const utcProvider={calls:0,gamesForDates:async(dates:string[])=>{dateCalls.push([...dates]);return [...games,late].filter(g=>dates.includes(g.date.slice(0,10)));}} as unknown as CbbBallDontLieClient;
  const lateResult=await refreshCbbMemberBoard({anchorDate:day,season:2026,now,bdlKey:"offline",owlsKey:"offline",provider:utcProvider,owls,
    trainingGames:[],db,fetcher:sourceFetcher,loadSchedule:async()=>lateSchedule,saveSnapshot,canonicalHistoryReader,fallbackOdds:[]});
  assert.equal(lateResult.published,66,"the seventh ET day's late game must publish an actual forecast");
  assert.ok((published as DailyEdgeResponse|null)?.games.some(g=>g.external_id===late.id));
  assert.equal(dateCalls.length,2,"reuse the existing bounded two-batch fixture capture");
  assert.ok(dateCalls.every(dates=>dates.length<=7));
  assert.ok(dateCalls.flat().includes("2026-11-12"),"capture the following UTC date before exact ET filtering");
  assert.equal(JSON.stringify(stored.get("cbb::member-game::nov4-owner-record")),original);
  const incomplete=await refreshCbbMemberBoard({anchorDate:day,season:2026,now,bdlKey:"offline",owlsKey:"offline",
    provider:{...provider,gamesForDates:async()=>[...games,tbd]} as unknown as CbbBallDontLieClient,owls,
    trainingGames:[],db,fetcher:sourceFetcher,loadSchedule:async()=>tbdSchedule,saveSnapshot,canonicalHistoryReader,fallbackOdds:[]});
  assert.equal(incomplete.published,65);assert.ok(incomplete.unpublishedIncomplete.includes(tbd.id));
  const finalResponse=published as DailyEdgeResponse|null;
  assert.ok(finalResponse?.cbbScheduleCoverage);
  const visible=applyCbbScheduleCoverage(tbdSchedule,finalResponse.cbbScheduleCoverage);
  assert.equal(excludeAnalyzedCbbScheduleGames(visible,finalResponse.games.map(g=>g.external_id)).games.length,0,
    "unconfirmed future fixtures stay internal instead of publishing empty placeholder cards");
  const future=source.games.find(g=>computeSlateDate("cbb",g.date)>day&&!cbbDivisionOneFixture(g).crossDivision)!;
  assert.ok(future);
  const futureTeams=[future.home_team,future.visitor_team].map(t=>({id:t.id,abbreviation:t.abbreviation,display_name:t.full_name,logo_url:null}));
  const futureSchedule=buildCbbRollingSchedule({anchorDate:day,teams:[...new Map([...teams.values(),...futureTeams].map(t=>[t.id,t])).values()],games:[
    ...games.map(g=>({external_id:g.id,slate_date:day,game_date:g.date,status:"STATUS_SCHEDULED",away_team_id:g.visitor_team.id,home_team_id:g.home_team.id,venue:null})),
    {external_id:future.id,slate_date:computeSlateDate("cbb",future.date),game_date:future.date,status:"STATUS_SCHEDULED",away_team_id:future.visitor_team.id,home_team_id:future.home_team.id,venue:null}]});
  const partialArgs={anchorDate:day,season:2026,now,bdlKey:"offline",owlsKey:"offline",
    provider:{...provider,gamesForDates:async()=>[...games,future]} as unknown as CbbBallDontLieClient,owls,
    trainingGames:[],db,fetcher,loadSchedule:async()=>futureSchedule,saveSnapshot,canonicalHistoryReader,fallbackOdds:[]};
  const partial=await refreshCbbMemberBoard(partialArgs);
  assert.equal(partial.published,65,"an incomplete future D1 venue cannot abort today's complete slate");
  assert.ok(partial.unpublishedIncomplete.includes(future.id));
  const validFuture=forecastCbbFullDivisionOneBatch([future],now,[],new Map(source.officialDays.map(d=>[d.day,d])))[0];
  assert.equal(validFuture.forecast.inputStatus,"complete");
  const priorBoard=buildCbbGameForecastBoard(validFuture.forecast,null);
  const priorSnapshot=advanceCbbProvisionalSnapshot({existing:null,candidate:priorBoard,startsAt:future.date,now});
  const priorMember=adaptCbbProvisionalGame({game:future,snapshot:priorSnapshot,now,homeLogo:null,awayLogo:null});
  const priorRecord={release:recordRelease(),snapshot:priorSnapshot,memberGame:priorMember};
  function recordRelease(){return (stored.get(`cbb::member-game::${games[0].id}`) as CbbStoredMemberGame).release;}
  stored.set(`cbb::member-game::${future.id}`,priorRecord);
  const priorBytes=JSON.stringify(priorRecord),fallback=await refreshCbbMemberBoard(partialArgs);
  assert.equal(fallback.published,66,"a prior coherent future forecast remains available during a source gap");
  assert.equal(JSON.stringify(stored.get(`cbb::member-game::${future.id}`)),priorBytes,"incomplete refresh cannot replace the prior member payload");
  const game=games.find(g=>cbbDivisionOneFixture(g).crossDivision)!;
  const record=stored.get(`cbb::member-game::${game.id}`) as CbbStoredMemberGame;
  assert.ok(record.snapshot.board.gameForecast);assert.equal(record.snapshot.board.marketContext.verifiedMarketRead,null,
    "D1 numerical reader may not alter the cross-domain game forecast");
  const lockAt=new Date(Date.parse(game.date)-3600_000).toISOString();
  const locked=await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:lockAt},db);
  const bytes=JSON.stringify(locked.record);
  const duplicate=await writeCbbMemberGame({game,candidate:{...record.snapshot.board,score:{...record.snapshot.board.score,home:999}},
    homeLogo:null,awayLogo:null,now:game.date},db);
  assert.equal(duplicate.written,false);assert.equal(JSON.stringify(duplicate.record),bytes);
  assert.equal(await writeLockedCbbTracking(locked.record,db),1);assert.equal(tracked.length,1);
  const row=tracked[0] as unknown as PredictionRecordRow;
  assert.equal(row.market,"moneyline");assert.equal(row.odds_american,null);assert.equal(row.expected_value,null);
  assert.equal(row.edge,null);assert.equal(row.no_bet,true);assert.equal(row.source_quality,"statistical_game_forecast_without_qualified_book_price");
  const selectedHome=row.side==="home";
  const settled=gradePrediction({record:row,game:{status:"STATUS_FINAL",home_score:selectedHome?80:50,
    away_score:selectedHome?50:80,first_inning_runs:null},source:"auto_score_ingest"});
  assert.equal(settled.result,"win");
  assert.equal(await writeLockedCbbTracking(locked.record,db),0);
  assert.equal(JSON.stringify(locked.record),bytes);
  const corrupt=structuredClone(locked.record);corrupt.snapshot.board.gameForecast!.homeId=999999;
  await assert.rejects(writeLockedCbbTracking(corrupt,db),/school identity or score law/);
  const domain=forecastCbbFullDivisionOneBatch([game],now,[],new Map(source.officialDays.map(d=>[d.day,d])))[0];
  const quotedBoard=buildCbbGameForecastBoard(domain.forecast,domain.coverage,(["moneyline","spread","total"] as const).map(market=>({
    gameId:game.id,market,sportsbook:"fanduel",line:market==="moneyline"?null:market==="spread"?-20.5:150.5,
    firstPrice:-110,secondPrice:-110,providerObservedAt:now,fetchedAt:now,phase:"current" as const})));
  const qi=advanceCbbProvisionalSnapshot({existing:null,candidate:quotedBoard,startsAt:game.date,now});
  const qs=advanceCbbProvisionalSnapshot({existing:qi,candidate:null,startsAt:game.date,now:lockAt});
  const qm=adaptCbbProvisionalGame({game,snapshot:qs,homeLogo:null,awayLogo:null,now:lockAt});
  const qr={...record,snapshot:qs,memberGame:qm};
  tracked.length=0;
  assert.equal(await writeLockedCbbTracking(qr,db),1);
  assert.equal(tracked[0].market,"moneyline");assert.equal(tracked[0].odds_american,null);
  assert.equal(tracked[0].source_quality,"statistical_game_forecast_without_qualified_book_price");
  assert.ok(qr.snapshot.board.rows.every(r=>!!r.observedQuote));
  assert.ok(qm.markets.total.observedMarketQuote);assert.ok(qm.markets.first_inning.observedMarketQuote);
  const core=readFullD1Fixture<{payload:{games:import("../lib/cbb/types").CbbTrainingGame[]}}>("existing-current-training").payload.games;
  const trainingKey="cbb::current-season-training::2026";
  stored.set(trainingKey,{release:CBB_CURRENT_TRAINING_RELEASE,season:2026,updatedAt:now,games:core,crossDivisionGames:[]});
  assert.ok(await readCbbCurrentTraining(2026,db));
  stored.set(trainingKey,{release:CBB_CURRENT_TRAINING_RELEASE,season:2026,updatedAt:now,games:core,crossDivisionGames:[{
    ...core[0],id:99999999,divisionOneId:core[0].homeId,opponentId:core[0].awayId}]});
  await assert.rejects(readCbbCurrentTraining(2026,db),/receipt corrupt/);
  console.log(JSON.stringify({privatePublisherForecasts:65,placeholderCards:0,newUnpricedWinnerRecords:1,
    quotedHoldTracksOnlyModelWinner:true,crossTrainingPartitionChecked:true,
    noFabricatedSpreadOrTotal:true,lockWriterAndReaderExact:true,november4Unchanged:true,
    networkRequests:0,productionWrites:0,mockedExistingProviderCalls:{bdl:providerCalls,owls:owlsCalls,espn:freeCalls}}));
}
void main().finally(()=>mock.timers.reset());
