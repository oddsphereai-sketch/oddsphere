import { verifyNbaOriginalRoster } from "./nbaOriginalPlayerImpact";
import type { NbaHistoricalGame, NbaHistoricalPlayerBox } from "../../services/nba/nbaPointInTimeFeatures";
export const NBA_ORIGINAL_TEAM_FEATURE_SOURCE_RELEASE = "nba_original_team_feature_source_2026_11_23_r1_native_box_counts" as const;
const fields = { fgm:"fieldGoalsMade",fga:"fieldGoalsAttempted",fg3m:"threePointersMade",fg3a:"threePointersAttempted",ftm:"freeThrowsMade",fta:"freeThrowsAttempted",oreb:"reboundsOffensive",dreb:"reboundsDefensive",ast:"assists",stl:"steals",blk:"blocks",turnover:"turnovers",pf:"foulsPersonal",points:"points" } as const;
/** Fixed team feature recipe from original box primitives, never a current
 * historical-provider revision. Native IDs need no cross-provider fuzzy join. */
export function verifyNbaOriginalTeamGame(args: Parameters<typeof verifyNbaOriginalRoster>[0] & { season:number }) {
  const roster = verifyNbaOriginalRoster(args), raw = JSON.parse(Buffer.from(args.bytes).toString()).game;
  const gameId = Number(args.gameId), boxes:NbaHistoricalPlayerBox[] = [];
  if (!Number.isInteger(args.season) || args.season < 2021 || args.season > 2026 || String(args.gameId).slice(3,5) !== String(args.season-2000)) throw Error("native_feature_season_mismatch");
  for (const [index,t] of [raw.homeTeam,raw.awayTeam].entries()) {
    if (!Number.isInteger(t.score) || t.score <= 0 || !Number.isInteger(raw.period) || raw.period<4) throw Error("invalid_native_feature_score");
    for (const [i,p] of t.players.entries()) {
      const counts = Object.fromEntries(Object.entries(fields).map(([key,field])=>{ const v=p.statistics[field]; if (!Number.isFinite(v)||v<0||!Number.isInteger(v)) throw Error("invalid_native_feature_count"); return [key,v]; })) as Pick<NbaHistoricalPlayerBox,keyof typeof fields>;
      const member=roster.teams[index]!.players.find(q=>q.playerId===p.personId)!;
      if (!Number.isFinite(p.statistics.plus)||!Number.isFinite(p.statistics.minus)) throw Error("invalid_native_feature_plusminus");
      boxes.push({rowId:gameId*100+index*30+i,gameId,teamId:t.teamId,playerId:p.personId,minutes:member.seconds/60,plusMinus:p.statistics.plus-p.statistics.minus,...counts});
    }
    const rows=boxes.filter(b=>b.teamId===t.teamId), seconds=rows.reduce((n,b)=>n+b.minutes*60,0);
    if (rows.reduce((n,b)=>n+b.points,0)!==t.score || Math.abs(seconds-(14400+(raw.period-4)*1500))>rows.length*.5) throw Error("incoherent_native_feature_rotation");
  }
  if(raw.homeTeam.score===raw.awayTeam.score) throw Error("tied_native_final");
  const game:NbaHistoricalGame={gameId,season:args.season,startTime:roster.startAt,homeTeamId:raw.homeTeam.teamId,awayTeamId:raw.awayTeam.teamId,homeTeam:raw.homeTeam.teamTricode,awayTeam:raw.awayTeam.teamTricode,homeScore:raw.homeTeam.score,awayScore:raw.awayTeam.score};
  return {release:NBA_ORIGINAL_TEAM_FEATURE_SOURCE_RELEASE,game,boxes,sourceAvailableAt:roster.sourceAvailableAt,receipt:{sha256:roster.sha256,fetchedAt:roster.fetchedAt,sourceAvailableAt:roster.sourceAvailableAt}};
}
