/** Reuse the existing pure NBA stat-feature builder; no forecasts or provider calls. */
import {buildNbaPointInTimeFeatures,NBA_POINT_IN_TIME_FEATURE_RELEASE} from "../services/nba/nbaPointInTimeFeatures";
import type {NbaPlayerPropsCurrentState} from "../services/nba/nbaPlayerPropsCurrentState";
import type {GamePacket,Evidence,Json} from "./evidenceContract";
import {instant,digest} from "./evidence";

export function nbaReaderBenchmark(packet:GamePacket,states:readonly NbaPlayerPropsCurrentState[]):Evidence|null{
  if(packet.sport!=="nba")return null;
  const eligible=states.filter(s=>typeof s.updatedAt==="string"&&Array.isArray(s.games)&&Array.isArray(s.boxes)&&Array.isArray(s.advanced)&&instant(s.updatedAt)<=instant(packet.cutoff));
  const games=[...new Map(eligible.flatMap(s=>s.games).map(g=>[g.gameId,g])).values()];
  const target=games.find(g=>Math.abs(instant(g.startTime)-instant(packet.start))<60000&&packet.players.every(p=>[g.homeTeam,g.awayTeam].includes(p.team)));
  // Upcoming games can be absent from the finalized-games cache. Teams and
  // season must still come from actual source identities, never guessed IDs.
  const names=new Map(games.flatMap(g=>[[g.homeTeam,g.homeTeamId],[g.awayTeam,g.awayTeamId]] as [string,number][]));
  const teams=[...new Set(packet.players.flatMap(p=>[p.team,p.opponent]))];
  if(teams.length!==2||teams.some(t=>!names.has(t)))return null;
  const season=target?.season??Math.max(...eligible.map(s=>s.season));
  const before=games.filter(g=>instant(g.startTime)+5*3600000<=instant(packet.cutoff));
  const ids=new Set(before.map(g=>g.gameId));
  const boxes=[...new Map(eligible.flatMap(s=>s.boxes).filter(b=>ids.has(b.gameId)).map(b=>[`${b.gameId}:${b.playerId}`,b])).values()];
  const advanced=[...new Map(eligible.flatMap(s=>s.advanced).filter(a=>ids.has(a.gameId)).map(a=>[a.rowId,a])).values()];
  const queryId=-1;
  const row=buildNbaPointInTimeFeatures({games:before,boxes,advanced,upcomingGames:[{gameId:queryId,season,startTime:packet.cutoff,
    homeTeam:teams[0],homeTeamId:names.get(teams[0])!,awayTeam:teams[1],awayTeamId:names.get(teams[1])!}],emitGameIds:new Set([queryId])})[0];
  if(!row)return null;
  const samples=Number(row.league_current_season_team_games??0),priorSamples=Number(row.league_prior_season_team_games??0);
  if(samples===0&&priorSamples===0)return null;
  const reference=Object.fromEntries(Object.entries(row).filter(([key])=>key.startsWith("league_current_")||key.startsWith("league_prior_")));
  const availableAt=new Date(Math.max(...eligible.map(s=>instant(s.updatedAt)))).toISOString();
  return {id:`nba-reader-league-reference:${digest({cutoff:packet.cutoff,availableAt,reference})}`,kind:"matchup",availableAt,
    source:`${NBA_POINT_IN_TIME_FEATURE_RELEASE}; existing finalized-stat feature path; league comparison, no model forecast`,
    value:{readerBenchmarks:true,asOf:packet.cutoff,reference:reference as Json,
      meaning:"Observed current/prior season reference from the existing stat builder; at most the latest three hundred team-games per season, with sample counts. Offensive rating is points per one hundred possessions and is a contextual comparison for opponent defensive rating, not an exact matched-window adjustment. Pace uses the SAME possession convention as game_pace_mean_5. Do not invent league ranks. No default/smoothed fallback is used as observed data."}};
}
