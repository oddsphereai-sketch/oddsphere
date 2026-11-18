import {buildNbaPlayerPropsMemberSnapshot,type NbaPlayerPropsMemberSnapshot as Snapshot} from './nbaPlayerPropsProductContract';

export const NBA_PROPS_PUBLICATION_CONTINUITY_RELEASE='nba_props_publication_continuity_2026_11_18_r1_prior_display_only' as const;
export type NbaPropsPublicationContinuity=Readonly<{release:typeof NBA_PROPS_PUBLICATION_CONTINUITY_RELEASE;pending:readonly Readonly<{gameId:string;start:string;publishedAt:string}>[]}>;
const MAX_AGE_MS=15*60000;

/** These clocks describe an actual earlier canonical display, never a new
 * source observation, quote confirmation, review or first-lock authority. */
export function nbaPendingPublicationGames(snapshot:Snapshot|null):readonly string[]{
 const value=snapshot?.diagnostics.publicationContinuity;
 if(!value)return[];
 if(value.release!==NBA_PROPS_PUBLICATION_CONTINUITY_RELEASE||!Array.isArray(value.pending)||value.pending.length>32)throw Error('NBA prior display metadata unavailable');
 const seen=new Set<string>();
 for(const p of value.pending){
  const game=snapshot!.games.find(g=>g.gameId===p.gameId);
  if(!game||seen.has(p.gameId)||Date.parse(game.scheduledStart)!==Date.parse(p.start)||!Number.isFinite(Date.parse(p.publishedAt))||Date.parse(p.publishedAt)>Date.parse(snapshot!.generatedAt))throw Error('NBA prior display clock/identity invalid');
  seen.add(p.gameId);
 }
 return[...seen];
}

/** Keep only exact, recent prior canonical rows while another game's source
 * callback is pending. A known lookup failure, changed window, expiry or lock
 * removes this display fallback. Stored locks always retain exact precedence. */
export function retainNbaPendingPublication(args:{snapshot:Snapshot;previous:Snapshot|null;pending:ReadonlySet<string>;unavailable:ReadonlySet<string>;knownGameId:string|null;now:string}):Snapshot{
 const {snapshot,previous}=args;
 nbaPendingPublicationGames(previous);
 const oldClocks=new Map(previous?.diagnostics.publicationContinuity?.pending.map(p=>[p.gameId,p])??[]);
 const oldRows=new Map(previous?.decisions.map(r=>[[r.gameId,r.playerId,r.market].join('|'),r])??[]);
 const pending=new Map<string,NbaPropsPublicationContinuity['pending'][number]>();
 const now=Date.parse(args.now);if(!Number.isFinite(now))throw Error('NBA prior display clock invalid');
 const decisions=snapshot.decisions.flatMap(row=>{
  if(!args.pending.has(row.gameId)||row.gameId===args.knownGameId)return[row];
  const prior=oldRows.get([row.gameId,row.playerId,row.market].join('|'));
  if(prior?.lockedAt)return[prior];
  if(!prior||!previous||args.unavailable.has(row.gameId)||previous.slateDate!==snapshot.slateDate)return[];
  const game=previous.games.find(g=>g.gameId===row.gameId),current=snapshot.games.find(g=>g.gameId===row.gameId);
  const publishedAt=oldClocks.get(row.gameId)?.publishedAt??previous.generatedAt,at=Date.parse(publishedAt);
  if(!game||!current||Date.parse(game.scheduledStart)!==Date.parse(current.scheduledStart)||Date.parse(prior.scheduledStart)!==Date.parse(current.scheduledStart)||!Number.isFinite(at)||at>now||now-at>MAX_AGE_MS||now>=Date.parse(prior.scheduledStart)-3600000)return[];
  pending.set(row.gameId,{gameId:row.gameId,start:game.scheduledStart,publishedAt});
  return[prior];
 });
 const metadata=pending.size?{release:NBA_PROPS_PUBLICATION_CONTINUITY_RELEASE,pending:[...pending.values()]}:undefined;
 if(decisions.length===snapshot.decisions.length&&decisions.every((row,i)=>row===snapshot.decisions[i])&&JSON.stringify(metadata)===JSON.stringify(snapshot.diagnostics.publicationContinuity))return snapshot;
 const rebuilt=buildNbaPlayerPropsMemberSnapshot({...snapshot,decisions,inputRows:snapshot.diagnostics.inputRows});
 const {publicationContinuity:removed,...diagnostics}=snapshot.diagnostics;void removed;
 return{...snapshot,...rebuilt,diagnostics:{...diagnostics,...rebuilt.diagnostics,...(metadata?{publicationContinuity:metadata}:{})}};
}
