import type {NflPlayerPropsRuntimeDecision} from '../services/football/nflPlayerPropsRuntime';
import type {NflPlayerPropPriceObservation} from '../services/football/nflPlayerPropsContract';
import type {NflPlayerPropsInferenceContext} from '../services/football/nflPlayerPropsInferenceContext';
import type {LivePropsGame} from './liveSources';
import {propsTeam} from './teamIdentity';
import {instant,invariant} from './evidence';
export const PROPS_AI_NFL_SOURCE_RELEASE='player_props_ai_nfl_source_2026_11_08_r2_model_context_status' as const;
const norm=(s:string)=>s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\b(jr|sr|ii|iii|iv)\b/g,'').replace(/[^a-z]/g,'');
// Name equivalence is explicit and must bind the independently captured native ID.
const aliases=[
 {id:'666',names:['Marquise Brown','Hollywood Brown']},
 {id:'12',names:['Kenneth Gainwell','Kenny Gainwell']},
 {id:'33934397',names:['KC Concepcion','Kevin Concepcion']},
 {id:'734',names:['Chig Okonkwo','Chigoziem Okonkwo']},
] as const;
export function sameNflPropActorName(a:string,b:string,id?:string|null):boolean{
 if(norm(a)===norm(b))return true;
 return aliases.some(group=>group.id===id&&group.names.some(n=>norm(n)===norm(a))&&group.names.some(n=>norm(n)===norm(b)));
}
export function resolveNflPropSourcePlayer(args:{row:NflPlayerPropPriceObservation;rows:readonly NflPlayerPropsRuntimeDecision[];observations:readonly NflPlayerPropPriceObservation[];context:NflPlayerPropsInferenceContext;game:LivePropsGame}){
 const {row,game}=args;
 if(row.canonicalGameId!==game.id||row.scheduledStart&&instant(row.scheduledStart)!==instant(game.start))return null;
 const g=args.context.games.find(g=>g.canonicalGameId===game.id);
 if(!g)return null;
 invariant(instant(g.scheduledStart)===instant(game.start)&&propsTeam(g.homeTeam)===propsTeam(game.home)&&propsTeam(g.awayTeam)===propsTeam(game.away),'NFL roster game identity mismatch');
 const compatible=(n:string|null,id:string|null,t:string|null)=>Boolean(n&&sameNflPropActorName(n,row.playerName??'',id)&&(!row.playerTeam||!t||propsTeam(t)===propsTeam(row.playerTeam)));
 // Identity is independent of whether the old numerical model could grade a row.
 const native=args.observations.filter(q=>q.provider==='balldontlie'&&!q.isOpening&&!q.isLive&&q.canonicalGameId===game.id&&q.scheduledStart&&instant(q.scheduledStart)===instant(game.start)&&q.providerPlayerId&&compatible(q.playerName,q.providerPlayerId,q.playerTeam));
 const stored=args.rows.filter(p=>p.gameId===game.id&&instant(p.scheduledStart)===instant(game.start)&&p.providerPlayerId&&compatible(p.playerName,p.providerPlayerId,p.team));
 const roster=[...g.awayDepth.roster.map(p=>({...p,team:g.awayTeam})),...g.homeDepth.roster.map(p=>({...p,team:g.homeTeam}))];
 const byName=roster.filter(p=>compatible(p.name,p.playerId,p.team));
 const ids=new Set([row.providerPlayerId,...native.map(p=>p.providerPlayerId),...stored.map(p=>p.providerPlayerId),...byName.map(p=>p.playerId)].filter((id):id is string=>Boolean(id)));
 invariant(ids.size<=1,'Conflicting NFL provider player identity');const id=[...ids][0];if(!id)return null;
 const byId=roster.filter(p=>p.playerId===id);
 const teams=new Set([row.playerTeam,...native.map(p=>p.playerTeam),...stored.map(p=>p.team),...byId.map(p=>p.team)].filter((s):s is string=>Boolean(s)).map(propsTeam));
 invariant(teams.size<=1,'Conflicting NFL player-team identity');const team=[...teams][0];
 const playerName=byId[0]?.name??native[0]?.playerName??stored[0]?.playerName??row.playerName;
 if(!team||![propsTeam(game.home),propsTeam(game.away)].includes(team)||!playerName)return null;
 return {id:`nfl-bdl-player:${id}`,providerId:id,name:playerName,team,opponent:team===propsTeam(game.home)?propsTeam(game.away):propsTeam(game.home)};
}
