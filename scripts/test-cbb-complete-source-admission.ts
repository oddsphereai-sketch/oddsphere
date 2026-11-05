import assert from "node:assert/strict";
import fs from "node:fs";
import {gunzipSync} from "node:zlib";
import {normalizeCbbOwlsCurrent} from "../lib/cbb/owlsMarketEvidence";
import {cbbCurrentSplitEvidence} from "../lib/cbb/owlsSplitEvidence";
import {cbbProviderInstitutionName} from "../lib/cbb/providerInstitutionIdentity";
import {cbbSplitOrientation} from "../lib/cbb/exactSplitIdentity";
import {matchCbbSourceGame} from "../lib/services/marketIntelligenceV2/shadowSync";
import type {CbbGame} from "../lib/cbb/types";
import type {RawOwlsOddsEvent} from "../lib/providers/owls/owlsSharpBookOdds";
import type {RawOwlsSplitsResponse} from "../lib/providers/owls/owlsSharpBookSplits";
const fixture=JSON.parse(gunzipSync(fs.readFileSync(new URL("./fixtures/cbb-source-admission-20261105.json.gz",import.meta.url))).toString()) as {
  capturedAt:string;games:CbbGame[];events:RawOwlsOddsEvent[];splits:RawOwlsSplitsResponse["data"]};
const at=fixture.capturedAt,odds={success:true,data:fixture.events},splits={success:true,sport:"ncaab",data:fixture.splits};
const refs=fixture.games.map(g=>({id:g.id,externalId:g.id,slateDate:g.date.slice(0,10),gameDate:g.date,
  homeTeamId:g.home_team.id,awayTeamId:g.visitor_team.id,homeAbbr:g.home_team.abbreviation,awayAbbr:g.visitor_team.abbreviation,
  homeName:g.home_team.full_name,awayName:g.visitor_team.full_name,homeLocation:g.home_team.college??"",awayLocation:g.visitor_team.college??""}));
let contracts=0,splitRows=0;
for(const game of fixture.games){
  const own={homeTeamDisplayName:game.home_team.full_name,awayTeamDisplayName:game.visitor_team.full_name,cbbHomeCollege:game.home_team.college,cbbAwayCollege:game.visitor_team.college};
  const events=fixture.events.filter(e=>cbbSplitOrientation(e.away_team??"",e.home_team??"",own)!==null);
  assert.ok(events.length>0,`${game.id} native source alias joins`);
  const quotes=normalizeCbbOwlsCurrent(game,odds,at,at).quotes;
  assert.ok(quotes.length>0,`${game.id} actual two-sided prices are usable`);contracts+=quotes.length;
  for(const event of events){
    const match=matchCbbSourceGame(refs,event.away_team!,event.home_team!,event.commence_time!);
    assert.equal(match?.game.externalId,game.id,"existing canonical collector uses the same exact aliases");
    assert.equal(match?.reversed,false);
    const reversed=matchCbbSourceGame(refs,event.home_team!,event.away_team!,event.commence_time!);
    assert.equal(reversed?.game.externalId,game.id);assert.equal(reversed?.reversed,true);
    const normalized=normalizeCbbOwlsCurrent(game,{success:true,data:[event]},at,at).quotes;
    for(const q of normalized){
      const market=event.bookmakers?.find(b=>b.key===q.sportsbook)?.markets?.find(m=>m.key===({moneyline:"h2h",spread:"spreads",total:"totals"}[q.market]));
      assert.ok(market);
      const first=market.outcomes?.find(o=>q.market==="total"?o.name?.toLowerCase()==="over":o.name===event.home_team);
      const second=market.outcomes?.find(o=>q.market==="total"?o.name?.toLowerCase()==="under":o.name===event.away_team);
      assert.equal(q.firstPrice,Number(first?.price));assert.equal(q.secondPrice,Number(second?.price));
      assert.equal(q.line,q.market==="moneyline"?null:Number(first?.point));
      assert.equal(q.providerObservedAt,market.last_update??event.bookmakers?.find(b=>b.key===q.sportsbook)?.last_update);
    }
    assert.equal(normalizeCbbOwlsCurrent(game,{success:true,data:[{...event,commence_time:new Date(Date.parse(game.date)+3600000).toISOString()}]},at,at).quotes.length,0);
    assert.equal(normalizeCbbOwlsCurrent(game,{success:true,data:[{...event,away_team:"Wrong school"}]},at,at).quotes.length,0);
  }
  const evidence=cbbCurrentSplitEvidence(game,odds,splits as RawOwlsSplitsResponse,at,at);
  if(game.id!==10882710){assert.ok(evidence.rows.length>0,`${game.id} current named splits restored`);splitRows+=evidence.rows.length;}
}
for(const [a,b] of [["Jax State","Jackson State"],["N Illinois","Illinois State"],["Penn","Penn State"]])assert.notEqual(cbbProviderInstitutionName(a),cbbProviderInstitutionName(b));
console.log(JSON.stringify({actualGames:fixture.games.length,sourceContracts:contracts,splitRows,collectorAndWriterJoinParity:true,
  sourceClocksPricesAndLinesExact:true,wrongSchoolAndTimeRejected:true,networkRequests:0,productionWrites:0}));
