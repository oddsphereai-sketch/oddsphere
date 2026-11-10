import {qualifyNflSourceEvent,sourceEventSummary,qualifyConflictingSourceObservations} from "./sourceEvents";
import {resolveNflPropSourcePlayer,sameNflPropActorName,PROPS_AI_NFL_SOURCE_RELEASE,PROPS_AI_NFL_IDENTITY_RELEASE} from "./nflPlayerIdentity";
/** Complete captured collector inputs. Pure: no provider, database or inference calls. */
import type {NbaPlayerPropsCurrentState} from "../services/nba/nbaPlayerPropsCurrentState";
import type {NbaPlayerPropsMemberSnapshot} from "../services/nba/nbaPlayerPropsProductContract";
import type {NbaPlayerPropsMarketHistory} from "../services/nba/nbaPlayerPropsPrivateStore";
import type {NflPlayerPropsProductionSnapshot} from "../services/football/nflPlayerPropsProductionContract";
import type {NflPlayerPropsCurrentSeasonState} from "../services/football/nflPlayerPropsCurrentSeasonState";
import {NFL_PLAYER_PROPS_EMPTY_CURRENT_RELEASE,type NflPlayerPropsEmptyCurrentCapture,type NflPlayerPropsObservationSnapshot} from "../services/football/nflPlayerPropsContract";
import type {NflPlayerPropsInferenceContext} from "../services/football/nflPlayerPropsInferenceContext";
import type {MlbPropsBoardSnapshot} from "../mlb/props/boardSnapshotStore";
import type {PropOddsSnapshot} from "../mlb/props/providers";
import {fromCachedExport,type CachedExport} from "./cachedAdapters";
import {enrichCachedPacket,mlbPackets,type EnrichedSource} from "./cachedEnrichment";
import {attachGameReaderContext,type ReaderGameContext} from "./gameContext";
import {attachNflReaderMarkets} from "./nflMarkets";
import {latestExecutionQuotes,quoteBook} from "./executionQuotes";
import {compileMarketReport} from "./marketReport";
import {CATALOG,PRODUCT_RELEASE,type GamePacket,type Json,type Quote,type Player} from "./evidenceContract";
import type {CapturedReviewWindow} from "./liveWindow";
import {propsTeam} from "./teamIdentity";
import {digest,instant,invariant} from "./evidence";
import {attachCapturedNbaParticipationReports,type CapturedNbaParticipationReport} from './participationEligibility';
import {resolveNbaCurrentActors,resolveNbaWithdrawalActors,sameNbaSourceActorName,PROPS_AI_NBA_CURRENT_SOURCE_RELEASE} from './nbaSourceIdentity';

export type LivePropsGame={id:string;start:string;away:string;home:string};
const json=(v:unknown):Json=>JSON.parse(JSON.stringify(v));
export {propsTeam} from "./teamIdentity";
export function emptyCapturedSource(at:string):CachedExport{
  const state={games:[],boxes:[],advanced:[],players:[],updatedAt:at} as unknown as NbaPlayerPropsCurrentState;
  return {readOnly:true,generatedAt:at,priorNba:state,currentNba:state,nba:[],nfl:[]};
}
function finish(packet:GamePacket,at:string,currentOffers:Quote[]){
  invariant(instant(packet.cutoff)===instant(at),"Live packet cutoff mismatch");
  const clean={...packet,quotes:[...new Map(packet.quotes.map(q=>[q.id,q])).values()],players:packet.players.map(p=>({...p,missing:p.missing.filter(s=>s!=="qualified joint outcome law not attached")})),sourceLimitations:[
    ...(packet.sourceInputRelease===PROPS_AI_NFL_SOURCE_RELEASE?packet.sourceLimitations:[]),
    "Captured pre-lock collector input; no later source or recalled news may be introduced.",
    "Opening/current quotes and retained chronology are bounded evidence, not every market tick. Odds movement does not prove money or bettor identity.",
  ]};
  return {...compileMarketReport(clean),executionQuotes:latestExecutionQuotes(currentOffers,at).map(q=>({...q,id:`execution:${digest(q)}`}))};
}
export function liveNbaPacket(args:{game:LivePropsGame;window:CapturedReviewWindow;snapshot:NbaPlayerPropsMemberSnapshot;market:NbaPlayerPropsMarketHistory;prior:NbaPlayerPropsCurrentState;current:NbaPlayerPropsCurrentState;context?:EnrichedSource["nbaContext"];participationReports?:readonly CapturedNbaParticipationReport[];currentObservations:NbaPlayerPropsMarketHistory["observations"]}):GamePacket{
  const at=args.window.cutoff;
  // The existing collector's explicit set owns current offer coverage. Retained
  // historical/opening orphans cannot turn into an offered actor on a later
  // refresh, and a failed/missing collector set cannot mean an empty market.
  invariant(Array.isArray(args.currentObservations),'NBA current collector observations unavailable');
  const retailIdentityMissing=(q:NbaPlayerPropsMarketHistory['observations'][number])=>q.canonicalGameId===args.game.id&&(CATALOG.nba.required as readonly string[]).includes(q.market)&&q.provider!=='owls'&&!q.canonicalPlayerId;
  const currentAtCutoff=args.currentObservations.filter(q=>{
    if(q.canonicalGameId!==args.game.id||!(CATALOG.nba.required as readonly string[]).includes(q.market))return false;
    const available=q.receivedAt??args.market.updatedAt;
    return q.isOpening===false&&!q.isLive&&['over','under','yes'].includes(q.side)&&Math.abs(q.americanPrice)>=100
      &&instant(q.observedAt)<=instant(available)&&instant(q.fetchedAt)<=instant(available)&&instant(available)<=instant(at);
  });
  invariant(!currentAtCutoff.some(retailIdentityMissing),'NBA retail offered-player identity incomplete');
  const nativeAvailable=instant(args.snapshot.generatedAt)<=instant(at),empty=currentAtCutoff.length===0;
  // A later native snapshot cannot donate priors, names or market scopes to an
  // earlier cutoff. The current fixture and independently available offers may
  // still establish complete quote-only actors without a manufactured head.
  const snapshot=nativeAvailable?args.snapshot:{...args.snapshot,games:[{gameId:args.game.id,scheduledStart:args.game.start,awayTeam:args.game.away,homeTeam:args.game.home}],decisions:[]};
  const nativeGame=snapshot.games.find(game=>game.gameId===args.game.id);
  invariant(nativeGame&&instant(nativeGame.scheduledStart)===instant(args.game.start)&&propsTeam(nativeGame.homeTeam)===propsTeam(args.game.home)&&propsTeam(nativeGame.awayTeam)===propsTeam(args.game.away),'NBA native fixture identity incomplete');
  const native=snapshot.decisions.filter(row=>row.gameId===args.game.id&&instant(row.evaluatedAt)<=instant(at));
  const availableState=(state:NbaPlayerPropsCurrentState)=>instant(state.updatedAt)<=instant(at)?state:{...state,games:[],boxes:[],advanced:[],players:[]};
  const prior=availableState(args.prior),currentState=availableState(args.current);
  const teamNames=new Map([...prior.games,...currentState.games].flatMap(game=>[[String(game.homeTeamId),game.homeTeam],[String(game.awayTeamId),game.awayTeam]] as [string,string][]));
  const historical=args.market.observations.filter(q=>q.canonicalGameId===args.game.id&&(CATALOG.nba.required as readonly string[]).includes(q.market)&&!q.isLive&&q.canonicalPlayerId&&instant(q.receivedAt??args.market.updatedAt)<=instant(at)&&instant(q.observedAt)<=instant(q.receivedAt??args.market.updatedAt)&&instant(q.fetchedAt)<=instant(q.receivedAt??args.market.updatedAt));
  const identity={native,offers:empty?historical:currentAtCutoff,teamNames,home:args.game.home,away:args.game.away,start:args.game.start,snapshotAt:args.snapshot.generatedAt,archiveAt:args.market.updatedAt,cutoff:at};
  const actors=empty?resolveNbaWithdrawalActors(identity):resolveNbaCurrentActors(identity);
  invariant(actors.length>0,empty?'NBA empty current collection has no verified withdrawal identity':'NBA current collector has no verified supported actors');
  const authority={nbaActors:new Map([[args.game.id,actors]])};
  // A retained merge may intentionally keep a conflicting old economic state.
  // The actual current collector rows must still reach the source reader; the
  // adapter deduplicates identical quotes without rewriting the original archive.
  const market={...args.market,observations:[...args.market.observations,...currentAtCutoff]};
  const source:EnrichedSource={readOnly:true,generatedAt:at,priorNba:prior,currentNba:currentState,nba:[{date:args.snapshot.slateDate,snapshot,market}],nfl:[],nbaContext:args.context};
  const packet=fromCachedExport(source,args.window,authority).packets[0];invariant(packet,"NBA live game missing from captured source");
  for(const p of packet.players){p.team=propsTeam(p.team);p.opponent=propsTeam(p.opponent);invariant([propsTeam(args.game.home),propsTeam(args.game.away)].includes(p.team)&&[propsTeam(args.game.home),propsTeam(args.game.away)].includes(p.opponent)&&p.team!==p.opponent,"NBA player/team matchup identity incomplete");}
  invariant(instant(packet.start)===instant(args.game.start),'NBA native fixture clock mismatch');
  // Original same-actor history remains source context even when its identity
  // label/team changed or its market was withdrawn. It cannot own current scope.
  packet.players=packet.players.map(player=>{
    const old=historical.filter(q=>q.canonicalPlayerId===player.id&&(!player.markets.includes(q.market)||q.playerName&&!sameNbaSourceActorName(q.playerName,player.name)||q.playerTeam&&propsTeam(teamNames.get(q.playerTeam)??q.playerTeam)!==player.team));
    return old.length?{...player,evidence:[...player.evidence,{id:`${player.id}:retained-noncurrent-identity-context`,kind:'market' as const,availableAt:new Date(Math.max(...old.map(q=>instant(q.receivedAt??args.market.updatedAt)))).toISOString(),source:'Original retained NBA observations; historical identity/scope context, not current offer authority',value:json({observations:old,meaning:'These original historical labels, teams, scopes, prices and clocks are unchanged. Current collector identities/scopes own the offered actor; old identity disagreements and withdrawn markets are not current facts or extra independent evidence.'})}]}:player;
  });
  const current=fromCachedExport({...source,nba:[{...source.nba[0],market:{...args.market,observations:currentAtCutoff}}]},args.window,authority).packets[0]?.quotes??[];
  const priced={...finish(attachCapturedNbaParticipationReports(enrichCachedPacket(packet,source),args.participationReports??[]),at,current),sourceInputRelease:PROPS_AI_NBA_CURRENT_SOURCE_RELEASE,sourceOfferSetStatus:empty?'empty' as const:'nonempty' as const};
  const orphanHistory=args.market.observations.filter(retailIdentityMissing).length;
  const unresolvedReferenceRows=currentAtCutoff.filter(q=>q.provider==='owls'&&!q.canonicalPlayerId).length;
  const identityLimitations=[
    ...([args.prior,args.current].some(state=>instant(state.updatedAt)>instant(at))?['NBA stat-cache data available after cutoff was withheld, including game/team identity metadata and player histories; later source availability cannot be backdated.']:[]),
    ...(empty?['The successful current NBA collector set has no admissible supported current offers. Retained verified identities describe withdrawal only; they are not offered actors or a completed evaluation and cannot enter scheduled paid review.']:[]),
    ...(historical.some(q=>!actors.some(actor=>actor.id===q.canonicalPlayerId))?['Retained NBA observations for actors absent from the explicit current collector set remain in the original source archive; they cannot add an offered actor or supply current identity.']:[]),
    ...(orphanHistory?[`Retained NBA market history contains ${orphanHistory} retail records without verified actor IDs; they cannot establish identity or current offer coverage. Current collector observations independently qualify current retail actors.`]:[]),
    ...(unresolvedReferenceRows?[`${unresolvedReferenceRows} current reference-source rows have unresolved actor identity. They cannot establish a known-player price, an alias or an additional player; reference coverage is partial.`]:[]),
  ];
  const result=identityLimitations.length?{...priced,sourceLimitations:[...priced.sourceLimitations,...identityLimitations]}:priced;
  return nativeAvailable?result:{...result,sourceLimitations:[...result.sourceLimitations,`Original NBA native snapshot availability ${args.snapshot.generatedAt} is after cutoff; its priors, labels and scopes were not supplied. Current quote-only actor coverage remains independent.`]};
}
export function liveNflPacket(args:{game:LivePropsGame;window:CapturedReviewWindow;snapshot:NflPlayerPropsProductionSnapshot;observations:NflPlayerPropsObservationSnapshot;history:NflPlayerPropsCurrentSeasonState;context:NflPlayerPropsInferenceContext;emptyCurrentGame?:NflPlayerPropsEmptyCurrentCapture;withdrawalSnapshot?:NflPlayerPropsProductionSnapshot;retainedQuotes?:Quote[];marketHistory?:Parameters<typeof attachNflReaderMarkets>[1]}):GamePacket{
  const at=args.window.cutoff,source:EnrichedSource={...emptyCapturedSource(at),nfl:[{week:args.snapshot.week,snapshot:args.snapshot}],nflHistory:args.history};
  const cached=fromCachedExport(source,args.window).packets[0];
  const packet:GamePacket=cached??{release:PRODUCT_RELEASE,sport:"nfl",gameId:args.game.id,start:args.game.start,lock:args.window.lock,cutoff:at,stage:args.window.stage,players:[],quotes:[],sourceLimitations:[]};
  const players=new Map<string,Player>(),quotes:Quote[]=[];let unresolved=0;
  const native=args.observations.observations.filter(q=>q.canonicalGameId===args.game.id&&(CATALOG.nfl.required as readonly string[]).includes(q.market));
  const currentNative=native.filter(q=>!q.isOpening&&!q.isLive&&q.receivedAt&&instant(q.receivedAt)<=instant(at)&&instant(q.observedAt)<=instant(q.receivedAt));
  for(const q of currentNative){
    const identity=resolveNflPropSourcePlayer({row:q,rows:args.snapshot.board.decisions,observations:currentNative,context:args.context,game:args.game,cutoff:at,observationsAvailableAt:args.observations.generatedAt,storedAvailableAt:args.snapshot.generatedAt});
    if(!identity){unresolved++;continue;}
    let player=players.get(identity.id);
    if(!player){
      const matches=packet.players.filter(p=>sameNflPropActorName(p.name,identity.name,identity.providerId)&&propsTeam(p.team)===identity.team);
      for(const old of matches){
        const ids=new Set(args.snapshot.memberDecisions.filter(r=>r.gameId===args.game.id&&r.playerName===old.name&&r.team===old.team).flatMap(r=>r.providerPlayerId?[r.providerPlayerId]:[]));
        invariant(ids.size<=1&&(!ids.size||ids.has(identity.providerId)),"Ambiguous NFL captured player");
      }
      const evidence=[...new Map(matches.flatMap(p=>p.evidence).map(e=>[digest({kind:e.kind,availableAt:e.availableAt,source:e.source,value:e.value}),e])).values()];
      const missing=[...new Set(matches.flatMap(p=>p.missing))].filter(s=>!s.includes("provider-ID reconciliation unverified"));
      player={id:identity.id,name:identity.name,team:identity.team,opponent:identity.opponent,markets:[],evidence,missing};players.set(identity.id,player);
    }
    if(!player.markets.includes(q.market))player.markets.push(q.market);
    const received=q.receivedAt;
    if(!received||q.isLive||instant(received)>instant(at)||instant(q.observedAt)>instant(received))continue;
    const sourceEvent=qualifyNflSourceEvent({market:q.market,provider:q.provider,providerMarket:q.providerMarket,observationId:q.providerObservationId,rosterPosition:identity.rosterPosition});
    const value={...(sourceEvent?{sourceEvent}:{}),playerId:identity.id,market:q.market,provider:q.provider,book:q.sportsbook,line:q.line,side:q.side,american:q.americanPrice,observedAt:q.observedAt,receivedAt:received,receivedAtProvenance:"provider_response" as const,opening:q.isOpening,live:false};
    quotes.push({...value,id:digest(value)});
  }
  // Historical openings supplement a verified current actor; they cannot create
  // an additional offered actor or block a currently complete game.
  for(const q of native.filter(q=>q.isOpening&&!q.isLive&&q.receivedAt&&instant(q.receivedAt)<=instant(at)&&instant(q.observedAt)<=instant(q.receivedAt))){
    let identity;try{identity=resolveNflPropSourcePlayer({row:q,rows:args.snapshot.board.decisions,observations:currentNative,context:args.context,game:args.game,cutoff:at,observationsAvailableAt:args.observations.generatedAt,storedAvailableAt:args.snapshot.generatedAt});}catch{continue;}
    const player=identity?players.get(identity.id):undefined;if(!identity||!player||!player.markets.includes(q.market))continue;
    const sourceEvent=qualifyNflSourceEvent({market:q.market,provider:q.provider,providerMarket:q.providerMarket,observationId:q.providerObservationId,rosterPosition:identity.rosterPosition});
    const value={...(sourceEvent?{sourceEvent}:{}),playerId:identity.id,market:q.market,provider:q.provider,book:q.sportsbook,line:q.line,side:q.side,american:q.americanPrice,observedAt:q.observedAt,receivedAt:q.receivedAt!,receivedAtProvenance:"provider_response" as const,opening:true,live:false};quotes.push({...value,id:digest(value)});
  }
  // Never silently omit a book-offered player with an unresolved identity.
  invariant(unresolved===0,`NFL offered-player identity coverage incomplete:${unresolved}`);
  if(!players.size&&args.emptyCurrentGame){
    const proof=args.emptyCurrentGame,available=instant(proof.availableAt),completed=instant(args.observations.generatedAt);
    const receipts=Object.values(proof.providerReceipts).map(instant);
    const games=args.observations.games.filter(game=>game.providerGameId===args.game.id);
    invariant(proof.release===NFL_PLAYER_PROPS_EMPTY_CURRENT_RELEASE&&args.observations.collectionComplete===true
      &&proof.gameId===args.game.id&&instant(proof.scheduledStart)===instant(args.game.start)
      &&propsTeam(proof.awayTeam)===propsTeam(args.game.away)&&propsTeam(proof.homeTeam)===propsTeam(args.game.home)
      &&games.length===1&&instant(games[0].scheduledStart)===instant(args.game.start)
      &&propsTeam(games[0].awayTeam)===propsTeam(args.game.away)&&propsTeam(games[0].homeTeam)===propsTeam(args.game.home)
      &&typeof proof.providerReceipts.balldontlie==='string'&&(!(args.observations.providerRequests.owls??0)||typeof proof.providerReceipts.owls==='string')
      &&receipts.every(receipt=>instant(args.observations.fetchedAt)<=receipt&&receipt<=completed)
      &&Math.max(...receipts)===available&&instant(proof.collectionGeneratedAt)===completed&&completed<=instant(at)
      &&native.every(row=>row.isOpening||row.isLive)&&!args.retainedQuotes?.length,
      'NFL empty current collection proof unavailable');
    // The exact stored aliases/scopes are withdrawal context only. They never
    // become offered actors, reconciled IDs, independent new heads or a paid
    // review. A game-wide empty execution authority also covers absent actors.
    const prior=args.withdrawalSnapshot??args.snapshot;
    const withdrawal=fromCachedExport({...source,nfl:[{week:prior.week,snapshot:prior}]},args.window).packets[0];
    invariant(withdrawal&&withdrawal.players.length>0&&instant(prior.generatedAt)<=instant(at)
      &&withdrawal.gameId===args.game.id&&instant(withdrawal.start)===instant(args.game.start)&&instant(withdrawal.lock)===instant(args.window.lock)
      &&withdrawal.players.every(player=>propsTeam(player.team)!==propsTeam(player.opponent)
        &&[args.game.away,args.game.home].some(team=>propsTeam(team)===propsTeam(player.team))
        &&[args.game.away,args.game.home].some(team=>propsTeam(team)===propsTeam(player.opponent))),
      'NFL empty current collection has no exact available withdrawal identity');
    return {...withdrawal,sourceInputRelease:NFL_PLAYER_PROPS_EMPTY_CURRENT_RELEASE,sourceOfferSetStatus:'empty',sourceOfferSetEvidence:json(proof),quotes:[],executionQuotes:[],
      sourceLimitations:[...withdrawal.sourceLimitations,'The successful complete current collection has no supported offered actors. Exact stored aliases, scopes and original evidence describe withdrawal context only; they are not current offer authority, a new independent forecast or a completed review. No scheduled token count, claim or generation is permitted.']};
  }
  invariant(players.size>0,"NFL complete source has no offered supported players");
  const qualifiedQuotes=qualifyConflictingSourceObservations(quotes);quotes.splice(0,quotes.length,...qualifiedQuotes);
  for(const player of players.values())if(player.markets.includes("interceptions")){
    const qualification=sourceEventSummary(quotes.filter(q=>q.playerId===player.id));
    player.sourceEventContracts={interceptions:qualification};
    player.evidence.push({id:`source-event:${player.id}:interceptions`,kind:"market",availableAt:at,source:"exact captured NFL provider declaration and same-actor roster context",value:json({market:"interceptions",sourceEventQualification:qualification})});
  }
  const retained=(args.retainedQuotes??[]).map(q=>q.market!=="interceptions"||q.sourceEvent?q:{...q,sourceEvent:qualifyNflSourceEvent({market:q.market,provider:q.provider,providerMarket:null,rosterPosition:null})!});
  const current={...packet,sourceInputRelease:PROPS_AI_NFL_SOURCE_RELEASE,sourceIdentityRelease:PROPS_AI_NFL_IDENTITY_RELEASE,sourceIdentityAvailableAt:args.observations.generatedAt,sourceLimitations:["Verified same-game current actor IDs. Stored model priors sharing a release remain correlated, including display aliases.",`Current rows without admissible provider receipt chronology: ${native.filter(q=>!q.isOpening&&!q.isLive).length-currentNative.length}; they cannot establish a current price.`,"Opening history supplements verified current actors and markets; orphan historical actors are not current offers.",...(currentNative.some(row=>row.collectedFixture)?["Current BDL fixture start/teams use the exact same-provider game ID from this collection's already fetched schedule. This is collection-time fixture context, not an original native quote schedule or quote/update clock; opening/history fields were not backfilled."]:[])],players:[...players.values()].map(p=>({...p,markets:p.markets.sort()})),quotes:[...quotes,...retained]};
  const enriched=enrichCachedPacket(current,source);
  const contexts:ReaderGameContext[]=args.context.games.map(g=>({id:`live:${g.canonicalGameId}`,gameId:g.canonicalGameId,start:g.scheduledStart,awayTeam:g.awayTeam,homeTeam:g.homeTeam,availableAt:args.context.capturedAt,source:"existing exact-game NFL collector",injuries:json(g.injuries),depth:json({away:g.awayDepth,home:g.homeDepth}),weather:json(g.weather??null)}));
  const contextual=attachGameReaderContext(enriched,contexts);
  return finish(args.marketHistory?attachNflReaderMarkets(contextual,args.marketHistory):contextual,at,quotes);
}
export function liveMlbPacket(args:{game:LivePropsGame;window:CapturedReviewWindow;snapshot:MlbPropsBoardSnapshot;currentOdds:readonly PropOddsSnapshot[];openingOdds:readonly PropOddsSnapshot[]}):GamePacket{
  const at=args.window.cutoff,source=emptyCapturedSource(at);
  const packet=mlbPackets(source,args.window,[args.snapshot])[0];invariant(packet,"MLB live source snapshot unavailable at cutoff; no earlier verified player mapping or native head may be manufactured");
  const quotes:Quote[]=[];
  const nativeRows=args.snapshot.data.props.filter(r=>r.providerIds?.gameId===args.game.id);
  const nativeGames=new Set(nativeRows.flatMap(r=>r.providerIds?.bdlGameId?[String(r.providerIds.bdlGameId)]:[]));
  for(const [opening,rows] of [[false,args.currentOdds],[true,args.openingOdds]] as const)for(const q of rows){
    if(!(CATALOG.mlb.required as readonly string[]).includes(q.marketKey)||!nativeGames.has(q.gameId.replace(/^balldontlie-game-/,"")))continue;
    const matching=nativeRows.filter(r=>String(r.providerIds?.bdlGameId)===q.gameId.replace(/^balldontlie-game-/,"")&&r.providerIds?.bdlPlayerId!==null&&String(r.providerIds?.bdlPlayerId)===q.playerId.replace(/^balldontlie-player-/,"")&&r.market===q.marketKey);
    const ids=new Set(matching.map(r=>r.providerIds?.mlbStatsPlayerId??`bdl:${r.providerIds?.bdlPlayerId}`));
    invariant(ids.size>0,"Offered MLB player identity missing from complete captured rows");invariant(ids.size===1,"Ambiguous MLB provider player identity");
    const raw=q.rawPayload&&typeof q.rawPayload==="object"&&!Array.isArray(q.rawPayload)?q.rawPayload as Record<string,unknown>:{};
    const declared=raw.market_kind==="milestone"?"milestone":raw.market_kind==="over_under"?"two_way":null;
    const exact=matching.filter(r=>quoteBook(r.book)===quoteBook(q.sportsbook)&&r.line===q.line&&r.side===q.side);
    const contracts=new Set(exact.map(r=>r.offerContract??"two_way"));
    invariant(declared!==null||contracts.size===1,"MLB source quote event contract is not uniquely declared");
    const offerContract=declared??[...contracts][0];
    // Declared raw contract owns its event. Identity is independently reconciled
    // across native rows; row order cannot relabel Over as an at-least milestone.
    const received=q.providerResponseAt;if(!received||instant(received)>instant(at)||instant(q.asOfTimestamp)>instant(received))continue;
    const value={playerId:[...ids][0],market:q.marketKey,provider:q.provider,book:q.sportsbook.toLowerCase().replace(/[^a-z0-9]/g,""),line:q.line,offerContract,side:offerContract==="milestone"?"yes" as const:q.side as Quote["side"],american:q.americanOdds,observedAt:q.asOfTimestamp,receivedAt:received,receivedAtProvenance:"provider_response" as const,opening,live:false};
    quotes.push({...value,id:digest(value)});
  }
  return finish({...packet,quotes:[...packet.quotes,...quotes]},at,quotes);
}
