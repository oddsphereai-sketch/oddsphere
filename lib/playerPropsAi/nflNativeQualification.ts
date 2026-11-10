/** Prospective operational qualification from the writer's actual original
 * native baseline. This is separate from the accepted conditional law and from
 * current medical participation. A member row cannot attest its own baseline. */
import type {NflPlayerPropsRuntimeDecision as Row} from '../services/football/nflPlayerPropsRuntime';
import type {GamePacket} from './evidenceContract';
import {digest,instant,invariant} from './evidence';
import {propsTeam} from './teamIdentity';
import {sameNflPropActorName} from './nflPlayerIdentity';
import {NFL_NATIVE_QUALIFICATION_RELEASE,NFL_NATIVE_TEMPLATE_UNAVAILABLE,type NflNativeQualification} from './publicationContract';
export type {NflNativeQualification} from './publicationContract';

export function nflNativePublicationContext(packet:GamePacket,playerId:string,nativeRows:readonly Row[]){
 invariant(packet.sport==='nfl'&&Array.isArray(nativeRows),'Actual original NFL native baseline required');
 const player=packet.players.find(p=>p.id===playerId);invariant(player,'Unknown NFL qualification actor');
 const gameId=packet.sourceGameId??packet.gameId;
 const own=nativeRows.filter(row=>row.gameId===gameId&&instant(row.scheduledStart)===instant(packet.start)&&instant(row.lockAt)===instant(packet.lock)
  &&propsTeam(row.team)===propsTeam(player.team)&&propsTeam(row.opponent)===propsTeam(player.opponent)
  &&(row.providerPlayerId!=null?player.id===`nfl-bdl-player:${row.providerPlayerId}`:sameNflPropActorName(row.playerName,player.name,player.id.replace(/^nfl-bdl-player:/,''))));
 const cutoff=instant(packet.cutoff),available=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=cutoff;
 const template=own.find(row=>row.state!=='locked'&&!row.aiReview&&!String(row.modelRelease).startsWith('player_props_ai_')
  &&available(row.observedAt)&&row.forecastContext&&available(row.forecastContext.featureAsOf));
 const qualification:NflNativeQualification|null=template?null:{release:NFL_NATIVE_QUALIFICATION_RELEASE,reason:'native_player_context_unavailable',detail:NFL_NATIVE_TEMPLATE_UNAVAILABLE,
  gameId,playerId,scheduledStart:packet.start,lockAt:packet.lock,sourcePacketHash:digest(packet),nativeBaselineHash:digest(JSON.parse(JSON.stringify(own)))};
 return{template,qualification};
}
