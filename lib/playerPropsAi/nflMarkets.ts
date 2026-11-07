import type {NflPlayerPropsMarketObserverHistory} from "../services/football/nflPlayerPropsMarketObserverStore";
import type {NflPlayerPropsExactOffer} from "../services/football/nflPlayerPropsMarketBoard";
import {CATALOG,type GamePacket,type Quote} from "./evidenceContract";
import {digest,instant,invariant} from "./evidence";
const name=(s:string)=>s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/\b(jr|sr|ii|iii|iv)\b/g,"").replace(/[^a-z]/g,"");
const team=(s:string)=>({JAC:"JAX",WSH:"WAS",LA:"LAR"}[s]??s);
/** Bounded existing landmarks/reference cache supplement selected-side member quotes. */
export function attachNflReaderMarkets(packet:GamePacket,source:{availableAt:string;observer:NflPlayerPropsMarketObserverHistory|null;references:readonly NflPlayerPropsExactOffer[]}){
  invariant(packet.sport==="nfl","NFL source adapter requires NFL packet");
  if(instant(source.availableAt)>instant(packet.cutoff))return packet;
  const quotes=[...packet.quotes],added=new Set<string>();
  const player=(n:string,t?:string|null)=>{
    const matches=packet.players.filter(p=>name(p.name)===name(n)&&(!t||team(p.team)===team(t)));
    return matches.length===1?matches[0]:null;
  };
  const add=(id:string,market:string,provider:string,book:string,line:number,side:Quote["side"],american:number|null,observedAt:string,opening:boolean)=>{
    if(!(CATALOG.nfl.required as readonly string[]).includes(market)||american===null||!Number.isFinite(american)||Math.abs(american)<100||!Number.isFinite(line)||instant(observedAt)>instant(source.availableAt))return;
    const row={playerId:id,market,provider,book,line,side,american,observedAt,receivedAt:source.availableAt,receivedAtProvenance:"snapshot_availability" as const,opening,live:false};
    const key=`nfl-retained:${digest(row)}`;if(added.has(key)||quotes.some(q=>q.id===key))return;added.add(key);quotes.push({...row,id:key});
  };
  for(const row of source.observer?.rows??[]){
    if(row.gameId!==packet.gameId||instant(row.scheduledStart)!==instant(packet.start)||instant(row.capturedAt)>instant(source.availableAt))continue;
    const p=player(row.playerName);if(!p)continue;
    const opening=row.landmark==="provider_opening";
    for(const [side,price] of [["over",row.overPrice],["under",row.underPrice],["yes",row.yesPrice]] as const)add(p.id,row.market,row.provider,row.sportsbook,row.observedLine,side,price,row.observedAt,opening);
  }
  for(const row of source.references){
    if(row.canonicalGameId!==packet.gameId||instant(row.scheduledStart)!==instant(packet.start))continue;
    const p=player(row.playerName,row.playerTeam);if(!p)continue;
    for(const [side,current,opening] of [["over",row.overPrice,row.openingOverPrice],["under",row.underPrice,row.openingUnderPrice],["yes",row.yesPrice,row.openingYesPrice]] as const){
      add(p.id,row.market,row.provider,row.sportsbook,row.line,side,current,row.observedAt,false);
      if(row.openingObservedAt&&row.openingLine!==null)add(p.id,row.market,row.provider,row.sportsbook,row.openingLine,side,opening,row.openingObservedAt,true);
    }
  }
  return {...packet,quotes,players:packet.players.map(p=>({...p,markets:[...new Set([...p.markets,...quotes.filter(q=>q.playerId===p.id).map(q=>q.market)])].sort()})),
    sourceLimitations:[...packet.sourceLimitations,"Supplemented with existing NFL observer landmarks/reference cache, not a full tick history; actual local export time is conservative availability, not provider-response confirmation. Same books across sources remain correlated."]};
}
