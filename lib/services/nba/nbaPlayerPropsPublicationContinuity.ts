import {buildNbaPlayerPropsMemberSnapshot,type NbaPlayerPropsMemberSnapshot as Snapshot} from './nbaPlayerPropsProductContract';

export const NBA_PROPS_PUBLICATION_CONTINUITY_RELEASE='nba_props_publication_continuity_2026_11_18_r1_prior_display_only' as const;
type Clock=Readonly<{gameId:string;start:string;publishedAt:string;pending:boolean;failed:boolean;pendingSince:string|null}>;
export type NbaPropsPublicationContinuity=Readonly<{release:typeof NBA_PROPS_PUBLICATION_CONTINUITY_RELEASE;games:readonly Clock[]}>;
const MAX_PRIOR_AGE_MS=90*60000,MAX_PENDING_MS=15*60000;
/** Only actual source-callback publication clocks qualify. A legacy whole-slate
 * header or row evaluation time cannot reconstruct a missing game clock. */
export function nbaPublicationClocks(snapshot:Snapshot|null):ReadonlyMap<string,Clock>{
 const value=snapshot?.diagnostics.publicationContinuity;const clocks=new Map<string,Clock>();
 if(!value)return clocks;
 if(value.release!==NBA_PROPS_PUBLICATION_CONTINUITY_RELEASE||!Array.isArray(value.games)||value.games.length>32)throw Error('NBA prior display metadata unavailable');
 for(const p of value.games){
  const game=snapshot!.games.find(g=>g.gameId===p.gameId);
  if(!game||clocks.has(p.gameId)||typeof p.pending!=='boolean'||typeof p.failed!=='boolean'||Object.keys(p).sort().join('|')!=='failed|gameId|pending|pendingSince|publishedAt|start'||Date.parse(game.scheduledStart)!==Date.parse(p.start)||!Number.isFinite(Date.parse(p.publishedAt))||Date.parse(p.publishedAt)>Date.parse(snapshot!.generatedAt))throw Error('NBA prior display clock/identity invalid');
  if(p.pending?(!p.pendingSince||!Number.isFinite(Date.parse(p.pendingSince))||Date.parse(p.pendingSince)<Date.parse(p.publishedAt)||Date.parse(p.pendingSince)>Date.parse(snapshot!.generatedAt)):(p.pendingSince!==null||p.failed))throw Error('NBA pending display interval invalid');
  clocks.set(p.gameId,p);
 }
 return clocks;
}
export function nbaPendingPublicationGames(snapshot:Snapshot|null):readonly string[]{return[...nbaPublicationClocks(snapshot).values()].filter(c=>c.pending).map(c=>c.gameId);}

/** Prior displays use the existing90minute LKG age ceiling and a separate
 * nonrenewable15minute pending interval, with original per-card as-of values.
 * Pending rows remain a prior display, never a new source, quote or first-lock
 * authority. Every game clock persists after resolution and sibling commits. */
export function retainNbaPendingPublication(args:{snapshot:Snapshot;previous:Snapshot|null;pending:ReadonlySet<string>;unavailable:ReadonlySet<string>;knownGameId:string|null;now:string}):Snapshot{
 const {snapshot,previous}=args,oldClocks=nbaPublicationClocks(previous),clocks=new Map<string,Clock>();
 const oldRows=new Map(previous?.decisions.map(r=>[[r.gameId,r.playerId,r.market].join('|'),r])??[]);
 const now=Date.parse(args.now);if(!Number.isFinite(now))throw Error('NBA prior display clock invalid');
 for(const [id,clock]of oldClocks){const game=snapshot.games.find(g=>g.gameId===id);if(game&&Date.parse(game.scheduledStart)===Date.parse(clock.start))clocks.set(id,clock);}
 if(args.knownGameId){const game=snapshot.games.find(g=>g.gameId===args.knownGameId);if(!game)throw Error('NBA known publication game unavailable');clocks.set(game.gameId,{gameId:game.gameId,start:game.scheduledStart,publishedAt:args.now,pending:false,failed:false,pendingSince:null});}
 const decisions=snapshot.decisions.flatMap(row=>{
  if(!args.pending.has(row.gameId)||row.gameId===args.knownGameId)return[row];
  const prior=oldRows.get([row.gameId,row.playerId,row.market].join('|'));
  if(prior?.lockedAt)return[prior];
  const clock=oldClocks.get(row.gameId),current=snapshot.games.find(g=>g.gameId===row.gameId);
  if(!prior||!previous||!clock||clock.failed||!current||args.unavailable.has(row.gameId)||previous.slateDate!==snapshot.slateDate||Date.parse(clock.start)!==Date.parse(current.scheduledStart)||Date.parse(prior.scheduledStart)!==Date.parse(current.scheduledStart)||Date.parse(clock.publishedAt)>now||now-Date.parse(clock.publishedAt)>MAX_PRIOR_AGE_MS||(clock.pending&&(!clock.pendingSince||now-Date.parse(clock.pendingSince)>MAX_PENDING_MS))||now>=Date.parse(prior.scheduledStart)-3600000){clocks.delete(row.gameId);return[];}
  clocks.set(row.gameId,{...clock,pending:true,pendingSince:clock.pending?clock.pendingSince:args.now});return[prior];
 });
 for(const id of args.unavailable)if(id!==args.knownGameId&&!decisions.some(r=>r.gameId===id&&r.lockedAt))clocks.delete(id);
 const metadata=clocks.size?{release:NBA_PROPS_PUBLICATION_CONTINUITY_RELEASE,games:[...clocks.values()].sort((a,b)=>a.gameId.localeCompare(b.gameId))}:undefined;
 if(decisions.length===snapshot.decisions.length&&decisions.every((row,i)=>row===snapshot.decisions[i])&&JSON.stringify(metadata)===JSON.stringify(snapshot.diagnostics.publicationContinuity))return snapshot;
 const rebuilt=buildNbaPlayerPropsMemberSnapshot({...snapshot,decisions,inputRows:snapshot.diagnostics.inputRows});
 const {publicationContinuity:removed,...diagnostics}=snapshot.diagnostics;void removed;
 return{...snapshot,...rebuilt,diagnostics:{...diagnostics,...rebuilt.diagnostics,...(metadata?{publicationContinuity:metadata}:{})}};
}
/** Read-time expiry covers a crashed writer before any later cron runs.
 * Existing stored locks are always rendered verbatim and take precedence. */
export function nbaVisiblePublicationRows(snapshot:Snapshot,now:string){
 if(snapshot.decisions.every(row=>row.lockedAt))return snapshot.decisions;
 let clocks:ReadonlyMap<string,Clock>;try{clocks=nbaPublicationClocks(snapshot);}catch{return snapshot.decisions.filter(row=>row.lockedAt);}
 const at=Date.parse(now);if(!Number.isFinite(at))throw Error('NBA display read clock invalid');
 const rows=snapshot.decisions.filter(row=>{if(row.lockedAt)return true;const clock=clocks.get(row.gameId);return!clock?.pending||(!clock.failed&&Date.parse(clock.publishedAt)<=at&&at-Date.parse(clock.publishedAt)<=MAX_PRIOR_AGE_MS&&Boolean(clock.pendingSince)&&at-Date.parse(clock.pendingSince!)<=MAX_PENDING_MS&&at<Date.parse(row.scheduledStart)-3600000);});
 return rows.length===snapshot.decisions.length?snapshot.decisions:rows;
}
