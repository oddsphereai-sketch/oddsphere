/** Complete captured collector inputs. Pure: no provider, database or inference calls. */
import type {NbaPlayerPropsCurrentState} from "../services/nba/nbaPlayerPropsCurrentState";
import type {NbaPlayerPropsMemberSnapshot} from "../services/nba/nbaPlayerPropsProductContract";
import type {NbaPlayerPropsMarketHistory} from "../services/nba/nbaPlayerPropsPrivateStore";
import type {NflPlayerPropsProductionSnapshot} from "../services/football/nflPlayerPropsProductionContract";
import type {NflPlayerPropsCurrentSeasonState} from "../services/football/nflPlayerPropsCurrentSeasonState";
import type {NflPlayerPropsObservationSnapshot,NflPlayerPropPriceObservation} from "../services/football/nflPlayerPropsContract";
import type {NflPlayerPropsInferenceContext} from "../services/football/nflPlayerPropsInferenceContext";
import type {MlbPropsBoardSnapshot} from "../mlb/props/boardSnapshotStore";
import type {PropOddsSnapshot} from "../mlb/props/providers";
import {fromCachedExport,type CachedExport} from "./cachedAdapters";
import {enrichCachedPacket,mlbPackets,type EnrichedSource} from "./cachedEnrichment";
import {attachGameReaderContext,type ReaderGameContext} from "./gameContext";
import {attachNflReaderMarkets} from "./nflMarkets";
import {compileMarketReport} from "./marketReport";
import {CATALOG,PRODUCT_RELEASE,type GamePacket,type Json,type Quote,type Player} from "./evidenceContract";
import type {CapturedReviewWindow} from "./liveWindow";
import {propsTeam} from "./teamIdentity";
import {digest,instant,invariant} from "./evidence";

export type LivePropsGame={id:string;start:string;away:string;home:string};
const json=(v:unknown):Json=>JSON.parse(JSON.stringify(v));
const name=(s:string)=>s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/\b(jr|sr|ii|iii|iv)\b/g,"").replace(/[^a-z]/g,"");
export {propsTeam} from "./teamIdentity";
export function emptyCapturedSource(at:string):CachedExport{
  const state={games:[],boxes:[],advanced:[],players:[],updatedAt:at} as unknown as NbaPlayerPropsCurrentState;
  return {readOnly:true,generatedAt:at,priorNba:state,currentNba:state,nba:[],nfl:[]};
}
function finish(packet:GamePacket,at:string){
  invariant(instant(packet.cutoff)===instant(at),"Live packet cutoff mismatch");
  const clean={...packet,quotes:[...new Map(packet.quotes.map(q=>[q.id,q])).values()],players:packet.players.map(p=>({...p,missing:p.missing.filter(s=>s!=="qualified joint outcome law not attached")})),sourceLimitations:[
    "Captured pre-lock collector input; no later source or recalled news may be introduced.",
    "Opening/current quotes and retained chronology are bounded evidence, not every market tick. Odds movement does not prove money or bettor identity.",
  ]};
  return compileMarketReport(clean);
}
export function liveNbaPacket(args:{game:LivePropsGame;window:CapturedReviewWindow;snapshot:NbaPlayerPropsMemberSnapshot;market:NbaPlayerPropsMarketHistory;prior:NbaPlayerPropsCurrentState;current:NbaPlayerPropsCurrentState;context?:EnrichedSource["nbaContext"]}):GamePacket{
  const at=args.window.cutoff;
  const source:EnrichedSource={readOnly:true,generatedAt:at,priorNba:args.prior,currentNba:args.current,nba:[{date:args.snapshot.slateDate,snapshot:{...args.snapshot,generatedAt:at},market:args.market}],nfl:[],nbaContext:args.context};
  const packet=fromCachedExport(source,args.window).packets[0];invariant(packet,"NBA live game missing from captured source");
  invariant(!args.market.observations.some(q=>q.canonicalGameId===args.game.id&&(CATALOG.nba.required as readonly string[]).includes(q.market)&&q.provider!=="owls"&&!q.canonicalPlayerId),"NBA retail offered-player identity incomplete");
  for(const p of packet.players){p.team=propsTeam(p.team);p.opponent=propsTeam(p.opponent);invariant([propsTeam(args.game.home),propsTeam(args.game.away)].includes(p.team)&&[propsTeam(args.game.home),propsTeam(args.game.away)].includes(p.opponent)&&p.team!==p.opponent,"NBA player/team matchup identity incomplete");}
  return finish(enrichCachedPacket(packet,source),at);
}
function nflNativePlayer(row:NflPlayerPropPriceObservation,snapshot:NflPlayerPropsProductionSnapshot,context:NflPlayerPropsInferenceContext,game:LivePropsGame){
  const exact=snapshot.memberDecisions.filter(p=>p.gameId===game.id&&name(p.playerName)===name(row.playerName??"")&&(!row.playerTeam||propsTeam(p.team)===propsTeam(row.playerTeam)));
  const ids=new Set(exact.flatMap(p=>p.providerPlayerId?[p.providerPlayerId]:[]));
  if(row.providerPlayerId)ids.add(row.providerPlayerId);
  invariant(ids.size<=1,"Conflicting NFL provider player identity");
  const id=[...ids][0],g=context.games.find(g=>g.canonicalGameId===game.id);
  const roster=g?[...g.awayDepth.roster.map(p=>({...p,team:g.awayTeam})),...g.homeDepth.roster.map(p=>({...p,team:g.homeTeam}))].filter(p=>id?p.playerId===id:name(p.name)===name(row.playerName??"")):[];
  const teams=new Set([row.playerTeam,...exact.map(p=>p.team),...roster.map(p=>p.team)].filter((s):s is string=>Boolean(s)).map(propsTeam));
  invariant(teams.size<=1,"Conflicting NFL player-team identity");
  const team=[...teams][0];
  if(!id||!team||![propsTeam(game.home),propsTeam(game.away)].includes(team)||!row.playerName)return null;
  return {id:`nfl-bdl-player:${id}`,providerId:id,name:row.playerName,team,opponent:team===propsTeam(game.home)?propsTeam(game.away):propsTeam(game.home)};
}
export function liveNflPacket(args:{game:LivePropsGame;window:CapturedReviewWindow;snapshot:NflPlayerPropsProductionSnapshot;observations:NflPlayerPropsObservationSnapshot;history:NflPlayerPropsCurrentSeasonState;context:NflPlayerPropsInferenceContext;retainedQuotes?:Quote[];marketHistory?:Parameters<typeof attachNflReaderMarkets>[1]}):GamePacket{
  const at=args.window.cutoff,source:EnrichedSource={...emptyCapturedSource(at),nfl:[{week:args.snapshot.week,snapshot:{...args.snapshot,generatedAt:at}}],nflHistory:args.history};
  const cached=fromCachedExport(source,args.window).packets[0];
  const packet:GamePacket=cached??{release:PRODUCT_RELEASE,sport:"nfl",gameId:args.game.id,start:args.game.start,lock:args.window.lock,cutoff:at,stage:args.window.stage,players:[],quotes:[],sourceLimitations:[]};
  const players=new Map<string,Player>(),quotes:Quote[]=[];let unresolved=0;
  const native=args.observations.observations.filter(q=>q.canonicalGameId===args.game.id&&(CATALOG.nfl.required as readonly string[]).includes(q.market));
  for(const q of native){
    const identity=nflNativePlayer(q,args.snapshot,args.context,args.game);
    if(!identity){unresolved++;continue;}
    let player=players.get(identity.id);
    if(!player){
      const matches=packet.players.filter(p=>name(p.name)===name(identity.name)&&propsTeam(p.team)===identity.team);invariant(matches.length<=1,"Ambiguous NFL captured player");
      const old=matches[0];
      player={id:identity.id,name:identity.name,team:identity.team,opponent:identity.opponent,markets:[],evidence:old?.evidence??[],missing:(old?.missing??[]).filter(s=>!s.includes("provider-ID reconciliation unverified"))};players.set(identity.id,player);
    }
    if(!player.markets.includes(q.market))player.markets.push(q.market);
    const received=q.receivedAt;
    if(!received||q.isLive||instant(received)>instant(at)||instant(q.observedAt)>instant(received))continue;
    const value={playerId:identity.id,market:q.market,provider:q.provider,book:q.sportsbook,line:q.line,side:q.side,american:q.americanPrice,observedAt:q.observedAt,receivedAt:received,receivedAtProvenance:"provider_response" as const,opening:q.isOpening,live:false};
    quotes.push({...value,id:digest(value)});
  }
  // Never silently omit a book-offered player with an unresolved identity.
  invariant(unresolved===0,`NFL offered-player identity coverage incomplete:${unresolved}`);
  invariant(players.size>0,"NFL complete source has no offered supported players");
  const current={...packet,players:[...players.values()].map(p=>({...p,markets:p.markets.sort()})),quotes:[...quotes,...(args.retainedQuotes??[])]};
  const enriched=enrichCachedPacket(current,source);
  const contexts:ReaderGameContext[]=args.context.games.map(g=>({id:`live:${g.canonicalGameId}`,gameId:g.canonicalGameId,start:g.scheduledStart,awayTeam:g.awayTeam,homeTeam:g.homeTeam,availableAt:args.context.capturedAt,source:"existing exact-game NFL collector",injuries:json(g.injuries),depth:json({away:g.awayDepth,home:g.homeDepth}),weather:json(g.weather??null)}));
  const contextual=attachGameReaderContext(enriched,contexts);
  return finish(args.marketHistory?attachNflReaderMarkets(contextual,args.marketHistory):contextual,at);
}
export function liveMlbPacket(args:{game:LivePropsGame;window:CapturedReviewWindow;snapshot:MlbPropsBoardSnapshot;currentOdds:readonly PropOddsSnapshot[];openingOdds:readonly PropOddsSnapshot[]}):GamePacket{
  const at=args.window.cutoff,source=emptyCapturedSource(at);
  const packet=mlbPackets(source,args.window,[{...args.snapshot,asOfTimestamp:at}])[0];invariant(packet,"MLB live game missing from captured source");
  const quotes:Quote[]=[];
  const nativeRows=args.snapshot.data.props.filter(r=>r.providerIds?.gameId===args.game.id);
  const nativeGames=new Set(nativeRows.flatMap(r=>r.providerIds?.bdlGameId?[String(r.providerIds.bdlGameId)]:[]));
  for(const [opening,rows] of [[false,args.currentOdds],[true,args.openingOdds]] as const)for(const q of rows){
    if(!(CATALOG.mlb.required as readonly string[]).includes(q.marketKey)||!nativeGames.has(q.gameId.replace(/^balldontlie-game-/,"")))continue;
    const matching=nativeRows.filter(r=>String(r.providerIds?.bdlGameId)===q.gameId.replace(/^balldontlie-game-/,"")&&r.providerIds?.bdlPlayerId!==null&&String(r.providerIds?.bdlPlayerId)===q.playerId.replace(/^balldontlie-player-/,"")&&r.market===q.marketKey);
    const ids=new Set(matching.map(r=>r.providerIds?.mlbStatsPlayerId??`bdl:${r.providerIds?.bdlPlayerId}`));
    invariant(ids.size>0,"Offered MLB player identity missing from complete captured rows");invariant(ids.size===1,"Ambiguous MLB provider player identity");
    const received=q.providerResponseAt;if(!received||instant(received)>instant(at)||instant(q.asOfTimestamp)>instant(received))continue;
    const value={playerId:[...ids][0],market:q.marketKey,provider:q.provider,book:q.sportsbook.toLowerCase().replace(/[^a-z0-9]/g,""),line:q.line,offerContract:matching[0].offerContract??"two_way",side:matching[0].offerContract==="milestone"?"yes" as const:q.side as Quote["side"],american:q.americanOdds,observedAt:q.asOfTimestamp,receivedAt:received,receivedAtProvenance:"provider_response" as const,opening,live:false};
    quotes.push({...value,id:digest(value)});
  }
  return finish({...packet,quotes:[...packet.quotes,...quotes]},at);
}
