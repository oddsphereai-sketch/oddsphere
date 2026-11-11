import {NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE,type NbaPlayerPropsCurrentState} from '../../lib/services/nba/nbaPlayerPropsCurrentState';

/** Explicit played boxes for source/transport controls; no missing history is
 * silently supplied by a model prior. Tests choose the actual numeric anchors. */
export function nbaPlayedStateFixture(updatedAt:string,playerIds:readonly number[],points:readonly number[],rebounds:readonly number[]):NbaPlayerPropsCurrentState{
 if(points.length!==rebounds.length)throw Error('Synthetic played fixture arrays differ');
 return{release:NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE,publicEnabled:false,season:2026,createdAt:updatedAt,updatedAt,
  games:points.map((_,i)=>({gameId:i+1,season:2026,startTime:`2026-11-0${i+1}T20:00:00Z`,homeTeamId:1,awayTeamId:2,homeTeam:'BOS',awayTeam:'NYK',homeScore:100,awayScore:99})),
  boxes:points.flatMap((value,i)=>[...playerIds,999999].map((playerId,j)=>({rowId:(i+1)*100+j,gameId:i+1,teamId:playerId===999999?2:1,playerId,minutes:30,fgm:Math.floor(value/2),fga:Math.max(20,Math.floor(value/2)),fg3m:0,fg3a:0,ftm:value%2,fta:value%2,oreb:0,dreb:rebounds[i],ast:3,stl:0,blk:0,turnover:1,pf:0,points:value,plusMinus:0}))),advanced:[],players:[]};
}
