import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import prairie from "./fixtures/cbb-lines-20261113/prairie-view-source.json";
import locked from "./fixtures/cbb-lines-20261113/west-florida-original-lock.json";
import recovery from "../lib/cbb/artifacts/locked-market-recovery-10883106-r2.json";
import {normalizeCbbOwlsCurrent} from "../lib/cbb/owlsMarketEvidence";
import {cbbProviderInstitutionName} from "../lib/cbb/providerInstitutionIdentity";
import {cbbObservedMarketQuote} from "../lib/services/cbb/cbbObservedMarketQuote";
import {adaptCbbProvisionalGame,cbbDailyEdgeResponse} from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import {appendCbbLockedMarketRecovery,cbbRecoveryPayloadSha256} from "../lib/services/cbb/cbbLockedMarketRecovery";
import {overlayCbbLockedMemberGames} from "../lib/services/cbb/cbbMemberReader";
import {writeCbbMemberGame,type CbbStoredMemberGame} from "../lib/services/cbb/cbbMemberGameStore";
import {accumulateCbbPublishedQuotes,BOOK_DISPLAY_HISTORY_RELEASE,type BookDisplayFeed} from "../lib/providers/owls/owlsBookDisplayHistory";
import {CbbRecoveredMarketContext} from "../app/lab/components/daily-edge/CbbRecoveredMarketContext";
import {QuickRead as MemberQuickRead} from "../app/dev/experience-preview/ActualDailyEdgePreview";
import type {CbbGame,CbbQuote} from "../lib/cbb/types";

export async function testCbbLineCoverage(){
  const raw=structuredClone(prairie),p=raw.game as CbbGame;
  const found=normalizeCbbOwlsCurrent(p,{success:true,data:raw.events},raw.at,raw.at).quotes;
  assert.deepEqual([...new Set(found.map(q=>q.market))].sort(),["moneyline","spread","total"]);
  assert(found.some(q=>q.sportsbook==="fanduel"&&q.market==="moneyline"&&q.firstPrice===-100000));
  assert.equal(normalizeCbbOwlsCurrent({...p,visitor_team:{...p.visitor_team,full_name:"Prairie State Panthers",college:"Prairie State"}},
    {success:true,data:raw.events},raw.at,raw.at).quotes.length,0,"No mascot, prefix or substring identity shortcut");
  assert.notEqual(cbbProviderInstitutionName("Prairie View"),cbbProviderInstitutionName("Prairie State"));
  const record=structuredClone(locked) as unknown as CbbStoredMemberGame,exact=JSON.stringify(record);
  assert.equal(cbbRecoveryPayloadSha256(record),recovery.originalPayloadSha256);
  type Point={timestampUtc:string;price:number;point?:string;inPlay?:boolean};
  const histories=new Map<string,Point[]>();
  for(const source of recovery.sourceReceipts){
    const bytes=readFileSync(`scripts/fixtures/cbb-lines-20261113/${source.file}`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"),source.sha256);
    const receipt=JSON.parse(bytes.toString()),d=receipt.body.data;
    assert.equal(receipt.status,200);assert.equal(d.book,recovery.book);assert.equal(d.eventId,recovery.providerEventId);
    assert.equal(d.market,source.market);assert.equal(d.side,source.side);
    assert(Date.parse(receipt.availableAt)>Date.parse(recovery.lockedAt));
    histories.set(`${d.market}:${d.side}`,d.history.filter((x:Point)=>Date.parse(x.timestampUtc)<=Date.parse(recovery.asOf)&&x.inPlay!==true));
  }
  for(const row of recovery.markets){
    const k=row.market==="moneyline"?"h2h":row.market==="spread"?"spreads":"totals";
    const a=histories.get(`${k}:${k==="totals"?"over":"home"}`)!,b=histories.get(`${k}:${k==="totals"?"under":"away"}`)!;
    const first=a.filter(x=>b.some(y=>y.timestampUtc===x.timestampUtc)).sort((x,y)=>Date.parse(x.timestampUtc)-Date.parse(y.timestampUtc)).at(-1)!;
    const second=b.find(x=>x.timestampUtc===first.timestampUtc)!;
    assert.equal(row.observedAt,first.timestampUtc);assert.equal(row.firstPrice,first.price);assert.equal(row.secondPrice,second.price);
    if(row.line!==null){assert.equal(row.line,Number(first.point));assert.equal(row.line,row.market==="spread"?-Number(second.point):Number(second.point));}
  }
  const game:CbbGame={id:recovery.gameId,date:recovery.startsAt,season:2026,status:"pre",period:0,home_score:0,away_score:0,
    home_team:{id:167,conference_id:1,name:"Vikings",full_name:recovery.homeDisplayName,college:"Cleveland State",abbreviation:record.memberGame.homeTeam},
    visitor_team:{id:732,conference_id:1,name:"Argonauts",full_name:recovery.awayDisplayName,college:"West Florida",abbreviation:record.memberGame.awayTeam}};
  const now="2026-11-13T18:50:00.000Z",observedAt="2026-11-13T18:42:23.860Z";
  const quotes:CbbQuote[]=( ["moneyline","spread","total"] as const).map(market=>({gameId:game.id,sportsbook:"fanduel",market,
    line:market==="moneyline"?null:market==="spread"?-1.5:150.5,firstPrice:-110,secondPrice:-110,providerObservedAt:observedAt,fetchedAt:now,phase:"current",provider:"owls"}));
  const q=cbbObservedMarketQuote(game,"spread",quotes,now)!;assert.equal(q.quotes[0].line,-1.5);assert.equal(q.quotes[1].line,1.5);
  for(const bad of [quotes.map(q=>({...q,gameId:0})),quotes.map(q=>({...q,phase:"opening" as const})),
    quotes.map(q=>({...q,firstPrice:-5000,secondPrice:-5000})),quotes.map(q=>({...q,providerObservedAt:"2026-11-13T16:00:00Z"})),
    quotes.map(q=>({...q,providerObservedAt:"2026-11-13T18:51:00Z"})),quotes.map(q=>({...q,sportsbook:"novig"}))])
    assert.equal(cbbObservedMarketQuote(game,"spread",bad,now),undefined);
  const snapshot={...structuredClone(record.snapshot),lockedAt:null,capturedAt:now};
  const beforeBoard=JSON.stringify(snapshot.board);
  const unpriced=adaptCbbProvisionalGame({game,snapshot,homeLogo:null,awayLogo:null,now,marketQuotes:quotes});
  for(const key of ["moneyline","total","first_inning"] as const){
    const m=unpriced.markets[key];assert(m.observedMarketQuote);assert.equal(m.priceAmerican,null);assert.equal(m.pick,null);assert.equal(m.line,null);
    assert.equal(m.verdict.key,"no_play");assert.match(renderToStaticMarkup(<CbbRecoveredMarketContext game={unpriced} market={key}/>),/Market odds/);
    assert.match(renderToStaticMarkup(<MemberQuickRead game={unpriced} market={m} marketKey={key} sport="cbb"/>),/Market odds/,
      "The active card must show a real offer even without a model wager");
  }
  assert.equal(JSON.stringify(snapshot.board),beforeBoard,"Observed offers never change model decisions");
  const empty:BookDisplayFeed={release:BOOK_DISPLAY_HISTORY_RELEASE,sport:"cbb",fetchedAt:now,eventsAt:now,events:[],rows:[]};
  const tape=accumulateCbbPublishedQuotes(empty,[unpriced],null,Date.parse(now));assert.equal(tape.rows.length,6);
  assert(tape.rows.every(r=>r.opening===null&&r.observedQuotes===true&&r.quotes.length===1));
  assert.deepEqual(accumulateCbbPublishedQuotes(tape,[unpriced],null,Date.parse(now)),tape);
  assert.equal(accumulateCbbPublishedQuotes(empty,[record.memberGame],null,Date.parse(now)).rows.length,0,"Existing locked cards cannot acquire new history");
  const view=appendCbbLockedMarketRecovery(record,structuredClone(record.memberGame));
  assert.equal(view.cbbRecoveredMarketData?.markets.length,3);assert.deepEqual(view.markets,record.memberGame.markets);
  for(const key of ["moneyline","total","first_inning"] as const)
    assert.match(renderToStaticMarkup(<MemberQuickRead game={view} market={view.markets[key]} marketKey={key} sport="cbb"/>),/Recovered pre-lock odds/);
  assert.deepEqual(view.projected,record.memberGame.projected);assert.deepEqual(view.predictions,record.memberGame.predictions);
  const changed=structuredClone(record);changed.memberGame.projected.home+=1;assert.equal(appendCbbLockedMarketRecovery(changed,changed.memberGame),changed.memberGame);
  let writes=0;
  const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{payload:record},error:null})})}),upsert:async()=>{writes++;return{error:null};}})} as unknown as Parameters<typeof writeCbbMemberGame>[1];
  assert.equal((await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:"2026-11-13T20:10:00Z"},db)).written,false);
  const index={snapshot_key:`cbb::member-game::${game.id}`,storeRelease:record.release,gameId:String(game.id),startsAt:record.snapshot.startsAt,lockedAt:record.snapshot.lockedAt,
    memberId:record.memberGame.id,memberExternalId:String(game.id),memberStart:record.snapshot.startsAt,memberLock:record.snapshot.lockedAt};
  const readerDb={from:(table:string)=>table==="lab_response_snapshots"?{select:(fields:string)=>({in:async()=>({data:fields.includes("storeRelease:")?[index]:[{snapshot_key:index.snapshot_key,payload:record}],error:null})})}:
    {select:()=>({eq:()=>({in:async()=>({data:[{external_id:game.id,status:"STATUS_SCHEDULED",home_score:null,away_score:null,game_date:game.date,
      home_team:{external_id:167,display_name:game.home_team.full_name},away_team:{external_id:732,display_name:game.visitor_team.full_name}}],error:null})})})}} as unknown as Parameters<typeof overlayCbbLockedMemberGames>[1];
  const board=cbbDailyEdgeResponse("2026-11-13",[structuredClone(record.memberGame)],now);board.games[0].markets.total.line=999;
  const publicView=await overlayCbbLockedMemberGames(board,readerDb);
  assert.deepEqual(publicView.games[0].markets,record.memberGame.markets,"Exact original locked payload precedes a newer altered board");
  assert.equal(publicView.games[0].cbbRecoveredMarketData?.markets.length,3);
  assert.equal(writes,0);assert.equal(JSON.stringify(record),exact);
  console.log("PASS CBB all-market alias recovery, forecast-only paired display/history, invalid-source refusal, source-hashed pre-lock recovery and immutable writer/reader precedence; zero real IO");
}
if(process.argv[1]?.endsWith("test-cbb-line-coverage.tsx"))
  testCbbLineCoverage().catch(error=>{console.error(error);process.exitCode=1;});
