/** SELECT-only rehearsal. Never captures providers or writes snapshots. */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { supabase } from "../../lib/db/supabase";
import { parseOwlsPredictionMarkets, matchPredictionMarketGame, type PredictionMarketSport } from "../../lib/providers/owls/owlsPredictionMarkets";
import type { DailyEdgeGameDto } from "../../app/lab/lib/labTypes";

async function main() {
  const fixturePath=process.argv.find(a=>a.startsWith("--provider-fixture="))?.split("=").slice(1).join("=");
  if(!fixturePath)throw new Error("Pass --provider-fixture=<retained read-only provider probe JSON>");
  const fixtures=JSON.parse(readFileSync(fixturePath,"utf8")) as Array<{sport:string;league:string;body:Record<string,unknown>}>;
  const date=process.argv.find(a=>a.startsWith("--date="))?.slice(7) ?? new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const keys=["nba","nhl","mlb","wnba"].map(sport=>`${sport}::${date}::current-only::live-copy`);
  keys.push("soccer::english_premier_league::current-week","soccer::uefa_champions_league::current-week");
  const daily=await supabase.from("lab_response_snapshots").select("snapshot_key,payload").in("snapshot_key",keys);
  if(daily.error)throw new Error(daily.error.message);
  const rows=[...(daily.data??[])];
  for(const sport of ["nfl","cfb"]) {
    const result=await supabase.from("lab_response_snapshots").select("snapshot_key,payload").like("snapshot_key",`${sport}::daily-edge::2026::%`).order("generated_at",{ascending:false}).limit(1);
    if(result.error)throw new Error(result.error.message);
    rows.push(...(result.data??[]));
  }
  const output=[];
  for(const row of rows){
    let payload=row.payload;
    if(payload.encoding==="gzip-base64")payload=JSON.parse(gunzipSync(Buffer.from(payload.payload,"base64"),{maxOutputLength:8_000_000}).toString("utf8"));
    const snapshot=payload.fixture?.snapshot??payload.snapshot??payload;
    const games=(snapshot.games??[]) as DailyEdgeGameDto[];
    const sport=(row.snapshot_key.includes("uefa_champions")?"ucl":snapshot.sport) as PredictionMarketSport;
    const fixture=fixtures.find(f=>f.league===(sport==="ucl"?"kxuclgame":sport==="soccer"?"kxeplgame":sport==="cfb"?"kxncaafgame":`kx${sport}game`));
    if(!fixture){console.log(JSON.stringify({sport,games:games.length,fixture:false}));continue;}
    const now=Date.parse((fixture.body.meta as {timestamp:string}).timestamp);
    const feed=parseOwlsPredictionMarkets(fixture.body,sport,now);
    const results=games.map(game=>({game,market:matchPredictionMarketGame(feed,{sport,gameStartAt:game.gameStartAt??"",awayTeam:game.awayTeam,homeTeam:game.homeTeam,awayName:game.awayTeamDisplayName,homeName:game.homeTeamDisplayName},now)}));
    console.log(JSON.stringify({sport,games:games.length,withCanonicalStart:games.filter(g=>g.gameStartAt).length,matched:results.filter(x=>x.market).length,unmatched:results.filter(x=>!x.market).map(x=>({id:x.game.id,away:x.game.awayTeam,home:x.game.homeTeam,start:x.game.gameStartAt})).slice(0,30)}));
    output.push({sport,games,feed});
  }
  const outputPath=process.argv.find(a=>a.startsWith("--output="))?.split("=").slice(1).join("=");
  if(outputPath)writeFileSync(outputPath,JSON.stringify(output));
}
void main();
